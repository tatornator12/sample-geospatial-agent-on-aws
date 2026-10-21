/**
 * The rail's backend notice (S8): it says what is wrong and when the stage tries again, counts
 * down, "Retry now" asks at once, and it goes the moment the backend answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../services/api', () => ({ listAgents: vi.fn() }));

import { listAgents } from '../services/api';
import { AgentProvider } from '../agentContext';
import { BackendNotice } from './BackendNotice';

const LIST = {
  defaultAgentId: 'stable',
  agents: [{ id: 'stable', label: 'Earth Analyst (stable)', description: '' }],
};

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount() {
  render(
    <AgentProvider>
      <BackendNotice />
    </AgentProvider>
  );
}

const wait = () => screen.getByRole('status').nextElementSibling?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(listAgents).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BackendNotice', () => {
  it('shows nothing while the list loads or once it has loaded', async () => {
    vi.mocked(listAgents).mockResolvedValue(LIST);
    mount();
    expect(screen.queryByRole('status')).toBeNull();
    await advance(0);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
  });

  it('says the backend is unreachable and counts down to the next try', async () => {
    vi.mocked(listAgents).mockRejectedValue(new TypeError('Failed to fetch'));
    mount();
    await advance(0);
    expect(screen.getByRole('status').textContent).toBe("Can't reach the stage backend.");
    expect(wait()).toBe('Retrying in 2 s.');
    await advance(1000);
    expect(wait()).toBe('Retrying in 1 s.');
    // The second try fails too: the wait doubles.
    await advance(1000);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(wait()).toBe('Retrying in 4 s.');
    await advance(1000);
    expect(wait()).toBe('Retrying in 3 s.');
  });

  it('"Retry now" asks the backend at once, and the notice goes when it answers', async () => {
    vi.mocked(listAgents).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(LIST);
    mount();
    await advance(0);
    expect(listAgents).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    });
    await advance(0);
    expect(listAgents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull();
  });
});
