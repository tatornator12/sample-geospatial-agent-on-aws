/**
 * Unit tests for listAgents (GET /api/agents parsing). fetch is stubbed; under jsdom the
 * module-level API URL resolves to http://localhost:3001.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAgents } from './api.ts';

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
