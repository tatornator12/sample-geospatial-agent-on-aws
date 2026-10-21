import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '../types.ts';
import { anotherLookMessage, approvedMessage, currentBriefId, draftBriefId, groundChecks, lastLookLine, missionChain, siteCue, siteTip } from './brief.ts';
import { parseManifest, parseTip } from './steps.ts';

const ID = 'brief-20260925T201500-a1b2c3';
const ID2 = 'brief-20260925T203000-ffffff';
const draftText = (id: string) => `**Methane Watch brief: Recurring methane** (draft \`${id}\`, not filed)\n\nDecision: analyst's.`;
const user = (content: string): Message => ({ role: 'user', content }) as Message;
const agent = (content: string): Message => ({ role: 'assistant', content }) as Message;

describe('draftBriefId', () => {
  it('reads the id the brief names as a draft, the last one when there are two', () => {
    expect(draftBriefId(draftText(ID))).toBe(ID);
    expect(draftBriefId(`${draftText(ID)}\n${draftText(ID2)}`)).toBe(ID2);
    expect(draftBriefId(`I filed ${ID}`)).toBeNull();
    expect(draftBriefId('draft `brief-2026`')).toBeNull();
  });
});

describe('currentBriefId', () => {
  it('shows the brief the latest answer drafted', () => {
    expect(currentBriefId([user('Brief me'), agent(draftText(ID))])).toBe(ID);
  });

  it('keeps it on the stage through the analyst\'s decision and the answer to it', () => {
    expect(currentBriefId([user('Brief me'), agent(draftText(ID)), user(approvedMessage(ID))])).toBe(ID);
    expect(currentBriefId([user('Brief me'), agent(draftText(ID)), user(approvedMessage(ID)), agent('The analyst filed it.')])).toBe(ID);
    expect(currentBriefId([agent(draftText(ID)), user(anotherLookMessage(ID)), agent(draftText(ID2))])).toBe(ID2);
  });

  it('lets it go once the conversation moves on', () => {
    expect(currentBriefId([agent(draftText(ID)), user('Show me the Permian'), agent('39 plumes')])).toBeNull();
    // A typed message that merely mentions the id is not a decision.
    expect(currentBriefId([agent(draftText(ID)), user(`what about ${ID}?`)])).toBeNull();
    expect(currentBriefId([])).toBeNull();
  });
});

// The Methane Watch replay's records (use-cases/methane-watch-mission/): the Krasnovodsk site's pass
// manifest and the south Caspian tip, trimmed to the fields the stage reads.
const DIR = 's3://bucket/use-cases/methane-watch-mission/';
const PASSES = {
  lat: 39.4379,
  lon: 53.573,
  since: '2025-01-01',
  passes: [
    { date: '2025-06-13', verdict: 'rejected', short: 'within noise', peak_ppm_m: 1231.6 },
    { date: '2025-08-20', verdict: 'candidate', short: 'candidate', peak_ppm_m: 2828.3 },
    { date: '2025-06-17', verdict: 'rejected', short: 'cloud or gap' },
    { date: '2025-08-01', verdict: 'candidate', short: 'candidate', peak_ppm_m: 2309.7 },
  ],
};
const TIP = { area: 'south caspian', end: '2026-10-10', days: 14, emit_can_look: true, top: { lat: 39.4379, lon: 53.573, anomaly_ppb: 108.8, valid_days: 5 } };
const cue = (id: string, lat: number, lon: number): ToolCall => ({ id, name: 'check_recent_passes', params: { lat, lon }, status: 'completed' });

describe('lastLookLine', () => {
  it("dates EMIT's last look from the newest pass and the latest sign from the tip over the site", () => {
    const frames = parseManifest(PASSES, DIR);
    const tip = parseTip(TIP, 'south caspian');
    expect(tip?.point).toEqual([53.573, 39.4379]);
    expect(lastLookLine(frames, tip)).toEqual({ lastLook: 'Aug 20 2025', tropomi: { days: 14, end: 'Oct 10 2026' } });
  });

  it('gives the last look alone without a tip, and nothing without a pass', () => {
    expect(lastLookLine(parseManifest(PASSES, DIR), null)).toEqual({ lastLook: 'Aug 20 2025', tropomi: null });
    expect(lastLookLine([], parseTip(TIP, 'south caspian'))).toBeNull();
    expect(lastLookLine(null)).toBeNull();
  });
});

describe('siteCue and siteTip', () => {
  it("pick the card's site to 2 decimals, the latest cue when there are two", () => {
    const cues = [cue('a', 39.4379, 53.573), cue('b', 35.5528, 112.6889), cue('c', 39.44, 53.5712)];
    expect(siteCue(cues, 39.4379, 53.573)?.id).toBe('c');
    expect(siteCue(cues, 35.55, 112.69)?.id).toBe('b');
    expect(siteCue(cues, 40.1, 53.573)).toBeNull();
    const tip = parseTip(TIP, 'south caspian')!;
    expect(siteTip([tip], 39.4379, 53.573)).toBe(tip);
    expect(siteTip([tip], 35.5528, 112.6889)).toBeNull();
  });
});

describe('missionChain and groundChecks (B15, A2 P1-2)', () => {
  it('counts each ground check once', () => {
    const t = (name: string, id: string) => ({ name, id, params: {}, status: 'completed' as const });
    expect(groundChecks([t('thermal_anomalies', 'a'), t('thermal_anomalies', 'b'), t('registry_lookup', 'c'), t('draft_brief', 'd')])).toBe(2);
    expect(groundChecks([])).toBe(0);
  });
  it('builds each part from its record, and leaves out a part with none', () => {
    const tip = parseTip({ area: 'amman', emit_can_look: true, top: { lat: 31.9, lon: 36.1, anomaly_ppb: 12.5 } }, 'amman')!;
    const frames = [
      { date: '2025-08-20', verdict: 'candidate' as const, short: 'candidate' as const, reason: null, peak: 1, chipUrl: null },
      { date: '2025-08-01', verdict: 'rejected' as const, short: 'too weak' as const, reason: null, peak: 1, chipUrl: null },
    ];
    expect(missionChain({ tip, frames, checks: 3 })).toEqual({ tip: { label: 'Amman, Jordan', ppb: 12.5 }, cue: { candidates: 1, read: 2 }, checks: 3 });
    expect(missionChain({})).toEqual({ tip: null, cue: null, checks: null });
  });
});
