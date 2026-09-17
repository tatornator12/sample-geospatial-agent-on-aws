/**
 * Unit tests for the stream-parsing layer: parseToolCalls (brace-matched tool JSON in the
 * SSE text) and extractAllVisualizationData (rasters vs geometries from display_visual).
 */
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import { extractAllVisualizationData, parseToolCalls } from './parsing.ts';

/** Build the exact wire format: a tool-call JSON object whose input is a JSON string. */
function toolJson(id: string, name: string, params: Record<string, unknown>): string {
  return JSON.stringify({ toolUseId: id, name, input: JSON.stringify(params) });
}

function completedTool(name: string, params: Record<string, unknown>, id = 'tool_1'): ToolCall {
  return { name, id, params, status: 'completed' };
}

describe('parseToolCalls', () => {
  it('parses a complete tool call and strips its JSON from the text', () => {
    const text = `Analyzing the area now. ${toolJson('t1', 'display_visual', {
      s3_url: 's3://bucket/ndvi.tif',
      title: 'NDVI',
    })} Done.`;

    const { cleanText, tools } = parseToolCalls(text);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: 't1',
      name: 'display_visual',
      status: 'completed',
      params: { s3_url: 's3://bucket/ndvi.tif', title: 'NDVI' },
    });
    expect(cleanText).not.toContain('toolUseId');
    expect(cleanText.replace(/\s+/g, ' ')).toBe('Analyzing the area now. Done.');
  });

  it('drops an outer JSON object truncated by the stream and trims the tail', () => {
    const text = 'Working on it. {"toolUseId": "t9", "name": "display_visual", "input": "{\\"s3_url';

    const { cleanText, tools } = parseToolCalls(text);

    expect(tools).toHaveLength(0);
    expect(cleanText).toBe('Working on it.');
  });

  it('recovers s3_url and title from a truncated input field via the regex fallback', () => {
    // The outer object is complete, but the input JSON string was cut mid-value.
    const text = JSON.stringify({
      toolUseId: 't2',
      name: 'display_visual',
      input: '{"s3_url": "s3://bucket/fire.tif", "title": "Fire severity',
    });

    const { tools } = parseToolCalls(text);

    expect(tools).toHaveLength(1);
    expect(tools[0].params).toMatchObject({
      s3_url: 's3://bucket/fire.tif',
      title: 'Fire severity',
    });
  });

  it('de-duplicates repeated toolUseIds, keeping the first occurrence', () => {
    const first = toolJson('dup', 'display_visual', { s3_url: 's3://b/a.tif', title: 'A' });
    const second = toolJson('dup', 'display_visual', { s3_url: 's3://b/b.tif', title: 'B' });

    const { tools } = parseToolCalls(`${first}\n${second}`);

    expect(tools).toHaveLength(1);
    expect(tools[0].params.s3_url).toBe('s3://b/a.tif');
  });

  it('keeps distinct tools in stream order', () => {
    const text = [
      toolJson('t1', 'get_rasters', { location: 'hyde_park' }),
      toolJson('t2', 'run_bandmath', { index: 'ndvi' }),
      toolJson('t3', 'display_visual', { s3_url: 's3://b/x.tif', title: 'X' }),
    ].join(' then ');

    const { cleanText, tools } = parseToolCalls(text);

    expect(tools.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(cleanText.replace(/\s+/g, ' ')).toBe('then then');
  });

  it('puts markdown headings on their own line', () => {
    const { cleanText } = parseToolCalls('Results below:## Analysis');
    expect(cleanText).toBe('Results below:\n\n## Analysis');
  });
});

describe('extractAllVisualizationData', () => {
  it('routes .tif to rasters with date and cloud coverage, .geojson to geometries', () => {
    const tools = [
      completedTool(
        'display_visual',
        {
          s3_url: 's3://bucket/session/ndvi_clipped_geneva_2025-10-07.tif',
          title: 'NDVI Geneva',
          description: 'NDVI composite (12.5% cloud coverage)',
        },
        'r1'
      ),
      completedTool(
        'display_visual',
        { s3_url: 's3://bucket/session/geneva_boundary.geojson', title: 'Geneva boundary' },
        'g1'
      ),
    ];

    const { rasters, geometries } = extractAllVisualizationData(tools);

    expect(rasters).toEqual([
      {
        url: 's3://bucket/session/ndvi_clipped_geneva_2025-10-07.tif',
        title: 'NDVI Geneva',
        date: '2025-10-07',
        cloudCoverage: '12.5%',
      },
    ]);
    expect(geometries).toEqual([
      { url: 's3://bucket/session/geneva_boundary.geojson', title: 'Geneva boundary' },
    ]);
  });

  it('leaves date and cloud coverage undefined when absent', () => {
    const { rasters } = extractAllVisualizationData([
      completedTool('display_visual', { s3_url: 's3://b/plain.tif', title: 'Plain' }),
    ]);

    expect(rasters[0].date).toBeUndefined();
    expect(rasters[0].cloudCoverage).toBeUndefined();
  });

  it('accepts uppercase extensions', () => {
    const { rasters } = extractAllVisualizationData([
      completedTool('display_visual', { s3_url: 's3://b/SHOUT_2024-01-02.TIF', title: 'Shout' }),
    ]);
    expect(rasters).toHaveLength(1);
    expect(rasters[0].date).toBe('2024-01-02');
  });

  it('de-duplicates by S3 URL across tool calls', () => {
    const params = { s3_url: 's3://b/once.tif', title: 'Once' };
    const { rasters } = extractAllVisualizationData([
      completedTool('display_visual', params, 'a'),
      completedTool('display_visual', params, 'b'),
    ]);
    expect(rasters).toHaveLength(1);
  });

  it('skips incomplete display_visual calls and other tools', () => {
    const { rasters, geometries } = extractAllVisualizationData([
      completedTool('display_visual', { s3_url: 's3://b/no-title.tif' }), // missing title
      completedTool('display_visual', { s3_url: 'https://not-s3/x.tif', title: 'Wrong scheme' }),
      completedTool('get_rasters', { s3_url: 's3://b/other-tool.tif', title: 'Other' }),
    ]);

    expect(rasters).toHaveLength(0);
    expect(geometries).toHaveLength(0);
  });
});
