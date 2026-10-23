import { describe, expect, it } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import {
  AIS_IDS,
  COVERAGE_LABEL_QUIET,
  SEA_COMPANION_SUFFIXES,
  SEA_FLOOR_IDS,
  SEA_OPACITY,
  SEA_TIER_KEY,
  addSeaLayers,
  furnitureOff,
  furnitureOn,
  paintCoverage,
  quietCoverageLabels,
  seaFloorOn,
} from './seaStage.ts';
import { insertInStack, stackCeiling, stackMoves, type StackPlace } from '../utils/layerStack.ts';
import type { VesselKind, VesselRest } from '../utils/vesselLayers.ts';

/** A map that holds every layer and records the last value painted per layer and property. */
function fakeMap() {
  const paint = new Map<string, unknown>();
  const map = {
    getLayer: () => ({}),
    setPaintProperty: (id: string, prop: string, value: unknown) => paint.set(`${id} ${prop}`, value),
  };
  return { map: map as unknown as Parameters<typeof paintCoverage>[0], paint };
}

describe('the coverage as the argument moves on', () => {
  it('halves the reception-unknown hatch and keeps the region words, quieter, while the candidates are read', () => {
    const { map, paint } = fakeMap();
    quietCoverageLabels(map, 'cov-unproven-fill');
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(COVERAGE_LABEL_QUIET);
    expect(COVERAGE_LABEL_QUIET).toBeGreaterThan(0);
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'hatch');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(SEA_OPACITY.unprovenQuiet);
    expect(SEA_OPACITY.unprovenQuiet).toBeLessThan(SEA_OPACITY.unproven);
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(COVERAGE_LABEL_QUIET);
    paintCoverage(map, 'heard', 'cov-heard-fill', 'hatch');
    expect(paint.get('cov-heard-fill fill-opacity')).toBe(SEA_OPACITY.heard);
  });

  it('steps both areas back and takes their words away under the forecast', () => {
    const { map, paint } = fakeMap();
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'all');
    paintCoverage(map, 'heard', 'cov-heard-fill', 'all');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(0.2);
    expect(paint.get('cov-heard-fill fill-opacity')).toBe(0.03);
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(0);
    expect(paint.get('cov-heard-labels text-opacity')).toBe(0);
  });

  it('leaves the region words as they arrived under the argument', () => {
    const { map, paint } = fakeMap();
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'none');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(SEA_OPACITY.unproven);
    expect(paint.has('cov-unproven-labels text-opacity')).toBe(false);
  });
});

// --- the ships under the targets: the style order on a small fake map --------------------------------

type Layer = { id: string; type: string; metadata?: unknown; paint?: Record<string, unknown> };

/** A map that keeps MapLibre's style order (addLayer/moveLayer before an id, else on top) and its style events. */
function styleMap() {
  let order: string[] = [];
  const layers = new Map<string, Layer>();
  const sources = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  let moves = 0;
  const place = (id: string, before?: string) => {
    if (before && !order.includes(before)) throw new Error(`no layer ${before} to go before`);
    if (before) order.splice(order.indexOf(before), 0, id);
    else order.push(id);
  };
  const map = {
    addSource: (id: string, spec: unknown) => {
      if (sources.has(id)) throw new Error(`source ${id} exists`);
      sources.set(id, spec);
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (spec: Layer, before?: string) => {
      if (layers.has(spec.id)) throw new Error(`layer ${spec.id} exists`);
      layers.set(spec.id, spec);
      place(spec.id, before);
    },
    moveLayer: (id: string, before?: string) => {
      if (!layers.has(id)) throw new Error(`no layer ${id}`);
      if (id === before) return;
      order = order.filter((x) => x !== id);
      place(id, before);
      moves += 1;
    },
    removeLayer: (id: string) => {
      layers.delete(id);
      order = order.filter((x) => x !== id);
    },
    getLayer: (id: string) => layers.get(id),
    getLayersOrder: () => [...order],
    setLayoutProperty: () => {},
    setPaintProperty: () => {},
    getPaintProperty: () => undefined,
    setFilter: () => {},
    hasImage: () => true,
    addImage: () => {},
    on: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    off: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  };
  return {
    map: map as unknown as maplibregl.Map,
    order: () => [...order],
    layer: (id: string) => layers.get(id),
    /** A layer MapView or the page adds itself (a basemap, a radar's tiles, the presenter's shapes). */
    raw: (id: string, type: string, before?: string) => map.addLayer({ id, type }, before),
    /** One frame: MapLibre's style update fires styledata, then places and paints. */
    frame: () => listeners.get('styledata')?.forEach((fn) => fn()),
    listening: () => listeners.get('styledata')?.size ?? 0,
    moves: () => moves,
  };
}

const BASEMAP = ['dark-base', 'google-roads-base', 'google-satellite-base', 'esri-satellite-base'];
const DRAWN = ['gl-draw-polygon-fill.cold', 'gl-draw-point.cold', 'gl-draw-polygon-fill.hot'];
const REST_FURNITURE = ['sea-reserve', 'sea-harbours', 'sea-harbour-names', 'sea-islands'];
const VIEW: [number, number, number, number] = [-91, -1.6, -89, 0.4];

const point = (lon: number, lat: number, properties: Record<string, unknown>) =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });
const square = (w: number, s: number, e: number, n: number, properties: Record<string, unknown> = {}) =>
  ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
type FC = Parameters<typeof addSeaLayers>[3];
const fc = (...features: unknown[]) => ({ type: 'FeatureCollection', features }) as unknown as FC;

/** One of each mark the targets file draws: grey, faint, matched, at port, a hairline's dot, the candidates. */
const TARGETS = fc(
  point(-89.6, -0.66, { label: 'T03', status: 'candidate', source: 'both' }),
  point(-89.9, -0.5, { label: 'T01', status: 'candidate', source: 'both' }),
  point(-90.1, -0.4, { status: 'detected', source: 'gfw' }),
  point(-90.2, -0.3, { status: 'seen_once', source: 'ours' }),
  point(-90.3, -0.2, { status: 'broadcasting', source: 'ours', claim: [-90.31, -0.21] }),
  point(-90.3, -0.75, { status: 'port', source: 'both' }),
  point(-90.5, -0.9, { status: 'unproven', source: 'both' }),
);
const FILES: Array<[Exclude<VesselKind, 'radar'>, FC]> = [
  ['targets', TARGETS],
  ['heard', fc(square(-90.4, -1, -89.4, 0, { label: 'AIS received' }))],
  ['unproven', fc(square(-91, -1.5, -90.4, -0.5))],
  ['heat', fc(point(-89.7, -0.6, { v: 0.8 }), point(-89.8, -0.7, { v: 0.4 }))],
  ['boxes', fc(square(-89.8, -0.8, -89.5, -0.5, { box: 1, label: 'Box 1', when: 'Oct 24 00:17 UTC' }), square(-90.2, -0.3, -89.9, 0, { box: 2, label: 'Box 2', when: 'Oct 24 00:17 UTC' }))],
  ['look', fc(square(-90.6, -1.4, -89.2, 0.2, { label: 'S1-D Oct 24 00:17 UTC' }))],
];

const REST = {
  version: 1,
  pass: { pass_id: 's1d-20261012t0018', satellite: 'S1D', sensed: '2026-10-12T00:18:00Z', orbit_state: 'ascending' },
  replay: { start: '2026-10-10T12:18:00Z', end: '2026-10-12T00:18:00Z', tracks: [] },
  reserve: square(-91.8, -1.6, -89, 0.6).geometry,
  ports: [{ label: 'Puerto Ayora', coordinates: [-90.31, -0.75] }],
  islands: [{ label: 'Santa Cruz', coordinates: [-90.35, -0.62] }],
  passes: [],
  attribution: 'Global Fishing Watch',
} as unknown as VesselRest;

/** MapView's stack, run by the same rules (placeInStack, applyLayerOrder, removeLayer), over the fake. */
function stage(t: ReturnType<typeof styleMap>) {
  let stack: string[] = [];
  let n = 0;
  const companions = (id: string) => (id.startsWith('cogLayer-')
    ? [`${id}-light`, `${id}-sweep`]
    : ['-casing', '-outline', '-query', '-dots', '-labels', '-keepout', '-hairline', ...SEA_COMPANION_SUFFIXES].map((s) => id.replace('-fill', s)));
  const apply = () => {
    const style = t.map.getLayersOrder();
    const groups = stack.map((id) => {
      const members = new Set([id, ...companions(id)]);
      return style.filter((x) => members.has(x));
    }).filter((g) => g.length > 0);
    const ceiling = stackCeiling(style, new Set(groups.flat()), [...BASEMAP, 'rest-relief', ...SEA_FLOOR_IDS]);
    for (const [id, before] of stackMoves(groups, ceiling)) t.map.moveLayer(id, before);
  };
  const place = (id: string, where: StackPlace) => {
    stack = insertInStack(stack, id, where, (x) => x.startsWith('cogLayer-'));
    apply();
  };
  const remove = (id: string) => {
    [id, ...companions(id)].forEach((x) => t.map.getLayer(x) && t.map.removeLayer(x));
    stack = stack.filter((x) => x !== id);
  };
  return {
    radar() {
      const id = `cogLayer-raster-${++n}`;
      t.raw(id, 'raster');
      place(id, 'bottom');
      // The sweep lands directly over its radar's tiles (sweepRadar), and travels with them.
      const order = t.map.getLayersOrder();
      t.raw(`${id}-sweep`, 'raster', order[order.indexOf(id) + 1]);
      t.frame();
      return id;
    },
    file(kind: Exclude<VesselKind, 'radar'>, data: FC) {
      const geometry = `geometry-${++n}`;
      const fill = `${geometry}-fill`;
      addSeaLayers(t.map, kind, { source: geometry, points: `${geometry}-points`, fill }, data, { view: VIEW, avoid: [], reduced: true, url: `s3://b/${kind}.geojson` });
      place(fill, 'top');
      t.frame();
      return fill;
    },
    argument() {
      const radar = this.radar();
      return [radar, ...FILES.map(([kind, data]) => this.file(kind, data))];
    },
    remove(id: string) {
      remove(id);
      t.frame();
    },
    clear() {
      [...stack].forEach(remove);
      t.frame();
    },
    reorder(next: string[]) {
      stack = next;
      apply();
      t.frame();
    },
    stack: () => [...stack],
  };
}

/** A map at rest: the basemap, the seabed and the presenter's drawing layers, as the stage builds it. */
function restMap() {
  const t = styleMap();
  t.raw('esri-satellite-base', 'raster');
  DRAWN.forEach((id) => t.raw(id, id.includes('fill') ? 'fill' : 'circle'));
  seaFloorOn(t.map, BASEMAP);
  return t;
}

/**
 * The order the room must see: the floor and the radar, then every sea area (coverage, heat, the
 * boxes' and the look's fills), then the ships (wakes, tails, dots) together, then every mark of
 * every file (each target's rings, halo, hairline, port square and words; the boxes' and the look's
 * lines and words), then the furniture's reserve, harbours and islands, then the presenter's shapes.
 */
function expectShipsBetween(t: ReturnType<typeof styleMap>) {
  const order = t.order();
  const at = (id: string) => order.indexOf(id);
  const ships = AIS_IDS.map(at);
  expect(ships.every((i) => i >= 0), 'every ship layer on the map').toBe(true);
  expect(ships, 'the ships together, wakes to dots').toEqual([ships[0], ships[0] + 1, ships[0] + 2, ships[0] + 3]);
  const [lowest, highest] = [ships[0], ships[3]];
  const tier = (id: string) => (t.layer(id)?.metadata as Record<string, unknown> | undefined)?.[SEA_TIER_KEY];
  let marks = 0;
  order.forEach((id, i) => {
    if (tier(id) === 'over') {
      marks += 1;
      expect(i, `${id} draws over the ships`).toBeGreaterThan(highest);
    } else if (tier(id) === 'under' || id.startsWith('cogLayer-') || [...BASEMAP, ...SEA_FLOOR_IDS].includes(id)) {
      expect(i, `${id} draws under the ships`).toBeLessThan(lowest);
    }
  });
  [...REST_FURNITURE, ...DRAWN].forEach((id) => expect(at(id), `${id} over the ships`).toBeGreaterThan(highest));
  DRAWN.forEach((id) => expect(at(id), `${id} over the furniture`).toBeGreaterThan(at('sea-islands')));
  return marks;
}

/** Every layer the targets file draws, by its suffix. */
const TARGET_MARKS = ['-halo', '-fill', '-outline', '-ports', '-ties', '-heads', '-cand', '-labels', '-notes'];

describe('the ships under the targets (the stack restacks; the ships settle back)', () => {
  it('sits the ships under every target mark and over every area, the furniture first and the files after, one by one', () => {
    const t = restMap();
    furnitureOn(t.map, REST, []);
    // At rest: just under the reserve, as added.
    expect(t.order().indexOf('sea-heads') + 1).toBe(t.order().indexOf('sea-reserve'));
    const s = stage(t);
    const radar = s.radar();
    expectShipsBetween(t);
    expect(t.order().indexOf(radar)).toBeLessThan(t.order().indexOf('sea-wakes-faint'));
    for (const [kind, data] of FILES) {
      const fill = s.file(kind, data);
      expectShipsBetween(t);
      if (kind === 'targets') {
        TARGET_MARKS.forEach((suffix) => {
          const id = fill.replace('-fill', suffix);
          expect(t.layer(id), id).toBeTruthy();
          expect(t.order().indexOf(id), `targets ${suffix} over the dots`).toBeGreaterThan(t.order().indexOf('sea-heads'));
        });
      }
    }
    // The words the boxes and the look carry, and the coverage's, draw over the dots too; the areas under them.
    const final = t.order();
    const ids = s.stack();
    const look = ids[0];
    const boxes = ids[1];
    const heat = ids[2];
    const heard = ids[4];
    const heads = final.indexOf('sea-heads');
    [look.replace('-fill', '-labels'), boxes.replace('-fill', '-labels'), heard.replace('-fill', '-labels')]
      .forEach((id) => expect(final.indexOf(id), id).toBeGreaterThan(heads));
    [heat, heard, boxes.replace('-fill', '-wash'), look].forEach((id) => expect(final.indexOf(id), id).toBeLessThan(heads));
  });

  it('holds when the files were there first and the furniture lands after them', () => {
    const t = restMap();
    const s = stage(t);
    s.argument();
    furnitureOn(t.map, REST, []);
    // Settled at once, before any frame. Every mark checked: the targets' 9, the coverage's 2
    // words, the boxes' 2 lines and words, the look's line and words.
    expect(expectShipsBetween(t)).toBe(16);
    t.frame();
    expectShipsBetween(t);
  });

  it('holds across a second turn, a reorder in the layers plate, a New session and switching agents and back', () => {
    const t = restMap();
    furnitureOn(t.map, REST, []);
    const s = stage(t);
    const first = s.argument();
    // A second turn: the next look again (it replaces the first), and a second targets file.
    s.remove(first[first.length - 1]);
    s.file('look', FILES[5][1]);
    s.file('targets', TARGETS);
    expectShipsBetween(t);
    // The presenter drags the targets to the bottom of the plate (under the radar's row), then to the top.
    const targets = s.stack().filter((id) => t.layer(id.replace('-fill', '-cand')));
    s.reorder([...s.stack().filter((id) => !targets.includes(id)), ...targets]);
    expectShipsBetween(t);
    s.reorder([...targets, ...s.stack().filter((id) => !targets.includes(id))]);
    expectShipsBetween(t);
    // Within each tier the plate's order still holds: the targets' words over the look's now.
    const order = t.order();
    expect(order.indexOf(targets[0].replace('-fill', '-labels'))).toBeGreaterThan(order.indexOf(s.stack()[targets.length].replace('-fill', '-labels')));
    // New session: the map clears, the furniture stays at rest, the next argument settles again.
    s.clear();
    expect(t.order().indexOf('sea-heads') + 1).toBe(t.order().indexOf('sea-reserve'));
    s.argument();
    expectShipsBetween(t);
    // Another act: the furniture goes with its listener; back to Dark Vessels, it comes back once.
    s.clear();
    furnitureOff(t.map);
    expect(t.listening()).toBe(0);
    expect(t.layer('sea-heads')).toBeUndefined();
    furnitureOn(t.map, REST, []);
    furnitureOn(t.map, REST, []);
    expect(t.listening()).toBe(1);
    s.argument();
    expectShipsBetween(t);
  });

  it('settles in one pass: a frame with nothing restacked moves nothing', () => {
    const t = restMap();
    furnitureOn(t.map, REST, []);
    stage(t).argument();
    const moved = t.moves();
    t.frame();
    t.frame();
    expect(t.moves()).toBe(moved);
  });

  it('keeps the dots as they were drawn: same size, same opacity, same edge', () => {
    const t = restMap();
    furnitureOn(t.map, REST, []);
    expect(t.layer('sea-heads')?.paint).toMatchObject({
      'circle-radius': 3.2, 'circle-stroke-width': 1.2, 'circle-opacity': 1, 'circle-stroke-opacity': 0.6, 'circle-blur': 0.15,
    });
    expect(t.layer('sea-wakes')?.paint).toMatchObject({ 'line-width': 1, 'line-opacity': 0.13 });
    expect(t.layer('sea-trail')?.paint).toMatchObject({ 'line-width': 2.2, 'line-opacity': 1 });
  });
});
