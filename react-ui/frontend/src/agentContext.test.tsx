/**
 * The agent list (S8, S9): a backend that cannot be reached is asked again (2, 4, 8, 16 s, then
 * every 30 s) until it answers, and the first answer selects as a first load does; an id the
 * switcher does not offer falls back to the backend's default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

vi.mock('./services/api', () => ({ listAgents: vi.fn() }));

import { listAgents } from './services/api';
import { AgentProvider, useAgents } from './agentContext';

const LIST = {
  defaultAgentId: 'stable',
  agents: [
    { id: 'stable', label: 'Earth Analyst (stable)', description: 'Live demo runtime, deployed from demo-stable' },
    { id: 'dev', label: 'Earth Analyst (dev)', description: 'Development runtime, deployed from develop' },
    { id: 'methane', label: 'Methane Hunter', description: 'EMIT methane plumes, deployed from demo-stable' },
  ],
};

let seen: ReturnType<typeof useAgents> | null = null;
function Probe() {
  seen = useAgents();
  return null;
}

function mount(url = '/') {
  window.history.replaceState({}, '', url);
  render(
    <AgentProvider>
      <Probe />
    </AgentProvider>
  );
}

// Let the pending listAgents promise settle, then move the clock on.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('DEV', false);
  vi.mocked(listAgents).mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  seen = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

describe('AgentProvider when the backend cannot be reached', () => {
  it('tries again after 2 s and 4 s, and the first answer selects the act', async () => {
    vi.mocked(listAgents)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(LIST);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount('/?agent=methane');

    await advance(0);
    expect(seen?.status).toBe('error');
    expect(seen?.selectedAgentId).toBeNull();
    expect(seen!.retryAt! - Date.now()).toBe(2000);
    expect(listAgents).toHaveBeenCalledTimes(1);

    await advance(1999);
    expect(listAgents).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(seen?.status).toBe('error');
    expect(seen!.retryAt! - Date.now()).toBe(4000);

    await advance(4000);
    expect(listAgents).toHaveBeenCalledTimes(3);
    expect(seen?.status).toBe('ready');
    expect(seen?.retryAt).toBeNull();
    expect(seen?.selectedAgentId).toBe('methane');
  });

  it('backs off 2, 4, 8, 16 s, then every 30 s', async () => {
    vi.mocked(listAgents).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    await advance(0);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const wait = seen!.retryAt! - Date.now();
      waits.push(wait);
      await advance(wait);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(listAgents).toHaveBeenCalledTimes(7);
  });

  it('retry() asks at once and restarts the wait', async () => {
    vi.mocked(listAgents).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(LIST);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    await advance(0);
    expect(seen?.status).toBe('error');

    await act(async () => {
      seen!.retry();
    });
    await advance(0);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(seen?.status).toBe('ready');
    expect(seen?.selectedAgentId).toBe('stable');

    // The timer of the failed attempt never fires a third request.
    await advance(5000);
    expect(listAgents).toHaveBeenCalledTimes(2);
  });
});

describe('AgentProvider choosing the act', () => {
  it('outside rehearsal, ?agent=dev lands on the backend default and dev is not offered', async () => {
    vi.mocked(listAgents).mockResolvedValue(LIST);
    mount('/?agent=dev');
    await advance(0);
    expect(seen?.rehearsal).toBe(false);
    expect(seen?.selectedAgentId).toBe('stable');
    expect(seen?.agents.map((a) => a.id)).toEqual(['stable', 'methane']);
    expect(seen?.selectedAgent?.roomName).toBe('Earth Analyst');
    expect(seen?.selectedAgent?.label).toBe('Earth Analyst (stable)');
  });

  it('a remembered dev runtime falls back the same way', async () => {
    vi.mocked(listAgents).mockResolvedValue(LIST);
    window.localStorage.setItem('agentic-earth.agent', 'dev');
    mount('/');
    await advance(0);
    expect(seen?.selectedAgentId).toBe('stable');
  });

  it('with ?dev=1, ?agent=dev selects the dev runtime', async () => {
    vi.mocked(listAgents).mockResolvedValue(LIST);
    mount('/?agent=dev&dev=1');
    await advance(0);
    expect(seen?.rehearsal).toBe(true);
    expect(seen?.selectedAgentId).toBe('dev');
    expect(seen?.agents.map((a) => a.id)).toEqual(['stable', 'methane', 'dev']);
  });
});
