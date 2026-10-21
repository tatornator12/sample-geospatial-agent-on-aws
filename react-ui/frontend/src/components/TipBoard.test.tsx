import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TipBoard } from './TipBoard.tsx';
import { cueTallyText, parseTip, type CueTally, type Tip } from '../utils/steps.ts';

afterEach(cleanup);

// The recorded mission's top three tips (use-cases/methane-watch-mission/tip_*.json, numbers only).
const tips: Tip[] = [
  parseTip({ area: 'south caspian', emit_can_look: true, top: { lat: 39.4379, lon: 53.573, anomaly_ppb: 108.8 } }, 'south caspian')!,
  parseTip({ area: 'shanxi coal basin', emit_can_look: true, top: { lat: 35.5528, lon: 112.6889, anomaly_ppb: 106.7 } }, 'shanxi coal basin')!,
  parseTip({ area: 'zagros foreland', emit_can_look: true, top: { lat: 31.1, lon: 50.2, anomaly_ppb: 42.8 } }, 'zagros foreland')!,
];
const cued = ['south caspian', 'shanxi coal basin'];
const tallies: Record<string, CueTally> = {
  'south caspian': { candidates: 2, read: 4, latest: '2025-08-20' },
  'shanxi coal basin': { candidates: 2, read: 6, latest: '2026-04-25' },
  // A tally for an area that was not cued is never printed.
  'zagros foreland': { candidates: 1, read: 1, latest: '2025-05-01' },
};

const rowOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.tip-row')].find((r) => r.textContent?.startsWith(label)) as HTMLElement;

describe('TipBoard', () => {
  it('prints the reason for the choice under each cued row, in the stage\'s words, numbers in mono', () => {
    const { container } = render(<TipBoard tips={tips} cued={cued} chosen="shanxi coal basin" expected={3} tallies={tallies} />);
    const lines = [...container.querySelectorAll('.tip-row__cue')].map((el) => el.textContent);
    expect(lines).toEqual([cueTallyText(tallies['south caspian']), cueTallyText(tallies['shanxi coal basin'])]);
    expect(lines).toEqual(['2 of 4 candidate passes · latest 2025-08-20', '2 of 6 candidate passes · latest 2026-04-25']);
    const shanxi = rowOf(container, 'Shanxi');
    expect([...shanxi.querySelectorAll('.tip-row__num')].map((el) => el.textContent)).toEqual(['2', '6', '2026-04-25']);
    expect(shanxi.querySelector('.tip-row__cue')?.getAttribute('role')).toBe('cell');
    // The row that was not cued carries no tally, even when one is passed for it.
    expect(rowOf(container, 'Zagros').querySelector('.tip-row__cue')).toBeNull();
  });

  it('keeps "following" on the chosen row only', () => {
    const { container } = render(<TipBoard tips={tips} cued={cued} chosen="shanxi coal basin" expected={3} tallies={tallies} />);
    expect(rowOf(container, 'Shanxi').querySelector('.tip-row__flag--chosen')?.textContent).toBe(' following');
    expect(container.querySelectorAll('.tip-row__flag--chosen')).toHaveLength(1);
    expect(rowOf(container, 'Shanxi').className).toContain('tip-row--chosen');
  });

  it('prints no tally without the prop (while the passes are still being read)', () => {
    const { container } = render(<TipBoard tips={tips} cued={cued} chosen={null} expected={3} />);
    expect(container.querySelector('.tip-row__cue')).toBeNull();
    expect(container.textContent).not.toMatch(/candidate pass/);
    expect(container.querySelectorAll('.tip-row--cued')).toHaveLength(2);
  });
});
