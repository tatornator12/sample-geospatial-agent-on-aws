/**
 * A turn in flight is ended by New session, Stop and Esc: its request is aborted and nothing it
 * streams afterwards (answer, layers) reaches the stage. The stream mock ignores the signal on
 * purpose, so these tests prove the turn token drops stale events, not just the abort.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GeometryData, StreamEvent } from '../types.ts';

interface FakeStream {
  prompt: string;
  sessionId: string;
  signal?: AbortSignal;
  push: (event: StreamEvent) => void;
  end: () => void;
}

const streams: FakeStream[] = [];

vi.mock('../services/api.ts', () => ({
  streamAgentInvoke: vi.fn(
    (prompt: string, sessionId: string, _scenarioId?: string, _agentId?: string, signal?: AbortSignal) => {
      const queue: Array<StreamEvent | null> = [];
      let wake: (() => void) | null = null;
      const stream: FakeStream = {
        prompt,
        sessionId,
        signal,
        push: (event) => {
          queue.push(event);
          wake?.();
        },
        end: () => {
          queue.push(null);
          wake?.();
        },
      };
      streams.push(stream);
      return (async function* () {
        while (true) {
          while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
          const event = queue.shift();
          if (!event) return;
          yield event;
        }
      })();
    }
  ),
  stopRuntimeSession: vi.fn(),
  loadGeometry: vi.fn(),
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  getBrief: vi.fn().mockResolvedValue(null),
  approveBrief: vi.fn(),
}));

import { ChatSidebar } from './ChatSidebar.tsx';
import { loadGeometry, stopRuntimeSession } from '../services/api.ts';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const GEOJSON = 's3://bucket/use-cases/la-fires-2025/geometry.geojson';
const RASTER = 's3://bucket/use-cases/archaeologist-newark/tci_2026-10-05.tif';

function toolCall(id: string, name: string, input: Record<string, unknown>) {
  return JSON.stringify({ toolUseId: id, name, input: JSON.stringify(input) });
}

const chunk = (content: string): StreamEvent => ({ type: 'chunk', content });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  streams.length = 0;
  vi.mocked(stopRuntimeSession).mockReset().mockResolvedValue(true);
  vi.mocked(loadGeometry).mockReset().mockResolvedValue({ type: 'FeatureCollection', features: [] });
});

afterEach(cleanup);

function setup(sessionId = S1) {
  const props = {
    agentId: 'dev',
    agentLabel: 'Earth Analyst (dev)',
    onSessionReset: vi.fn(),
    onGeometryUpdate: vi.fn(),
    onRastersUpdate: vi.fn(),
  };
  const view = render(<ChatSidebar sessionId={sessionId} {...props} />);
  const rerender = (next: string) => view.rerender(<ChatSidebar sessionId={next} {...props} />);
  return { ...props, rerender };
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

const input = () => document.querySelector('.docent-input') as HTMLTextAreaElement;

async function sendFirstPlate() {
  const plate = document.querySelector('.docent-plate') as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(plate);
  });
  return streams[streams.length - 1];
}

describe('New session mid-turn', () => {
  it('aborts the turn and drops a geometry that finishes loading after the reset', async () => {
    const { rerender, onGeometryUpdate } = setup();
    let finishLoad: (value: GeometryData | null) => void = () => {};
    vi.mocked(loadGeometry).mockImplementation(() => new Promise((resolve) => (finishLoad = resolve)));

    const turn = await sendFirstPlate();
    turn.push(chunk(`Looking. ${toolCall('t1', 'display_visual', { s3_url: GEOJSON, title: 'OLD geometry' })}`));
    await flush();
    expect(loadGeometry).toHaveBeenCalledWith(GEOJSON);

    rerender(S2);
    expect(turn.signal?.aborted).toBe(true);
    expect(stopRuntimeSession).toHaveBeenCalledWith(S1, 'dev');

    await act(async () => {
      finishLoad({ type: 'FeatureCollection', features: [] });
    });
    turn.push(chunk('OLD-TURN answer from the session before the reset.'));
    turn.end();
    await flush();

    expect(onGeometryUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(/OLD-TURN/)).toBeNull();
    expect(input().disabled).toBe(false);
  });

  it('drops an answer and raster streamed before the reset when only done follows', async () => {
    const { rerender, onRastersUpdate } = setup();
    const turn = await sendFirstPlate();
    turn.push(chunk(`${toolCall('t1', 'display_visual', { s3_url: RASTER, title: 'OLD raster' })}OLD-TURN answer.`));
    await flush();
    onRastersUpdate.mockClear();

    rerender(S2);
    turn.end();
    await flush();

    expect(onRastersUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(/OLD-TURN/)).toBeNull();
    expect(document.querySelector('.stage-steps')).toBeNull();
  });
});

describe('Leaving the stage mid-turn', () => {
  it('aborts the turn and stops its runtime when the stage unmounts', async () => {
    setup();
    const turn = await sendFirstPlate();
    turn.push(chunk('Working. '));
    await flush();

    cleanup();

    expect(turn.signal?.aborted).toBe(true);
    expect(stopRuntimeSession).toHaveBeenCalledWith(S1, 'dev');
  });
});

describe('Stop', () => {
  it('ends the turn at once, keeps a late tail out, and the next turn owns the console', async () => {
    setup();
    // The runtime stop never answers: Stop must not wait on it.
    vi.mocked(stopRuntimeSession).mockReturnValue(new Promise(() => {}));
    const turn = await sendFirstPlate();
    turn.push(chunk('Looking up the place first. '));
    await flush();
    expect(input().disabled).toBe(true);

    await act(async () => {
      fireEvent.click(document.querySelector('.docent-actions .stage-btn--danger') as HTMLButtonElement);
    });
    expect(turn.signal?.aborted).toBe(true);
    expect(stopRuntimeSession).toHaveBeenCalledWith(S1, 'dev');
    expect(screen.getByText('Stopped by the presenter.')).toBeTruthy();
    expect(input().disabled).toBe(false);

    turn.push(chunk('LATE answer from the stopped turn.'));
    turn.end();
    await flush();
    expect(screen.queryByText(/LATE answer/)).toBeNull();

    const second = await sendFirstPlate();
    expect(second).not.toBe(turn);
    expect(input().disabled).toBe(true);
    second.push(chunk('Second answer.'));
    await flush();
    expect(input().disabled).toBe(true);
    second.end();
    await flush();

    expect(screen.getByText('Second answer.')).toBeTruthy();
    expect(screen.queryByText(/LATE answer/)).toBeNull();
    expect(input().disabled).toBe(false);
  });
});

describe('Escape', () => {
  it('stops a turn from anywhere on the stage', async () => {
    setup();
    const turn = await sendFirstPlate();
    turn.push(chunk('Working. '));
    await flush();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(turn.signal?.aborted).toBe(true);
    expect(screen.getByText('Stopped by the presenter.')).toBeTruthy();
    expect(input().disabled).toBe(false);
  });

  it('leaves Escape to a control that already handled it, or to a slider', async () => {
    setup();
    const turn = await sendFirstPlate();
    await flush();

    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    await act(async () => {
      window.dispatchEvent(handled);
    });
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.tabIndex = 0;
    document.body.appendChild(slider);
    await act(async () => {
      fireEvent.keyDown(slider, { key: 'Escape' });
    });
    slider.remove();

    expect(turn.signal?.aborted).toBe(false);
    expect(screen.queryByText('Stopped by the presenter.')).toBeNull();
    expect(input().disabled).toBe(true);
  });

  it('does nothing when no turn is running', async () => {
    setup();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(stopRuntimeSession).not.toHaveBeenCalled();
    expect(screen.queryByText('Stopped by the presenter.')).toBeNull();
  });
});

describe('The lit step while a tool runs (B1, A1 P1-2)', () => {
  const rows = () => [...document.querySelectorAll('.stage-step-column > li')];
  const lit = () => document.querySelector('.stage-step-column > li[aria-current="step"]');

  it('lights the call the agent has started, before it finishes, and keeps it out of the layers', async () => {
    const { onRastersUpdate } = setup();
    const turn = await sendFirstPlate();
    turn.push(chunk(`Finding the park. ${toolCall('t1', 'find_location_boundary', { location: 'Central Park' })} Searching now. `));
    turn.push(chunk('{"toolUseId": "t2", "name": "find_similar_places", "input": "{\\"s3_url\\": \\"'));
    await flush();
    expect(rows()).toHaveLength(2);
    expect(lit()?.textContent).toContain('Find similar places');
    expect(lit()?.textContent).toContain('working');
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
    expect(rows()[0].textContent).toContain('Get the boundary');
    expect(onRastersUpdate).not.toHaveBeenCalled();

    // The call closes once the tool has run: the same row, now with its inputs.
    turn.push(chunk(`${RASTER}\\"}"}The matches are on the map.`));
    turn.end();
    await flush();
    expect(rows()).toHaveLength(2);
    expect(lit()).toBeNull();
    expect(screen.getByText('The matches are on the map.')).toBeTruthy();
  });

  it('is left as it was on Dark Vessels (its act is its own)', async () => {
    const props = { agentId: 'vessels', agentLabel: 'Dark Vessels', onSessionReset: vi.fn(), onGeometryUpdate: vi.fn(), onRastersUpdate: vi.fn() };
    render(<ChatSidebar sessionId={S1} {...props} />);
    const turn = await sendFirstPlate();
    turn.push(chunk(`${toolCall('t1', 'find_pass', { date: '2026-10-12' })}{"toolUseId": "t2", "name": "detect_vessels", "input": "`));
    await flush();
    expect(rows()).toHaveLength(1);
    expect(lit()?.textContent).toContain('Find the radar pass');
  });
});

describe('A turn that fails after some steps (B2, A1 P1-9)', () => {
  it('keeps its steps, names the last one, and keeps them in its record when the next turn starts', async () => {
    setup();
    const turn = await sendFirstPlate();
    turn.push(chunk(`${toolCall('t1', 'find_location_boundary', { location: 'Bergen' })} ${toolCall('t2', 'get_rasters', { current_date_str: '2025-09-15' })}`));
    await flush();
    turn.push({ type: 'error', message: 'ThrottlingException: Rate exceeded' });
    await flush();

    const rows = () => [...document.querySelectorAll('.stage-steps > .stage-step-column > li, .stage-steps .stage-step-column > li')];
    expect(rows()).toHaveLength(2);
    expect(document.querySelector('.stage-steps__title')?.textContent).toBe('What the agent did');
    expect(document.querySelector('.stage-answer--failed')?.textContent).toContain(
      'The agent stopped at step 02, Fetch Sentinel-2. Send the prompt again; the steps it finished are above.'
    );
    expect(input().disabled).toBe(false);

    const next = await sendFirstPlate();
    next.push(chunk('Quick answer.'));
    next.end();
    await flush();
    const row = screen.getByRole('button', { name: /Show vegetation health for Bergen/ });
    expect(row.textContent).toContain('2 steps');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(document.querySelector('.earlier-turn__record')?.textContent).toContain('The agent stopped at step 02, Fetch Sentinel-2.');
    expect(document.querySelectorAll('.earlier-turn__record .stage-step-column > li')).toHaveLength(2);
  });
});

describe('Runtime crash', () => {
  it('resets the session and shows the recovery notice on the new one', async () => {
    const { rerender, onSessionReset } = setup();
    const turn = await sendFirstPlate();
    turn.push({ type: 'error', code: 'RUNTIME_CRASH', message: 'RuntimeClientError: An error occurred when starting the runtime' });
    await flush();
    expect(onSessionReset).toHaveBeenCalledTimes(1);

    rerender(S2);
    await flush();
    expect(screen.getByText(/hit a runtime error and was automatically reset/)).toBeTruthy();
    expect(input().disabled).toBe(false);
  });
});
