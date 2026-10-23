/**
 * Carbon Mapper on the stage (Oct 22): the tool's numbers-only record per cued site, the follow rule's
 * view of which site was followed, the step and plan names, the map's detections kind, its legend key
 * and its popup. Nothing model-written or catalogue-written is printed.
 */
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.ts';
import { chosenCue, cmLineText, cmPlumesUrl, groupDetail, groupName, groupSteps, parseCmPlumes, planStage, type PassFrame } from './steps.ts';
import { parseRenderHint } from './render.ts';
import { CARBON_MAPPER_SOURCE, METHANE_DETECTIONS, detectionPopupRows, methaneGeometryHint, methaneLegend } from './methaneLayers.ts';
import { isMethaneLayer, type LayerMetadata } from './layerFormatting.ts';
import { layerLegend, stackLegends } from './layerStack.ts';
import { stepName } from './stageCopy.ts';

const DIR = 's3://bucket/session_data/s1/methane/';
const call = (name: string, params: Record<string, unknown>, id = name): ToolCall => ({ id, name, params, status: 'completed' });
// The record carbon_mapper_plumes wrote at Krasnovodsk on Oct 22 (tests/test_carbon_mapper.py).
const KRASNOVODSK = { lat: 39.4379, lon: 53.573, radius_km: 5, since: '2025-01-01', count: 45, latest: '2026-06-20',
  rate_kg_h: 273.1, uncertainty_kg_h: 260.9, instrument: 'tanager', source: 'carbon-mapper' };

describe('the Carbon Mapper record', () => {
  it('is read from the call\'s own point, 4 decimals, like the filmstrip', () => {
    expect(cmPlumesUrl(DIR, call('carbon_mapper_plumes', { lat: 39.4379, lon: 53.573 }))).toBe(`${DIR}cmplumes_39.4379_53.5730.json`);
    expect(cmPlumesUrl(DIR, call('carbon_mapper_plumes', { lat: '37.8938', lon: 113.5625 }))).toBe(`${DIR}cmplumes_37.8938_113.5625.json`);
    expect(cmPlumesUrl(null, call('carbon_mapper_plumes', { lat: 1, lon: 2 }))).toBeNull();
    expect(cmPlumesUrl(DIR, call('check_recent_passes', { lat: 1, lon: 2 }))).toBeNull();
    expect(cmPlumesUrl(DIR, call('carbon_mapper_plumes', { lat: 'north', lon: 2 }))).toBeNull();
  });

  it('keeps numbers, dates and a code only, and refuses a malformed record', () => {
    expect(parseCmPlumes(KRASNOVODSK)).toEqual({ point: [53.573, 39.4379], radiusKm: 5, since: '2025-01-01', count: 45,
      latest: '2026-06-20', rateKgH: 273.1, instrument: 'tanager', unavailable: false, dates: [], followRadiusKm: null });
    // The record timeline's plumes (records since Oct 23): numbers and codes only, a bad row dropped.
    const dated = parseCmPlumes({ ...KRASNOVODSK, follow_radius_km: 7, dates: [
      { date: '2026-06-20', instrument: 'tanager', rate_kg_h: null, distance_km: 2 },
      { date: '2026-06-11', instrument: 'Acme', rate_kg_h: 1, distance_km: 2 },
      { date: 'June', instrument: 'tanager', rate_kg_h: 1, distance_km: 2 },
      { date: '2026-05-01', instrument: 'emit', rate_kg_h: 2050, distance_km: 5.1 },
    ] });
    expect(dated?.followRadiusKm).toBe(7);
    expect(dated?.dates).toEqual([{ date: '2026-06-20', instrument: 'tanager', rateKgH: null, distanceKm: 2 },
      { date: '2026-05-01', instrument: 'emit', rateKgH: 2050, distanceKm: 5.1 }]);
    const none = parseCmPlumes({ ...KRASNOVODSK, count: 0, latest: null, rate_kg_h: null, instrument: null });
    expect(none).toMatchObject({ count: 0, latest: null, rateKgH: null, instrument: null });
    expect(parseCmPlumes({ ...KRASNOVODSK, instrument: '<b>Acme</b>' })?.instrument).toBeNull();
    for (const bad of [{ ...KRASNOVODSK, count: '45' }, { ...KRASNOVODSK, count: 2.5 }, { ...KRASNOVODSK, latest: 'June' },
      { ...KRASNOVODSK, latest: '2026-02-30' }, { ...KRASNOVODSK, radius_km: 50 }, { ...KRASNOVODSK, lat: 95 }, null, 'x']) {
      expect(parseCmPlumes(bad)).toBeNull();
    }
    expect(parseCmPlumes({ ...KRASNOVODSK, rate_kg_h: Number.NaN })?.rateKgH).toBeNull();
  });

  it('reads as the board prints it', () => {
    expect(cmLineText(parseCmPlumes(KRASNOVODSK)!)).toBe('Carbon Mapper: 45 plumes · latest 2026-06-20 · ~270 kg/h');
    expect(cmLineText(parseCmPlumes({ ...KRASNOVODSK, count: 1, rate_kg_h: null })!)).toBe('Carbon Mapper: 1 plume · latest 2026-06-20');
    expect(cmLineText(parseCmPlumes({ ...KRASNOVODSK, count: 0, latest: null })!)).toBe('Carbon Mapper: no plumes within 5 km');
    expect(cmLineText(parseCmPlumes({ ...KRASNOVODSK, rate_kg_h: 1513.1 })!)).toBe('Carbon Mapper: 45 plumes · latest 2026-06-20 · ~1,510 kg/h');
  });
});

describe('the step column', () => {
  it('names the check, says what it read, and counts it in the plan\'s Cue stage', () => {
    expect(stepName('carbon_mapper_plumes')).toBe('Check Carbon Mapper');
    const steps = [call('carbon_mapper_plumes', { lat: 1, lon: 2 }, 'a'), call('carbon_mapper_plumes', { lat: 3, lon: 4 }, 'b')];
    const [group] = groupSteps(steps);
    expect(groupName(group)).toBe('Check Carbon Mapper on 2 sites');
    expect(groupDetail(group)).toEqual({ text: "Carbon Mapper's public plumes, within 5 km since 2025" });
    expect(planStage([call('scan_tropomi', {}), ...steps])).toBe(2);
  });

  it('knows which site was followed: the EMIT scene shown, else the Carbon Mapper points shown', () => {
    const cues = [call('check_recent_passes', { lat: 39.4379, lon: 53.573 }, 'c1'), call('check_recent_passes', { lat: 37.8938, lon: 113.5625 }, 'c2')];
    const scene = 'EMIT_L2B_CH4ENH_002_20250925T060520_2526804_019';
    const frames: Array<PassFrame[] | null> = [[], [{ date: '2025-09-25', verdict: 'candidate', short: 'candidate', reason: null, peak: 5121.5, chipUrl: `${DIR}passchip_${scene}.png` }]];
    const cmShown = call('display_visual', { s3_url: `${DIR}cmplumes_39.4379_53.5730.geojson` });
    expect(chosenCue(cues, frames, [cmShown])).toBe(0);
    expect(chosenCue(cues, frames, [call('display_visual', { s3_url: `${DIR}columns_${scene}.geojson` })])).toBe(1);
    // An EMIT scene on the map decides; a Carbon Mapper layer elsewhere does not override it.
    expect(chosenCue(cues, frames, [cmShown, call('inspect_image', { s3_url: `${DIR}pass_${scene}.tif` })])).toBe(1);
    expect(chosenCue(cues, frames, [call('display_visual', { s3_url: `${DIR}cmplumes_10.0000_10.0000.geojson` })])).toBeNull();
    expect(chosenCue(cues, frames, [])).toBeNull();
  });
});

describe('the map', () => {
  const layer = (url: string, render = methaneGeometryHint(undefined, url) ?? undefined): LayerMetadata =>
    ({ id: url, name: 'x', url, type: 'geometry', render }) as LayerMetadata;

  it('accepts the tool\'s detections hint and falls back to it by file name', () => {
    const hint = { kind: 'detections', group: 'methane', property: 'rate_kg_h', units: 'kg/h', legend: 'Carbon Mapper plumes' };
    expect(parseRenderHint(hint)).toEqual(hint);
    expect(methaneGeometryHint(undefined, `${DIR}cmplumes_39.4379_53.5730.geojson`)).toEqual(METHANE_DETECTIONS);
    expect(methaneGeometryHint(undefined, 's3://bucket/elsewhere/cmplumes_1.0000_2.0000.geojson')).toBeNull();
    expect(isMethaneLayer(layer(`${DIR}cmplumes_39.4379_53.5730.geojson`, undefined))).toBe(true);
    expect(methaneLegend([METHANE_DETECTIONS])).toEqual({ ramps: [], sites: false });
  });

  it('gives the rings a key of their own, after the measures', () => {
    const cm = layer(`${DIR}cmplumes_39.4379_53.5730.geojson`);
    expect(layerLegend(cm)).toEqual({ kind: 'detections', key: 'detections' });
    const columns = layer(`${DIR}columns_x.geojson`);
    expect(stackLegends([cm, columns], () => true).map((l) => l.kind)).toEqual(['measure', 'detections']);
  });

  it('pops up a date, a fixed instrument word and Carbon Mapper\'s estimate, nothing else', () => {
    expect(detectionPopupRows({ date: '2026-06-20', rate_kg_h: 273.1, instrument: 'tanager' }))
      .toEqual({ date: '2026-06-20', instrument: 'Tanager-1', rate: 'about 270 kg/h' });
    expect(detectionPopupRows({ date: '<img src=x>', rate_kg_h: '9', instrument: '<script>' }))
      .toEqual({ date: 'n/a', instrument: 'n/a', rate: 'not published' });
    expect(detectionPopupRows({ date: '2026-06-20<script>', rate_kg_h: null, instrument: 'emit' }).date).toBe('2026-06-20');
    expect(CARBON_MAPPER_SOURCE).toBe('Source: Carbon Mapper (data.carbonmapper.org)');
  });
});

describe('when Carbon Mapper could not be checked', () => {
  it('the record says so, with no numbers', () => {
    const c = parseCmPlumes({ lat: 37.8938, lon: 113.5625, radius_km: 5, since: '2025-01-01', status: 'unavailable' })!;
    expect(c).toMatchObject({ unavailable: true, count: 0, latest: null, rateKgH: null });
    expect(cmLineText(c)).toBe('Carbon Mapper: could not be checked');
    expect(parseCmPlumes(KRASNOVODSK)?.unavailable).toBe(false);
  });

  it('a site followed for its Carbon Mapper points is found at the board\'s 2 decimals', () => {
    const cues = [call('check_recent_passes', { lat: 39.43791, lon: 53.57304 }, 'c1')];
    expect(chosenCue(cues, [[]], [call('display_visual', { s3_url: `${DIR}cmplumes_39.4379_53.5730.geojson` })])).toBe(0);
  });
});
