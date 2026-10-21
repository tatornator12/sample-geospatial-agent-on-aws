import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import {
  chosenCue,
  filmstripSummary,
  groupDetail,
  groupName,
  groupSteps,
  bboxAreaKm2,
  dayMinus,
  excludedDays,
  isoDay,
  methaneDirFrom,
  parseManifest,
  parseTip,
  passManifestUrl,
  planStage,
  rankTips,
  tipCued,
  tipManifestUrl,
  type PassFrame,
} from './steps.ts';

let n = 0;
function call(name: string, params: Record<string, unknown> = {}, status: ToolCall['status'] = 'completed'): ToolCall {
  n += 1;
  return { id: `t${n}`, name, params, status };
}

describe('groupSteps and groupName', () => {
  it('folds consecutive calls of one tool into one step', () => {
    const areas = ['permian basin', 'south caspian', 'zagros foreland', 'shanxi coal basin', 'orenburg and lower volga', 'west siberia and yamal', 'hassi messaoud'];
    const steps = [call('watch_baseline'), call('display_visual'), ...areas.map((area) => call('scan_tropomi', { area })), call('check_recent_passes', { lat: 39.4741, lon: 53.6435 })];
    const groups = groupSteps(steps);
    expect(groups.map((g) => g.name)).toEqual(['watch_baseline', 'display_visual', 'scan_tropomi', 'check_recent_passes']);
    expect(groups.map(groupName)).toEqual(['Build the baseline', 'Put it on the map', 'Scan 7 watch areas', 'Cue EMIT']);
    expect(groups[2].first).toBe(3);
    expect(groupDetail(groups[2])?.text).toBe(areas.join(' · '));
  });

  it('does not fold calls that are not consecutive', () => {
    expect(groupSteps([call('inspect_image'), call('display_visual'), call('inspect_image')])).toHaveLength(3);
  });

  it('names an unknown repeated tool with a count', () => {
    expect(groupName(groupSteps([call('calculator'), call('calculator')])[0])).toBe('Calculate ×2');
  });
});

describe('groupDetail', () => {
  it('never prints a model-written area', () => {
    const [g] = groupSteps([call('scan_tropomi', { area: '<b>Operator X</b>' }), call('scan_tropomi', { bbox: [1, 2, 3, 4] })]);
    expect(groupDetail(g)).toBeNull();
  });

  it('says what the cue followed, with the point as numbers', () => {
    const groups = groupSteps([call('scan_tropomi', { area: 'south caspian' }), call('check_recent_passes', { lat: '39.4741', lon: 53.6435 })]);
    expect(groupDetail(groups[1], groups.slice(0, 1))).toEqual({ text: 'Following the TROPOMI tip', mono: '39.47, 53.64', points: ['39.47, 53.64'] });
    // The tip's map update rides between the scan and the cue: still following the tip.
    const withDisplay = groupSteps([call('scan_tropomi', { area: 'south caspian' }), call('display_visual'), call('check_recent_passes', { lat: 1, lon: 2 })]);
    expect(groupDetail(withDisplay[2], withDisplay.slice(0, 2))?.text).toBe('Following the TROPOMI tip');
    expect(groupDetail(groupSteps([call('check_recent_passes', { lat: 'north', lon: 1 })])[0])).toEqual({ text: 'Recent EMIT passes' });
  });
});

describe('groupDetail: Earth Analyst', () => {
  const one = (name: string, params: Record<string, unknown>) => groupDetail(groupSteps([call(name, params)])[0]);

  it('prints the 60-day window that ends on the requested date (Bergen)', () => {
    expect(one('get_rasters', { location: 'Bergen', current_date_str: '2025-11-15' })).toEqual({ text: 'Scenes from 2025-09-16 to 2025-11-15' });
    // Leap years and month ends come from the calendar, not from the model.
    expect(one('get_rasters', { current_date_str: '2024-03-01' })?.text).toBe('Scenes from 2024-01-01 to 2024-03-01');
    expect(one('get_rasters', { current_date_str: ' 2025-11-15 ' })?.text).toBe('Scenes from 2025-09-16 to 2025-11-15');
  });

  it('says which scenes the agent turned down, valid days only, sorted', () => {
    const d = one('get_rasters', { current_date_str: '2025-11-15', exclude_dates: '2025-11-02, <b>x</b>, 2025-13-40, 2025-10-28' });
    expect(d).toEqual({ text: 'Scenes from 2025-09-16 to 2025-11-15', mono: 'skipping 2025-10-28 · 2025-11-02' });
    expect(one('get_rasters', { current_date_str: '2025-11-15', exclude_dates: ['2025-11-02', '2025-11-02', 7, '2025-02-30'] })?.mono).toBe('skipping 2025-11-02');
    expect(one('get_rasters', { current_date_str: '2025-11-15', exclude_dates: '2025-11-01;2025-11-03' })?.mono).toBe('skipping 2025-11-01 · 2025-11-03');
    // At most three days on the stage.
    expect(one('get_rasters', { exclude_dates: '2025-11-04,2025-11-03,2025-11-02,2025-11-01' })?.mono).toBe('skipping 2025-11-01 · 2025-11-02 · 2025-11-03');
    expect(one('get_rasters', { current_date_str: '2025-11-15', exclude_dates: '' })).toEqual({ text: 'Scenes from 2025-09-16 to 2025-11-15' });
  });

  it('never prints a date it cannot validate', () => {
    expect(one('get_rasters', { current_date_str: '<script>' })).toEqual({ text: 'Scenes from the last 60 days' });
    expect(one('get_rasters', { current_date_str: '2025-13-40' })).toEqual({ text: 'Scenes from the last 60 days' });
    expect(one('get_rasters', { current_date_str: '2025-11-15T00:00' })).toEqual({ text: 'Scenes from the last 60 days' });
    expect(one('get_rasters', {})).toEqual({ text: 'Scenes from the last 60 days' });
    const d = one('get_rasters', { current_date_str: 20251115, exclude_dates: '<img src=x>' });
    expect(d).toEqual({ text: 'Scenes from the last 60 days' });
  });

  it('names each window when one step fetched several', () => {
    const [g] = groupSteps([
      call('get_rasters', { current_date_str: '2024-07-01' }),
      call('get_rasters', { current_date_str: '2019-07-01', exclude_dates: '2019-06-20' }),
    ]);
    expect(groupDetail(g)).toEqual({ text: 'Scenes in the 60 days to 2019-07-01 and 2024-07-01', mono: 'skipping 2019-06-20' });
    const days = ['2021-07-01', '2020-07-01', '2022-07-01', '2023-07-01'];
    const [three] = groupSteps(days.slice(0, 3).map((d) => call('get_rasters', { current_date_str: d })));
    expect(groupDetail(three)?.text).toBe('Scenes in the 60 days to 2020-07-01, 2021-07-01 and 2022-07-01');
    const [four] = groupSteps(days.map((d) => call('get_rasters', { current_date_str: d })));
    expect(groupDetail(four)?.text).toBe('Scenes in the 60 days to each of 4 dates');
  });

  it('prints both windows of a two-date fetch', () => {
    expect(one('get_rasters_for_dates', { date1_str: '2024-12-31', date2_str: '2025-03-01', exclude_dates: '2025-02-20' })).toEqual({
      text: 'Two 60-day windows, to 2024-12-31 and to 2025-03-01',
      mono: 'skipping 2025-02-20',
    });
    expect(one('get_rasters_for_dates', { date1_str: '2024-12-31', date2_str: 'after the fire' })).toEqual({ text: 'Two 60-day windows' });
  });

  it('says how big the scanned area is, and why that means the embedding grid', () => {
    // [-105, 39, -104, 40]: R² × 1° × (sin 40° − sin 39°) ≈ 9,540 km² (checked by hand).
    expect(one('scan_region_change', { region: 'Colorado', bbox: [-105, 39, -104, 40], year1: 2019, month1: 7, year2: 2024, month2: 7 })).toEqual({
      text: 'About 9,500 km², so an embedding scan',
      mono: '2019-07 · 2024-07',
    });
    // Half the height: ≈ 4,753 km², under the pixel limit.
    expect(one('scan_region_change', { bbox: [-105, 39.5, -104, 40] })).toEqual({ text: 'About 4,800 km², scanned on the embedding grid' });
    // A JSON string of four numbers is read the same way.
    expect(one('scan_region_change', { bbox: '[-105, 39, -104, 40]' })?.text).toBe('About 9,500 km², so an embedding scan');
  });

  it('falls back to the whole region when the box is not four valid numbers, and never prints the region', () => {
    for (const bbox of [[-104, 39, -105, 40], [Number.NaN, 39, -104, 40], ['-105', '39', '-104', '40'], [-105, 39, -104], '<b>Colorado</b>', [-200, 39, -104, 40]]) {
      expect(one('scan_region_change', { region: '<b>Colorado</b>', bbox })).toEqual({ text: 'A whole region, on the embedding grid' });
    }
    const d = one('scan_region_change', { region: 'Colorado', year1: 2019, month1: 13, year2: 2024, month2: 7 });
    expect(d).toEqual({ text: 'A whole region, on the embedding grid' });
    expect(JSON.stringify(d)).not.toContain('Colorado');
    expect(one('scan_region_change', { year1: '2019', month1: 7, year2: 2024, month2: 7 })?.mono).toBeUndefined();
    expect(one('scan_region_change', { year1: 2019.5, month1: 7, year2: 2024, month2: 7 })?.mono).toBeUndefined();
  });

  it('says pixel-level change works up to the pixel limit, with the two dates', () => {
    expect(one('run_change_detection', { location: 'Folsom', date1_str: '2021-08-30', date2_str: '2022-08-25' })).toEqual({
      text: 'Pixel by pixel, for areas up to 5,000 km²',
      mono: '2021-08-30 · 2022-08-25',
    });
    expect(one('run_change_detection', { date1_str: '2021-08-30', date2_str: 'later' })).toEqual({ text: 'Pixel by pixel, for areas up to 5,000 km²' });
  });

  it('leaves the methane details as they were', () => {
    const [g] = groupSteps([call('thermal_anomalies', { nights: 14 })]);
    expect(groupDetail(g)).toEqual({ text: 'VIIRS night-time heat, last 14 nights' });
    expect(one('nearby_infrastructure', {})).toEqual({ text: 'Overture Maps, by type, within 2 km' });
    expect(one('registry_lookup', { radius_km: 3 })).toEqual({ text: 'OGIM public registry, operators of record, within 3 km' });
    expect(one('inspect_image', { s3_url: 's3://b/x.tif' })).toBeNull();
  });
});

describe('isoDay, dayMinus, excludedDays and bboxAreaKm2', () => {
  it('validate model-written values', () => {
    expect(isoDay('2024-02-29')).toBe('2024-02-29');
    expect(isoDay('2025-02-29')).toBeNull();
    expect(isoDay('2025-00-10')).toBeNull();
    expect(isoDay(null)).toBeNull();
    expect(dayMinus('2025-01-15', 60)).toBe('2024-11-16');
    expect(excludedDays(undefined)).toEqual([]);
    expect(excludedDays({ a: '2025-01-01' })).toEqual([]);
    expect(bboxAreaKm2([-105, 39, -104, 40])).toBeCloseTo(9540, -1);
    expect(bboxAreaKm2('not json')).toBeNull();
    expect(bboxAreaKm2([0, 10, 1, 10])).toBeNull();
  });
});

describe('planStage', () => {
  it('is the furthest stage reached, or null outside a watch turn', () => {
    expect(planStage([call('search_methane_plumes')])).toBeNull();
    expect(planStage([call('watch_baseline')])).toBe(0);
    expect(planStage([call('watch_baseline'), call('scan_tropomi'), call('check_recent_passes')])).toBe(2);
    expect(planStage([call('check_recent_passes'), call('thermal_anomalies'), call('nearby_infrastructure')])).toBe(3);
    expect(planStage([call('check_recent_passes'), call('draft_brief'), call('site_history')])).toBe(4);
  });
});

describe('tips', () => {
  const dir = 's3://b/session_data/abc/methane/';
  it('derives the tip manifest from the scan call and parses only its numbers', () => {
    expect(tipManifestUrl(dir, call('scan_tropomi', { area: 'South Caspian' }))).toBe(`${dir}tip_south_caspian.json`);
    expect(tipManifestUrl(dir, call('scan_tropomi', { area: 'Xinjiang' }))).toBeNull();
    expect(tipManifestUrl(dir, call('scan_tropomi', { bbox: [1, 2, 3, 4] }))).toBeNull();
    const tip = parseTip(
      { area: 'south caspian', end: '2026-10-04', days: 14, emit_can_look: true, orbits: 28,
        top: { lat: 39.4665, lon: 53.5411, anomaly_ppb: 85.7, valid_days: 6, emit_can_look: true, label: '<b>Acme</b>' } },
      'south caspian'
    )!;
    expect(tip.area.label).toBe('South Caspian, Turkmenistan');
    expect(tip.anomalyPpb).toBe(85.7);
    expect(tip.point).toEqual([53.5411, 39.4665]);
    expect(JSON.stringify(tip)).not.toContain('Acme');
    expect(parseTip({ area: 'shanxi coal basin' }, 'south caspian')).toBeNull();
    expect(parseTip({ area: 'west siberia and yamal', emit_can_look: false, top: null }, 'west siberia and yamal')?.anomalyPpb).toBeNull();
  });

  it('ranks strongest first and knows which tips were cued', () => {
    const a = parseTip({ area: 'south caspian', emit_can_look: true, top: { lat: 39.4665, lon: 53.5411, anomaly_ppb: 85.7 } }, 'south caspian')!;
    const b = parseTip({ area: 'shanxi coal basin', emit_can_look: true, top: { lat: 36.9782, lon: 114.2629, anomaly_ppb: 66.8 } }, 'shanxi coal basin')!;
    const c = parseTip({ area: 'hassi messaoud', emit_can_look: true, top: null }, 'hassi messaoud')!;
    expect(rankTips([c, b, a]).map((t) => t.area.short)).toEqual(['S. Caspian', 'Shanxi', 'Hassi Messaoud']);
    const cues = [call('check_recent_passes', { lat: 39.4665, lon: 53.5411 }), call('check_recent_passes', { lat: '36.9782', lon: 114.2629 })];
    expect(tipCued(a, cues)).toBe(true);
    expect(tipCued(b, cues)).toBe(true);
    expect(tipCued(c, cues)).toBe(false);
  });

  it('finds the site the agent followed from the scene it put on the map', () => {
    const cues = [call('check_recent_passes', { lat: 39.4665, lon: 53.5411 }), call('check_recent_passes', { lat: 36.9782, lon: 114.2629 })];
    const frames = (scene: string): PassFrame[] => [{ date: '2026-06-23', verdict: 'candidate', short: 'candidate', reason: null, peak: 3438.2, chipUrl: `${dir}passchip_${scene}.png` }];
    const framesByCue = [frames('EMIT_L2B_CH4ENH_002_20250820T070851_2523205_009'), frames('EMIT_L2B_CH4ENH_002_20260623T031906_2617402_006')];
    const later = [call('display_visual', { s3_url: `${dir}pass_EMIT_L2B_CH4ENH_002_20260623T031906_2617402_006.tif` })];
    expect(chosenCue(cues, framesByCue, later)).toBe(1);
    expect(chosenCue(cues, framesByCue, [])).toBeNull();
    expect(chosenCue(cues, [null, null], later)).toBeNull();
  });
});

describe('methaneDirFrom and passManifestUrl', () => {
  it('finds THIS session\'s methane folder', () => {
    const tools = [call('display_visual', { s3_url: 's3://geo-bucket/session_data/abc-123/methane/watch_sites_v002.geojson' })];
    expect(methaneDirFrom(tools, 'abc-123')).toBe('s3://geo-bucket/session_data/abc-123/methane/');
    expect(methaneDirFrom(tools, 'other')).toBeNull();
    expect(methaneDirFrom(tools)).toBeNull();
  });

  it('finds a replay case folder (files kept flat)', () => {
    const tools = [call('display_visual', { s3_url: 's3://geo-bucket/use-cases/methane-watch-south-caspian/watch_sites_v002.geojson' })];
    expect(methaneDirFrom(tools, 'abc')).toBe('s3://geo-bucket/use-cases/methane-watch-south-caspian/');
    expect(methaneDirFrom([call('display_visual', { s3_url: 's3://geo-bucket/use-cases/../x/y.tif' })], 'abc')).toBeNull();
  });

  it('derives the manifest key from the call as the tool does (4 decimals)', () => {
    const dir = 's3://b/session_data/abc/methane/';
    expect(passManifestUrl(dir, call('check_recent_passes', { lat: 39.4741, lon: 53.6435 }))).toBe(`${dir}passes_39.4741_53.6435.json`);
    expect(passManifestUrl(dir, call('check_recent_passes', { lat: 37.48, lon: -61.025 }))).toBe(`${dir}passes_37.4800_-61.0250.json`);
    expect(passManifestUrl(dir, call('check_recent_passes', { lat: 'x', lon: 1 }))).toBeNull();
    expect(passManifestUrl(dir, call('site_history', { lat: 1, lon: 1 }))).toBeNull();
    expect(passManifestUrl(null, call('check_recent_passes', { lat: 1, lon: 1 }))).toBeNull();
  });
});

describe('parseManifest and filmstripSummary', () => {
  const dir = 's3://b/session_data/abc/methane/';
  it('keeps valid passes, resolves chips beside the manifest, and drops the rest', () => {
    const frames = parseManifest(
      {
        passes: [
          { date: '2025-08-01', verdict: 'candidate', short: 'candidate', reason: 'ok', peak_ppm_m: 9144, chip: 'passchip_EMIT_L2B_CH4ENH_002_20250801T061200_1.png' },
          { date: '2025-07-20', verdict: 'rejected', short: 'too weak', reason: 'weak', peak_ppm_m: 800, chip: '../../secret.png' },
          { date: '2025-07-02', verdict: 'rejected', short: 'cloud or gap', peak_ppm_m: null, chip: null },
          { date: 'yesterday', verdict: 'candidate' },
          { date: '2025-06-01', verdict: 'maybe' },
        ],
      },
      dir
    )!;
    expect(frames).toHaveLength(3);
    expect(frames[0].chipUrl).toBe(`${dir}passchip_EMIT_L2B_CH4ENH_002_20250801T061200_1.png`);
    expect(frames[1].chipUrl).toBeNull();
    expect(filmstripSummary(frames)).toBe('1 candidate · 1 too weak · 1 cloud or gap');
  });

  it('is null for something that is not a manifest', () => {
    expect(parseManifest({ type: 'FeatureCollection', features: [] }, dir)).toBeNull();
    expect(parseManifest(null, dir)).toBeNull();
  });
});
