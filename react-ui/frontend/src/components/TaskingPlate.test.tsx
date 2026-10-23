import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TaskingState } from '../services/api.ts';
import { clockLines, filedFacts, type SeaBeat, type SeaFacts } from '../utils/vesselLayers.ts';
import { SeaClock } from './SeaClock.tsx';
import { TaskingPlate } from './TaskingPlate.tsx';

// The plate reads its draft from the backend; here the draft is fixed.
const state: { current: TaskingState | null } = { current: null };
vi.mock('../services/api.ts', () => ({
  getTasking: vi.fn(async () => state.current),
  approveTasking: vi.fn(),
}));

const look = { satellite: 'S1D', start: '2026-10-24T00:17:29Z', share: 1, text: 'S1-D Oct 24 00:17 UTC' };
const box = (n: number, share: number) => ({ box: n, bounds: [-90.55, -0.5, -90.35, -0.3] as [number, number, number, number], share, look });
const DRAFT: TaskingState = {
  status: 'draft',
  card: {
    taskingId: 'tasking-20261020T143651-34da66', draftedAt: '2026-10-20T14:36:51Z',
    passId: 's1d-20261012t0018', passSensed: '2026-10-12T00:18:02Z',
    counts: { broadcasting: 4, port: 3, unproven: 2, seen_once: 9, candidate: 4 }, heardShare: 0.298,
    box: box(1, 0.089),
    candidates: ['T01', 'T02', 'T03', 'T04'].map((id) => ({ id, lon: -90.4, lat: -0.4, port: 'Baltra', portKm: 31, nearestBroadcastKm: 5.8 })),
    check: null, notes: [], sentence: 'A candidate is a radar target with no broadcast nearby; it is not an accusation.',
    attribution: 'Powered by Global Fishing Watch.',
  },
  boxes: [box(1, 0.089), box(2, 0.05), box(3, 0.05)],
};
const FILED: TaskingState = { ...DRAFT, status: 'filed', filedAt: '2026-10-20T14:37:12.000Z', filedBy: 'officer', choice: { box: 3, candidateIds: ['T01', 'T02', 'T03', 'T04'] } };

const noop = () => {};
function Stage({ beat, facts = {} }: { beat: SeaBeat; facts?: SeaFacts }) {
  return (
    <>
      <SeaClock beat={beat} facts={facts} />
      <TaskingPlate sessionId="s" draftKey={1} busy={false} box={null} excluded={[]}
        onLoaded={noop} onBox={noop} onToggle={noop} onFiled={noop} onDismiss={noop} />
    </>
  );
}
const count = (text: string, re: RegExp) => (text.match(new RegExp(re.source, 'gi')) ?? []).length;

afterEach(cleanup);

describe('the tasking on stage (clock and plate together)', () => {
  it('says the filed sentence once, on the plate\'s filed line, with the time', async () => {
    state.current = FILED;
    render(<Stage beat="filed" />);
    const line = await screen.findByText(/Filed by the officer/);
    const text = document.body.textContent ?? '';
    expect(count(text, /Filed by the officer/)).toBe(1);
    expect(count(text, /did not file/)).toBe(1);
    expect(line.textContent).toBe('Filed by the officer at 2026-10-20 14:37 UTC. The agent did not file it.');
    expect(text).toContain(clockLines('filed', {}).sub);
  });

  it('with the filed facts the map passes, the clock states the choice and the filed sentence is still the plate\'s alone', async () => {
    state.current = FILED;
    const now = Date.parse('2026-10-20T14:37:00Z');
    render(<Stage beat="filed" facts={{ now, tasking: filedFacts(FILED) }} />);
    await screen.findByText(/Filed by the officer/);
    const text = document.body.textContent ?? '';
    expect(text).toContain('box 3 · 4 of 4 candidates · next radar look in 3 d 9 h');
    expect(count(text, /Filed by the officer/)).toBe(1);
    expect(count(text, /did not file/)).toBe(1);
  });

  it('in the draft, says nothing is filed yet and the decision sentence nowhere on the clock or plate', async () => {
    state.current = DRAFT;
    render(<Stage beat="tasking" />);
    await screen.findByText('Nothing is filed until you approve.');
    const text = document.body.textContent ?? '';
    expect(count(text, /Filed by the officer|did not file|officer's/)).toBe(0);
    expect(text).toContain('choose a box and the candidates, then approve');
    // Each box says where it comes from (past dark targets), the candidates' legend their pass; the
    // summary says the candidates are on the way.
    expect(text).toContain('Patrol box and its next radar look');
    expect(text).toContain('Candidates (Oct 12 pass)');
    expect(text).toContain('Patrol box 1 · check 4 of 4 candidates on the way');
    expect(text).toContain('Box 1  9% of past dark targets');
  });

  it('gives each box two lines: its share, then its next look and the countdown (no satellite, no "next look" again)', async () => {
    state.current = DRAFT;
    vi.useFakeTimers({ now: Date.parse('2026-10-23T17:16:00Z'), toFake: ['Date'] });
    try {
      const { container } = render(<Stage beat="tasking" />);
      await screen.findByText('Nothing is filed until you approve.');
      const options = [...container.querySelectorAll('.tasking-plate__option')];
      expect(options).toHaveLength(3);
      for (const o of options) {
        expect(o.querySelectorAll('.tasking-plate__option-main, .tasking-plate__option-sub')).toHaveLength(2);
        expect(o.querySelector('.tasking-plate__option-sub')?.textContent).toBe('Oct 24 00:17 UTC, in 7 h 1 min');
      }
      expect(container.querySelector('.tasking-plate')?.textContent).not.toMatch(/S1-D|next look/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a box with no look planned says so on its second line', async () => {
    state.current = { ...DRAFT, boxes: [{ ...box(1, 0.089), look: null } as never, box(2, 0.05)] };
    const { container } = render(<Stage beat="tasking" />);
    await screen.findByText('Nothing is filed until you approve.');
    expect(container.querySelector('.tasking-plate__option-sub')?.textContent).toBe('no look planned yet');
  });

  it('stands where the map placed it: under the key on the right, or filling the step column\'s slot on the left', async () => {
    state.current = DRAFT;
    const at = (place: Parameters<typeof TaskingPlate>[0]['place']) =>
      render(<TaskingPlate sessionId="s" draftKey={1} busy={false} box={null} excluded={[]}
        onLoaded={noop} onBox={noop} onToggle={noop} onDismiss={noop} place={place} />);
    const right = at({ side: 'right', top: 482, maxHeight: 466, scrolls: false });
    await screen.findByText('Approve the tasking');
    const r = right.container.querySelector<HTMLElement>('.tasking-plate')!;
    expect(r.classList.contains('tasking-plate--left')).toBe(false);
    expect([r.style.top, r.style.bottom, r.style.maxHeight, r.style.height]).toEqual(['482px', 'auto', '466px', '']);
    right.unmount();
    const left = at({ side: 'left', top: 16, maxHeight: 486, scrolls: false });
    await screen.findByText('Approve the tasking');
    const l = left.container.querySelector<HTMLElement>('.tasking-plate')!;
    expect(l.classList.contains('tasking-plate--left')).toBe(true);
    expect([l.style.top, l.style.maxHeight, l.style.height]).toEqual(['16px', '486px', '486px']);
    // Every choice is there on either side: the boxes, the candidates, Approve and Not now.
    expect(l.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(l.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expect(screen.getByText('Not now')).toBeTruthy();
    left.unmount();
    // Unmeasured, the stylesheet places it (no inline place).
    const none = at(null);
    await screen.findByText('Approve the tasking');
    expect(none.container.querySelector<HTMLElement>('.tasking-plate')!.getAttribute('style')).toBeNull();
  });

  it('lists the candidates without the candidate sentence: the agent\'s answer says it, once', async () => {
    for (const s of [DRAFT, { ...DRAFT, status: 'replay' as const }]) {
      state.current = s;
      const { container, unmount } = render(<Stage beat="tasking" facts={{ taskingRecorded: s.status === 'replay' }} />);
      await screen.findByText('Patrol box and its next radar look');
      const text = document.body.textContent ?? '';
      expect(text).toContain('Patrol box 1 · check 4 of 4 candidates on the way');
      // The draft still carries the sentence (tasking_tools.py); the stage does not repeat it.
      expect(DRAFT.card.sentence).toMatch(/not an accusation/);
      expect(text).not.toContain(DRAFT.card.sentence);
      expect(count(text, /accusation|reason to look/)).toBe(0);
      expect(container.querySelector('.tasking-plate__note')).toBeNull();
      // The candidates themselves are all there, by id and distance from port.
      for (const id of ['T01', 'T02', 'T03', 'T04']) expect(text).toContain(id);
      expect(count(text, /31 km from Baltra/)).toBe(4);
      unmount();
    }
  });

  it('names a replay case\'s tasking recorded on the clock, and asks for no approval there', async () => {
    state.current = { ...DRAFT, status: 'replay' };
    render(<Stage beat="tasking" facts={{ taskingRecorded: true }} />);
    await screen.findByText('Recorded case: the decision is made live, not replayed.');
    const text = document.body.textContent ?? '';
    expect(text).toContain('the box and candidates the agent drafted, as recorded');
    expect(text).not.toContain('then approve');
    expect(screen.queryByText('Approve the tasking')).toBeNull();
  });

  it('keeps the clock quiet for screen readers while the plate announces the tasking', () => {
    const live = (beat: SeaBeat) => {
      const { container, unmount } = render(<SeaClock beat={beat} facts={{}} />);
      const value = container.querySelector('.sea-clock')?.getAttribute('aria-live');
      unmount();
      return value;
    };
    expect(live('tasking')).toBe('off');
    expect(live('filed')).toBe('off');
    expect(live('forward')).toBe('off');
    expect(live('coverage')).toBe('polite');
    expect(live('candidates')).toBe('polite');
  });
});
