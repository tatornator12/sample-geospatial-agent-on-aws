/**
 * Dark Vessels (Act 3) on the map: the MapLibre half of the sea at night (design component 11).
 * The styles, the file-name rules, the label points, the replay's frames and the clock's words are
 * pure and tested in utils/vesselLayers.ts; this module only puts them on a map: the seabed floor,
 * the AIS furniture and its replay, each tool's layers by the file's own kind, the candidates'
 * reveal, the radar's sweep and the tasking's selection. MapView owns when; this owns how.
 *
 * Layer ids follow MapView's geometry convention: a session file's main layer is `<geometryId>-fill`
 * (the row in the layers plate) and every companion is `<geometryId>-<suffix>` (one of
 * SEA_COMPANION_SUFFIXES), so the stack, visibility and removal treat them as one layer. One extra
 * source per file, `<geometryId>-points`, carries its label points (MapView removes it with it).
 */
import * as maplibregl from 'maplibre-gl';
import { TERRAIN_TILES_URL, TITILER_API_KEY, TITILER_URL } from '../config.ts';
import {
  AIS,
  CANDIDATE_LABEL_SUFFIX,
  DOME,
  FOG,
  HALO,
  LABEL,
  LEFT_OUT_SUFFIX,
  ORCHID,
  SEABED_COLOURS,
  SEABED_SHADE,
  SHOWN_STATUS,
  SWEEP_MS,
  REPLAY_FORWARD_MS_PER_HOUR,
  REPLAY_MS_PER_HOUR,
  boxLabelPoints,
  claimParts,
  fleetPlaces,
  radarTileParams,
  regionLabelPoint,
  replayFrame,
  sweepRows,
  wakes,
  type AisLook,
  type PreparedTrack,
  type VesselKind,
  type VesselRest,
} from '../utils/vesselLayers.ts';

type M = maplibregl.Map;
type Expr = maplibregl.ExpressionSpecification;
type Filter = maplibregl.FilterSpecification;
type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null };
type FC = { type: 'FeatureCollection'; features: Feature[] };

const MONO = ['Atkinson Hyperlegible Mono', 'monospace'];
const SANS = ['Atkinson Hyperlegible Next', 'sans-serif'];
const FADE = { duration: 700, delay: 0 };
const EMPTY: FC = { type: 'FeatureCollection', features: [] };
/** A patrol box's label: "1  9%" over its next look's time, the time a size down in label grey. */
const BOX_LABEL_FIELD: Expr = ['format', ['get', 'label'], { 'font-scale': 1 }, '\n', {}, ['get', 'when'], { 'font-scale': 0.84, 'text-color': LABEL }];
/** The reserve's own words (labels, notes) go below this zoom: the fleet's pull-back reads clean. */
const NEAR = 6;

/** The companions a sea file's main layer carries (MapView's geometryCompanionIds adds these). */
export const SEA_COMPANION_SUFFIXES = ['-cand', '-halo', '-ports', '-ties', '-heads', '-hit', '-notes', '-wash'];

/** A companion's id from the main layer's. */
export const cid = (fillId: string, suffix: string) => fillId.replace(/-fill$/, suffix);

// --- the floor: the seabed -------------------------------------------------------------------------

export const SEA_DEM = 'sea-dem';
export const SEABED = 'sea-seabed';
export const SEA_SHADE = 'sea-shade';
/** The floor the stack draws over (with the basemap, which the sea hides). */
export const SEA_FLOOR_IDS = [SEABED, SEA_SHADE];

export function seaFloorOn(map: M, basemapIds: readonly string[]): void {
  if (!map.getSource(SEA_DEM)) {
    map.addSource(SEA_DEM, {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 12,
      attribution: 'Bathymetry: AWS Terrain Tiles',
    });
  }
  // Just above the (hidden) basemap: the stack and the furniture draw over it.
  const above = map.getLayersOrder().find((id) => !basemapIds.includes(id) && id !== SEABED && id !== SEA_SHADE);
  if (!map.getLayer(SEABED)) {
    map.addLayer({
      id: SEABED,
      type: 'color-relief',
      source: SEA_DEM,
      paint: { 'color-relief-opacity': 1, 'color-relief-color': SEABED_COLOURS as Expr },
    }, map.getLayer(SEA_SHADE) ? SEA_SHADE : above);
  }
  if (!map.getLayer(SEA_SHADE)) {
    map.addLayer({ id: SEA_SHADE, type: 'hillshade', source: SEA_DEM, paint: { ...SEABED_SHADE } }, above);
  }
  seaBasemap(map, basemapIds, true);
}

export function seaFloorOff(map: M, basemapIds: readonly string[]): void {
  [SEA_SHADE, SEABED].forEach((id) => map.getLayer(id) && map.removeLayer(id));
  if (map.getSource(SEA_DEM)) map.removeSource(SEA_DEM);
  seaBasemap(map, basemapIds, false);
}

/** The satellite basemap goes while the sea is on: this act's ground is the water itself. */
export function seaBasemap(map: M, basemapIds: readonly string[], sea: boolean): void {
  basemapIds.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', sea ? 'none' : 'visible'));
}

// --- images: the unproven water's hatch, the port boats' square --------------------------------------

function canvasImage(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): ImageData | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) return null;
  draw(x);
  return x.getImageData(0, 0, w, h);
}

export function seaImages(map: M): void {
  if (!map.hasImage('sea-hatch')) {
    const img = canvasImage(14, 14, (x) => {
      x.strokeStyle = 'rgba(143, 163, 184, 0.55)';
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(0, 14); x.lineTo(14, 0);
      x.moveTo(-7, 7); x.lineTo(7, -7);
      x.moveTo(7, 21); x.lineTo(21, 7);
      x.stroke();
    });
    if (img) map.addImage('sea-hatch', img);
  }
  if (!map.hasImage('sea-port')) {
    const img = canvasImage(12, 12, (x) => {
      x.fillStyle = FOG;
      x.fillRect(2, 2, 8, 8);
    });
    if (img) map.addImage('sea-port', img);
  }
}

// --- the furniture: the reserve, the AIS replay, the ports, the islands --------------------------------

const F = {
  wakesFaint: 'sea-wakes-faint',
  wakes: 'sea-wakes',
  trail: 'sea-trail',
  heads: 'sea-heads',
  reserve: 'sea-reserve',
  harbours: 'sea-harbours',
  harbourNames: 'sea-harbour-names',
  islands: 'sea-islands',
};
const FS = { wakes: 'sea-wakes', trail: 'sea-trail', heads: 'sea-heads', reserve: 'sea-reserve', harbours: 'sea-harbours', islands: 'sea-islands' };
/** Above the stack (the stack's ceiling is the lowest of them), under the presenter's drawn shapes. */
export const SEA_FURNITURE_IDS = Object.values(F);

function pointsOf(rows: ReadonlyArray<{ label: string; coordinates: [number, number] }>): FC {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({ type: 'Feature', properties: { label: r.label }, geometry: { type: 'Point', coordinates: r.coordinates } })),
  };
}

export function furnitureOn(map: M, rest: VesselRest, prepared: readonly PreparedTrack[]): void {
  if (map.getLayer(F.islands)) return;
  // Under the presenter's drawn shapes, which stay on top of everything.
  const before = map.getLayersOrder().find((id) => id.startsWith('gl-draw'));
  map.addSource(FS.wakes, { type: 'geojson', data: wakes(prepared) as GeoJSON.FeatureCollection });
  map.addSource(FS.trail, { type: 'geojson', data: EMPTY as GeoJSON.FeatureCollection, lineMetrics: true });
  map.addSource(FS.heads, { type: 'geojson', data: EMPTY as GeoJSON.FeatureCollection });
  map.addSource(FS.reserve, {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: rest.reserve } as GeoJSON.Feature,
  });
  map.addSource(FS.harbours, { type: 'geojson', data: pointsOf(rest.ports) as GeoJSON.FeatureCollection });
  map.addSource(FS.islands, { type: 'geojson', data: pointsOf(rest.islands) as GeoJSON.FeatureCollection });
  // The long exposure: every track's whole three days, transits fainter (the network is the routes between the islands).
  map.addLayer({
    id: F.wakesFaint, type: 'line', source: FS.wakes, filter: ['==', ['get', 'faint'], true],
    paint: { 'line-color': AIS, 'line-width': 1, 'line-opacity': 0.05, 'line-opacity-transition': FADE },
  }, before);
  map.addLayer({
    id: F.wakes, type: 'line', source: FS.wakes, filter: ['!=', ['get', 'faint'], true],
    paint: { 'line-color': AIS, 'line-width': 1, 'line-opacity': 0.13, 'line-opacity-transition': FADE },
  }, before);
  // The last four hours as a comet, clear to pale cyan.
  map.addLayer({
    id: F.trail, type: 'line', source: FS.trail, layout: { 'line-cap': 'round' },
    paint: {
      'line-width': 2.2,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(233, 238, 243, 0)', 1, AIS],
      'line-opacity': 1,
      'line-opacity-transition': FADE,
    },
  }, before);
  // A dot is something AIS heard.
  map.addLayer({
    id: F.heads, type: 'circle', source: FS.heads,
    paint: {
      'circle-radius': 3.2,
      'circle-color': FOG,
      'circle-blur': 0.15,
      'circle-stroke-color': AIS,
      'circle-stroke-width': 1.2,
      'circle-opacity': 1,
      'circle-stroke-opacity': 0.6,
      'circle-opacity-transition': FADE,
      'circle-stroke-opacity-transition': FADE,
    },
  }, before);
  map.addLayer({
    id: F.reserve, type: 'line', source: FS.reserve,
    paint: { 'line-color': FOG, 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [4, 3] },
  }, before);
  map.addLayer({
    id: F.harbours, type: 'circle', source: FS.harbours, minzoom: 6.5,
    paint: { 'circle-radius': 2.5, 'circle-color': LABEL, 'circle-stroke-color': HALO, 'circle-stroke-width': 1 },
  }, before);
  map.addLayer({
    id: F.harbourNames, type: 'symbol', source: FS.harbours, minzoom: 7.4,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': SANS,
      'text-size': 15,
      'text-variable-anchor': ['right', 'left', 'top', 'bottom'],
      'text-radial-offset': 0.7,
      'text-optional': true,
      'symbol-sort-key': 2,
    },
    paint: { 'text-color': LABEL, 'text-halo-color': HALO, 'text-halo-width': 2 },
  }, before);
  // The islands' names over everything the agent draws, never under it.
  map.addLayer({
    id: F.islands, type: 'symbol', source: FS.islands, minzoom: 6.5,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': SANS,
      'text-size': 17,
      'text-letter-spacing': 0.04,
      'text-padding': 4,
      'symbol-sort-key': 1,
    },
    paint: { 'text-color': LABEL, 'text-halo-color': HALO, 'text-halo-width': 2.5 },
  }, before);
}

export function furnitureOff(map: M): void {
  [...SEA_FURNITURE_IDS].reverse().forEach((id) => map.getLayer(id) && map.removeLayer(id));
  Object.values(FS).forEach((id) => map.getSource(id) && map.removeSource(id));
}

/** The beat's look on the traffic: fades where it can (the layers' constant paint transitions). */
export function paintAis(map: M, look: AisLook): void {
  const vis = look.shown ? 'visible' : 'none';
  [F.wakesFaint, F.wakes, F.trail, F.heads].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis));
  if (!map.getLayer(F.heads)) return;
  map.setPaintProperty(F.wakesFaint, 'line-opacity', look.faintWakes);
  map.setPaintProperty(F.wakes, 'line-opacity', look.wakes);
  map.setPaintProperty(F.trail, 'line-opacity', look.trail);
  map.setPaintProperty(F.heads, 'circle-opacity', look.heads);
  map.setPaintProperty(F.heads, 'circle-stroke-opacity', look.headStroke);
}

// --- the replay ------------------------------------------------------------------------------------

export type ReplayMode = 'loop' | 'forward' | 'hold';

/**
 * The AIS replay on the map: loops the window at rest, runs on to the pass's minute when the agent
 * starts, holds there once the pass is on the stage (and, under reduced motion, from the start).
 * Draws at most 30 times a second and tells the clock four times a second.
 */
export class ReplayPlayer {
  private frame = 0;
  private mode: ReplayMode = 'loop';
  private t: number;
  private last = 0;
  private painted = 0;
  private told = 0;
  private map: M;
  private prepared: readonly PreparedTrack[];
  private window: [number, number];
  private onTick: (t: number, vessels: number) => void;

  constructor(map: M, prepared: readonly PreparedTrack[], window: [number, number], onTick: (t: number, vessels: number) => void) {
    this.map = map;
    this.prepared = prepared;
    this.window = window;
    this.onTick = onTick;
    this.t = window[0];
  }

  get current(): ReplayMode {
    return this.mode;
  }

  setMode(mode: ReplayMode): void {
    if (mode === this.mode && (this.frame || mode === 'hold')) return;
    // Forward from a hold means nothing: the replay is already at the pass.
    if (mode === 'forward' && this.mode === 'hold') return;
    this.mode = mode;
    if (mode === 'hold') this.t = this.window[1];
    this.start();
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private start(): void {
    this.stop();
    this.last = performance.now();
    this.painted = 0;
    this.told = 0;
    this.frame = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    const dt = Math.min(250, now - this.last);
    this.last = now;
    const [start, end] = this.window;
    if (this.mode === 'loop') {
      this.t += (dt / REPLAY_MS_PER_HOUR) * 3600e3;
      if (this.t > end) this.t = start;
    } else if (this.mode === 'forward') {
      this.t += (dt / REPLAY_FORWARD_MS_PER_HOUR) * 3600e3;
      if (this.t >= end) {
        this.t = end;
        this.mode = 'hold';
      }
    }
    const hold = this.mode === 'hold';
    if (hold || now - this.painted > 33) {
      this.painted = now;
      const f = replayFrame(this.prepared, this.t);
      const heads = this.map.getSource(FS.heads) as maplibregl.GeoJSONSource | undefined;
      const trail = this.map.getSource(FS.trail) as maplibregl.GeoJSONSource | undefined;
      if (!heads || !trail) {
        this.frame = 0;
        return;
      }
      heads.setData(f.heads as GeoJSON.FeatureCollection);
      trail.setData(f.tails as GeoJSON.FeatureCollection);
      if (hold || now - this.told > 250) {
        this.told = now;
        this.onTick(this.t, f.n);
      }
    }
    this.frame = hold ? 0 : requestAnimationFrame(this.step);
  };
}

// --- each tool's layers ---------------------------------------------------------------------------

export interface SeaIds {
  /** The file's own source and its label points' source. */
  source: string;
  points: string;
  /** The main layer (the row in the layers plate). */
  fill: string;
}

export interface SeaContext {
  /** The view the room sees ([w, s, e, n], inside the plates): where labels must land. */
  view: [number, number, number, number];
  /** Marks a label must not cover (the targets on the stage). */
  avoid: Array<[number, number]>;
  reduced: boolean;
  /** The file's URL (the fleet's month is in its name). */
  url?: string;
}

const vis = { visibility: 'visible' as const };
const isPoly: Filter = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
const kindIs = (k: string): Filter => ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], k]];
const shown = SHOWN_STATUS as Expr;

function labelPoint(label: string, at: [number, number] | null, kind = 'label'): Feature[] {
  return at ? [{ type: 'Feature', properties: { label, kind }, geometry: { type: 'Point', coordinates: at } }] : [];
}

/** The grey rings: everything the radar saw that nothing explains yet (and, after the reveal, the left-out candidates). */
export function greyFilter(revealed: boolean, excluded: readonly string[]): Filter {
  const plain: Filter = ['in', shown, ['literal', revealed ? ['detected', 'unproven', 'seen_once'] : ['detected', 'unproven', 'seen_once', 'candidate']]];
  if (!revealed || excluded.length === 0) return plain;
  return ['any', plain, ['all', ['==', ['get', 'status'], 'candidate'], ['in', ['get', 'label'], ['literal', [...excluded]]]]];
}

function candidateFilter(excluded: readonly string[]): Filter {
  return excluded.length
    ? ['all', ['==', ['get', 'status'], 'candidate'], ['!', ['in', ['get', 'label'], ['literal', [...excluded]]]]]
    : ['==', ['get', 'status'], 'candidate'];
}

function notesFilter(excluded: readonly string[]): Filter {
  return excluded.length
    ? ['any', ['==', ['get', 'status'], 'unproven'], ['all', ['==', ['get', 'status'], 'candidate'], ['in', ['get', 'label'], ['literal', [...excluded]]]]]
    : ['==', ['get', 'status'], 'unproven'];
}

const HEAT_RAMP: Expr = [
  'interpolate', ['linear'], ['heatmap-density'],
  0, 'rgba(240, 122, 216, 0)', 0.15, 'rgba(240, 122, 216, 0.16)', 0.5, 'rgba(240, 122, 216, 0.5)',
  0.85, 'rgba(240, 122, 216, 0.82)', 1, 'rgba(237, 180, 230, 0.92)',
];
const FLEET_RAMP: Expr = [
  'interpolate', ['linear'], ['heatmap-density'],
  0, 'rgba(159, 211, 230, 0)', 0.2, 'rgba(159, 211, 230, 0.28)', 0.55, 'rgba(159, 211, 230, 0.7)', 1, 'rgba(233, 238, 243, 0.95)',
];

/** The opacity each kind fades in to (its layers start at 0 and transition, so the beat arrives, not snaps). */
export const SEA_OPACITY = { heard: 0.08, unproven: 0.6, heat: 0.75, fleet: 0.9, look: 0.035, reach: 0.07 };

/**
 * One tool's file on the map, by its kind. Every layer that fades starts at 0; `arrive` brings it
 * in on the next frame.
 */
export function addSeaLayers(map: M, kind: Exclude<VesselKind, 'radar'>, ids: SeaIds, data: FC, ctx: SeaContext): void {
  const { source, points, fill } = ids;
  const c = (s: string) => cid(fill, s);
  const fade = ctx.reduced ? { duration: 0, delay: 0 } : { duration: 900, delay: 0 };
  map.addSource(source, { type: 'geojson', data: data as GeoJSON.FeatureCollection });
  const addPoints = (fc: FC) => map.addSource(points, { type: 'geojson', data: fc as GeoJSON.FeatureCollection });

  if (kind === 'targets') {
    addPoints(claimParts(data.features) as FC);
    // A dome halo under the candidates' rings, so orchid reads on the radar's speckle.
    map.addLayer({
      id: c('-halo'), type: 'circle', source, filter: ['==', ['get', 'status'], 'candidate'], layout: vis,
      paint: { 'circle-radius': 16, 'circle-color': DOME, 'circle-blur': 0.6, 'circle-opacity': 0, 'circle-opacity-transition': fade, 'circle-pitch-alignment': 'map' },
    });
    // A ring is something the radar saw: grey until something explains it.
    map.addLayer({
      id: fill, type: 'circle', source, filter: greyFilter(false, []), layout: vis,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'status'], 'seen_once'], 5, 8],
        'circle-color': 'rgba(0, 0, 0, 0)',
        'circle-stroke-color': LABEL,
        'circle-stroke-width': ['case', ['==', ['get', 'status'], 'seen_once'], 1.2, 1.5],
        'circle-stroke-opacity': ['case', ['==', ['get', 'status'], 'seen_once'], 0.55, 0.95],
        'circle-pitch-alignment': 'map',
      },
    });
    // The claim: a broadcast accounts for it (a fog ring tied by a hairline to the AIS dot).
    map.addLayer({
      id: c('-outline'), type: 'circle', source, filter: ['==', shown, 'claimed'], layout: vis,
      paint: {
        'circle-radius': 7.5, 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-color': FOG, 'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0, 'circle-stroke-opacity-transition': { ...fade, delay: ctx.reduced ? 0 : 400 }, 'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: c('-ports'), type: 'symbol', minzoom: NEAR, source, filter: ['==', shown, 'port'],
      layout: { ...vis, 'icon-image': 'sea-port', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    map.addLayer({
      id: c('-ties'), type: 'line', source: points, filter: ['==', ['get', 'part'], 'tie'], layout: { ...vis, 'line-cap': 'round' },
      paint: { 'line-color': FOG, 'line-width': 1.2, 'line-opacity': 0, 'line-opacity-transition': { ...fade, delay: ctx.reduced ? 0 : 700 } },
    });
    map.addLayer({
      id: c('-heads'), type: 'circle', source: points, filter: ['==', ['get', 'part'], 'head'], layout: vis,
      paint: {
        'circle-radius': 3.6, 'circle-color': FOG, 'circle-stroke-color': AIS, 'circle-stroke-width': 1.4,
        'circle-opacity': 0, 'circle-stroke-opacity': 0,
        'circle-opacity-transition': { ...fade, delay: ctx.reduced ? 0 : 700 }, 'circle-stroke-opacity-transition': { ...fade, delay: ctx.reduced ? 0 : 700 },
      },
    });
    // The candidates: hidden rings until the reveal turns them orchid and grows them.
    map.addLayer({
      id: c('-cand'), type: 'circle', source, filter: candidateFilter([]), layout: vis,
      paint: {
        'circle-radius': 8, 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-color': ORCHID, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0,
        'circle-radius-transition': fade, 'circle-stroke-opacity-transition': fade, 'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: c('-labels'), type: 'symbol', minzoom: NEAR, source, filter: candidateFilter([]),
      layout: {
        ...vis,
        'text-field': ['concat', ['get', 'label'], CANDIDATE_LABEL_SUFFIX],
        'text-font': MONO, 'text-size': 16, 'text-max-width': 30,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1.2, 'text-justify': 'auto', 'text-padding': 3,
        // Placed in order (T01 first). Two labels over one another read as neither, so a label with
        // no free side is left out; the plate lists every candidate.
        'symbol-sort-key': ['to-number', ['slice', ['get', 'label'], 1]],
      },
      paint: { 'text-color': ORCHID, 'text-halo-color': HALO, 'text-halo-width': 2.5, 'text-opacity': 0, 'text-opacity-transition': { ...fade, delay: ctx.reduced ? 0 : 300 } },
    });
    // Unproven targets say so ("not evidence"); a candidate the officer left out says that.
    map.addLayer({
      id: c('-notes'), type: 'symbol', minzoom: NEAR, source, filter: notesFilter([]),
      layout: {
        ...vis,
        'text-field': ['case', ['==', ['get', 'status'], 'unproven'], 'not evidence', ['concat', ['get', 'label'], LEFT_OUT_SUFFIX]],
        'text-font': MONO, 'text-size': 15, 'text-max-width': 30,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1.1, 'text-justify': 'auto', 'text-padding': 3, 'text-optional': true,
      },
      paint: { 'text-color': LABEL, 'text-halo-color': HALO, 'text-halo-width': 2.5 },
    });
    return;
  }

  if (kind === 'heard' || kind === 'unproven') {
    const geom = data.features.find((f) => f.geometry && /Polygon$/.test(f.geometry.type))?.geometry ?? null;
    const words = kind === 'heard' ? 'heard water' : 'unproven: AIS not heard here';
    addPoints({ type: 'FeatureCollection', features: labelPoint(words, regionLabelPoint(geom as never, ctx.view, ctx.avoid)) });
    if (kind === 'heard') {
      map.addLayer({
        id: fill, type: 'fill', source, layout: vis,
        paint: { 'fill-color': FOG, 'fill-opacity': 0, 'fill-opacity-transition': fade },
      });
      map.addLayer({
        id: c('-outline'), type: 'line', source, layout: vis,
        paint: { 'line-color': FOG, 'line-width': 1, 'line-opacity': 0, 'line-opacity-transition': fade },
      });
    } else {
      map.addLayer({
        id: fill, type: 'fill', source, layout: vis,
        paint: { 'fill-pattern': 'sea-hatch', 'fill-opacity': 0, 'fill-opacity-transition': fade },
      });
    }
    map.addLayer({
      id: c('-labels'), type: 'symbol', minzoom: NEAR, source: points,
      layout: { ...vis, 'text-field': ['get', 'label'], 'text-font': MONO, 'text-size': 15, 'text-max-width': 60, 'text-allow-overlap': true },
      paint: {
        'text-color': kind === 'heard' ? FOG : LABEL, 'text-halo-color': HALO, 'text-halo-width': 2.5,
        'text-opacity': 0, 'text-opacity-transition': fade,
      },
    });
    return;
  }

  if (kind === 'heat' || kind === 'fleet') {
    const heat = kind === 'heat';
    addPoints(heat ? EMPTY : (fleetPlaces(data.features, ctx.url) as FC));
    map.addLayer({
      id: fill, type: 'heatmap', source, layout: vis,
      paint: heat
        ? {
            'heatmap-weight': ['get', 'v'],
            'heatmap-intensity': 0.8,
            // About 2.2 cells (0.05°) at every zoom, so the surface's square kernel reads as a field, not tiles.
            'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 6, 10, 9, 80],
            'heatmap-color': HEAT_RAMP,
            'heatmap-opacity': 0,
            'heatmap-opacity-transition': { duration: ctx.reduced ? 0 : 1400, delay: 0 },
          }
        : {
            // The hours are skewed (a few cells hold most): the square root lets the fleet's spread read,
            // and at the pull-back's zoom each cell is a light, not a speck.
            'heatmap-weight': ['sqrt', ['get', 'v']],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 6, 0.8],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 7, 5, 16, 8, 34],
            'heatmap-color': FLEET_RAMP,
            'heatmap-opacity': 0,
            'heatmap-opacity-transition': { duration: ctx.reduced ? 0 : 1400, delay: 0 },
          },
    });
    if (!heat) {
      map.addLayer({
        id: c('-labels'), type: 'symbol', source: points,
        layout: { ...vis, 'text-field': ['get', 'label'], 'text-font': SANS, 'text-size': 16, 'text-letter-spacing': 0.04, 'text-allow-overlap': true },
        paint: {
          'text-color': ['case', ['==', ['get', 'kind'], 'fleet'], FOG, LABEL], 'text-halo-color': HALO, 'text-halo-width': 2.5,
          'text-opacity': 0, 'text-opacity-transition': fade,
        },
      });
    }
    return;
  }

  if (kind === 'boxes') {
    addPoints(boxLabelPoints(data.features) as FC);
    // The officer's selection: a fog wash and a heavier line (never amber: amber is the Approve button's).
    map.addLayer({
      id: c('-wash'), type: 'fill', source, filter: ['==', ['get', 'box'], -1], layout: vis,
      paint: { 'fill-color': FOG, 'fill-opacity': 0.07 },
    });
    map.addLayer({ id: c('-hit'), type: 'fill', source, layout: vis, paint: { 'fill-color': FOG, 'fill-opacity': 0 } });
    map.addLayer({
      id: fill, type: 'line', source, layout: vis,
      paint: { 'line-color': FOG, 'line-width': 1.6, 'line-opacity': 0, 'line-opacity-transition': fade },
    });
    map.addLayer({
      id: c('-outline'), type: 'line', source, filter: ['==', ['get', 'box'], -1], layout: vis,
      paint: { 'line-color': FOG, 'line-width': 3 },
    });
    map.addLayer({
      id: c('-labels'), type: 'symbol', minzoom: NEAR, source: points,
      layout: {
        ...vis,
        'text-field': BOX_LABEL_FIELD,
        'text-font': MONO, 'text-size': 18, 'text-offset': [0, -0.5], 'text-max-width': 40,
        // Over the box's top edge: centred, or slid right or left off an island's or a harbour's
        // name. With overlap allowed MapLibre tries every anchor clear first and only then overlaps
        // on the first, so the beat's content is never dropped (the three boxes sit close together).
        'text-variable-anchor': ['bottom', 'bottom-left', 'bottom-right'], 'text-justify': 'auto',
        // Placed whatever is near, and never in the candidates' way: their labels are the argument.
        'text-allow-overlap': true, 'text-ignore-placement': true,
        'symbol-sort-key': ['get', 'box'], 'text-padding': 4,
      },
      paint: { 'text-color': FOG, 'text-halo-color': HALO, 'text-halo-width': 2.5, 'text-opacity': 0, 'text-opacity-transition': fade },
    });
    return;
  }

  if (kind === 'look') {
    const f = data.features.find((x) => x.geometry && /Polygon$/.test(x.geometry.type));
    const words = String(f?.properties?.label ?? 'next look');
    addPoints({ type: 'FeatureCollection', features: labelPoint(words, regionLabelPoint(f?.geometry as never, ctx.view, ctx.avoid)) });
    map.addLayer({
      id: fill, type: 'fill', source, layout: vis,
      paint: { 'fill-color': FOG, 'fill-opacity': 0, 'fill-opacity-transition': fade },
    });
    map.addLayer({
      id: c('-outline'), type: 'line', source, layout: vis,
      paint: { 'line-color': LABEL, 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0, 'line-opacity-transition': fade },
    });
    map.addLayer({
      id: c('-labels'), type: 'symbol', minzoom: NEAR, source: points,
      layout: { ...vis, 'text-field': ['get', 'label'], 'text-font': MONO, 'text-size': 16, 'text-max-width': 60, 'text-allow-overlap': true },
      paint: { 'text-color': LABEL, 'text-halo-color': HALO, 'text-halo-width': 2.5, 'text-opacity': 0, 'text-opacity-transition': fade },
    });
    return;
  }

  // The silent vessel's reach: the area it could have reached by water, where it went off, the dark
  // targets inside, and (last, after a beat) where its AIS came back on.
  const area = data.features.find((x) => x.geometry && /Polygon$/.test(x.geometry.type));
  const off = data.features.find((x) => x.properties?.kind === 'off');
  const labels: Feature[] = [
    ...labelPoint(String(area?.properties?.label ?? ''), area ? regionLabelPoint(area.geometry as never, ctx.view, [
      ...(off?.geometry ? [off.geometry.coordinates as [number, number]] : []), ...ctx.avoid,
    ]) : null, 'area'),
    ...(off?.geometry ? labelPoint(String(off.properties.label ?? 'last broadcast'), off.geometry.coordinates as [number, number], 'off') : []),
  ];
  addPoints({ type: 'FeatureCollection', features: labels });
  const slow = { duration: ctx.reduced ? 0 : 2400, delay: 0 };
  const late = { duration: ctx.reduced ? 0 : 900, delay: 0 };
  map.addLayer({
    id: fill, type: 'fill', source, filter: isPoly, layout: vis,
    paint: { 'fill-color': FOG, 'fill-opacity': 0, 'fill-opacity-transition': slow },
  });
  map.addLayer({
    id: c('-outline'), type: 'line', source, filter: isPoly, layout: vis,
    paint: { 'line-color': FOG, 'line-width': 1.2, 'line-opacity': 0, 'line-opacity-transition': slow },
  });
  map.addLayer({
    id: c('-cand'), type: 'circle', source, filter: kindIs('target'), layout: vis,
    paint: {
      'circle-radius': 9, 'circle-color': 'rgba(0, 0, 0, 0)', 'circle-stroke-color': FOG, 'circle-stroke-width': 2,
      'circle-stroke-opacity': 0, 'circle-stroke-opacity-transition': { ...slow, delay: ctx.reduced ? 0 : 1200 }, 'circle-pitch-alignment': 'map',
    },
  });
  map.addLayer({
    id: c('-heads'), type: 'circle', source, filter: kindIs('off'), layout: vis,
    paint: { 'circle-radius': 4.5, 'circle-color': FOG, 'circle-stroke-color': AIS, 'circle-stroke-width': 1.6 },
  });
  map.addLayer({
    id: c('-labels'), type: 'symbol', minzoom: NEAR, source: points,
    layout: {
      ...vis, 'text-field': ['get', 'label'], 'text-font': MONO, 'text-size': 16, 'text-max-width': 40,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': ['case', ['==', ['get', 'kind'], 'off'], 1, 0], 'text-allow-overlap': true,
    },
    paint: { 'text-color': ['case', ['==', ['get', 'kind'], 'off'], AIS, FOG], 'text-halo-color': HALO, 'text-halo-width': 2.5 },
  });
  map.addLayer({
    id: c('-notes'), type: 'circle', source, filter: kindIs('on'), layout: vis,
    paint: {
      'circle-radius': 4.5, 'circle-color': FOG, 'circle-stroke-color': AIS, 'circle-stroke-width': 1.6,
      'circle-opacity': 0, 'circle-stroke-opacity': 0, 'circle-opacity-transition': late, 'circle-stroke-opacity-transition': late,
    },
  });
  map.addLayer({
    id: c('-wash'), type: 'symbol', minzoom: NEAR, source, filter: kindIs('on'),
    layout: { ...vis, 'text-field': ['get', 'label'], 'text-font': MONO, 'text-size': 16, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 1, 'text-allow-overlap': true },
    paint: { 'text-color': AIS, 'text-halo-color': HALO, 'text-halo-width': 2.5, 'text-opacity': 0, 'text-opacity-transition': late },
  });
}

type PaintKey = Parameters<M['setPaintProperty']>[1];
const setPaint = (map: M, id: string, prop: PaintKey, value: number) => {
  if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
};

/** A kind's layers come in (every fading layer started at 0). */
export function arrive(map: M, kind: Exclude<VesselKind, 'radar'>, fill: string): void {
  const c = (s: string) => cid(fill, s);
  switch (kind) {
    case 'targets':
      setPaint(map, c('-outline'), 'circle-stroke-opacity', 1);
      setPaint(map, c('-ties'), 'line-opacity', 0.8);
      setPaint(map, c('-heads'), 'circle-opacity', 0.95);
      setPaint(map, c('-heads'), 'circle-stroke-opacity', 0.9);
      return;
    case 'heard':
      setPaint(map, fill, 'fill-opacity', SEA_OPACITY.heard);
      setPaint(map, c('-outline'), 'line-opacity', 0.35);
      setPaint(map, c('-labels'), 'text-opacity', 1);
      return;
    case 'unproven':
      setPaint(map, fill, 'fill-opacity', SEA_OPACITY.unproven);
      setPaint(map, c('-labels'), 'text-opacity', 1);
      return;
    case 'heat':
      setPaint(map, fill, 'heatmap-opacity', SEA_OPACITY.heat);
      return;
    case 'fleet':
      setPaint(map, fill, 'heatmap-opacity', SEA_OPACITY.fleet);
      setPaint(map, c('-labels'), 'text-opacity', 1);
      return;
    case 'boxes':
      setPaint(map, fill, 'line-opacity', 0.9);
      setPaint(map, c('-labels'), 'text-opacity', 1);
      return;
    case 'look':
      setPaint(map, fill, 'fill-opacity', SEA_OPACITY.look);
      setPaint(map, c('-outline'), 'line-opacity', 1);
      setPaint(map, c('-labels'), 'text-opacity', 1);
      return;
    case 'reach':
      setPaint(map, fill, 'fill-opacity', SEA_OPACITY.reach);
      setPaint(map, c('-outline'), 'line-opacity', 0.5);
      setPaint(map, c('-cand'), 'circle-stroke-opacity', 1);
      return;
  }
}

/**
 * The coverage under the forecast: once the argument has moved on to where to look next, heard and
 * unproven water step back so the history's heat and the boxes read (the key still says what they are).
 */
export function paintCoverage(map: M, kind: 'heard' | 'unproven', fill: string, quiet: boolean): void {
  if (kind === 'heard') {
    setPaint(map, fill, 'fill-opacity', quiet ? 0.03 : SEA_OPACITY.heard);
    setPaint(map, cid(fill, '-outline'), 'line-opacity', quiet ? 0.15 : 0.35);
  } else {
    setPaint(map, fill, 'fill-opacity', quiet ? 0.2 : SEA_OPACITY.unproven);
  }
}

/** Where the silent vessel's AIS came back on: revealed last, after the room has read the area. */
export function revealBackOn(map: M, fill: string): void {
  setPaint(map, cid(fill, '-notes'), 'circle-opacity', 1);
  setPaint(map, cid(fill, '-notes'), 'circle-stroke-opacity', 1);
  setPaint(map, cid(fill, '-wash'), 'text-opacity', 1);
}

/** The targets' file again, statuses changed in place (match_ais after detect_vessels). */
export function updateTargets(map: M, ids: SeaIds, data: FC): void {
  (map.getSource(ids.source) as maplibregl.GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection);
  (map.getSource(ids.points) as maplibregl.GeoJSONSource | undefined)?.setData(claimParts(data.features) as GeoJSON.FeatureCollection);
}

/**
 * The candidates' reveal: the grey rings in heard water turn orchid, grow and take their labels;
 * the claim's hairlines step back. The grey rings under them go once the orchid has arrived.
 */
export function revealCandidates(map: M, fill: string, excluded: readonly string[], reduced: boolean): () => void {
  const c = (s: string) => cid(fill, s);
  setPaint(map, c('-cand'), 'circle-stroke-opacity', 1);
  setPaint(map, c('-cand'), 'circle-radius', 10);
  setPaint(map, c('-halo'), 'circle-opacity', 0.55);
  setPaint(map, c('-labels'), 'text-opacity', 1);
  setPaint(map, c('-ties'), 'line-opacity', 0.25);
  setPaint(map, c('-heads'), 'circle-opacity', 0.35);
  setPaint(map, c('-heads'), 'circle-stroke-opacity', 0.35);
  const timer = setTimeout(() => {
    if (map.getLayer(fill)) map.setFilter(fill, greyFilter(true, excluded));
  }, reduced ? 0 : 950);
  return () => clearTimeout(timer);
}

/** The coverage's labels step aside once the candidates carry the argument. */
export function quietCoverageLabels(map: M, fill: string): void {
  setPaint(map, cid(fill, '-labels'), 'text-opacity', 0);
}

/** The officer's choice on the map: the selected box washed and lined; candidates in orchid, left-out ones grey. */
export function paintTasking(map: M, boxesFill: string | null, targetsFill: string | null, box: number | null, excluded: readonly string[], revealed: boolean): void {
  if (boxesFill) {
    const sel: Filter = ['==', ['get', 'box'], box ?? -1];
    [cid(boxesFill, '-wash'), cid(boxesFill, '-outline')].forEach((id) => map.getLayer(id) && map.setFilter(id, sel));
    // The boxes not chosen step back, so the choice reads from the back of the room.
    // While the plate is up it lists each box's next look, so the map's labels keep the rank and
    // the share alone: on a small screen the candidates' labels then find room beside them.
    const labels = cid(boxesFill, '-labels');
    if (map.getLayer(labels)) map.setLayoutProperty(labels, 'text-field', box == null ? BOX_LABEL_FIELD : ['get', 'label']);
    // Undone only where a choice was painted: boxes still waiting to arrive stay at 0.
    if (map.getLayer(boxesFill)) {
      if (box != null) map.setPaintProperty(boxesFill, 'line-opacity', ['case', sel, 0.9, 0.4]);
      else if (Array.isArray(map.getPaintProperty(boxesFill, 'line-opacity'))) map.setPaintProperty(boxesFill, 'line-opacity', 0.9);
    }
  }
  if (targetsFill && map.getLayer(targetsFill)) {
    map.setFilter(cid(targetsFill, '-cand'), candidateFilter(excluded));
    map.setFilter(cid(targetsFill, '-halo'), candidateFilter(excluded));
    map.setFilter(cid(targetsFill, '-labels'), candidateFilter(excluded));
    map.setFilter(cid(targetsFill, '-notes'), notesFilter(excluded));
    map.setFilter(targetsFill, greyFilter(revealed, excluded));
  }
}

// --- the radar's sweep -------------------------------------------------------------------------------

/** The radar's preview, tinted like its tiles, as a bitmap (fetched, so the canvas is never tainted). */
export async function radarPreview(presignedUrl: string): Promise<ImageBitmap | null> {
  try {
    const url = `${TITILER_URL}/cog/preview.png?url=${encodeURIComponent(presignedUrl)}&max_size=1024&${radarTileParams()}`;
    const response = await fetch(url, {
      headers: { Accept: 'image/png', ...(TITILER_API_KEY ? { 'x-api-key': TITILER_API_KEY } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

/**
 * The radar arrives along the satellite's track: its preview drawn row by row over SWEEP_MS from the
 * edge the satellite came in at, a brighter band at the leading edge. Calls `done` when drawn (the
 * tiles take over then). Returns a cancel.
 */
export function sweepRadar(
  map: M,
  layerId: string,
  image: ImageBitmap,
  bounds: [number, number, number, number],
  ascending: boolean,
  opacity: number,
  done: () => void,
): () => void {
  const id = `${layerId}-sweep`;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    done();
    return () => {};
  }
  const [w, s, e, n] = bounds;
  map.addSource(id, { type: 'canvas', canvas, coordinates: [[w, n], [e, n], [e, s], [w, s]], animate: true });
  // Directly over the radar's tile layer: it travels with it in the stack.
  const order = map.getLayersOrder();
  const above = order[order.indexOf(layerId) + 1];
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, above);
  const t0 = performance.now();
  let frame = 0;
  let finished = false;
  const draw = (now: number) => {
    const t = (now - t0) / SWEEP_MS;
    const { from, to, edge } = sweepRows(t, canvas.height, ascending);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (to > from) ctx.drawImage(image, 0, from, canvas.width, to - from, 0, from, canvas.width, to - from);
    // The leading edge: the same pixels again, lighter, where the swath has data.
    const [a, b] = ascending ? [from, edge] : [edge, to];
    if (t < 1 && b > a) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(image, 0, a, canvas.width, b - a, 0, a, canvas.width, b - a);
    }
    if (t < 1) {
      frame = requestAnimationFrame(draw);
    } else if (!finished) {
      finished = true;
      done();
    }
  };
  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    if (!finished) {
      finished = true;
      done();
    }
  };
}

export function dropSweep(map: M, layerId: string): void {
  const id = `${layerId}-sweep`;
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

// --- the seabed's tiles, ahead of the beats ----------------------------------------------------------

/**
 * Warm the browser's cache with the seabed's tiles over the act's water at the zooms its views use,
 * so no beat lands with its edge tiles missing (round 4's rest still did). Fire and forget, a few
 * at a time; MapLibre's own requests for the same URLs are then served from the cache.
 */
export function prefetchSeabed(bounds: [number, number, number, number], zooms: readonly number[], signal: AbortSignal): void {
  const [w, s, e, n] = bounds;
  const tx = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  const urls: string[] = [];
  for (const z of zooms) {
    for (let x = tx(w, z); x <= tx(e, z); x++) {
      for (let y = ty(n, z); y <= ty(s, z); y++) {
        urls.push(TERRAIN_TILES_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
      }
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const url = urls[next++];
      try {
        await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
      } catch {
        // a missed tile is fetched again by the map when the view needs it
      }
    }
  };
  for (let i = 0; i < 4; i++) void worker();
}
