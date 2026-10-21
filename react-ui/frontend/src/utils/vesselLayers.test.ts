import { describe, expect, it } from 'vitest';
import { layerLegend, stackLegends } from './layerStack.ts';
import type { LayerMetadata } from './layerFormatting.ts';
import { layerRowLabel } from './layerFormatting.ts';
import {
  AIS,
  ATTRIBUTION,
  FOG,
  LABEL,
  ORCHID,
  RADAR_ALPHA,
  REPLAY_LOOP_H,
  STATUS_KEY,
  aisLook,
  beatFor,
  boxLabelPoints,
  claimParts,
  clockLines,
  countdown,
  featureBounds,
  filedFacts,
  fleetMonth,
  fleetPlaces,
  heavyBounds,
  isVesselLayer,
  lookStartFrom,
  loopTime,
  numberRuns,
  passDay,
  passOf,
  passWords,
  poleOf,
  prepareReplay,
  radarColour,
  radarColormap,
  radarTileParams,
  regionLabelPoint,
  replayFrame,
  replayWindow,
  sweepRows,
  targetCounts,
  taskingFiledMessage,
  taskingLine,
  toggled,
  vesselGeometryHint,
  vesselKind,
  vesselRasterHint,
  wakes,
  type ReplayTrack,
  type SeaBeat,
} from './vesselLayers.ts';

const S = 's3://bucket/session_data/0b6c9a0e-1111-4222-8333-444455556666/vessels/';
const point = (lon: number, lat: number, properties: Record<string, unknown> = {}) =>
  ({ type: 'Feature' as const, properties, geometry: { type: 'Point', coordinates: [lon, lat] } });
const square = (w: number, s: number, e: number, n: number, properties: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  properties,
  geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
});

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
/** Red or amber: a hue between about 0° and 50° with real saturation. */
function isRedOrAmber([r, g, b]: [number, number, number]): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 40) return false;
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) * 60;
  else if (max === g) h = ((b - r) / (max - min)) * 60 + 120;
  else h = ((r - g) / (max - min)) * 60 + 240;
  h = (h + 360) % 360;
  return h < 50 || h > 345;
}

describe('which file is which (by the tools\' own names)', () => {
  it('reads each tool file of a session and of a replay case', () => {
    expect(vesselKind(`${S}radar_s1d-20261012t0018.tif`)).toBe('radar');
    expect(vesselKind(`${S}targets_s1d-20261012t0018.geojson`)).toBe('targets');
    expect(vesselKind(`${S}heard_s1d-20261012t0018.geojson`)).toBe('heard');
    expect(vesselKind(`${S}unproven_s1d-20261012t0018.geojson`)).toBe('unproven');
    expect(vesselKind(`${S}hotspots.geojson`)).toBe('heat');
    expect(vesselKind(`${S}boxes.geojson`)).toBe('boxes');
    expect(vesselKind(`${S}fleet_2026-10.geojson`)).toBe('fleet');
    expect(vesselKind(`${S}look_1_2026-10-24T00.geojson`)).toBe('look');
    expect(vesselKind(`${S}reach_s1a-20240306t0027.geojson`)).toBe('reach');
    expect(vesselKind('s3://bucket/use-cases/vessels-galapagos/targets_s1d-20261012t0018.geojson')).toBe('targets');
  });

  it('claims nothing outside the act\'s folders, nor an unknown name inside them', () => {
    expect(vesselKind('s3://bucket/session_data/x/methane/targets_s1d-20261012t0018.geojson')).toBeNull();
    expect(vesselKind('s3://bucket/vessels/cache/v1/targets_s1d-20261012t0018.geojson')).toBeNull();
    expect(vesselKind(`${S}chips/T01.tif`)).toBeNull();
    expect(vesselKind(undefined)).toBeNull();
    expect(isVesselLayer({ type: 'geometry', url: `${S}boxes.geojson` })).toBe(true);
    expect(isVesselLayer({ type: 'geometry', url: 's3://b/session_data/x/aoi.geojson' })).toBe(false);
  });

  it('dates a file by its pass; the forecast\'s files carry none', () => {
    expect(passOf(`${S}targets_s1d-20261012t0018.geojson`)).toBe('s1d-20261012t0018');
    expect(passOf(`${S}reach_s1a-20240306t0027.geojson`)).toBe('s1a-20240306t0027');
    expect(passOf(`${S}boxes.geojson`)).toBeNull();
    expect(passWords('s1d-20261012t0018')).toEqual({ satellite: 'Sentinel-1D', when: '2026-10-12 00:18 UTC', day: '2026-10-12' });
    expect(passWords('nope')).toBeNull();
    // The short date for lines and the plate: month first, no leading zero.
    expect(passDay('s1d-20261012t0018')).toBe('Oct 12');
    expect(passDay('s1d-20260907t1141')).toBe('Sep 7');
    expect(passDay('s1a-20240306t0027')).toBe('Mar 6');
    expect(passDay('s1d-20261312t0018')).toBeNull();
    expect(passDay('nope')).toBeNull();
  });

  it('styles by the file\'s name whatever the hint says (the stage wins over a drifting hint)', () => {
    const drifted = { kind: 'raster' as const, group: 'methane' as const, legend: 'Plume' };
    expect(vesselGeometryHint(drifted, `${S}boxes.geojson`)).toMatchObject({ kind: 'vector', group: 'maritime', label: 'label' });
    expect(vesselGeometryHint(undefined, `${S}hotspots.geojson`)).toMatchObject({ kind: 'points', property: 'v' });
    expect(vesselGeometryHint({ kind: 'vector', group: 'maritime', legend: 'AIS received' }, `${S}heard_s1d-20261012t0018.geojson`)?.legend).toBe('AIS received');
    // With no hint, the room's words: AIS received and AIS reception unknown.
    expect(vesselGeometryHint(undefined, `${S}heard_s1d-20261012t0018.geojson`)?.legend).toBe('AIS received');
    expect(vesselGeometryHint(undefined, `${S}unproven_s1d-20261012t0018.geojson`)?.legend).toBe('AIS reception unknown');
    expect(vesselGeometryHint(undefined, `${S}radar_s1d-20261012t0018.tif`)).toBeNull();
    expect(vesselRasterHint(undefined, `${S}radar_s1d-20261012t0018.tif`)).toMatchObject({ kind: 'raster', group: 'maritime' });
    expect(vesselRasterHint({ kind: 'raster', bounds: [-92, -2, -88, 2] }, `${S}radar_s1d-20261012t0018.tif`)?.bounds).toEqual([-92, -2, -88, 2]);
    expect(vesselRasterHint(undefined, `${S}boxes.geojson`)).toBeNull();
  });

  it('keeps the agent\'s short titles in the layers plate', () => {
    const layer: LayerMetadata = { id: 'g', sourceId: 'g', name: 'AIS received', url: `${S}heard_s1d-20261012t0018.geojson`, type: 'geometry' };
    expect(layerRowLabel(layer)).toBe('AIS received');
  });
});

describe('colours and shapes (never red or amber, never colour alone)', () => {
  it('uses no red or amber anywhere on the sea', () => {
    for (const hex of [ORCHID, AIS, FOG, LABEL, ...Object.values(STATUS_KEY).map((s) => s.colour)]) {
      expect(isRedOrAmber(hexToRgb(hex)), hex).toBe(false);
    }
    for (let g = 0; g <= 1; g += 0.05) expect(isRedOrAmber(radarColour(g))).toBe(false);
  });

  it('tells every status apart by shape and words, not only by hue', () => {
    const shapes = Object.values(STATUS_KEY).map((s) => s.shape);
    const words = Object.values(STATUS_KEY).map((s) => s.words);
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(new Set(words).size).toBe(words.length);
    // The two grey statuses differ by their label ("reception unknown"), not by colour.
    expect(STATUS_KEY.unproven.colour).toBe(STATUS_KEY.detected.colour);
    expect(STATUS_KEY.unproven.shape).not.toBe(STATUS_KEY.detected.shape);
    expect(STATUS_KEY.candidate.words).toBe('candidate: no AIS where AIS was received, both detectors');
    expect(STATUS_KEY.unproven.words).toBe('reception unknown: no AIS there proves nothing');
    for (const { words } of Object.values(STATUS_KEY)) expect(words).not.toMatch(/heard|unproven|not evidence/i);
  });

  it('tints the radar from the deep sea to fog, never pure white, as 32 TiTiler intervals', () => {
    expect(radarColour(0)).toEqual([8, 18, 28]);
    expect(radarColour(1)).toEqual([233, 238, 243]);
    expect(radarColour(1)).not.toEqual([255, 255, 255]);
    const bands = JSON.parse(radarColormap()) as Array<[[number, number], number[]]>;
    expect(bands).toHaveLength(32);
    expect(bands[0][0]).toEqual([1, 9]);
    expect(bands.every(([, rgba]) => rgba[3] === RADAR_ALPHA)).toBe(true);
    // Brighter returns are lighter.
    expect(bands[31][1][0]).toBeGreaterThan(bands[0][1][0]);
    expect(radarTileParams()).toMatch(/^bidx=1&colormap=%5B/);
  });

  it('reads the targets\' legend as a key and the heats as ramps in their own hues', () => {
    const at = (url: string): LayerMetadata => ({ id: url, sourceId: url, name: 'x', url, type: 'geometry' });
    expect(layerLegend(at(`${S}targets_s1d-20261012t0018.geojson`))).toEqual({ kind: 'vessels', key: 'vessels' });
    expect(layerLegend(at(`${S}unproven_s1d-20261012t0018.geojson`))).toEqual({ kind: 'coverage', key: 'coverage' });
    expect(layerLegend(at(`${S}hotspots.geojson`))).toMatchObject({ kind: 'seaheat', colour: ORCHID });
    expect(layerLegend(at(`${S}fleet_2026-10.geojson`))).toMatchObject({ kind: 'seaheat', colour: AIS });
    expect(layerLegend(at(`${S}boxes.geojson`))).toBeNull();
    // Heard and unproven water share one key.
    const legends = stackLegends([at(`${S}heard_s1d-20261012t0018.geojson`), at(`${S}unproven_s1d-20261012t0018.geojson`)], () => true);
    expect(legends).toHaveLength(1);
  });
});

describe('the targets and the claim', () => {
  const detected = [
    point(-90.1, -0.5, { status: 'detected', claimed: true, claim: [-90.11, -0.49] }),
    point(-90.2, -0.6, { status: 'detected' }),
    point(-90.31, -0.75, { status: 'port' }),
  ];
  const matched = [
    point(-90.1, -0.5, { status: 'broadcasting', claimed: true, claim: [-90.11, -0.49] }),
    point(-90.2, -0.6, { status: 'candidate', label: 'T01' }),
    point(-90.31, -0.75, { status: 'port' }),
    point(-90.4, -0.2, { status: 'unproven' }),
    point(-90.5, -0.3, { status: 'seen_once' }),
  ];

  it('counts the claim at detect, and knows when match_ais has run', () => {
    expect(targetCounts(detected)).toEqual({ targets: 3, claimed: 1, port: 1, unproven: 0, seenOnce: 0, candidate: 0, matched: false });
    expect(targetCounts(matched)).toEqual({ targets: 5, claimed: 1, port: 1, unproven: 1, seenOnce: 1, candidate: 1, matched: true });
  });

  it('ties a claimed target to its AIS position, and skips a claim without one', () => {
    const parts = claimParts([...detected, point(0, 0, { claimed: true, claim: ['x', 1] })]);
    expect(parts.features.map((f) => f.properties?.part)).toEqual(['tie', 'head']);
    expect(parts.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-90.1, -0.5], [-90.11, -0.49]] });
  });

  it('calls nothing a candidate before match_ais, and never before the coverage beat', () => {
    expect(beatFor('targets', targetCounts(detected))).toBe('targets');
    expect(beatFor('targets', targetCounts(matched))).toBe('candidates');
    expect(clockLines('targets', { counts: targetCounts(detected) }).lead).toBe('3 radar targets');
    expect(clockLines('targets', { counts: targetCounts(detected) }).sub).not.toMatch(/candidate|dark/);
    expect(clockLines('targets', {}).sub).toMatch(/nothing is called dark before the coverage check/);
  });
});

describe('label points', () => {
  it('puts one label inside the largest part of a region, off its edge', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 1, 1).geometry.coordinates, square(5, 5, 9, 9).geometry.coordinates],
    };
    const p = poleOf(geometry)!;
    expect(p[0]).toBeGreaterThan(6);
    expect(p[0]).toBeLessThan(8);
    expect(p[1]).toBeGreaterThan(6);
  });

  it('places a region\'s label in the view and clear of the targets', () => {
    const region = square(0, 0, 10, 10).geometry;
    const p = regionLabelPoint(region, [0, 0, 10, 10], [[5, 5]])!;
    expect(p[0]).toBeGreaterThanOrEqual(1);
    expect(p[0]).toBeLessThanOrEqual(9);
    expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeGreaterThan(0.5);
    // A region wholly outside the view has no label in it.
    expect(regionLabelPoint(square(20, 20, 30, 30).geometry, [0, 0, 10, 10])).toBeNull();
  });

  it('labels each patrol box at its top edge with its share and next look', () => {
    const fc = boxLabelPoints([square(-91, -1, -90, 0, { box: 1, label: '1  9%', next: 'S1-D Oct 24 00:17 UTC' })]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-90.5, 0] });
    expect(fc.features[0].properties).toEqual({ box: 1, label: '1  9%', next: 'S1-D Oct 24 00:17 UTC', when: 'Oct 24 00:17 UTC' });
    // No look planned: the words stand as they are.
    expect(boxLabelPoints([square(0, 0, 1, 1, { box: 2, label: '2  5%', next: 'no look planned yet' })]).features[0].properties?.when).toBe('no look planned yet');
  });

  it('frames the heat by its heavy cells, and everything by its bounds', () => {
    const heat = [point(-91, -1, { v: 0.1 }), point(-90.5, -0.5, { v: 0.6 }), point(-90, 0, { v: 0.3 })];
    expect(heavyBounds(heat, 0.15)).toEqual([-90.5, -0.5, -90, 0]);
    expect(heavyBounds(heat, 0.9)).toBeNull();
    expect(featureBounds([...heat, square(-92, -2, -91.5, -1.5)])).toEqual([-92, -2, -90, 0]);
    expect(featureBounds([])).toBeNull();
  });

  it('names the fleet\'s month and the places that frame it', () => {
    expect(fleetMonth(`${S}fleet_2026-10.geojson`)).toBe('October 2026');
    expect(fleetMonth(`${S}fleet_2026-13.geojson`)).toBeNull();
    const places = fleetPlaces([point(-80, -15, { v: 1 }), point(-82, -17, { v: 1 })], `${S}fleet_2026-10.geojson`);
    expect(places.features.map((f) => f.properties?.label)).toContain('Squid fleet, October 2026');
    expect(places.features.map((f) => f.properties?.label)).toContain('Galápagos Marine Reserve');
  });
});

describe('the AIS replay', () => {
  const tracks: ReplayTrack[] = [
    { n: 1, type: 'fishing', t: ['2026-10-11T10:00Z', '2026-10-11T11:00Z', '2026-10-11T18:00Z'], c: [[-90, -0.5], [-90.1, -0.5], [-90.5, -0.5]] },
    { n: 2, type: 'cargo', t: ['2026-10-11T10:00Z', '2026-10-11T11:00Z'], c: [[-89, 0], [-89, 0.1]] },
  ];
  const prepared = prepareReplay(tracks);
  const at = (iso: string) => Date.parse(iso);

  it('reads the replay\'s minute timestamps and marks transits faint', () => {
    expect(prepared).toHaveLength(2);
    expect(prepared[0].ts[0]).toBe(at('2026-10-11T10:00:00Z'));
    expect(prepared.map((p) => p.faint)).toEqual([false, true]);
  });

  it('interpolates a head between hourly positions, but never across a long gap', () => {
    const half = replayFrame(prepared, at('2026-10-11T10:30:00Z'));
    expect(half.n).toBe(2);
    expect((half.heads.features[0].geometry!.coordinates as number[])[0]).toBeCloseTo(-90.05);
    // 11:00 to 18:00 is a 7 h gap: the head waits at 11:00's position.
    const gap = replayFrame(prepared, at('2026-10-11T11:30:00Z'));
    expect(gap.heads.features[0].geometry!.coordinates).toEqual([-90.1, -0.5]);
    // An hour after its last position a track is still shown; later it is gone.
    expect(replayFrame(prepared, at('2026-10-11T12:30:00Z')).n).toBe(1);
  });

  it('breaks a wake where the gap is long (a gap is not a route)', () => {
    const w = wakes(prepared);
    expect(w.features).toHaveLength(2);
    expect(w.features[0].geometry?.coordinates).toEqual([[-90, -0.5], [-90.1, -0.5]]);
  });

  it('loops the last 36 hours before the pass', () => {
    const win = replayWindow({ replay: { start: '2026-10-09T00:18Z', end: '2026-10-12T00:18Z', tracks: [] } });
    expect(win[1] - win[0]).toBe(REPLAY_LOOP_H * 3600e3);
    expect(win[1]).toBe(at('2026-10-12T00:18:00Z'));
    expect(loopTime(win, 0)).toBe(win[0]);
    expect(loopTime(win, 3000)).toBe(win[0] + 3600e3);
    expect(loopTime(win, 3000 * REPLAY_LOOP_H)).toBe(win[0]);
  });
});

describe('the clock plate', () => {
  it('says what the room is looking at, dated, with the tools\' own numbers', () => {
    const rest = clockLines('rest', { replayAt: Date.parse('2026-10-11T14:00:00Z'), vessels: 193 });
    expect(rest.lead).toBe('AIS replay  2026-10-11 14:00 UTC');
    expect(rest.sub).toContain('193 vessels broadcasting');
    expect(rest.sub).toContain(ATTRIBUTION);
    expect(clockLines('radar', { passId: 's1d-20261012t0018', vessels: 120 }).lead).toBe('Sentinel-1D radar  2026-10-12 00:18 UTC');
    // The received share is of the whole reserve on this path: no checkable share is claimed.
    expect(clockLines('coverage', { heardShare: 0.298 })).toEqual({
      lead: 'AIS received over 30% of the reserve',
      sub: 'other ships\' AIS was received there near the pass · hatched: reception unknown',
    });
    expect(clockLines('coverage', {}).lead).toBe('Where AIS was received');
    expect(clockLines('candidates', { counts: { targets: 22, claimed: 4, port: 3, unproven: 2, seenOnce: 9, candidate: 4, matched: true } }).lead).toBe('4 candidates');
    expect(clockLines('candidates', {}).sub).toBe('no AIS where AIS was being received, seen by both detectors · a reason to look, not an accusation');
    expect(clockLines('fleet', { fleetMonth: 'October 2026' }).sub).toContain(ATTRIBUTION);
  });

  it('sets the AIS replay aside over an earlier pass rather than mislead', () => {
    const earlier = clockLines('radar', { passId: 's1a-20240306t0027', replayPassId: 's1d-20261012t0018' });
    expect(earlier.lead).toBe('Sentinel-1A radar  2024-03-06 00:27 UTC');
    expect(earlier.sub).toBe('the AIS replay is of the 2026-10-12 pass, so it steps aside');
    // A newer pass than the replay's steps it aside the same way (the replay is one pass's, not "the latest").
    expect(clockLines('radar', { passId: 's1d-20261024t0017', replayPassId: 's1d-20261012t0018' }).sub)
      .toBe('the AIS replay is of the 2026-10-12 pass, so it steps aside');
    expect(clockLines('radar', { passId: 's1d-20261012t0018', replayPassId: 's1d-20261012t0018', vessels: 120 }).sub)
      .toBe('AIS held at the pass minute · 120 vessels broadcasting');
    expect(clockLines('reach', { passId: 's1a-20240306t0027', reach: '133 km by water at 6 kn' }).sub)
      .toBe('133 km by water at 6 kn · I cannot say which, if any, of these it is.');
  });

  it('says the heat is history, never today\'s candidates', () => {
    expect(clockLines('heat', {}).sub).toMatch(/history, not today's candidates/);
    expect(clockLines('boxes', {}).sub).toMatch(/history, not today's candidates/);
  });

  it('never says the agent filed anything, and leaves the filed sentence to the plate', () => {
    const beats: SeaBeat[] = ['rest', 'forward', 'radar', 'targets', 'coverage', 'candidates', 'heat', 'boxes', 'fleet', 'look', 'reach', 'tasking', 'filed'];
    for (const b of beats) {
      const { lead, sub } = clockLines(b, {});
      expect(`${lead} ${sub}`).not.toMatch(/agent filed|illegal|poach|suspect|culprit|—/i);
      // The officer sentence and the retired coverage words appear on no clock line.
      expect(`${lead} ${sub}`).not.toMatch(/Filed by the officer|did not file|officer's|heard|unproven|not evidence/i);
    }
    expect(clockLines('tasking', {}).sub).toBe('choose a box and the candidates, then approve');
    expect(clockLines('filed', {}).sub).toBe('the approved box and candidates are on the tasking plate');
    const now = Date.parse('2026-10-20T14:37:00Z');
    expect(clockLines('filed', { now, tasking: { box: 3, kept: 3, total: 4, lookStart: '2026-10-24T00:17:00Z' } }).sub)
      .toBe('box 3 · 3 of 4 candidates · next radar look in 3 d 9 h');
    expect(clockLines('filed', { now, tasking: { box: 2, kept: 1, total: 1, lookStart: null } }).sub)
      .toBe('box 2 · 1 of 1 candidate · next radar look not planned yet');
    expect(clockLines('filed', { now, tasking: { box: 1, kept: 0, total: 0 } }).sub)
      .toBe('box 1 · a patrol of the box only · next radar look not planned yet');
  });

  it('reads the clock\'s filed facts from the filed tasking only: the chosen box, the kept candidates, that box\'s look', () => {
    const look = (start: string) => ({ start });
    const card = { candidates: [{ id: 'T01' }, { id: 'T02' }, { id: 'T03' }, { id: 'T04' }] };
    const boxes = [{ box: 1, look: look('2026-10-24T00:17:29Z') }, { box: 2, look: null }, { box: 3, look: look('2026-10-25T11:40:00Z') }];
    const choice = { box: 3, candidateIds: ['T01', 'T03', 'T04'] };
    expect(filedFacts(null)).toBeUndefined();
    expect(filedFacts({ status: 'draft', choice, card, boxes })).toBeUndefined();
    expect(filedFacts({ status: 'filed', choice: null, card, boxes })).toBeUndefined();
    expect(filedFacts({ status: 'filed', choice, card, boxes })).toEqual({ box: 3, kept: 3, total: 4, lookStart: '2026-10-25T11:40:00Z' });
    // A box with no look planned, and an id the draft does not carry, counted as not kept.
    expect(filedFacts({ status: 'filed', choice: { box: 2, candidateIds: ['T02', 'T99'] }, card, boxes }))
      .toEqual({ box: 2, kept: 1, total: 4, lookStart: null });
  });

  it('keeps every changed sub at 110 characters or fewer, with the longest values', () => {
    const counts = { targets: 22, claimed: 4, port: 3, unproven: 2, seenOnce: 9, candidate: 4, matched: true };
    const now = Date.parse('2026-10-20T14:37:00Z');
    const subs = [
      clockLines('radar', { passId: 's1a-20240306t0027', replayPassId: 's1d-20261012t0018' }).sub,
      clockLines('coverage', { heardShare: 1 }).sub,
      clockLines('candidates', { counts }).sub,
      clockLines('tasking', {}).sub,
      clockLines('filed', {}).sub,
      clockLines('filed', { now, tasking: { box: 3, kept: 12, total: 12, lookStart: '2026-11-30T23:59:00Z' } }).sub,
    ];
    for (const sub of subs) expect(sub.length, sub).toBeLessThanOrEqual(110);
  });

  it('counts down to the next look', () => {
    const now = Date.parse('2026-10-19T09:37:00Z');
    expect(countdown('2026-10-24T00:17:00Z', now)).toBe('in 4 d 14 h');
    expect(countdown('2026-10-19T12:57:00Z', now)).toBe('in 3 h 20 min');
    expect(countdown('2026-10-19T09:50:00Z', now)).toBe('in 13 min');
    expect(countdown('2026-10-19T09:00:00Z', now)).toBe('under way or passed');
    expect(countdown('not a time', now)).toBe('');
  });

  it('reads the look\'s time from next_look\'s words, in the nearest year', () => {
    const now = Date.parse('2026-10-19T09:37:00Z');
    expect(lookStartFrom('next look  S1-D Oct 24 00:17 UTC', now)).toBe('2026-10-24T00:17:00Z');
    expect(lookStartFrom('S1-D Jan 3 11:40 UTC', Date.parse('2026-12-30T00:00:00Z'))).toBe('2027-01-03T11:40:00Z');
    expect(lookStartFrom('no look planned yet', now)).toBeNull();
    expect(lookStartFrom('S1-D Oct 24 25:17 UTC', now)).toBeNull();
  });

  it('sets numbers apart for the mono face', () => {
    expect(numberRuns('AIS received over 30% of the reserve')).toEqual([
      { text: 'AIS received over ', num: false }, { text: '30%', num: true }, { text: ' of the reserve', num: false },
    ]);
    expect(numberRuns('AIS replay  2026-10-11 14:00 UTC').filter((r) => r.num).map((r) => r.text)).toEqual(['2026-10-11', '14:00 UTC']);
  });
});

describe('the beats\' paint', () => {
  it('steps the traffic back for the claim, dims it for the forecast, and sets it aside for the fleet and an earlier pass', () => {
    const rest = aisLook('rest');
    const claim = aisLook('targets');
    const forecast = aisLook('boxes');
    expect(rest).toMatchObject({ shown: true, trail: 1, heads: 1 });
    expect(claim.trail).toBe(0);
    expect(claim.wakes).toBeLessThan(rest.wakes);
    expect(claim.heads).toBeGreaterThan(forecast.heads);
    expect(forecast.radar).toBeLessThan(claim.radar);
    expect(aisLook('fleet').shown).toBe(false);
    // The coverage steps back under the forecast, is full under the argument, and only the
    // reception-unknown hatch steps back while the candidates are read.
    expect(aisLook('boxes').quietCoverage).toBe('all');
    expect(aisLook('tasking').quietCoverage).toBe('all');
    expect(aisLook('coverage').quietCoverage).toBe('none');
    expect(aisLook('candidates').quietCoverage).toBe('hatch');
    expect(aisLook('reach').shown).toBe(false);
    expect(aisLook('radar', true).shown).toBe(false);
  });

  it('sweeps the radar in from the edge the satellite came in at', () => {
    expect(sweepRows(0, 1000, true)).toEqual({ from: 1000, to: 1000, edge: 1000 });
    expect(sweepRows(1, 1000, true)).toMatchObject({ from: 0, to: 1000 });
    expect(sweepRows(1, 1000, false)).toMatchObject({ from: 0, to: 1000 });
    const asc = sweepRows(0.5, 1000, true);
    const desc = sweepRows(0.5, 1000, false);
    expect(asc.to).toBe(1000);
    expect(desc.from).toBe(0);
    expect(asc.edge).toBeGreaterThan(asc.from);
    expect(desc.edge).toBeLessThan(desc.to);
    // Ease out: more than half drawn at half time.
    expect(1000 - asc.from).toBeGreaterThan(500);
  });
});

describe('the tasking on the map', () => {
  it('toggles a candidate in and out, in order', () => {
    expect(toggled([], 'T02')).toEqual(['T02']);
    expect(toggled(['T03'], 'T01')).toEqual(['T01', 'T03']);
    expect(toggled(['T01', 'T03'], 'T01')).toEqual(['T03']);
  });

  it('says the choice in a line', () => {
    // The box is history's and the candidates the pass's: they are checked on the way, not in the box.
    expect(taskingLine(1, 3, 4)).toBe('Patrol box 1 · check 3 of 4 candidates on the way');
    expect(taskingLine(2, 1, 1)).toBe('Patrol box 2 · check 1 of 1 candidate on the way');
    expect(taskingLine(3, 0, 0)).toBe('Patrol box 3 · a patrol of the box only');
  });

  it('asks the agent to check the filing (it never says so itself)', () => {
    expect(taskingFiledMessage('tasking-20261019T120000-a1b2c3')).toBe('The officer approved tasking-20261019T120000-a1b2c3 on the map. Is it filed?');
  });
});
