import { describe, expect, it } from 'vitest';
import { stagePunctuation } from './caption.ts';
import {
  dayMonthYear, daysBetween, decisionText, gapWords, recordTimeline, windowWords, type BriefDecision,
} from './record.ts';
import { chosenCue, parseCmPlumes, parseTip, type PassFrame } from './steps.ts';
import type { ToolCall } from '../types.ts';

// Shanxi on the Oct 21 board, as the tools wrote it (shortened).
const TIP = parseTip({ area: 'shanxi coal basin', start: '2026-10-07', end: '2026-10-21', days: 14, emit_can_look: true,
  top: { lat: 37.8938, lon: 113.5625, anomaly_ppb: 124.7, valid_days: 3 } }, 'shanxi coal basin')!;
const frame = (date: string, verdict: PassFrame['verdict'], short: PassFrame['short']): PassFrame =>
  ({ date, product: date > '2026-08-31' ? 'V003' : 'V002', verdict, short, reason: null, peak: null, chipUrl: null });
const FRAMES = [
  frame('2026-08-17', 'rejected', 'cloud or gap'),
  frame('2026-07-25', 'rejected', 'within noise'),
  frame('2025-08-18', 'candidate', 'candidate'),
  frame('2025-04-22', 'candidate', 'candidate'),
  frame('2025-04-22', 'rejected', 'too weak'),     // a second granule the same day: one mark, the stronger verdict
  frame('2025-03-02', 'error', 'error'),            // unread: not drawn
];
const CM = parseCmPlumes({ lat: 37.8938, lon: 113.5625, radius_km: 7, since: '2025-01-01', count: 3, latest: '2026-06-10',
  rate_kg_h: 2050, instrument: 'tanager', follow_radius_km: 7, dates: [
    { date: '2026-06-10', instrument: 'tanager', rate_kg_h: 2050, distance_km: 5.1 },
    { date: '2026-06-10', instrument: 'tanager', rate_kg_h: 900, distance_km: 5.2 },
    { date: '2025-05-10', instrument: 'tanager', rate_kg_h: 100, distance_km: 5.1 },
  ] })!;

describe('dates and gaps in the stage\'s words', () => {
  it('writes days first, windows short, and the gap in months or days', () => {
    expect(dayMonthYear('2026-06-10')).toBe('10 Jun 2026');
    expect(windowWords('2026-10-06', '2026-10-20')).toBe('6 to 20 Oct 2026');
    expect(windowWords('2026-09-28', '2026-10-12')).toBe('28 Sep to 12 Oct 2026');
    expect(windowWords('2025-12-28', '2026-01-10')).toBe('28 Dec 2025 to 10 Jan 2026');
    expect(daysBetween('2026-06-10', '2026-10-06')).toBe(118);
    expect(gapWords(118)).toBe('about 4 months');
    expect(gapWords(60)).toBe('about 2 months');
    expect(gapWords(59)).toBe('59 days');
    expect(gapWords(26)).toBe('26 days');
    expect(gapWords(1)).toBe('1 day');
  });
});

describe('recordTimeline', () => {
  it('draws one mark per look day and per plume day within 7 km, and the bracket to the tip', () => {
    const m = recordTimeline({ tip: TIP, frames: FRAMES, cm: CM })!;
    expect(m.axisStart).toBe('2025-01-01');
    expect(m.axisEnd).toBe('2026-10-21');
    expect(m.band).toMatchObject({ start: '2026-10-07', end: '2026-10-21', to: 1, ppb: 124.7 });
    expect(m.emit.map((e) => [e.date, e.kind, e.count])).toEqual([
      ['2025-04-22', 'seen', 2], ['2025-08-18', 'seen', 1], ['2026-07-25', 'faint', 1], ['2026-08-17', 'clouded', 1]]);
    expect(m.carbonMapper.map((c) => [c.date, c.count])).toEqual([['2025-05-10', 1], ['2026-06-10', 2]]);
    expect(m.latest).toMatchObject({ date: '2026-06-10', by: 'carbon_mapper', days: 119, words: 'about 4 months' });
    expect(m.latest!.at).toBeLessThan(m.band.from);
    expect(m.emit.every((e) => e.at >= 0 && e.at <= 1)).toBe(true);
  });

  it('leaves out plumes beyond the follow radius, and needs a tip to measure against', () => {
    const far = parseCmPlumes({ lat: 37.89, lon: 113.56, radius_km: 10, since: '2025-01-01', count: 1, latest: '2026-09-01',
      rate_kg_h: null, instrument: 'tanager', follow_radius_km: 7,
      dates: [{ date: '2026-09-01', instrument: 'tanager', rate_kg_h: null, distance_km: 8.5 }] });
    const m = recordTimeline({ tip: TIP, frames: FRAMES, cm: far })!;
    expect(m.carbonMapper).toEqual([]);
    expect(m.latest).toMatchObject({ date: '2025-08-18', by: 'emit', words: 'about 14 months' });
    expect(recordTimeline({ tip: { ...TIP, end: null }, frames: FRAMES, cm: CM })).toBeNull();
    expect(recordTimeline({ tip: TIP, frames: [], cm: null })!.latest).toBeNull();
    // A tip written before the window's first day was kept: the band runs back the scan's days.
    expect(recordTimeline({ tip: { ...TIP, start: null }, frames: [], cm: null })!.band.start).toBe('2026-10-08');
  });

  it('calls a same-day EMIT and Carbon Mapper confirmation both, and counts days under 60 in days', () => {
    const cm = parseCmPlumes({ lat: 37.89, lon: 113.56, radius_km: 7, since: '2025-01-01', count: 1, latest: '2026-09-11',
      rate_kg_h: null, instrument: 'tanager', follow_radius_km: 7,
      dates: [{ date: '2026-09-11', instrument: 'tanager', rate_kg_h: null, distance_km: 3 }] });
    const m = recordTimeline({ tip: TIP, frames: [frame('2026-09-11', 'candidate', 'candidate')], cm })!;
    expect(m.latest).toMatchObject({ date: '2026-09-11', by: 'both', days: 26, words: '26 days' });
  });
});

describe('the brief card\'s decision line', () => {
  const base: BriefDecision = {
    recommendation: 'recommend_new_look', reason: 'confirmation_older_than_90_days',
    latestConfirmed: { date: '2026-06-10', by: 'carbon_mapper' }, daysBetween: 118, reference: 'tip',
    lastLook: { date: '2026-08-17', result: 'clouded_out' }, confirmedDates: 9,
  };
  const all: BriefDecision[] = [
    base,
    { ...base, reason: 'last_look_clouded_out', confirmedDates: 2 },
    { ...base, recommendation: 'no_new_look_needed', reason: 'confirmed_within_90_days', latestConfirmed: { date: '2026-08-01', by: 'emit' }, daysBetween: 67 },
    { ...base, reason: 'no_confirmation_on_record', latestConfirmed: null, daysBetween: null, confirmedDates: 0 },
    { ...base, recommendation: 'no_new_look_needed', reason: 'confirmed_within_90_days', latestConfirmed: { date: '2026-10-12', by: 'both' }, daysBetween: -5 },
    { ...base, reference: 'brief', daysBetween: 135 },
  ];

  it('reads as the approved table has it (2026-10-23): the days before this fortnight, then the call', () => {
    expect(decisionText(base)).toBe('Methane was last seen up close here 118 days before this fortnight. The agent recommends a new close look.');
    expect(decisionText(all[2])).toBe('Methane was last seen up close here 67 days before this fortnight. No new close look is needed yet.');
    expect(decisionText(all[3])).toBe('No close look has confirmed methane here. The agent recommends a new close look.');
    // With the tip bars on the map the card says whose bars they are; their window is said with them.
    expect(decisionText(all[3], { bars: true })).toBe(
      "No close look has confirmed methane here, so the bars are TROPOMI's only. The agent recommends a new close look.");
    expect(decisionText(all[4])).toBe('Methane was seen up close here during this fortnight. No new close look is needed yet.');
    expect(decisionText(all[5])).toContain('135 days before this brief.');
    expect(decisionText({ ...base, daysBetween: 1 })).toContain(' 1 day before');
  });

  it('says a clouded-out last look with its date, and never a bar layer\'s date again', () => {
    expect(decisionText(all[1])).toBe("Methane was last seen up close here 118 days before this fortnight. EMIT's last look, "
      + 'on 17 Aug 2026, was clouded out. The agent recommends a new close look.');
    expect(decisionText(base)).not.toMatch(/10 Jun|2026-06-10/);
  });

  it('never says now, still, active or leaking, never another look, and has no dashes', () => {
    for (const d of all) {
      const text = decisionText(d);
      expect(text).not.toMatch(/\b(now|still|active|leaking)\b/i);
      expect(text).not.toMatch(/another look/i);
      expect(stagePunctuation(text)).toBe(text);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('the followed site', () => {
  it('is found by a V003 scene the agent put on the map, as by a V002 one', () => {
    const call = (id: string, lat: number, lon: number): ToolCall => ({ id, name: 'check_recent_passes', params: { lat, lon }, status: 'completed' });
    const dir = 's3://b/session_data/s/methane/';
    const v3 = 'EMIT_L2B_CH4ENH_003_20261012T071201';
    const cues = [call('a', 46.858, 52.7329), call('b', 37.8938, 113.5625)];
    const frames: Array<PassFrame[] | null> = [[{ ...frame('2026-10-12', 'candidate', 'candidate'), chipUrl: `${dir}passchip_${v3}.png` }], []];
    const shown: ToolCall = { id: 'd', name: 'display_visual', params: { s3_url: `${dir}columns_${v3}.geojson` }, status: 'completed' };
    expect(chosenCue(cues, frames, [shown])).toBe(0);
  });

  it('is the one the ground checks ran at when neither site had anything to put on the map', () => {
    const call = (id: string, name: string, lat: number, lon: number): ToolCall => ({ id, name, params: { lat, lon }, status: 'completed' });
    const cues = [call('a', 'check_recent_passes', 35.5493, 112.8982), call('b', 'check_recent_passes', 37.6834, 53.7827)];
    const later = [call('t', 'thermal_anomalies', 35.5493, 112.8982), call('r', 'registry_lookup', 35.5493, 112.8982)];
    expect(chosenCue(cues, [[], []], later)).toBe(0);
    expect(chosenCue(cues, [[], []], [])).toBeNull();
  });
});
