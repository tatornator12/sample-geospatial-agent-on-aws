/**
 * Dark Vessels in the docent (redesign §3.8.1, R6.10, N2): the step column gets this session, the
 * rest file's bucket and the turn's send time, so the board is asked for before any URL streams;
 * and when the turn ends, an answer taller than the column's room lands with its first line in
 * view (`block: 'start'`), one that fits keeps `nearest`, and other acts keep `nearest`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { StreamEvent } from '../types.ts';
interface FakeStream {
  push: (event: StreamEvent) => void;
  end: () => void;
}
const streams: FakeStream[] = [];
vi.mock('../services/api.ts', () => ({
  streamAgentInvoke: vi.fn(() => {
    const queue: Array<StreamEvent | null> = [];
    let wake: (() => void) | null = null;
    streams.push({
      push: (event) => { queue.push(event); wake?.(); },
      end: () => { queue.push(null); wake?.(); },
    });
    return (async function* () {
      while (true) {
        while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
        const event = queue.shift();
        if (!event) return;
        yield event;
      }
    })();
  }),
  stopRuntimeSession: vi.fn().mockResolvedValue(true),
  loadGeometry: vi.fn().mockResolvedValue(null),
  getPresignedUrl: vi.fn().mockResolvedValue(null),
  getBrief: vi.fn().mockResolvedValue(null),
  approveBrief: vi.fn(),
}));
import { ChatSidebar } from './ChatSidebar.tsx';
import { loadGeometry } from '../services/api.ts';

const S1 = '11111111-1111-4111-8111-111111111111';
const toolCall = (id: string, name: string, input: Record<string, unknown>) =>
  JSON.stringify({ toolUseId: id, name, input: JSON.stringify(input) });
const chunk = (content: string): StreamEvent => ({ type: 'chunk', content });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

// jsdom lays nothing out: the answer's and the column's heights are set per test.
let answerHeight = 0;
const COLUMN_HEIGHT = 500;
let scrolls: Array<{ el: Element; arg: unknown }> = [];
const saved = {
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return (this as HTMLElement).classList.contains('stage-answer') ? answerHeight : 0; },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get() { return (this as Element).classList.contains('stage-steps') ? COLUMN_HEIGHT : 0; },
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  if (saved.offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.offsetHeight);
  if (saved.clientHeight) Object.defineProperty(Element.prototype, 'clientHeight', saved.clientHeight);
});
beforeEach(() => {
  streams.length = 0;
  scrolls = [];
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    scrolls.push({ el: this, arg });
  } as typeof Element.prototype.scrollIntoView;
  vi.mocked(loadGeometry).mockClear();
});
afterEach(cleanup);

function setup(agentId: string) {
  render(
    <ChatSidebar
      sessionId={S1}
      agentId={agentId}
      agentLabel={agentId === 'vessels' ? 'Dark Vessels (dev)' : 'Earth Analyst (dev)'}
      onSessionReset={vi.fn()}
      onGeometryUpdate={vi.fn()}
      onRastersUpdate={vi.fn()}
      vesselBucket={agentId === 'vessels' ? 'geo-bucket' : null}
      revealedPasses={{}}
    />,
  );
}

async function turnWithAnswer(): Promise<void> {
  await act(async () => {
    fireEvent.click(document.querySelector('.docent-plate') as HTMLButtonElement);
  });
  const turn = streams[streams.length - 1];
  turn.push(chunk(`Weighing the passes on file. ${toolCall('tooluse_list1', 'list_passes', {})}`));
  await flush();
  turn.push(chunk('\n\n4 candidates on the Oct 12 pass; I drafted box 1 for the next look.'));
  turn.end();
  await flush();
}

const answerScrolls = () => scrolls.filter(({ el }) => el.classList.contains('stage-answer')).map(({ arg }) => arg);

describe('the board before the radar (N2)', () => {
  it('asks for this turn\'s board in this session\'s folder from the rest file\'s bucket, before any URL streams', async () => {
    setup('vessels');
    await act(async () => {
      fireEvent.click(document.querySelector('.docent-plate') as HTMLButtonElement);
    });
    streams[0].push(chunk(`Weighing the passes on file. ${toolCall('tooluse_list1', 'list_passes', {})}`));
    await flush();
    expect(vi.mocked(loadGeometry).mock.calls.map(([u]) => u)).toContain(`s3://geo-bucket/session_data/${S1}/vessels/passes_tooluse_list1.json`);
    expect(document.querySelector('.stage-step-column')?.textContent).toContain('Weigh the passes on file');
    streams[0].end();
    await flush();
  });
});

describe('the answer\'s first line in view when the turn ends (R6.10)', () => {
  it('lands a vessel answer taller than the column\'s room at its first line', async () => {
    answerHeight = 600;   // the room under the head and above the fade is 500 - 52 - 24 = 424
    setup('vessels');
    await turnWithAnswer();
    expect(answerScrolls().at(-1)).toEqual({ block: 'start', behavior: 'smooth' });
  });

  it('keeps nearest for a vessel answer that fits, so the steps above it stay in view', async () => {
    answerHeight = 300;
    setup('vessels');
    await turnWithAnswer();
    expect(answerScrolls().at(-1)).toEqual({ block: 'nearest', behavior: 'smooth' });
  });

  it('keeps nearest on the other acts', async () => {
    answerHeight = 600;
    setup('dev');
    await turnWithAnswer();
    expect(answerScrolls().at(-1)).toEqual({ block: 'nearest', behavior: 'smooth' });
  });
});
