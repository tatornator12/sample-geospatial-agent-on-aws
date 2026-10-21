/**
 * Unit tests for listAgents (GET /api/agents parsing). fetch is stubbed; under jsdom the
 * module-level API URL resolves to http://localhost:3001.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAgents, loadVesselRest, prewarmSession, streamAgentInvoke } from './api.ts';
import type { StreamEvent, ToolCall } from '../types.ts';
import { vesselsDirFrom } from '../utils/vesselSteps.ts';

function fetchResponding(status: number, payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listAgents', () => {
  it('returns the agent list and default from the backend', async () => {
    const payload = {
      defaultAgentId: 'dev',
      agents: [
        { id: 'dev', label: 'Earth Analyst (dev)', description: 'Development runtime' },
        { id: 'stable', label: 'Earth Analyst (stable)', description: 'Live demo runtime' },
      ],
    };
    const fetchMock = fetchResponding(200, payload);
    vi.stubGlobal('fetch', fetchMock);

    const result = await listAgents();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/agents',
      expect.objectContaining({ headers: expect.anything() })
    );
  });

  it('normalizes a missing default and missing agents array', async () => {
    vi.stubGlobal('fetch', fetchResponding(200, {}));

    const result = await listAgents();

    expect(result).toEqual({ defaultAgentId: null, agents: [] });
  });

  it('normalizes a non-array agents field', async () => {
    vi.stubGlobal('fetch', fetchResponding(200, { defaultAgentId: 'x', agents: { nope: true } }));

    const result = await listAgents();

    expect(result.agents).toEqual([]);
    expect(result.defaultAgentId).toBe('x');
  });

  it('throws with the HTTP status on a failed response', async () => {
    vi.stubGlobal('fetch', fetchResponding(500, { error: 'boom' }));

    await expect(listAgents()).rejects.toThrow(/HTTP 500/);
  });
});

describe('prewarmSession', () => {
  it('posts the session and agent and reports acceptance', async () => {
    const fetchMock = fetchResponding(202, { warming: true });
    vi.stubGlobal('fetch', fetchMock);

    expect(await prewarmSession('0123456789abcdef0123456789abcdef0123', 'dev')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/agent/prewarm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: '0123456789abcdef0123456789abcdef0123', agentId: 'dev' }),
      })
    );
  });

  it('never throws: a network failure or error status is just false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    expect(await prewarmSession('0123456789abcdef0123456789abcdef0123')).toBe(false);

    vi.stubGlobal('fetch', fetchResponding(503, { error: 'no runtime' }));
    expect(await prewarmSession('0123456789abcdef0123456789abcdef0123')).toBe(false);
  });
});

describe('loadVesselRest (Dark Vessels, review M3)', () => {
  const SID = '0b6c9a0e-1111-4222-8333-444455556666';
  const rest = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    pass: { pass_id: 's1d-20261012t0018', satellite: 'Sentinel-1D', sensed: '2026-10-12T00:18:02Z', orbit_state: 'ASCENDING' },
    replay: { start: '2026-10-10T00:18Z', end: '2026-10-12T00:18Z', tracks: [] },
    reserve: { type: 'Polygon', coordinates: [] },
    ports: [], islands: [], passes: [], attribution: 'Powered by Global Fishing Watch.',
    ...extra,
  });
  // Before any s3_url has streamed, only the list_passes call is on the stage.
  const listing: ToolCall[] = [{ id: 'tooluse_list1', name: 'list_passes', params: {}, status: 'completed' }];

  it('keeps a bucket that passes the bucket rule, so the board can load before the radar', async () => {
    vi.stubGlobal('fetch', fetchResponding(200, rest({ bucket: 'geo-agent-bucket' })));
    const loaded = await loadVesselRest();
    expect(loaded?.bucket).toBe('geo-agent-bucket');
    expect(vesselsDirFrom(listing, SID, { bucket: loaded?.bucket })).toBe(`s3://geo-agent-bucket/session_data/${SID}/vessels/`);
  });

  it('leaves the fallback off with no bucket, or one that fails the rule: the column waits for a streamed s3_url', async () => {
    for (const bad of [undefined, null, '', 'Geo_Bucket', 'a', '-bucket', 'bucket/../x', 's3://bucket', 42]) {
      vi.stubGlobal('fetch', fetchResponding(200, bad === undefined ? rest() : rest({ bucket: bad })));
      const loaded = await loadVesselRest();
      // The rest itself still loads (the sea at night), only the bucket is dropped.
      expect(loaded?.version).toBe(1);
      expect(loaded?.bucket).toBeNull();
      expect(vesselsDirFrom(listing, SID, { bucket: loaded?.bucket })).toBeNull();
    }
  });

  it('is null when nothing is published', async () => {
    vi.stubGlobal('fetch', fetchResponding(404, { error: 'No resting state published yet' }));
    expect(await loadVesselRest()).toBeNull();
    vi.stubGlobal('fetch', fetchResponding(200, { version: 2 }));
    expect(await loadVesselRest()).toBeNull();
  });
});

describe('streamAgentInvoke', () => {
  const SESSION = '0123456789abcdef0123456789abcdef0123';
  const line = (event: StreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

  /** An SSE body that sends `lines` and then stays open; records whether it was cancelled.
   * (ReadableStream is Node's global; jsdom does not replace it.) */
  function openBody(lines: string[]) {
    const state = { cancelled: false };
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const l of lines) controller.enqueue(encoder.encode(l));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { body, state };
  }

  function fetchStreaming(body: unknown) {
    return vi.fn().mockResolvedValue({ ok: true, status: 200, body });
  }

  it('passes the signal to fetch', async () => {
    const { body } = openBody([line({ type: 'done' })]);
    const fetchMock = fetchStreaming(body);
    vi.stubGlobal('fetch', fetchMock);
    const ctl = new AbortController();

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION, undefined, 'dev', ctl.signal)) events.push(event);

    expect(events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/agent/invoke',
      expect.objectContaining({ signal: ctl.signal })
    );
  });

  it('ends quietly on abort mid-stream and cancels the body', async () => {
    const { body, state } = openBody([line({ type: 'chunk', content: 'first' })]);
    vi.stubGlobal('fetch', fetchStreaming(body));
    const ctl = new AbortController();
    const stream = streamAgentInvoke('q', SESSION, undefined, 'dev', ctl.signal);

    const first = await stream.next();
    expect(first.value).toEqual({ type: 'chunk', content: 'first' });

    // The next read is pending on a body that stays open; ending the turn resolves it.
    const pending = stream.next();
    ctl.abort();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(state.cancelled).toBe(true);
  });

  it('returns without fetching or throwing when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctl = new AbortController();
    ctl.abort();

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION, undefined, 'dev', ctl.signal)) events.push(event);

    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an aborted fetch as the end of the turn, not an error', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      ctl.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }));

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION, undefined, 'dev', ctl.signal)) events.push(event);

    expect(events).toEqual([]);
  });

  it('still ends on a done event, without cancelling a finished body', async () => {
    const { body, state } = openBody([line({ type: 'chunk', content: 'a' }), line({ type: 'done' })]);
    vi.stubGlobal('fetch', fetchStreaming(body));

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION)) events.push(event);

    expect(events).toEqual([{ type: 'chunk', content: 'a' }]);
    expect(state.cancelled).toBe(false);
  });

  it('still yields an error event', async () => {
    const crash: StreamEvent = { type: 'error', code: 'RUNTIME_CRASH', message: 'RuntimeClientError' };
    const { body } = openBody([line(crash), line({ type: 'done' })]);
    vi.stubGlobal('fetch', fetchStreaming(body));

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION)) events.push(event);

    expect(events).toEqual([crash]);
  });

  it('closes the body when the caller stops reading early', async () => {
    const { body, state } = openBody([line({ type: 'chunk', content: 'a' })]);
    vi.stubGlobal('fetch', fetchStreaming(body));

    const events: StreamEvent[] = [];
    for await (const event of streamAgentInvoke('q', SESSION)) {
      events.push(event);
      break;
    }

    expect(events).toEqual([{ type: 'chunk', content: 'a' }]);
    expect(state.cancelled).toBe(true);
  });
});
