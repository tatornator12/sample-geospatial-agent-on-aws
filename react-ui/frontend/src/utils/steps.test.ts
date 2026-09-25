import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import {
  filmstripSummary,
  groupDetail,
  groupName,
  groupSteps,
  methaneDirFrom,
  parseManifest,
  passManifestUrl,
  planStage,
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
    expect(groupDetail(groups[1], groups[0])).toEqual({ text: 'Following the TROPOMI tip', mono: '39.47, 53.64' });
    expect(groupDetail(groupSteps([call('check_recent_passes', { lat: 'north', lon: 1 })])[0])).toEqual({ text: 'Recent EMIT passes' });
  });
});

describe('planStage', () => {
  it('is the furthest stage reached, or null outside a watch turn', () => {
    expect(planStage([call('search_methane_plumes')])).toBeNull();
    expect(planStage([call('watch_baseline')])).toBe(0);
    expect(planStage([call('watch_baseline'), call('scan_tropomi'), call('check_recent_passes')])).toBe(2);
    expect(planStage([call('check_recent_passes'), call('draft_brief'), call('site_history')])).toBe(3);
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
