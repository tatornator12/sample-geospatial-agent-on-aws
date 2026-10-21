/**
 * The brief card says when EMIT last looked at the site, and the latest sign over it (A2 P0-2): from
 * the cue's pass manifest and the TROPOMI tip on the card's site, never from the draft's words.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ToolCall } from '../types.ts';
vi.mock('../services/api.ts', () => ({
  getBrief: vi.fn(),
  approveBrief: vi.fn(),
  loadGeometry: vi.fn(),
}));
import { BriefCard } from './BriefCard.tsx';
import { getBrief, loadGeometry, type BriefState } from '../services/api.ts';
import { parseTip, type Tip } from '../utils/steps.ts';

const ID = 'brief-20261012T164527-99f772';
const DIR = 's3://bucket/use-cases/methane-watch-mission/';
const MANIFEST = `${DIR}passes_39.4379_53.5730.json`;
// The replay's records, trimmed (use-cases/methane-watch-mission/).
const STATE: BriefState = {
  status: 'replay',
  card: {
    briefId: ID,
    title: 'Recurring methane near Krasnovodsk, Turkmenistan',
    place: 'Krasnovodsk, Turkmenistan',
    lat: 39.4379,
    lon: 53.573,
    watchArea: 'south Caspian (Turkmenistan)',
    looks: 23,
    candidates: 2,
    passesRead: 4,
    passesSince: '2025-01-01',
    confidence: 'moderate',
    singleExplanation: 'low without a ground or aircraft check',
    hypotheses: [],
  },
};
const PASSES = {
  lat: 39.4379,
  lon: 53.573,
  passes: [
    { date: '2025-08-20', verdict: 'candidate', short: 'candidate', peak_ppm_m: 2828.3 },
    { date: '2025-08-01', verdict: 'candidate', short: 'candidate', peak_ppm_m: 2309.7 },
    { date: '2025-06-17', verdict: 'rejected', short: 'cloud or gap' },
    { date: '2025-06-13', verdict: 'rejected', short: 'within noise', peak_ppm_m: 1231.6 },
  ],
};
const TIP: Tip = parseTip(
  { area: 'south caspian', end: '2026-10-10', days: 14, emit_can_look: true, top: { lat: 39.4379, lon: 53.573, anomaly_ppb: 108.8, valid_days: 5 } },
  'south caspian'
)!;
const cue = (id: string, lat: number, lon: number): ToolCall => ({ id, name: 'check_recent_passes', params: { lat, lon }, status: 'completed' });
const CUES = [cue('c1', 39.4379, 53.573), cue('c2', 35.5528, 112.6889)];

function card(props: { cues?: ToolCall[]; tips?: Tip[]; methaneDir?: string | null } = {}) {
  return render(
    <BriefCard briefId={ID} sessionId="s" caseId="methane-watch-mission" busy={false} onDecision={() => {}} methaneDir={DIR} cues={CUES} tips={[TIP]} {...props} />
  );
}

const lineText = () =>
  Array.from(document.querySelectorAll('.brief-card__line')).map((p) => p.textContent?.replace(/\s+/g, ' ').trim());

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  vi.mocked(getBrief).mockReset().mockResolvedValue(STATE);
  vi.mocked(loadGeometry).mockReset().mockImplementation(async (url: string) => (url === MANIFEST ? PASSES : null) as never);
});
afterEach(cleanup);

describe('BriefCard last look', () => {
  it("puts EMIT's last look and the TROPOMI sign after the count, above the verdict", async () => {
    card();
    const look = await screen.findByText(/Last EMIT look/);
    expect(look.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Last EMIT look Aug 20 2025. Latest sign: TROPOMI, 14 days to Oct 10 2026 (about 4 km cells).'
    );
    // Dates and numbers in the mono register, as the count has them.
    expect(Array.from(look.querySelectorAll('.brief-card__num')).map((s) => s.textContent)).toEqual(['Aug 20 2025', '14', 'Oct 10 2026', '4']);
    // It runs on in the count's paragraph (one line fewer, so the decision stays on the first screen).
    expect(lineText()[0]).toBe(
      '2 of 4 passes read since 2025-01-01 are candidates; EMIT looked 23 times in all. ' +
        'Last EMIT look Aug 20 2025. Latest sign: TROPOMI, 14 days to Oct 10 2026 (about 4 km cells).'
    );
    expect(look.compareDocumentPosition(document.querySelector('.brief-card__verdict')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(loadGeometry)).toHaveBeenCalledWith(MANIFEST);
  });

  it('says the last look alone when no tip is over the site', async () => {
    card({ tips: [] });
    const look = await screen.findByText(/Last EMIT look/);
    expect(look.textContent?.replace(/\s+/g, ' ').trim()).toBe('Last EMIT look Aug 20 2025.');
  });

  it('has no line when no cue is on the site, or its manifest is not there', async () => {
    card({ cues: [cue('c2', 35.5528, 112.6889)] });
    await screen.findByText(/Recurring methane near Krasnovodsk/);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/Last EMIT look/)).toBeNull();
    expect(vi.mocked(loadGeometry)).not.toHaveBeenCalled();
    cleanup();

    card({ methaneDir: null });
    await screen.findByText(/Recurring methane near Krasnovodsk/);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/Last EMIT look/)).toBeNull();
  });
});
