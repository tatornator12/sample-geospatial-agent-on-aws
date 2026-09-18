/**
 * Unit tests for listAgents (GET /api/agents parsing). fetch is stubbed; under jsdom the
 * module-level API URL resolves to http://localhost:3001.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAgents, prewarmSession } from './api.ts';

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
