import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import { evidenceUrlsFor, extractEvidence } from './evidence.ts';

const SESSION = 's3://bucket/session_data/abc-123/';

function inspect(id: string, params: Record<string, unknown>): ToolCall {
  return { id, name: 'inspect_image', params, status: 'completed' };
}

describe('evidenceUrlsFor', () => {
  it('maps a true-colour raster to a jpg first, png fallback', () => {
    expect(evidenceUrlsFor(`${SESSION}rasters/tci_clipped_hyde_park_2026-08-21.tif`)).toEqual([
      `${SESSION}inspections/tci_clipped_hyde_park_2026-08-21.jpg`,
      `${SESSION}inspections/tci_clipped_hyde_park_2026-08-21.png`,
    ]);
  });

  it('maps an index raster to a png first, jpg fallback', () => {
    expect(evidenceUrlsFor(`${SESSION}rasters/ndvi_clipped_hyde_park_2026-08-21.tif`)).toEqual([
      `${SESSION}inspections/ndvi_clipped_hyde_park_2026-08-21.png`,
      `${SESSION}inspections/ndvi_clipped_hyde_park_2026-08-21.jpg`,
    ]);
  });

  it('works for change maps in other session folders and keeps the stem', () => {
    const urls = evidenceUrlsFor(`${SESSION}change_detection/change_detection_composite_manaus.tif`);
    expect(urls?.[0]).toBe(`${SESSION}inspections/change_detection_composite_manaus.png`);
  });

  it('rejects non-session and non-s3 urls', () => {
    expect(evidenceUrlsFor('s3://bucket/other/tci.tif')).toBeNull();
    expect(evidenceUrlsFor('https://example.com/session_data/x/rasters/tci.tif')).toBeNull();
    expect(evidenceUrlsFor('')).toBeNull();
  });

  it('maps a shared plume raster to THIS session\'s inspections (Week 4)', () => {
    const plume = 's3://bucket/methane/cache/ch4plm_EMIT_L2B_CH4PLM_002_20240131T182459_002534.tif';
    expect(evidenceUrlsFor(plume, 'abc-123')).toEqual([
      's3://bucket/session_data/abc-123/inspections/ch4plm_EMIT_L2B_CH4PLM_002_20240131T182459_002534.png',
      's3://bucket/session_data/abc-123/inspections/ch4plm_EMIT_L2B_CH4PLM_002_20240131T182459_002534.jpg',
    ]);
    // No session, or one that could climb out of its prefix: no chip.
    expect(evidenceUrlsFor(plume)).toBeNull();
    expect(evidenceUrlsFor(plume, '../other')).toBeNull();
    expect(evidenceUrlsFor('s3://bucket/methane/cache/../secrets/ch4plm_x.tif', 'abc-123')).toBeNull();
  });

  it('maps a replay case raster to the case\'s own inspections (Week 4)', () => {
    expect(evidenceUrlsFor('s3://bucket/use-cases/methane-permian-2024/tci_clipped_midland_2023-12-28.tif')).toEqual([
      's3://bucket/use-cases/methane-permian-2024/inspections/tci_clipped_midland_2023-12-28.jpg',
      's3://bucket/use-cases/methane-permian-2024/inspections/tci_clipped_midland_2023-12-28.png',
    ]);
    expect(evidenceUrlsFor('s3://bucket/use-cases/methane-permian-2024/ch4plm_x.tif')?.[0]).toBe(
      's3://bucket/use-cases/methane-permian-2024/inspections/ch4plm_x.png'
    );
    expect(evidenceUrlsFor('s3://bucket/use-cases/Bad_Id/x.tif')).toBeNull();
    expect(evidenceUrlsFor('s3://bucket/use-cases/case/../x.tif')).toBeNull();
  });
});

describe('extractEvidence', () => {
  it('turns complete inspect_image calls into evidence items in stream order', () => {
    const items = extractEvidence([
      { id: 'g1', name: 'get_rasters', params: { location: 'x' }, status: 'completed' },
      inspect('i1', { s3_url: `${SESSION}rasters/tci_clipped_x_2026-01-01.tif`, title: 'True colour', question: 'cloud?' }),
      inspect('i2', { s3_url: `${SESSION}rasters/ndvi_clipped_x_2026-01-01.tif`, title: 'NDVI' }),
    ]);
    expect(items.map((i) => i.toolId)).toEqual(['i1', 'i2']);
    expect(items[0]).toMatchObject({ title: 'True colour', question: 'cloud?' });
    expect(items[0].evidenceUrls[0]).toBe(`${SESSION}inspections/tci_clipped_x_2026-01-01.jpg`);
    expect(items[1].question).toBeUndefined();
  });

  it('skips truncated inputs until s3_url and title are both present', () => {
    expect(extractEvidence([inspect('i1', { s3_url: `${SESSION}rasters/tci.tif` })])).toEqual([]);
    expect(extractEvidence([inspect('i1', { title: 'x' })])).toEqual([]);
    expect(extractEvidence([inspect('i1', {})])).toEqual([]);
  });

  it('skips urls that are not session rasters and de-duplicates by tool id', () => {
    const items = extractEvidence([
      inspect('i1', { s3_url: 'https://elsewhere/x.tif', title: 'nope' }),
      inspect('i2', { s3_url: `${SESSION}rasters/tci.tif`, title: 'first' }),
      inspect('i2', { s3_url: `${SESSION}rasters/tci.tif`, title: 'duplicate' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('first');
  });
});
