/**
 * The pass board rendered: the passes on file before the choice, 4 rows below 1600 px and 6 at it,
 * a marked row never hidden, states from the decision files only, mono at 15 px, and no amber or
 * orchid anywhere on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PassBoard } from './PassBoard.tsx';
import { boardStates, parseBoard, parseDecision, type BoardRow } from '../utils/vesselSteps.ts';
import { ORCHID } from '../utils/vesselLayers.ts';
import { theme } from '../theme';

const row = (pass_id: string, sensed: string, imaged_share: number) =>
  ({ pass_id, sensed, satellite: 'Sentinel-1D', orbit_state: 'ASCENDING', imaged_share, imaged_pct: Math.round(imaged_share * 100) });
const board = parseBoard({
  question_id: 'a1b2c3d4e5f6', started_at: '2026-10-21T14:00:00Z', decision_keys: 'call',
  passes: [
    row('s1d-20261012t0018', '2026-10-12T00:18:02Z', 0.53), row('s1d-20260930t0018', '2026-09-30T00:18:02Z', 0.53),
    row('s1d-20260918t0018', '2026-09-18T00:18:02Z', 0.53), row('s1d-20260907t1141', '2026-09-07T11:41:47Z', 0.48),
    row('s1d-20260830t0026', '2026-08-30T00:26:09Z', 0.31), row('s1d-20260818t0026', '2026-08-18T00:26:09Z', 0.31),
    row('s1d-20260806t0026', '2026-08-06T00:26:09Z', 0.31),
  ],
})!;
const rows: BoardRow[] = board.rows;

/** window.matchMedia for one width, with a way to change it (jsdom has none). */
function screenWidth(px: number) {
  const listeners = new Set<() => void>();
  const mq = { matches: px >= 1600, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) };
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((q: string) => (q === '(min-width: 1600px)' ? mq : { matches: false })));
  return (to: number) => { mq.matches = to >= 1600; listeners.forEach((f) => f()); };
}

const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="row"]')].map((r) => [...r.querySelectorAll('[role="cell"]')].map((c) => c.textContent).join(' | '));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PassBoard', () => {
  it('shows the newest 4 passes below 1600 px, then "and N older", before any decision', () => {
    screenWidth(1280);
    const { container } = render(<PassBoard rows={rows} states={{}} />);
    expect(container.querySelector('.step-detail')?.textContent).toBe('share of the reserve each pass imaged');
    expect(shown(container)).toEqual(['Oct 12 | S1D | 53% | ', 'Sep 30 | S1D | 53% | ', 'Sep 18 | S1D | 53% | ', 'Sep 7 | S1D | 48% | ']);
    expect([...container.querySelectorAll('.step-detail')].map((e) => e.textContent)).toContain('and 3 older');
    expect(container.querySelector('[role="table"]')?.getAttribute('aria-label')).toMatch(/newest first/);
  });

  it('shows 6 rows at 1600 px and over, and follows the screen when it changes', () => {
    const resize = screenWidth(1920);
    const { container } = render(<PassBoard rows={rows} states={{}} />);
    expect(shown(container)).toHaveLength(6);
    expect(container.textContent).toContain('and 1 older');
    act(() => resize(1280));
    expect(shown(container)).toHaveLength(4);
  });

  it('keeps a marked row in view and marks it from the decision files: reading with a fog dot, set aside in grey', () => {
    screenWidth(1280);
    const asked = parseDecision({
      question_id: 'a1b2c3d4e5f6', step: 'read_pass', because: 'asked', subject: 's1d-20260830t0026', n: 1,
      facts: { pass_id: 's1d-20260830t0026', imaged_pct: 31 }, tool_use_id: 'tooluse_1',
    })!;
    const thin = parseDecision({
      question_id: 'a1b2c3d4e5f6', step: 'read_pass', because: 'coverage_thin', subject: 's1d-20260930t0018', n: 2,
      facts: { pass_id: 's1d-20260930t0018', imaged_pct: 53, from: 's1d-20260830t0026', checkable_pct: 10 }, tool_use_id: 'tooluse_2',
    })!;
    const { container, rerender } = render(<PassBoard rows={rows} states={boardStates([asked], {})} />);
    expect(shown(container)).toEqual(['Oct 12 | S1D | 53% | ', 'Sep 30 | S1D | 53% | ', 'Sep 18 | S1D | 53% | ', 'Aug 30 | S1D | 31% | reading']);
    const reading = container.querySelector('.pass-row--reading') as HTMLElement;
    expect(reading.style.color).toBe('var(--fog)');
    expect(reading.querySelector('[aria-hidden="true"]')).not.toBeNull();
    rerender(<PassBoard rows={rows} states={boardStates([asked, thin], {})} />);
    expect(shown(container)).toEqual(['Oct 12 | S1D | 53% | ', 'Sep 30 | S1D | 53% | reading', 'Sep 18 | S1D | 53% | ', 'Aug 30 | S1D | 31% | set aside']);
    const aside = container.querySelector('.pass-row--thin') as HTMLElement;
    expect(aside.style.color).toBe('var(--label)');
    expect(aside.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('sets every row in mono at 15 px, with no amber and no orchid', () => {
    screenWidth(1920);
    const { container } = render(<PassBoard rows={rows} states={{ 's1d-20261012t0018': 'reading', 's1d-20260930t0018': 'empty' }} />);
    const rowsEl = [...container.querySelectorAll('[role="row"]')] as HTMLElement[];
    for (const r of rowsEl) {
      expect(r.style.fontFamily).toBe('var(--font-mono)');
      expect(r.style.fontSize).toBe('15px');
    }
    expect(shown(container)[1]).toBe('Sep 30 | S1D | 53% | no candidates');
    const html = container.innerHTML.toLowerCase();
    for (const colour of [theme.colors.primary, theme.colors.primaryContainer, ORCHID]) expect(html).not.toContain(colour.toLowerCase());
    expect(html).not.toMatch(/primary|amber|orchid|\u2014/);
  });

  it('renders nothing with no rows, and 4 rows where the screen cannot be measured', () => {
    expect(render(<PassBoard rows={[]} states={{}} />).container.innerHTML).toBe('');
    cleanup();
    vi.stubGlobal('matchMedia', undefined);
    expect(shown(render(<PassBoard rows={rows} states={{}} />).container)).toHaveLength(4);
  });
});
