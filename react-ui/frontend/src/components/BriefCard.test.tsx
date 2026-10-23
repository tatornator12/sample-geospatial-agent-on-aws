/**
 * The brief card says the gap once (approved 2026-10-23): the latest fine-scale confirmation, how long
 * before the tip, and the agent's recommendation, worded by the stage from the draft's validated enums
 * and dates, never from the draft's words. The chain still reads the cue's pass manifest and the tip.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ToolCall } from '../types.ts';
vi.mock('../services/api.ts', () => ({
  getBrief: vi.fn(),
  approveBrief: vi.fn(),
  loadGeometry: vi.fn(),
}));
import { BriefCard } from './BriefCard.tsx';
import { getBrief, loadGeometry, type BriefState } from '../services/api.ts';
import { parseTip, type Tip } from '../utils/steps.ts';
import type { BriefDecision } from '../utils/record.ts';

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

function card(props: { cues?: ToolCall[]; tips?: Tip[]; methaneDir?: string | null; checks?: number } = {}) {
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

// Shanxi on the Oct 21 board: Carbon Mapper on 2026-06-10, 118 days before the tip's first day.
const DECISION: BriefDecision = {
  recommendation: 'recommend_new_look', reason: 'confirmation_older_than_90_days',
  latestConfirmed: { date: '2026-06-10', by: 'carbon_mapper' }, daysBetween: 118, reference: 'tip',
  lastLook: { date: '2026-08-17', result: 'clouded_out' }, confirmedDates: 9,
};
const withDecision = (decision: BriefDecision | undefined) =>
  vi.mocked(getBrief).mockResolvedValue({ ...STATE, card: { ...STATE.card, ...(decision ? { decision } : {}) } });

describe('BriefCard decision line', () => {
  it('says the gap once, in its own line under the count, above the verdict', async () => {
    withDecision(DECISION);
    card();
    const line = await screen.findByText(/latest fine-scale confirmation/);
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Methane keeps showing up here. The latest fine-scale confirmation is a Carbon Mapper plume on 10 Jun 2026, ' +
        'about 4 months before the tip. The agent recommends a new fine-scale look.'
    );
    expect(line.className).toContain('brief-card__decision');
    expect(Array.from(line.querySelectorAll('.brief-card__num')).map((s) => s.textContent)).toEqual(['10 Jun 2026']);
    // It runs on in the count's paragraph (no last look any more: the gap is said once, here), which
    // keeps the decision on the column's first screen at 720p.
    expect(lineText()[0]).toBe('2 of 4 passes read since 2025-01-01 are candidates; EMIT looked 23 times in all. ' +
      'Methane keeps showing up here. The latest fine-scale confirmation is a Carbon Mapper plume on 10 Jun 2026, ' +
      'about 4 months before the tip. The agent recommends a new fine-scale look.');
    expect(screen.queryByText(/Last EMIT look/)).toBeNull();
    expect(line.compareDocumentPosition(document.querySelector('.brief-card__verdict')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Never confused with the analyst's "Request another look": the stage says "a new fine-scale look".
    expect(line.textContent).not.toMatch(/another look/);
  });

  it('words each reason from the enums, and "has shown up here before" under 3 confirmed dates', async () => {
    withDecision({ ...DECISION, reason: 'last_look_clouded_out', confirmedDates: 2 });
    card();
    const line = await screen.findByText(/latest fine-scale confirmation/);
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Methane has shown up here before. The latest fine-scale confirmation is a Carbon Mapper plume on 10 Jun 2026, ' +
        "about 4 months before the tip. EMIT's last look, on 17 Aug 2026, was clouded out. The agent recommends a new fine-scale look."
    );
  });

  it('has no line on a draft without a decision (drafts made before it)', async () => {
    withDecision(undefined);
    card();
    await screen.findByText(/Recurring methane near Krasnovodsk/);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.brief-card__decision')).toBeNull();
  });
});

describe('BriefCard chain (B15, A2 P1-2)', () => {
  const chainText = () => document.querySelector('.brief-card__chain')?.textContent?.replace(/\s+/g, ' ').trim();

  it('opens the card with tip, cue, check and brief, from the records', async () => {
    card({ checks: 3 });
    await waitFor(() => expect(chainText()).toContain('Cue'));
    const section = document.querySelector('.brief-card')!;
    expect(section.firstElementChild?.className).toBe('brief-card__chain');
    expect(chainText()).toBe('Tip South Caspian, Turkmenistan +108.8 ppb → Cue 2 of 4 passes → Check 3 records → Brief');
    expect([...document.querySelectorAll('.brief-card__chain .brief-card__num')].map((n) => n.textContent)).toEqual(['+108.8', '2', '4', '3']);
  });

  it('leaves out a part with no record', async () => {
    render(<BriefCard briefId={ID} sessionId="s" caseId="methane-watch-mission" busy={false} onDecision={() => {}} methaneDir={DIR} cues={CUES} tips={[]} />);
    await waitFor(() => expect(chainText()).toContain('Cue'));
    expect(chainText()).toBe('Cue 2 of 4 passes → Brief');
  });
});

describe('BriefCard independent detections', () => {
  const LINE = "Carbon Mapper lists 45 methane plumes within 5 km since 2025-01-01; the latest on 2026-06-20 by Tanager-1, Carbon Mapper's estimate about 270 ± 260 kg/h. Source: Carbon Mapper (data.carbonmapper.org).";

  it("shows Carbon Mapper's line, with its source, under its own heading", async () => {
    vi.mocked(getBrief).mockResolvedValue({ ...STATE, card: { ...STATE.card, independent: LINE } });
    card();
    expect(await screen.findByText('Independent detections')).toBeTruthy();
    expect(screen.getByText(LINE).tagName).toBe('LI');
  });

  it('shows no heading when the draft carries no line', async () => {
    card();
    await screen.findByText(/Recurring methane near Krasnovodsk/);
    expect(screen.queryByText('Independent detections')).toBeNull();
  });
});
