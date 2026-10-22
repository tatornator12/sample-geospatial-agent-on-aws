/**
 * A prompt sent while the stage backend is unreachable (S8): the real stream client's fetch fails
 * the way a browser's does, and the step column says the stage cannot reach the backend, not that
 * the agent stopped (it never started).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return {
    ...actual,
    stopRuntimeSession: vi.fn().mockResolvedValue(true),
    loadGeometry: vi.fn(),
    getPresignedUrl: vi.fn().mockResolvedValue(null),
    getBrief: vi.fn().mockResolvedValue(null),
    approveBrief: vi.fn(),
  };
});

import { ChatSidebar } from './ChatSidebar.tsx';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('A prompt with the backend unreachable', () => {
  it('says the stage cannot reach the backend, and the console is free again', async () => {
    render(
      <ChatSidebar
        sessionId="11111111-1111-4111-8111-111111111111"
        agentId="vessels"
        onSessionReset={vi.fn()}
        onGeometryUpdate={vi.fn()}
        onRastersUpdate={vi.fn()}
      />
    );
    const input = document.querySelector('.docent-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('Ask about the reserve, or a radar pass on file');

    await act(async () => {
      fireEvent.click(document.querySelector('.docent-plate') as HTMLButtonElement);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/agent/invoke'), expect.anything());
    expect(document.querySelector('.stage-answer')?.textContent).toContain(
      "The stage can't reach the backend. Check the connection, then send the prompt again."
    );
    expect(screen.queryByText(/The agent stopped before it answered/)).toBeNull();
    expect(input.disabled).toBe(false);
  });
});
