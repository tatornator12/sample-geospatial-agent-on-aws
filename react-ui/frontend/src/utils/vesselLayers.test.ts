import { describe, expect, it } from 'vitest';
import { layerLegend, stackLegends } from './layerStack.ts';
import type { LayerMetadata } from './layerFormatting.ts';
import { layerRowLabel } from './layerFormatting.ts';
// @ts-expect-error -- the app's tsconfig carries no Node types; vitest runs on Node (the key's icons are read from stage.css).
import { readFileSync } from 'node:fs';
import {
  AIS,
  AIS_KEY_WORDS,
  ATTRIBUTION,
  FOG,
  HEAT_END,
  aisKeyRow,
  coverageKeyRows,
  monthDayTime,
  targetKeyRows,
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
  boxCheckOf,
  countdown,
  coverageFacts,
  featureBounds,
  filedFacts,
  forecastPass,
  HEAT_HOLD_MS,
  BOXES_HOLD_MS,
  heatCheckOf,
  heatHoldLeft,
  fleetMonth,
  fleetPlaces,
  heavyBounds,
  isVesselLayer,
  lookHoldLeft,
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
  RECORDED_SETTLE_MS,
  recordedTaskingWait,
  regionLabelPoint,
  replayFrame,
  replayWindow,
  revealBeat,
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
    expect(targetCounts(detected)).toEqual({ targets: 3, claimed: 1, port: 1, unproven: 0, seenOnce: 0, candidate: 0, tied: 0, matched: false });
    expect(targetCounts(matched)).toEqual({ targets: 5, claimed: 1, port: 1, unproven: 1, seenOnce: 1, candidate: 1, tied: 0, matched: true });
    // A hairline only where our own detector's match drew one (claimParts).
    expect(targetCounts([...matched, point(-90.6, -0.4, { status: 'broadcasting', source: 'ours', claimed: true, claim: [-90.601, -0.401] })]).tied).toBe(1);
  });

  it('ties a target to its AIS dot only where that dot decided (our detector alone), and skips a claim without one', () => {
    const ours = point(-90.1, -0.5, { status: 'broadcasting', source: 'ours', claimed: true, claim: [-90.11, -0.49] });
    const parts = claimParts([ours, ...detected, point(0, 0, { source: 'ours', claimed: true, claim: ['x', 1] })]);
    expect(parts.features.map((f) => f.properties?.part)).toEqual(['tie', 'head']);
    expect(parts.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-90.1, -0.5], [-90.11, -0.49]] });
    expect(parts.features[1].geometry).toEqual({ type: 'Point', coordinates: [-90.11, -0.49] });
  });

  it('draws no hairline where Global Fishing Watch\'s own match decided (both detectors, or GFW\'s alone)', () => {
    // Oct 12: all four matches were GFW's; three carry a claim (the nearest dot, 2.7 to 4.1 km away).
    const gfwDecided = [
      point(-90.1, -0.5, { status: 'broadcasting', source: 'gfw', claimed: true, claim: [-90.12, -0.48] }),
      point(-90.2, -0.4, { status: 'broadcasting', source: 'gfw', claimed: true, claim: [-90.23, -0.41] }),
      point(-90.3, -0.3, { status: 'broadcasting', source: 'both', claimed: true, claim: [-90.31, -0.33] }),
      point(-90.4, -0.2, { status: 'broadcasting', source: 'gfw', claimed: true }),
    ];
    expect(claimParts(gfwDecided).features).toEqual([]);
    // A file without a source says nothing about who decided: no line either.
    expect(claimParts(detected).features).toEqual([]);
    // The fog ring stays: they are still counted as accounted for by a broadcast.
    expect(targetCounts(gfwDecided).claimed).toBe(4);
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

  it('clips the rest view\'s wakes to the loop\'s hours, as the clock says (not the file\'s three days)', () => {
    const long = prepareReplay([
      // Hourly fixes from before the loop to an hour after the pass (the file runs 72 h to +1 h).
      { n: 1, type: 'fishing', t: ['2026-10-10T11:00Z', '2026-10-10T12:00Z', '2026-10-10T13:00Z', '2026-10-10T14:00Z', '2026-10-11T23:00Z', '2026-10-12T00:00Z', '2026-10-12T01:00Z'],
        c: [[-91, -1], [-90.9, -1], [-90.8, -1], [-90.7, -1], [-90.6, -1], [-90.5, -1], [-90.4, -1]] },
      // A track wholly before the loop draws no wake.
      { n: 2, type: 'cargo', t: ['2026-10-09T02:00Z', '2026-10-09T03:00Z'], c: [[-89, 0], [-89, 0.1]] },
    ]);
    const win = replayWindow({ replay: { start: '2026-10-09T00:18Z', end: '2026-10-12T00:18Z', tracks: [] } });
    expect(wakes(long).features).toHaveLength(3);
    // The loop is 12:18 Oct 10 to the pass minute, 00:18 Oct 12: 13:00 to 00:00 stay, and the long gap still breaks the wake.
    expect(wakes(long, 3, win).features.map((f) => f.geometry?.coordinates)).toEqual([
      [[-90.8, -1], [-90.7, -1]],
      [[-90.6, -1], [-90.5, -1]],
    ]);
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
      sub: 'other ships\' AIS was received there in the three hours either side of the pass',
    });
    expect(clockLines('coverage', {}).lead).toBe('Where AIS was received');
    expect(clockLines('candidates', { counts: { targets: 22, claimed: 4, port: 3, unproven: 2, seenOnce: 9, candidate: 4, tied: 0, matched: true } }).lead).toBe('4 candidates');
    // "A reason to look, not an accusation" is the answer's sentence alone.
    expect(clockLines('candidates', {}).sub).toBe('no AIS where AIS was being received, seen by both detectors');
    expect(clockLines('fleet', { fleetMonth: 'October 2026' }).sub).toContain(ATTRIBUTION);
  });

  it('says in plain clock words which AIS is on the map: the ships at the radar minute, and only for their own pass', () => {
    // The radar beat: the dots held at the radar minute are the ones the matching used (the count is the stage's).
    expect(clockLines('radar', { passId: 's1d-20261012t0018', replayPassId: 's1d-20261012t0018', vessels: 142 }).sub)
      .toBe('142 ships broadcasting at the radar minute');
    const earlier = clockLines('radar', { passId: 's1a-20240306t0027', replayPassId: 's1d-20261012t0018' });
    expect(earlier.lead).toBe('Sentinel-1A radar  2024-03-06 00:27 UTC');
    expect(earlier.sub).toBe('ships\' broadcasts are shown for Oct 12 only');
    // A newer pass than the replay's reads the same way (the replay is one pass's, not "the latest").
    expect(clockLines('radar', { passId: 's1d-20261024t0017', replayPassId: 's1d-20261012t0018' }).sub)
      .toBe('ships\' broadcasts are shown for Oct 12 only');
    expect(clockLines('radar', { passId: 's1d-20260830t0026', replayPassId: 'not-a-pass' }).sub)
      .toBe('ships\' broadcasts are shown for one other pass only');
    // The coverage's window in words: the hours stamped within 3 h of the pass, either side.
    expect(clockLines('coverage', { checkable: 0.19, standard: 0.15 }).sub).toContain('in the three hours either side of the pass');
    for (const b of ['radar', 'coverage', 'candidates'] as SeaBeat[]) {
      const { sub } = clockLines(b, { passId: 's1d-20261012t0018', replayPassId: 's1d-20261012t0018', vessels: 142, checkable: 0.19 });
      expect(sub).not.toMatch(/held at the pass minute|near the pass|steps aside|accusation|reason to look/);
    }
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
    // A replay case's plate is read-only: the clock names it recorded and asks for nothing.
    expect(clockLines('tasking', { taskingRecorded: true })).toEqual({
      lead: 'Patrol tasking  recorded', sub: 'the box and candidates the agent drafted, as recorded',
    });
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
    const counts = { targets: 22, claimed: 4, port: 3, unproven: 2, seenOnce: 9, candidate: 4, tied: 0, matched: true };
    const now = Date.parse('2026-10-20T14:37:00Z');
    const subs = [
      clockLines('forward', {}).sub,
      clockLines('radar', { passId: 's1a-20240306t0027', replayPassId: 's1d-20261012t0018' }).sub,
      clockLines('radar', { passId: 's1d-20261012t0018', replayPassId: 's1d-20261012t0018', vessels: 9999 }).sub,
      clockLines('tasking', { taskingRecorded: true }).sub,
      clockLines('coverage', { heardShare: 1 }).sub,
      clockLines('coverage', { heardShare: 1, checkable: 1, standard: 0.15 }).sub,
      clockLines('heat', { heatCheck: { since: '2026-09-01', pct: 100 } }).sub,
      clockLines('heat', { heatCheck: { since: '2026-09-01', pct: null } }).sub,
      clockLines('boxes', { boxCheck: { pct: 100, daysHit: 99, days: 99 } }).sub,
      clockLines('boxes', { boxCheck: { pct: null, daysHit: 0, days: 0 } }).sub,
      clockLines('boxes', {}).sub,
      clockLines('candidates', { counts }).sub,
      clockLines('tasking', {}).sub,
      clockLines('filed', {}).sub,
      clockLines('filed', { now, tasking: { box: 3, kept: 12, total: 12, lookStart: '2026-11-30T23:59:00Z' } }).sub,
    ];
    for (const sub of subs) expect(sub.length, sub).toBeLessThanOrEqual(110);
  });

  it('says what the pass can check, and while the agent chooses, that it is choosing', () => {
    expect(clockLines('forward', { replayAt: Date.parse('2026-10-11T14:00:00Z') })).toEqual({
      lead: 'AIS replay  2026-10-11 14:00 UTC', sub: 'while the agent chooses a radar pass',
    });
    const coverage = clockLines('coverage', { heardShare: 0.298, checkable: 0.19, standard: 0.15 });
    expect(coverage).toEqual({
      lead: 'This pass can check 19% of the reserve',
      sub: 'the radar imaged it and other ships\' AIS was received there in the three hours either side of the pass',
    });
    // The hatch carries its own label on the map, so the sub has room for the window in words.
    expect(coverage.sub).toHaveLength(102);
    // A checkable share out of range is not a number the stage prints.
    expect(clockLines('coverage', { heardShare: 0.298, checkable: 1.9 }).lead).toBe('AIS received over 30% of the reserve');
  });

  it('puts each measured figure beside its own layer: the top 5% with the heat, the boxes\' with the boxes', () => {
    const facts = { heatCheck: { since: '2026-07-01', pct: 41 }, boxCheck: { pct: 9, daysHit: 4, days: 17 } };
    const heat = clockLines('heat', facts);
    const boxes = clockLines('boxes', facts);
    expect(heat).toEqual({ lead: 'Where to look on the next pass', sub: 'refitted before each radar day since July, its top 5% of water held 41% of the dark targets' });
    expect(boxes).toEqual({ lead: 'Three patrol boxes', sub: 'the three boxes, refitted the same way, held 9% · one or more in a box on 4 of 17 days with dark targets' });
    expect(heat.sub).not.toMatch(/\b9%|\b4 of 17/);
    expect(boxes.sub).not.toMatch(/41%|top 5%/);
    // The longest values measure as the design says: 97 and 107.
    expect(clockLines('heat', { heatCheck: { since: '2026-09-01', pct: 100 } }).sub).toHaveLength(97);
    expect(clockLines('boxes', { boxCheck: { pct: 100, daysHit: 99, days: 99 } }).sub).toHaveLength(107);
    // No radar days with dark targets: no check possible, and no figure.
    expect(clockLines('heat', { heatCheck: { since: '2026-07-01', pct: null } }).sub).toBe('no check possible: no dark targets were found since July');
    expect(clockLines('boxes', { boxCheck: { pct: null, daysHit: 0, days: 0 } }).sub).toBe('each box with its next radar look · no check possible');
    // The box labels carry no share now, so the boxes' words never point at one.
    expect(clockLines('boxes', {}).sub).not.toMatch(/share/);
  });

  it('reads the clock\'s figures from the tools\' features, each validated as a number in range', () => {
    expect(coverageFacts([{ properties: { kind: 'heard', share: 0.3, imaged: 0.53, checkable: 0.19, standard: 0.15 } }]))
      .toEqual({ heardShare: 0.3, checkable: 0.19, standard: 0.15 });
    expect(coverageFacts([{ properties: { share: 0.3, checkable: '0.19', standard: 2 } }])).toEqual({ heardShare: 0.3 });
    expect(coverageFacts([])).toEqual({});
    const heat = [point(-90, -0.5, { v: 1, check_pct: 41, check_times: 8.2, check_since: '2026-07-01' }), point(-90.1, -0.5, { v: 0.4 })];
    expect(heatCheckOf(heat)).toEqual({ since: '2026-07-01', pct: 41 });
    expect(heatCheckOf([point(0, 0, { v: 1, check_pct: null, check_times: null, check_since: '2026-07-01' })])).toEqual({ since: '2026-07-01', pct: null });
    expect(heatCheckOf([point(0, 0, { v: 1, check_pct: 141, check_since: '2026-07-01' })])).toBeUndefined();
    expect(heatCheckOf([point(0, 0, { v: 1, check_pct: 41, check_since: 'July' })])).toBeUndefined();
    expect(heatCheckOf([point(0, 0, { v: 1 })])).toBeUndefined();
    const box = (props: Record<string, unknown>) => square(-91, -1, -90, 0, { box: 1, label: 'Box 1', next: 'no look planned yet', ...props });
    expect(boxCheckOf([box({ boxes_pct: 9, boxes_times: 9.1, boxes_days_hit: 4, days: 17 })])).toEqual({ pct: 9, daysHit: 4, days: 17 });
    expect(boxCheckOf([box({ boxes_pct: null, boxes_times: null, boxes_days_hit: 0, days: 0 })])).toEqual({ pct: null, daysHit: 0, days: 0 });
    expect(boxCheckOf([box({ boxes_pct: 9, boxes_days_hit: 18, days: 17 })])).toBeUndefined();
    // The box features carry no top 5% figure, and a feature without the boxes' figure gives none.
    expect(boxCheckOf([box({ check_pct: 41 })])).toBeUndefined();
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

  it('holds the heat beat 5 s before the boxes beat, so each figure is read beside its own layer', () => {
    const on = Date.parse('2026-10-21T14:00:00Z');
    expect(HEAT_HOLD_MS).toBe(5000);
    // The boxes landing with the heat wait out the rest of the hold.
    expect(heatHoldLeft(on, on)).toBe(5000);
    expect(heatHoldLeft(on, on + 1200)).toBe(3800);
    // Boxes later than the hold, no heat at all, or a clock that went back: no wait, or the full hold at most.
    expect(heatHoldLeft(on, on + 5000)).toBe(0);
    expect(heatHoldLeft(on, on + 9000)).toBe(0);
    expect(heatHoldLeft(null, on)).toBe(0);
    expect(heatHoldLeft(on, on - 3000)).toBe(5000);
    expect(heatHoldLeft(Number.NaN, on)).toBe(0);
  });

  it('holds the boxes beat 3 s before the next look replaces it (gate B, W1)', () => {
    const on = Date.parse('2026-10-21T14:00:00Z');
    expect(BOXES_HOLD_MS).toBe(3000);
    // Gate B: next_look landed 0.5 s after the boxes beat, so the swath waits out the rest.
    expect(lookHoldLeft(on, on + 5000, on + 5500)).toBe(2500);
    expect(lookHoldLeft(on, on + 5000, on + 8000)).toBe(0);
    // The look landing while the heat still holds waits for the heat's rest and then the whole boxes beat.
    expect(lookHoldLeft(on, null, on + 1200)).toBe(3800 + 3000);
    expect(lookHoldLeft(on, null, on)).toBe(HEAT_HOLD_MS + BOXES_HOLD_MS);
    // No forecast on the stage, or the heat held and no boxes ever came: the look lands at once.
    expect(lookHoldLeft(null, null, on)).toBe(0);
    expect(lookHoldLeft(on, null, on + 6000)).toBe(0);
    // A clock that went back holds the full beat at most; a broken time is no boxes beat.
    expect(lookHoldLeft(null, on, on - 2000)).toBe(3000);
    expect(lookHoldLeft(null, Number.NaN, on)).toBe(0);
  });
});

describe('the replay case\'s clock (every file lands at once)', () => {
  it('moves to the candidates only from the coverage\'s beat', () => {
    expect(revealBeat('coverage')).toBe('candidates');
    for (const b of ['radar', 'targets', 'candidates', 'heat', 'boxes', 'look', 'tasking', 'filed', 'fleet', 'reach'] as SeaBeat[]) {
      expect(revealBeat(b), b).toBeNull();
    }
  });

  it('brings a recorded case back to its tasking once each beat after the draft has held', () => {
    const on = Date.parse('2026-10-23T15:00:00Z');
    // Longer than the boxes' hold, so the next look lands (and holds) before the tasking comes back.
    expect(RECORDED_SETTLE_MS).toBeGreaterThan(BOXES_HOLD_MS);
    expect(recordedTaskingWait('coverage', null, on)).toBe(RECORDED_SETTLE_MS);
    expect(recordedTaskingWait('boxes', on, on + 5000)).toBe(RECORDED_SETTLE_MS);
    expect(recordedTaskingWait('look', on, on + 8000)).toBe(RECORDED_SETTLE_MS);
    // The heat holds its own 5 s first (the boxes follow it).
    expect(recordedTaskingWait('heat', on, on)).toBe(HEAT_HOLD_MS + RECORDED_SETTLE_MS);
    expect(recordedTaskingWait('heat', on, on + 2000)).toBe(3000 + RECORDED_SETTLE_MS);
    // Nothing to come back from: the tasking itself, the filed beat, the rest, the spares.
    for (const b of ['tasking', 'filed', 'rest', 'forward', 'fleet', 'reach'] as SeaBeat[]) {
      expect(recordedTaskingWait(b, on, on), b).toBeNull();
    }
  });

  /**
   * A model of the stage's beat rules (MapView.tsx: landTargets, landSeaFile, maybeReveal, the
   * heat and boxes holds, the look's wait, onTaskingLoaded) on a virtual clock, fed the order the
   * files landed in a headless replay of vessels-open-question (the case's draft first, then every
   * file within about a second). `fixed` switches the reveal rule and the recorded tasking's return.
   */
  function replayBeats(events: Array<[number, string]>, fixed: boolean, recorded = true): SeaBeat[] {
    let now = 0;
    let beat: SeaBeat = 'rest';
    let heatAt: number | null = null;
    let boxesAt: number | null = null;
    let recordedDraft = false;
    let back: number | null = null;
    let matchedOn = false;
    let coverageOn = false;
    let revealed = false;
    const seq: SeaBeat[] = [];
    const queue: Array<{ at: number; id: number; fn: () => void }> = [];
    let nextId = 0;
    const later = (ms: number, fn: () => void) => { const id = ++nextId; queue.push({ at: now + ms, id, fn }); return id; };
    const set = (b: SeaBeat) => {
      beat = b;
      seq.push(b);
      if (back !== null) { const i = queue.findIndex((q) => q.id === back); if (i >= 0) queue.splice(i, 1); back = null; }
      const wait = fixed && recordedDraft ? recordedTaskingWait(b, heatAt, now) : null;
      if (wait !== null) back = later(wait, () => { back = null; if (recordedDraft && beat === b) set('tasking'); });
    };
    // The reveal waits for the matched targets and the coverage of the pass, then a breath.
    const maybeReveal = () => {
      if (!matchedOn || !coverageOn || revealed) return;
      revealed = true;
      later(1400, () => {
        if (!fixed) return set('candidates');
        const next = revealBeat(beat);
        if (next) set(next);
      });
    };
    const land: Record<string, () => void> = {
      draft: () => { recordedDraft = recorded; set('tasking'); },
      radar: () => set('radar'),
      targets: () => set('targets'),
      matched: () => { matchedOn = true; if (!revealed) set('coverage'); maybeReveal(); },
      heard: () => { coverageOn = true; set('coverage'); maybeReveal(); },
      heat: () => { heatAt = now; boxesAt = null; set('heat'); },
      boxes: () => {
        const showBoxes = () => { boxesAt = now; set('boxes'); };
        const wait = heatHoldLeft(heatAt, now);
        if (wait === 0) showBoxes();
        else later(wait, () => { if (beat === 'heat') showBoxes(); });
      },
      look: () => {
        const arrive = () => { if (beat !== 'tasking' && beat !== 'filed') set('look'); };
        const wait = lookHoldLeft(heatAt, boxesAt, now);
        if (wait > 0) later(wait, arrive);
        else arrive();
      },
    };
    for (const [at, what] of events) queue.push({ at, id: ++nextId, fn: land[what] });
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const q = queue.shift()!;
      now = q.at;
      q.fn();
    }
    return seq;
  }
  // The headless replay's order (ms after the page loaded): the draft at 3.5 s, then the matched
  // targets, the received area, the heat, the boxes and the look within 1.2 s of each other.
  const REPLAY: Array<[number, string]> = [[3530, 'draft'], [4530, 'matched'], [4630, 'heard'], [4640, 'heat'], [5600, 'boxes'], [5710, 'look']];

  it('ended the replay on the next look with the old rules: the reveal and the deferred look took the clock from the tasking', () => {
    const old = replayBeats(REPLAY, false);
    expect(old).toEqual(['tasking', 'coverage', 'coverage', 'heat', 'candidates', 'look']);
  });

  it('ends the replay on the tasking, after the heat, the boxes and the next look have each held', () => {
    const seq = replayBeats(REPLAY, true);
    expect(seq).toEqual(['tasking', 'coverage', 'coverage', 'heat', 'boxes', 'look', 'tasking']);
    expect(seq.at(-1)).toBe('tasking');
  });

  it('leaves a live turn as it was: the candidates after the coverage, and the tasking last, once', () => {
    // A live turn's files, seconds apart (the final gates' run on dev), and its draft last.
    const live: Array<[number, string]> = [[14900, 'radar'], [19000, 'targets'], [21600, 'heard'], [28100, 'matched'], [42100, 'heat'], [42200, 'boxes'], [44200, 'look'], [56700, 'draft']];
    const seq = replayBeats(live, true, false);
    expect(seq).toEqual(['radar', 'targets', 'coverage', 'coverage', 'candidates', 'heat', 'boxes', 'look', 'tasking']);
    // The old rules gave the same live sequence: the change is the replay's alone.
    expect(replayBeats(live, false, false)).toEqual(seq);
  });
});

describe('the beats\' paint', () => {
  it('draws only the AIS the matching used: the loop at rest, then the dots at the radar minute to the end of the act', () => {
    // [beat, wakes, faint wakes, comet tails, dots, dots' edge] as the room sees them (0 = not drawn).
    const table: Array<[SeaBeat, number, number, number, number, number]> = [
      ['rest', 0.13, 0.05, 1, 1, 0.6],
      ['forward', 0.13, 0.05, 1, 1, 0.6],
      // From the radar on: the dots held at the radar minute, no tails and no wakes.
      ['radar', 0, 0, 0, 1, 0.6],
      ['targets', 0, 0, 0, 0.7, 0.35],
      ['coverage', 0, 0, 0, 0.7, 0.35],
      ['candidates', 0, 0, 0, 0.7, 0.35],
      // Under the forecast and the tasking the ships stay, dimmed so the heat and the boxes read.
      ['heat', 0, 0, 0, 0.45, 0.25],
      ['boxes', 0, 0, 0, 0.45, 0.25],
      ['look', 0, 0, 0, 0.45, 0.25],
      ['tasking', 0, 0, 0, 0.45, 0.25],
      ['filed', 0, 0, 0, 0.45, 0.25],
      // The spares step it aside altogether.
      ['fleet', 0, 0, 0, 0, 0],
      ['reach', 0, 0, 0, 0, 0],
    ];
    for (const [beat, wakes, faintWakes, trail, heads, headStroke] of table) {
      const look = aisLook(beat);
      expect({ beat, wakes: look.wakes, faintWakes: look.faintWakes, trail: look.trail, heads: look.heads, headStroke: look.headStroke })
        .toEqual({ beat, wakes, faintWakes, trail, heads, headStroke });
      // A dot with no fill shows no stroke either; the edge never outshines the dot.
      if (heads === 0) expect(look.headStroke, beat).toBe(0);
      expect(look.headStroke, beat).toBeLessThanOrEqual(look.heads);
    }
    const claim = aisLook('targets');
    const forecast = aisLook('boxes');
    expect(claim.heads).toBeGreaterThan(forecast.heads);
    // Dimmed, not gone: between 0.4 and 0.5 under the heat and the boxes.
    for (const beat of ['heat', 'boxes', 'look', 'tasking', 'filed'] as SeaBeat[]) {
      expect(aisLook(beat).heads, beat).toBeGreaterThanOrEqual(0.4);
      expect(aisLook(beat).heads, beat).toBeLessThanOrEqual(0.5);
      expect(aisLook(beat).shown, beat).toBe(true);
    }
    expect(forecast.radar).toBeLessThan(claim.radar);
    expect(forecast.shown).toBe(true);
    expect(aisLook('fleet').shown).toBe(false);
    // Over an earlier pass the replay (another pass's) is not drawn at any beat.
    for (const [beat] of table) expect(aisLook(beat, true).shown, beat).toBe(false);
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

  it('returns the forecast\'s camera to the pass the argument ended on, never a set-aside one', () => {
    const detected = [point(-90.2, -0.6, { status: 'detected' })];
    const matched = [point(-90.2, -0.6, { status: 'candidate', label: 'T01' })];
    const aug30 = { kind: 'targets' as const, pass: 's1d-20260830t0026', data: { features: detected } };
    const sep30 = { kind: 'targets' as const, pass: 's1d-20260930t0018', data: { features: matched } };
    const heat = { kind: 'heat' as const, pass: null, data: { features: [] } };
    // The thin path: Aug 30 set aside (detected only), Sep 30 matched.
    expect(forecastPass([aug30, sep30, heat])).toBe('s1d-20260930t0018');
    // A matched pass wins over a later pass that was only detected.
    expect(forecastPass([sep30, aug30])).toBe('s1d-20260930t0018');
    // With nothing matched, the last pass with targets; with no targets, none.
    expect(forecastPass([aug30, { ...aug30, pass: 's1d-20260907t1141' }])).toBe('s1d-20260907t1141');
    expect(forecastPass([{ kind: 'radar', pass: 's1d-20261012t0018', data: null }, heat])).toBeNull();
    expect(forecastPass(new Map([['a', aug30]]).values())).toBe('s1d-20260830t0026');
  });

  it('asks the agent to check the filing (it never says so itself)', () => {
    expect(taskingFiledMessage('tasking-20261019T120000-a1b2c3')).toBe('The officer approved tasking-20261019T120000-a1b2c3 on the map. Is it filed?');
  });
});

describe('the map key (every icon the mark the map draws)', () => {
  // vitest serves CSS imports empty, so the stylesheet is read as text (from the package root, where vitest runs).
  const css: string = readFileSync('src/stage.css', 'utf8');
  const icons = (rows: ReadonlyArray<{ icon: string }>) => rows.map((r) => r.icon);

  it('keys each target status by its own icon, before and after the candidates are revealed', () => {
    expect(icons(targetKeyRows({ revealed: false }))).toEqual(['sea-key--ring', 'sea-key--claimed', 'sea-key--port']);
    expect(targetKeyRows({ revealed: false })[0].words).toBe('radar target, not yet explained');
    const after = targetKeyRows({ revealed: true, seenOnce: true });
    expect(icons(after)).toEqual(['sea-key--ring', 'sea-key--once', 'sea-key--claimed', 'sea-key--port', 'sea-key--candidate']);
    // Set aside: the grey ring and the fainter "seen once" ring are two marks on the map, so two rows.
    expect(after.map((r) => r.words)).toEqual([
      'set aside: reception unknown',
      'set aside: seen by one detector only',
      'matched to a ship\'s AIS',
      'at or near a port',
      'candidate: no AIS where AIS was received',
    ]);
    // No faint ring on the map, no row for it.
    expect(icons(targetKeyRows({ revealed: true, seenOnce: false }))).not.toContain('sea-key--once');
  });

  it('draws a matched target as the plain fog ring, and the tied variant only on a pass with a hairline', () => {
    // Oct 12: every match was Global Fishing Watch's, so the map draws no line and the key shows none.
    expect(icons(targetKeyRows({ revealed: true, seenOnce: true, tied: false }))).not.toContain('sea-key--tied');
    const tied = targetKeyRows({ revealed: true, tied: true });
    expect(icons(tied)).toContain('sea-key--claimed');
    expect(tied.find((r) => r.icon === 'sea-key--tied')?.words).toBe('matched to the ship at the end of its line');
    // The plain ring's icon carries no dot (the old ::after), the tied one does.
    expect(css).not.toMatch(/\.sea-key--claimed::after/);
    expect(css).toMatch(/\.sea-key--tied::after/);
  });

  it('keys the AIS dots, in plain words, while the dots held at the radar minute are on the map', () => {
    expect(AIS_KEY_WORDS).toBe('ship broadcasting its position (AIS), where it was at the radar pass');
    for (const beat of ['radar', 'targets', 'coverage', 'candidates', 'heat', 'boxes', 'look', 'tasking', 'filed'] as SeaBeat[]) {
      expect(aisKeyRow(beat), beat).toEqual({ icon: 'sea-key--ais', words: AIS_KEY_WORDS });
    }
    // Not over the replay's loop (the clock names it), another pass, or the spares (no dots drawn).
    for (const beat of ['rest', 'forward', 'fleet', 'reach'] as SeaBeat[]) expect(aisKeyRow(beat), beat).toBeNull();
    expect(aisKeyRow('tasking', true)).toBeNull();
    // The row follows the paint: wherever it shows, the dots are drawn.
    for (const beat of ['radar', 'heat', 'tasking'] as SeaBeat[]) expect(aisLook(beat).heads, beat).toBeGreaterThan(0);
  });

  it('keys the coverage, with plain sea outside the radar once the pass says what it can check', () => {
    expect(icons(coverageKeyRows({ outside: false }))).toEqual(['sea-key--heard', 'sea-key--unproven']);
    expect(icons(coverageKeyRows({ outside: true }))).toEqual(['sea-key--heard', 'sea-key--unproven', 'sea-key--outside']);
  });

  it('has a drawn icon in the stylesheet for every row, in plain words with no dashes', () => {
    const rows = [
      ...targetKeyRows({ revealed: true, seenOnce: true, tied: true }),
      ...targetKeyRows({ revealed: false, seenOnce: true }),
      ...coverageKeyRows({ outside: true }),
      aisKeyRow('radar')!,
    ];
    for (const r of rows) {
      expect(css, r.icon).toMatch(new RegExp(`\\.${r.icon}::before`));
      expect(r.words, r.icon).not.toMatch(/[\u2013\u2014]|heard|unproven|not evidence/i);
    }
  });

  it('ends the heat\'s key in the pale orchid its ramp ends in on the map', () => {
    expect(layerLegend({ id: 'h', sourceId: 'h', name: 'x', url: `${S}hotspots.geojson`, type: 'geometry' }))
      .toMatchObject({ kind: 'seaheat', colour: ORCHID, end: HEAT_END });
    expect(layerLegend({ id: 'f', sourceId: 'f', name: 'x', url: `${S}fleet_2026-10.geojson`, type: 'geometry' }))
      .toMatchObject({ kind: 'seaheat', colour: AIS, end: FOG });
  });
});

describe('the tasking plate\'s look line', () => {
  it('words a look\'s start month first, to the minute, in UTC', () => {
    expect(monthDayTime('2026-10-24T00:17:29Z')).toBe('Oct 24 00:17 UTC');
    expect(monthDayTime('2026-01-03T11:40:00Z')).toBe('Jan 3 11:40 UTC');
    expect(monthDayTime('not a time')).toBeNull();
    expect(monthDayTime(undefined)).toBeNull();
  });
});
