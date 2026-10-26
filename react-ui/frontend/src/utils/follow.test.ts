import { describe, expect, it } from 'vitest';
import {
  barKind, barLegendLabel, barShown, dayWords, decisionParts, decisionWords, followUrl, parseFollow, recordBarsLine, samePoint, tipBarsLine,
  windowLongWords, type Follow,
} from './follow.ts';
import { stagePunctuation } from './caption.ts';
import { layerLegend, stackLegends } from './layerStack.ts';
import { CARBON_MAPPER_SOURCE, METHANE_CM_COLUMNS, METHANE_TIP_COLUMNS, detectionPopupHtml, methaneGeometryHint } from './methaneLayers.ts';
import { isMethaneLayer, type LayerMetadata } from './layerFormatting.ts';
import { parseRenderHint } from './render.ts';
import type { ToolCall } from '../types.ts';

/** follow.json as follow_site writes it (agents/methane-hunter/follow_tools.py manifest()). */
const RAW = {
  reason: 'top_spot_stale_switched', basis: 'stronger_tip', gap_days: 90,
  tip: { start: '2026-10-07', end: '2026-10-21' },
  step1: { area: 'shanxi coal basin', rank: 1, lat: 35.5493, lon: 112.8982, anomaly_ppb: 122.6, latest: null, days_before_tip: null },
  followed: { area: 'south caspian', rank: 3, lat: 37.7625, lon: 53.9324, anomaly_ppb: 70.0,
    latest: { date: '2026-08-26', by: 'carbon_mapper' }, days_before_tip: 42 },
  checked: 4,
  tip_bars: { file: 'tipcolumns_37.7625_53.9324.geojson' },
  record_bars: { by: 'carbon_mapper', date: '2026-08-26', file: 'cmcolumns_tan20260826t070000c11s4001-A.geojson', days_before_tip: 42 },
};
const F = parseFollow(RAW)!;
const D = 's3://b/session_data/s/methane/';

describe('follow.json, field by field', () => {
  it('reads the decision, the two points and the bar files', () => {
    expect(F.reason).toBe('top_spot_stale_switched');
    expect(F.followed).toMatchObject({ area: 'south caspian', rank: 3, daysBeforeTip: 42, latest: { date: '2026-08-26', by: 'carbon_mapper' } });
    expect(F.step1.latest).toBeNull();
    expect(F.tipBars).toEqual({ file: 'tipcolumns_37.7625_53.9324.geojson' });
    expect(F.recordBars).toMatchObject({ by: 'carbon_mapper', daysBeforeTip: 42 });
  });

  it('drops what is malformed: a reason, an area, a date, a file name the tool never writes', () => {
    expect(parseFollow({ ...RAW, reason: 'because I said so' })).toBeNull();
    expect(parseFollow({ ...RAW, followed: { ...RAW.followed, area: 'North Korea' } })).toBeNull();
    expect(parseFollow({ ...RAW, followed: { ...RAW.followed, rank: 7 } })).toBeNull();
    expect(parseFollow({ ...RAW, tip: { start: '2026-02-30', end: '2026-10-21' } })).toBeNull();
    expect(parseFollow({ ...RAW, followed: { ...RAW.followed, latest: { date: '2026-08-26', by: 'a friend' } } })).toBeNull();
    expect(parseFollow({ ...RAW, tip_bars: { file: '../../secret.geojson' } })!.tipBars).toBeNull();
    expect(parseFollow({ ...RAW, record_bars: { ...RAW.record_bars, file: 'columns_EMIT_L2B_CH4ENH_003_20260926T040000.geojson' } })!.recordBars).toBeNull();
    expect(parseFollow({ ...RAW, record_bars: { ...RAW.record_bars, file: '\u003cimg src=x>.geojson' } })!.recordBars).toBeNull();
    expect(parseFollow(null)).toBeNull();
  });

  it('is read once the agent called follow_site, from the session or the case folder', () => {
    const tools: ToolCall[] = [{ id: '1', name: 'follow_site', params: {}, status: 'completed' }];
    expect(followUrl(D, tools)).toBe(`${D}follow.json`);
    expect(followUrl(D, [])).toBeNull();
    expect(followUrl(null, tools)).toBeNull();
  });
});

describe('the stage words (approved 2026-10-23)', () => {
  const words = (f: Follow) => [decisionWords(f), tipBarsLine(f), recordBarsLine(f) ?? ''];

  it('says the tip bars and the record bars as the table has them, the date once each', () => {
    expect(tipBarsLine(F)).toBe('TROPOMI, 7 to 21 October 2026. Taller bars mean more methane in the air than usual for this area.');
    expect(recordBarsLine(F)).toBe("Carbon Mapper's image of this plume, 26 August 2026. That is 42 days before this fortnight began.");
    const emit = parseFollow({ ...RAW, record_bars: { by: 'emit', date: '2026-08-15', file: 'columns_EMIT_L2B_CH4ENH_002_20260815T061000_2622401_012.geojson', days_before_tip: 19 } })!;
    expect(recordBarsLine(emit)).toBe('EMIT saw methane here on 15 August 2026. That is 19 days before this fortnight began.');
    const inside = parseFollow({ ...RAW, record_bars: { ...RAW.record_bars, days_before_tip: -3 } })!;
    expect(recordBarsLine(inside)).toContain('That is within this fortnight.');
    expect(recordBarsLine(parseFollow({ ...RAW, record_bars: null })!)).toBeNull();
  });

  it('says the decision for each reason in plain words', () => {
    expect(decisionWords(F)).toBe('Methane has not been seen up close at either top spot, so the agent is following the third spot '
      + 'in the south Caspian, last seen up close 42 days before this fortnight.');
    const stale = parseFollow({ ...RAW, step1: { ...RAW.step1, latest: { date: '2026-06-10', by: 'carbon_mapper' }, days_before_tip: 117 },
      followed: { ...RAW.followed, days_before_tip: 40 } })!;
    expect(decisionWords(stale)).toBe('Methane was last seen up close at the top spot in Shanxi 117 days before this fortnight, so the '
      + 'agent is following the third spot in the south Caspian, last seen up close 40 days before.');
    const kept = parseFollow({ ...RAW, reason: 'top_spot_stale_no_fresher', followed: { ...RAW.step1, latest: { date: '2026-06-10', by: 'carbon_mapper' }, days_before_tip: 117 },
      step1: { ...RAW.step1, latest: { date: '2026-06-10', by: 'carbon_mapper' }, days_before_tip: 117 } })!;
    expect(decisionWords(kept)).toBe('Methane was last seen up close at the top spot in Shanxi 117 days before this fortnight, and at '
      + 'none of the 4 next spots within 90 days, so the agent stays with it.');
    const tip = parseFollow({ ...RAW, reason: 'stronger_tip', followed: RAW.step1 })!;
    expect(decisionWords(tip)).toBe('Methane has not been seen up close at either top spot, or at the 4 next spots within 90 days, so '
      + 'the agent follows the stronger tip, the top spot in Shanxi.');
    // Step 1 held (the presenter's live run, Oct 26): the gap and the rule, from follow.json's numbers.
    const newest = parseFollow({ ...RAW, reason: 'newest_confirmation', checked: 0,
      followed: { ...RAW.step1, latest: { date: '2026-07-25', by: 'emit' }, days_before_tip: 78 } })!;
    expect(decisionWords(newest)).toBe('Methane was last seen up close at the top spot in Shanxi 78 days before this fortnight, '
      + 'within 90 days, so the agent stays with it and checks no more spots.');
    const during = parseFollow({ ...RAW, reason: 'newest_confirmation', checked: 0,
      followed: { ...RAW.step1, latest: { date: '2026-10-12', by: 'emit' }, days_before_tip: -5 } })!;
    expect(decisionWords(during)).toBe('Methane was seen up close at the top spot in Shanxi during this fortnight, '
      + 'so the agent stays with it and checks no more spots.');
    const sameDay = parseFollow({ ...RAW, reason: 'newest_confirmation', checked: 0,
      followed: { ...RAW.step1, latest: { date: '2026-10-07', by: 'both' }, days_before_tip: 0 } })!;
    expect(decisionWords(sameDay)).toContain('during this fortnight');
    for (const f of [F, stale, kept, tip, newest, during]) {
      for (const w of words(f)) {
        expect(w).not.toMatch(/\b(now|still|active|leaking)\b/i);
        expect(stagePunctuation(w)).toBe(w);       // no em or en dashes, no rules
        expect(w).not.toMatch(/[\u2013\u2014]/);
        expect(w).not.toMatch(/\b(color|center)\b/);
      }
    }
  });

  it('prints the decision\'s figures in mono, and takes the rule\'s days from follow.json', () => {
    const newest = parseFollow({ ...RAW, reason: 'newest_confirmation', checked: 0,
      followed: { ...RAW.step1, latest: { date: '2026-07-25', by: 'emit' }, days_before_tip: 78 } })!;
    expect(newest.gapDays).toBe(90);
    expect(decisionParts(newest).filter((p) => p.mono).map((p) => p.text)).toEqual(['78 days', '90 days']);
    const sixty = parseFollow({ ...RAW, gap_days: 60, reason: 'newest_confirmation', checked: 0,
      followed: { ...RAW.step1, latest: { date: '2026-07-25', by: 'emit' }, days_before_tip: 52 } })!;
    expect(decisionWords(sixty)).toContain('52 days before this fortnight, within 60 days,');
    // A file from before the threshold was recorded: the rule's own 90; a malformed one is dropped.
    const older: Record<string, unknown> = { ...RAW };
    delete older.gap_days;
    expect(parseFollow(older)!.gapDays).toBe(90);
    expect(parseFollow({ ...RAW, gap_days: 'ninety' })).toBeNull();
    expect(parseFollow({ ...RAW, gap_days: 0 })).toBeNull();
    // The other reasons' lines are unchanged in words (their 90 now read from the file).
    const tip = parseFollow({ ...RAW, reason: 'stronger_tip', followed: RAW.step1 })!;
    expect(decisionParts(tip).filter((p) => p.mono).map((p) => p.text)).toEqual(['90 days']);
  });

  it('writes dates day first, long on the plate and short in the legend', () => {
    expect(dayWords('2026-06-20')).toBe('20 June 2026');
    expect(dayWords('2026-06-20', true)).toBe('20 Jun 2026');
    expect(windowLongWords('2026-09-28', '2026-10-12')).toBe('28 September to 12 October 2026');
    expect(windowLongWords('2025-12-28', '2026-01-10', true)).toBe('28 Dec 2025 to 10 Jan 2026');
  });
});

describe('the bar layers on the map and in the legend', () => {
  const layer = (file: string, render = methaneGeometryHint(undefined, `${D}${file}`) ?? undefined): LayerMetadata =>
    ({ id: file, name: 'a title the model wrote', url: `${D}${file}`, type: 'geometry', render } as LayerMetadata);

  it('knows the bars by their file names only', () => {
    expect(barKind(`${D}tipcolumns_37.7625_53.9324.geojson`)).toBe('tip');
    expect(barKind(`${D}cmcolumns_tan-A.geojson`)).toBe('carbon_mapper');
    expect(barKind(`${D}columns_EMIT_L2B_CH4ENH_003_20260926T040000.geojson`)).toBe('emit');
    expect(barKind(`${D}plumes_x.geojson`)).toBeNull();
    expect(isMethaneLayer(layer('tipcolumns_37.7625_53.9324.geojson'))).toBe(true);
    expect(isMethaneLayer(layer('cmcolumns_tan-A.geojson'))).toBe(true);
    expect(methaneGeometryHint(undefined, `${D}tipcolumns_37.7625_53.9324.geojson`)).toBe(METHANE_TIP_COLUMNS);
    expect(methaneGeometryHint(undefined, `${D}cmcolumns_tan-A.geojson`)).toBe(METHANE_CM_COLUMNS);
    const call = (file: string): ToolCall => ({ id: file, name: 'display_visual', params: { s3_url: `${D}${file}` }, status: 'completed' });
    expect(barShown(call('tipcolumns_37.7625_53.9324.geojson'), F)).toBe('tip');
    expect(barShown(call('cmcolumns_tan20260826t070000c11s4001-A.geojson'), F)).toBe('record');
    expect(barShown(call('cmcolumns_other.geojson'), F)).toBeNull();
  });

  it('gives each bar layer its own legend row with its date, and Carbon Mapper its source', () => {
    const tip = layerLegend(layer('tipcolumns_37.7625_53.9324.geojson'), F);
    expect(tip).toMatchObject({ kind: 'measure', key: 'bars-tip', label: 'TROPOMI, 7 to 21 Oct 2026', units: 'ppb', ramp: 'ice' });
    const cm = layerLegend(layer('cmcolumns_tan20260826t070000c11s4001-A.geojson'), F);
    expect(cm).toMatchObject({ key: 'bars-carbon_mapper', label: 'Carbon Mapper plume, 26 Aug 2026', source: CARBON_MAPPER_SOURCE });
    const emit = layerLegend(layer('columns_EMIT_L2B_CH4ENH_002_20260815T061000_2622401_012.geojson'), null);
    expect(emit).toMatchObject({ key: 'bars-emit', label: 'EMIT, 15 Aug 2026', units: 'ppm·m' });
    expect(emit && 'source' in emit ? emit.source : undefined).toBeUndefined();
    // Without follow.json (a case recorded before it) the rows still name their source, without a date.
    expect(barLegendLabel(`${D}tipcolumns_37.7625_53.9324.geojson`, null)).toBe('TROPOMI around the site');
    expect(barLegendLabel(`${D}cmcolumns_tan-A.geojson`, null)).toBe('Carbon Mapper plume');
    // The two bar kinds are two rows (never merged on a shared ramp key).
    const rows = stackLegends([layer('cmcolumns_tan20260826t070000c11s4001-A.geojson'), layer('tipcolumns_37.7625_53.9324.geojson')], () => true, F);
    expect(rows.map((r) => ('label' in r ? r.label : r.kind))).toEqual(['Carbon Mapper plume, 26 Aug 2026', 'TROPOMI, 7 to 21 Oct 2026']);
  });

  it('carries a validated height scale on the columns hint', () => {
    expect(parseRenderHint({ ...METHANE_TIP_COLUMNS })?.height_scale).toBe(40);
    for (const bad of [0, -1, 5001, Number.NaN, '40', Infinity]) {
      expect(parseRenderHint({ kind: 'columns', property: 'ppb', height_scale: bad })).toBeNull();
    }
    expect(parseRenderHint({ kind: 'columns', property: 'ppm_m' })?.height_scale).toBeUndefined();
  });

  it("builds Carbon Mapper's ring popup from a date, a fixed word and a rate only (MapView)", () => {
    const html = detectionPopupHtml({ date: '2026-06-20', rate_kg_h: 273.1, instrument: 'tanager' });
    expect(html).toContain('Carbon Mapper plume, 2026-06-20');
    expect(html).toContain('<code>Tanager-1</code>');
    expect(html).toContain('about 270 kg/h');
    expect(html).toContain(CARBON_MAPPER_SOURCE);
    const hostile = detectionPopupHtml({ date: '\u003cimg src=x onerror=alert(1)>', rate_kg_h: '\u003cb>9\u003c/b>', instrument: '\u003cscript>' });
    expect(hostile).not.toMatch(/\u003c(img|script|b>)/);
    expect(hostile).toContain('<code>n/a</code>');
    expect(hostile).toContain('not published');
  });

  it('matches a followed point to 4 decimals', () => {
    expect(samePoint(F.followed, 37.7625, 53.9324)).toBe(true);
    expect(samePoint(F.followed, '37.7625', '53.9324')).toBe(true);
    expect(samePoint(F.followed, 37.78, 53.9324)).toBe(false);
  });
});
