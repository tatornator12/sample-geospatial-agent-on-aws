import { describe, expect, it } from 'vitest';
import { stagePunctuation } from './caption.ts';
import {
  axisLayout, dayMonth, dayMonthYear, daysBetween, decisionText, emptyRowWords, labelWidth, recordTimeline, windowShortWords,
  windowWords, type AxisLayout, type BriefDecision,
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
  it('writes days first and windows short; the axis carries the year', () => {
    expect(dayMonthYear('2026-06-10')).toBe('10 Jun 2026');
    expect(dayMonth('2026-07-25')).toBe('25 Jul');
    expect(dayMonth('2026-03-03')).toBe('3 Mar');
    expect(windowWords('2026-10-06', '2026-10-20')).toBe('6 to 20 Oct 2026');
    expect(windowWords('2026-09-28', '2026-10-12')).toBe('28 Sep to 12 Oct 2026');
    expect(windowWords('2025-12-28', '2026-01-10')).toBe('28 Dec 2025 to 10 Jan 2026');
    expect(windowShortWords('2026-10-11', '2026-10-24')).toBe('11 to 24 Oct');
    expect(windowShortWords('2026-09-28', '2026-10-12')).toBe('28 Sep to 12 Oct');
    expect(windowShortWords('2025-12-28', '2026-01-10')).toBe('28 Dec to 10 Jan');
    expect(daysBetween('2026-06-10', '2026-10-06')).toBe(118);
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
    expect(m.latest).toMatchObject({ date: '2026-06-10', by: 'carbon_mapper', days: 119, words: '119 days' });
    expect(m.latest!.at).toBeLessThan(m.band.from);
    expect(m.emit.every((e) => e.at >= 0 && e.at <= 1)).toBe(true);
  });

  it('leaves out plumes beyond the follow radius, and needs a tip to measure against', () => {
    const far = parseCmPlumes({ lat: 37.89, lon: 113.56, radius_km: 10, since: '2025-01-01', count: 1, latest: '2026-09-01',
      rate_kg_h: null, instrument: 'tanager', follow_radius_km: 7,
      dates: [{ date: '2026-09-01', instrument: 'tanager', rate_kg_h: null, distance_km: 8.5 }] });
    const m = recordTimeline({ tip: TIP, frames: FRAMES, cm: far })!;
    expect(m.carbonMapper).toEqual([]);
    expect(m.latest).toMatchObject({ date: '2025-08-18', by: 'emit', words: '415 days' });
    expect(recordTimeline({ tip: { ...TIP, end: null }, frames: FRAMES, cm: CM })).toBeNull();
    expect(recordTimeline({ tip: TIP, frames: [], cm: null })!.latest).toBeNull();
    // A tip written before the window's first day was kept: the band runs back the scan's days.
    expect(recordTimeline({ tip: { ...TIP, start: null }, frames: [], cm: null })!.band.start).toBe('2026-10-08');
  });

  it('calls a same-day EMIT and Carbon Mapper confirmation both, and always counts the gap in days', () => {
    const cm = parseCmPlumes({ lat: 37.89, lon: 113.56, radius_km: 7, since: '2025-01-01', count: 1, latest: '2026-09-11',
      rate_kg_h: null, instrument: 'tanager', follow_radius_km: 7,
      dates: [{ date: '2026-09-11', instrument: 'tanager', rate_kg_h: null, distance_km: 3 }] });
    const m = recordTimeline({ tip: TIP, frames: [frame('2026-09-11', 'candidate', 'candidate')], cm })!;
    expect(m.latest).toMatchObject({ date: '2026-09-11', by: 'both', days: 26, words: '26 days' });
  });
});

// The presenter's live run, Oct 26 2026: Shanxi's top spot, the fortnight 11 to 24 Oct, EMIT's newest
// candidate 25 Jul (78 days before the fortnight's first day), no Carbon Mapper plume within 7 km.
const LIVE_TIP = parseTip({ area: 'shanxi coal basin', start: '2026-10-11', end: '2026-10-24', days: 14, emit_can_look: true,
  top: { lat: 37.8927, lon: 113.5628, anomaly_ppb: 112.8, valid_days: 4 } }, 'shanxi coal basin')!;
const LIVE_FRAMES = [frame('2026-08-20', 'rejected', 'too weak'), frame('2026-07-25', 'candidate', 'candidate'),
  frame('2026-06-02', 'rejected', 'cloud or gap'), frame('2025-09-25', 'candidate', 'candidate')];
const NO_CM = parseCmPlumes({ lat: 37.8927, lon: 113.5628, radius_km: 7, since: '2025-01-01', count: 0, latest: null,
  rate_kg_h: null, instrument: null, follow_radius_km: 7, dates: [] })!;
const live = recordTimeline({ tip: LIVE_TIP, frames: LIVE_FRAMES, cm: NO_CM })!;
const words = (parts: Array<{ text: string }>) => parts.map((p) => p.text).join('');

describe('the shared date axis (approved 2026-10-26)', () => {
  it('ticks every month from January 2025 to the tip, the years at their Januaries', () => {
    const { ticks, years } = live.axis;
    expect(ticks).toHaveLength(22);                               // Jan 2025 to Oct 2026
    expect(ticks.filter((t) => t.year).map((t) => t.at)).toEqual([0, years[1].at]);
    expect(years.map((y) => y.text)).toEqual(['2025', '2026']);
    expect(years[1].at).toBeCloseTo(365 / daysBetween('2025-01-01', '2026-10-24'), 6);
    expect(ticks.every((t, i) => i === 0 || t.at > ticks[i - 1].at)).toBe(true);
    expect(ticks[ticks.length - 1].at).toBeLessThan(1);
  });

  it('labels the latest close look at its mark, the gap in days to the fortnight\'s first day, and the fortnight', () => {
    expect(live.axis.fortnight).toBe('11 to 24 Oct');
    expect(live.axis.latest).toEqual({ at: live.latest!.at, text: '25 Jul 2026' });
    expect(live.axis.gap).toMatchObject({ from: live.latest!.at, to: live.band.from, days: 78 });
    // Pinned to the first day, as the follow rule measures it (to the fortnight's end it would be 91).
    expect(words(live.axis.gap!.words)).toBe('78 days to 11 Oct');
    expect(live.axis.gap!.words.filter((p) => p.mono).map((p) => p.text)).toEqual(['78 days', '11 Oct']);
    expect(live.axis.during).toBeNull();
    const inside = recordTimeline({ tip: LIVE_TIP, frames: [frame('2026-10-14', 'candidate', 'candidate')], cm: NO_CM })!;
    expect(inside.axis.gap).toBeNull();
    expect(words(inside.axis.during!)).toBe('during this fortnight');
    const none = recordTimeline({ tip: LIVE_TIP, frames: [frame('2026-06-02', 'rejected', 'cloud or gap')], cm: NO_CM })!;
    expect(none.axis.latest).toBeNull();
    expect(none.axis.gap).toBeNull();
  });

  it('says what an empty row means: none since January 2025, or that it could not be read', () => {
    expect(live.carbonMapper).toEqual([]);
    expect(live.carbonMapperRead).toBe('read');
    expect(emptyRowWords('carbon_mapper', live.carbonMapperRead)).toBe('none since January 2025');
    expect(emptyRowWords('carbon_mapper', 'unavailable')).toBe('could not be read');
    expect(recordTimeline({ tip: LIVE_TIP, frames: LIVE_FRAMES, cm: null })!.carbonMapperRead).toBe('not_checked');
    expect(emptyRowWords('emit')).toBe('no pass read since January 2025');
  });
});

describe('axisLayout: labels drop a line rather than shrink', () => {
  const sameLine = (l: AxisLayout) => {
    const boxes = [...l.years, ...(l.latest ? [l.latest] : []), ...(l.gap ? [l.gap] : []), ...(l.during ? [l.during] : [])];
    return boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.line === b.line
      && a.left < b.left + b.width && b.left < a.left + a.width));
  };

  for (const width of [222, 291]) {
    it(`at ${width} px (the column at ${width === 222 ? '1280 x 720' : '1920 x 1080'}): years, then the date, then the gap`, () => {
      const l = axisLayout(live.axis, width);
      expect(l.years.map((y) => [y.text, y.line])).toEqual([['2025', 0], ['2026', 0]]);
      expect(l.years[0].left).toBe(2);
      const mark = live.axis.latest!.at * width;
      expect(l.latest).toMatchObject({ text: '25 Jul 2026', line: 1, width: labelWidth('25 Jul 2026') });
      expect(l.latest!.left + l.latest!.width).toBeCloseTo(mark, 6);   // its right edge at its mark
      expect(l.gap).toMatchObject({ line: 2, inside: false, bracket: { left: mark, line: 2 } });
      expect(l.gap!.bracket.right).toBeCloseTo(live.band.from * width, 6);
      expect(l.gap!.left + l.gap!.width).toBeLessThanOrEqual(mark - 8);  // just left of the bracket
      expect(l.lines).toBe(3);
      expect(sameLine(l)).toEqual([]);
      for (const b of [...l.years, l.latest!, l.gap!]) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.left + b.width).toBeLessThanOrEqual(width);
      }
    });
  }

  it('puts the gap inside a wide bracket, on the date\'s line', () => {
    const old = recordTimeline({ tip: LIVE_TIP, frames: [frame('2025-03-10', 'candidate', 'candidate')], cm: NO_CM })!;
    const l = axisLayout(old.axis, 600);
    expect(words(old.axis.gap!.words)).toBe('580 days to 11 Oct');
    expect(l.gap).toMatchObject({ inside: true, line: l.latest!.line });
    expect(l.gap!.left).toBeGreaterThan(l.gap!.bracket.left);
    expect(l.gap!.left + l.gap!.width).toBeLessThan(l.gap!.bracket.right);
    expect(sameLine(l)).toEqual([]);
  });

  it('with no room either side, puts the words under the bracket', () => {
    const old = recordTimeline({ tip: LIVE_TIP, frames: [frame('2025-08-18', 'candidate', 'candidate')], cm: NO_CM })!;
    const l = axisLayout(old.axis, 222);
    expect(l.gap!.bracket.line).toBe(l.latest!.line + 1);
    expect(l.gap!.line).toBe(l.gap!.bracket.line + 1);
    expect(l.gap!.left + l.gap!.width).toBeLessThanOrEqual(222);
    expect(l.lines).toBe(l.gap!.line + 1);
  });

  it('a confirmation during the fortnight: its words right-aligned under the date', () => {
    const inside = recordTimeline({ tip: LIVE_TIP, frames: [frame('2026-10-14', 'candidate', 'candidate')], cm: NO_CM })!;
    const l = axisLayout(inside.axis, 222);
    expect(l.gap).toBeNull();
    expect(l.during).toMatchObject({ line: l.latest!.line + 1 });
    expect(l.during!.left + l.during!.width).toBe(222);
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
