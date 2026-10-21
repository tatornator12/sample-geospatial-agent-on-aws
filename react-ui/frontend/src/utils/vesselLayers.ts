/**
 * Dark Vessels (Act 3) on the stage: the sea at night (design component 11, decision 7).
 *
 * The other acts look at land; this one looks at the water. The satellite basemap goes; the ground
 * is the seabed from the Terrain Tiles' bathymetry, near-black abyss to the islands' blue platform,
 * the islands dark silhouettes. Three days of AIS on file play back over it, and stop at the radar
 * pass's minute when the radar lands. A ring is something the radar saw; a dot is something AIS
 * heard. Nothing is called a candidate before the coverage check is on the map, and the one data
 * colour, orchid, belongs to the candidates (and, the user's pick, the history's heat). Never red,
 * never amber: amber is the stage's, for what the presenter or the officer is doing.
 *
 * Pure: styles, file-name rules, label points, the replay's frames, the clock's words and the
 * tasking's countdown, so all of it is tested without WebGL.
 */
import type { RenderHint } from './render.ts';

export const ORCHID = '#f07ad8';
/** AIS: the comet tails and the fleet's heat. */
export const AIS = '#9fd3e6';
export const FOG = '#e9eef3';
export const LABEL = '#8fa3b8';
export const DOME = '#0f141b';
/** The abyss behind the canvas (the frame's background under the seabed). */
export const SEA_GROUND = '#03070d';
/** Label halos on the sea: a shade of the deep water, so names cut out of it cleanly. */
export const HALO = '#0b1622';
export const ATTRIBUTION = 'Powered by Global Fishing Watch.';

// --- the seabed ------------------------------------------------------------------------------------

/** The bathymetry as a chart at night: abyss near-black, the platform lighter, land a dark silhouette. */
export const SEABED_COLOURS: unknown[] = [
  'interpolate', ['linear'], ['elevation'],
  -4200, '#03070d', -3200, '#06101b', -2200, '#0a1a2a', -1200, '#0f2638', -400, '#163448', -60, '#1d4258', -1, '#244c62',
  0, '#0b0e12', 400, '#10141a', 1600, '#161b22',
];
/** A low relief on the seabed, lit from the north-west: the ridges and the island slopes read. */
export const SEABED_SHADE = {
  'hillshade-method': 'basic',
  'hillshade-illumination-direction': 315,
  'hillshade-illumination-altitude': 35,
  'hillshade-exaggeration': 0.4,
  'hillshade-shadow-color': 'rgba(0, 0, 0, 0.5)',
  'hillshade-highlight-color': 'rgba(150, 190, 215, 0.14)',
  'hillshade-accent-color': 'rgba(0, 0, 0, 0)',
} as const;

// --- the radar ---------------------------------------------------------------------------------------

/**
 * The radar's tint: the display COG is the radar over its local sea (scripts/build_vessel_cache.py
 * --display, uint8 1..255), so the sea sits in one low band at every range and only what stands
 * above it goes towards fog. Never pure white. The ramp is TiTiler's `colormap` in its interval form
 * (32 bands of 8 values; speckle dithers the steps).
 */
const RADAR_STOPS: Array<[number, [number, number, number]]> = [
  [0, [8, 18, 28]], [0.5, [38, 64, 82]], [0.85, [150, 176, 194]], [1, [233, 238, 243]],
];
export const RADAR_ALPHA = 235;

export function radarColour(g: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, g));
  for (let i = 0; i < RADAR_STOPS.length - 1; i++) {
    const [a, ca] = RADAR_STOPS[i];
    const [b, cb] = RADAR_STOPS[i + 1];
    if (x >= a && x <= b) {
      const t = (x - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] * (1 - t) + cb[k] * t)) as [number, number, number];
    }
  }
  return RADAR_STOPS[RADAR_STOPS.length - 1][1];
}

/** The interval colormap for TiTiler: [[[lo, hi], [r, g, b, a]], ...] over the display's 1..255. */
export function radarColormap(): string {
  const bands: Array<[[number, number], [number, number, number, number]]> = [];
  for (let lo = 1; lo < 256; lo += 8) {
    const [r, g, b] = radarColour((lo + 3 - 1) / 254);
    bands.push([[lo, lo + 8], [r, g, b, RADAR_ALPHA]]);
  }
  return JSON.stringify(bands);
}

/** The radar's TiTiler query (tiles and the sweep's preview). */
export function radarTileParams(): string {
  return `bidx=1&colormap=${encodeURIComponent(radarColormap())}`;
}

// --- which file is which -----------------------------------------------------------------------------

export type VesselKind = 'radar' | 'targets' | 'heard' | 'unproven' | 'heat' | 'boxes' | 'fleet' | 'look' | 'reach';

const PASS_ID = /s1[a-d]-\d{8}t\d{4}/;
const SEA_TREE = /\/session_data\/[^/]+\/vessels\/|\/use-cases\/vessels-[a-z0-9-]+\//;

function basenameOf(url: string | undefined): string {
  const path = (url || '').split('?')[0];
  return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}

/** What a session file of the act is, by the tools' own names (never by its title). */
export function vesselKind(url: string | undefined): VesselKind | null {
  if (!SEA_TREE.test(url || '')) return null;
  const name = basenameOf(url);
  if (/^radar_s1[a-d]-\d{8}t\d{4}\.tiff?$/.test(name)) return 'radar';
  if (/^targets_s1[a-d]-\d{8}t\d{4}\.geojson$/.test(name)) return 'targets';
  if (/^heard_s1[a-d]-\d{8}t\d{4}\.geojson$/.test(name)) return 'heard';
  if (/^unproven_s1[a-d]-\d{8}t\d{4}\.geojson$/.test(name)) return 'unproven';
  if (name === 'hotspots.geojson') return 'heat';
  if (name === 'boxes.geojson') return 'boxes';
  if (/^fleet_\d{4}-\d{2}\.geojson$/.test(name)) return 'fleet';
  if (/^look_\d_[0-9t-]+\.geojson$/.test(name)) return 'look';
  if (/^reach_s1[a-d]-\d{8}t\d{4}\.geojson$/.test(name)) return 'reach';
  return null;
}

/** The pass a file belongs to (radar, targets, coverage, reach), or null (the forecast's files). */
export function passOf(url: string | undefined): string | null {
  const name = basenameOf(url);
  if (!/^(radar|targets|heard|unproven|reach)_/.test(name)) return null;
  return name.match(PASS_ID)?.[0] ?? null;
}

const DEFAULTS: Record<VesselKind, RenderHint> = {
  radar: { kind: 'raster', group: 'maritime', legend: 'Radar backscatter' },
  targets: { kind: 'points', group: 'maritime', legend: 'Radar targets' },
  heard: { kind: 'vector', group: 'maritime', legend: 'AIS received' },
  unproven: { kind: 'vector', group: 'maritime', legend: 'AIS reception unknown' },
  heat: { kind: 'points', group: 'maritime', legend: 'Dark targets seen before', property: 'v' },
  boxes: { kind: 'vector', group: 'maritime', legend: 'Patrol boxes', label: 'label' },
  fleet: { kind: 'points', group: 'maritime', legend: 'Squid fleet hours', property: 'v' },
  look: { kind: 'vector', group: 'maritime', legend: 'Next radar look', label: 'label' },
  reach: { kind: 'vector', group: 'maritime', legend: 'Reach by water', label: 'label' },
};

/**
 * The style of a sea layer is the stage's, by the file's name: the hint only has to say it is
 * maritime, and a hint the model drifted (or dropped) changes nothing on the stage.
 */
export function vesselGeometryHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  const kind = vesselKind(url);
  if (kind && kind !== 'radar') return { ...DEFAULTS[kind], ...(render?.group === 'maritime' && render.legend ? { legend: render.legend } : {}) };
  return null;
}

export function vesselRasterHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  if (vesselKind(url) !== 'radar') return null;
  return { ...DEFAULTS.radar, ...(render?.bounds ? { bounds: render.bounds } : {}) };
}

export function isVesselLayer(layer: { type: 'raster' | 'geometry'; url: string; render?: RenderHint }): boolean {
  return vesselKind(layer.url) !== null;
}

// --- passes ------------------------------------------------------------------------------------------

/** "Sentinel-1D", "2026-10-12 00:18 UTC" from a pass id (s1d-20261012t0018). */
export function passWords(passId: string): { satellite: string; when: string; day: string } | null {
  const m = passId.match(/^s1([a-d])-(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})$/);
  if (!m) return null;
  const day = `${m[2]}-${m[3]}-${m[4]}`;
  return { satellite: `Sentinel-1${m[1].toUpperCase()}`, when: `${day} ${m[5]}:${m[6]} UTC`, day };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The pass's short date, "Oct 12" (month first, as the look lines give it), or null. */
export function passDay(passId: string): string | null {
  const m = passId.match(/^s1[a-d]-\d{4}(\d{2})(\d{2})t\d{4}$/);
  if (!m) return null;
  const [month, day] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTH_SHORT[month - 1]} ${day}`;
}

// --- the targets ---------------------------------------------------------------------------------------

/** How a target reads, by what the tools said about it (detect_vessels, then match_ais). */
export type ShownStatus = 'detected' | 'claimed' | 'port' | 'unproven' | 'seen_once' | 'candidate';

/**
 * Every status by shape and words as well as hue (never colour alone), and never red or amber.
 * A ring is something the radar saw; a filled disc is a radar target a broadcast accounts for.
 */
export const STATUS_KEY: Record<ShownStatus, { shape: string; colour: string; words: string }> = {
  detected: { shape: 'grey ring', colour: LABEL, words: 'radar target, not yet explained' },
  claimed: { shape: 'fog ring tied by a hairline to its AIS dot', colour: FOG, words: 'a broadcast accounts for it' },
  port: { shape: 'fog square', colour: FOG, words: 'at or near a port' },
  unproven: { shape: 'grey ring, labelled', colour: LABEL, words: 'reception unknown: no AIS there proves nothing' },
  seen_once: { shape: 'small faint ring', colour: LABEL, words: 'seen by one detector only, set aside' },
  candidate: { shape: 'orchid ring, labelled', colour: ORCHID, words: 'candidate: no AIS where AIS was received, both detectors' },
};

/** The circle layer's status as an expression: a claimed target (at detect) reads as a broadcast. */
export const SHOWN_STATUS: unknown[] = [
  'case',
  ['all', ['==', ['get', 'claimed'], true], ['!=', ['get', 'status'], 'port']], 'claimed',
  ['==', ['get', 'status'], 'broadcasting'], 'claimed',
  ['get', 'status'],
];

export interface TargetCounts {
  targets: number;
  claimed: number;
  port: number;
  unproven: number;
  seenOnce: number;
  candidate: number;
  /** match_ais has run (the statuses are its), so the candidates may be shown. */
  matched: boolean;
}

type Feature = { type?: string; properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null };

export function targetCounts(features: readonly Feature[]): TargetCounts {
  const c: TargetCounts = { targets: 0, claimed: 0, port: 0, unproven: 0, seenOnce: 0, candidate: 0, matched: false };
  for (const f of features) {
    if (f?.geometry?.type !== 'Point') continue;
    const s = f.properties?.status;
    c.targets++;
    if (s === 'port') c.port++;
    else if (s === 'broadcasting' || f.properties?.claimed === true) c.claimed++;
    else if (s === 'unproven') c.unproven++;
    else if (s === 'seen_once') c.seenOnce++;
    else if (s === 'candidate') c.candidate++;
    if (s === 'broadcasting' || s === 'unproven' || s === 'seen_once' || s === 'candidate') c.matched = true;
  }
  return c;
}

/** The claim's hairlines (target to the AIS position at the pass minute) and those positions, from `claim`. */
export function claimParts(features: readonly Feature[]): { type: 'FeatureCollection'; features: Feature[] } {
  const out: Feature[] = [];
  for (const f of features) {
    const c = f?.properties?.claim;
    const at = f?.geometry?.type === 'Point' ? (f.geometry.coordinates as number[]) : null;
    if (!at || !Array.isArray(c) || c.length !== 2 || !c.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ type: 'Feature', properties: { part: 'tie' }, geometry: { type: 'LineString', coordinates: [[at[0], at[1]], [c[0], c[1]]] } });
    out.push({ type: 'Feature', properties: { part: 'head' }, geometry: { type: 'Point', coordinates: [c[0], c[1]] } });
  }
  return { type: 'FeatureCollection', features: out };
}

// --- label points ------------------------------------------------------------------------------------------

type Ring = Array<[number, number]>;

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(a / 2);
}

function inRing(p: [number, number], r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p: [number, number], poly: Ring[]): boolean {
  return poly.length > 0 && inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h));
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function edgeDist(p: [number, number], poly: Ring[]): number {
  let d = Infinity;
  for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(p, r[j], r[i]));
  return d;
}

/** A geometry's polygons (rings of [lon, lat]); [] for anything else. */
export function polygonsOf(geometry: Feature['geometry']): Ring[][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates as Ring[]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Ring[][];
  return [];
}

/**
 * Where one label for a (multi)polygon goes: inside its largest part, as far from every edge as a
 * grid search finds (a pole of inaccessibility, near enough), so "heard water" sits once in the
 * water it names rather than once per scrap of it.
 */
export function poleOf(geometry: Feature['geometry'], grid = 24): [number, number] | null {
  const polys = polygonsOf(geometry).filter((p) => p.length > 0 && p[0].length >= 4);
  if (!polys.length) return null;
  const poly = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const xs = poly[0].map((c) => c[0]);
  const ys = poly[0].map((c) => c[1]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best: { p: [number, number]; d: number } | null = null;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const p: [number, number] = [w + ((i + 0.5) * (e - w)) / grid, s + ((j + 0.5) * (n - s)) / grid];
      if (!inPolygon(p, poly)) continue;
      const d = edgeDist(p, poly);
      if (!best || d > best.d) best = { p, d };
    }
  }
  return best?.p ?? poly[0][0];
}

/**
 * Where a long shape's label goes in the view (the next look's swath crosses the frame): inside
 * both the shape and the view's inner 80%, towards the edge of the view the shape runs out to.
 */
export function viewLabelPoint(geometry: Feature['geometry'], view: [number, number, number, number], grid = 30): [number, number] | null {
  const polys = polygonsOf(geometry);
  if (!polys.length) return null;
  const [w, s, e, n] = view;
  const dx = (e - w) * 0.1, dy = (n - s) * 0.1;
  const cx = (w + e) / 2, cy = (s + n) / 2;
  let best: { p: [number, number]; d: number } | null = null;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const p: [number, number] = [w + dx + ((i + 0.5) * (e - w - 2 * dx)) / grid, s + dy + ((j + 0.5) * (n - s - 2 * dy)) / grid];
      if (!polys.some((poly) => inPolygon(p, poly))) continue;
      const d = Math.hypot((p[0] - cx) / (e - w), (p[1] - cy) / (n - s));
      if (!best || d > best.d) best = { p, d };
    }
  }
  return best?.p ?? null;
}

/** The patrol boxes' labels, at each box's top edge: "1  9%" over its next look. */
export function boxLabelPoints(features: readonly Feature[]): { type: 'FeatureCollection'; features: Feature[] } {
  const out: Feature[] = [];
  for (const f of features) {
    const ring = polygonsOf(f?.geometry)[0]?.[0];
    if (!ring) continue;
    const xs = ring.map((c) => c[0]);
    const n = Math.max(...ring.map((c) => c[1]));
    const next = String(f.properties?.next ?? '');
    out.push({
      type: 'Feature',
      // `when` is the look's time alone ("Oct 24 00:17 UTC"): three boxes sit close, so their labels are short.
      properties: { box: f.properties?.box ?? null, label: String(f.properties?.label ?? ''), next, when: next.replace(/^S1-?[A-D]\s+/, '') },
      geometry: { type: 'Point', coordinates: [(Math.min(...xs) + Math.max(...xs)) / 2, n] },
    });
  }
  return { type: 'FeatureCollection', features: out };
}

/** The bounds of a set of points with weight `v` at or above `min`, or null. */
export function heavyBounds(features: readonly Feature[], min: number): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of features) {
    const c = f?.geometry?.type === 'Point' ? (f.geometry.coordinates as number[]) : null;
    const v = Number(f?.properties?.v);
    if (!c || !(v >= min)) continue;
    w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function growBounds(b: [number, number, number, number], d: number): [number, number, number, number] {
  return [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" from fleet_2026-10.geojson. */
export function fleetMonth(url: string | undefined): string | null {
  const m = basenameOf(url).match(/^fleet_(\d{4})-(\d{2})\.geojson$/);
  const i = m ? Number(m[2]) - 1 : -1;
  return m && i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : null;
}

/** The fleet's lights and the places that frame them: the labels the pull-back puts on the map. */
export function fleetPlaces(features: readonly Feature[], url: string | undefined): { type: 'FeatureCollection'; features: Feature[] } {
  let sx = 0, sy = 0, sw = 0;
  for (const f of features) {
    const c = f?.geometry?.type === 'Point' ? (f.geometry.coordinates as number[]) : null;
    const v = Number(f?.properties?.v);
    if (!c || !(v >= 0.25)) continue;
    sx += c[0] * v; sy += c[1] * v; sw += v;
  }
  const month = fleetMonth(url);
  const places: Array<[string, [number, number], string]> = [
    ['Ecuador', [-78.6, -1.6], 'place'], ['Peru', [-76.6, -8.6], 'place'], ['Galápagos Marine Reserve', [-90.6, -2.6], 'place'],
  ];
  if (sw > 0) places.push([`Squid fleet${month ? `, ${month}` : ''}`, [sx / sw, sy / sw - 1.2], 'fleet']);
  return {
    type: 'FeatureCollection',
    features: places.map(([label, c, kind]) => ({ type: 'Feature', properties: { label, kind }, geometry: { type: 'Point', coordinates: c } })),
  };
}

/** Where the fleet beat frames: the fleet off Peru and Chile, and the reserve. */
export const FLEET_VIEW: [number, number, number, number] = [-95.0, -24.0, -74.0, 3.0];

// --- the AIS replay ------------------------------------------------------------------------------------------

export interface ReplayTrack {
  n: number;
  type: string;
  t: string[];
  c: Array<[number, number]>;
}

/** The act's resting state from the backend (/api/vessels/rest; scripts/publish_vessel_rest.py). */
export interface VesselRest {
  version: 1;
  pass: { pass_id: string; satellite: string | null; sensed: string; orbit_state: string | null };
  replay: { start: string; end: string; tracks: ReplayTrack[] };
  reserve: { type: string; coordinates: unknown };
  ports: Array<{ label: string; coordinates: [number, number] }>;
  islands: Array<{ label: string; coordinates: [number, number] }>;
  passes: Array<{ pass_id: string; satellite: string | null; sensed: string; orbit_state: string | null; role: string | null }>;
  attribution: string;
}

export interface PreparedTrack {
  ts: number[];
  cs: Array<[number, number]>;
  faint: boolean;
}

const HOUR = 3600e3;
/** Transits (cargo, tankers, survey) draw fainter: the routes between the islands are the network. */
const TRANSIT = new Set(['cargo', 'tanker', 'seismic_vessel']);

export function prepareReplay(tracks: readonly ReplayTrack[]): PreparedTrack[] {
  return tracks
    .map((tr) => ({
      ts: tr.t.map((s) => Date.parse(s.length === 17 ? s.replace('Z', ':00Z') : s)),
      cs: tr.c,
      faint: TRANSIT.has(tr.type),
    }))
    .filter((tr) => tr.ts.length > 0 && tr.ts.length === tr.cs.length && tr.ts.every(Number.isFinite));
}

/** Every track's whole wake, broken where a gap is longer than `maxGapH` (a long gap is not a route). */
export function wakes(prepared: readonly PreparedTrack[], maxGapH = 3): { type: 'FeatureCollection'; features: Feature[] } {
  const out: Feature[] = [];
  for (const tr of prepared) {
    let seg: Array<[number, number]> = [tr.cs[0]];
    for (let j = 1; j < tr.cs.length; j++) {
      if (tr.ts[j] - tr.ts[j - 1] > maxGapH * HOUR) {
        if (seg.length > 1) out.push({ type: 'Feature', properties: { faint: tr.faint }, geometry: { type: 'LineString', coordinates: seg } });
        seg = [];
      }
      seg.push(tr.cs[j]);
    }
    if (seg.length > 1) out.push({ type: 'Feature', properties: { faint: tr.faint }, geometry: { type: 'LineString', coordinates: seg } });
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * The replay at time `t` (ms): each vessel's head, interpolated between hourly positions only
 * across gaps of `maxGapH` or less, and the last `tailHours` as its comet tail. A track is shown
 * from its first position to an hour after its last.
 */
export function replayFrame(prepared: readonly PreparedTrack[], t: number, tailHours = 4, maxGapH = 3) {
  const heads: Feature[] = [];
  const tails: Feature[] = [];
  for (const { ts, cs } of prepared) {
    if (t < ts[0] || t > ts[ts.length - 1] + HOUR) continue;
    let i = 0;
    while (i < ts.length - 1 && ts[i + 1] <= t) i++;
    let p = cs[i];
    if (i < ts.length - 1 && ts[i + 1] - ts[i] <= maxGapH * HOUR && t >= ts[i]) {
      const a = (t - ts[i]) / (ts[i + 1] - ts[i]);
      p = [cs[i][0] + a * (cs[i + 1][0] - cs[i][0]), cs[i][1] + a * (cs[i + 1][1] - cs[i][1])];
    }
    heads.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } });
    const tail: Array<[number, number]> = [];
    for (let j = 0; j <= i; j++) {
      if (ts[j] < t - tailHours * HOUR) continue;
      if (tail.length && ts[j] - ts[j - 1] > maxGapH * HOUR) tail.length = 0;
      tail.push(cs[j]);
    }
    tail.push(p);
    if (tail.length >= 2) tails.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: tail } });
  }
  return {
    heads: { type: 'FeatureCollection' as const, features: heads },
    tails: { type: 'FeatureCollection' as const, features: tails },
    n: heads.length,
  };
}

/** The rest view's loop: the last 36 hours before the pass, an hour every three seconds. */
export const REPLAY_LOOP_H = 36;
export const REPLAY_MS_PER_HOUR = 3000;
/** When the agent starts on the pass, the replay runs on to the pass's minute quickly (six hours a second). */
export const REPLAY_FORWARD_MS_PER_HOUR = 167;

export function replayWindow(rest: Pick<VesselRest, 'replay'>): [number, number] {
  const end = Date.parse(rest.replay.end.length === 17 ? rest.replay.end.replace('Z', ':00Z') : rest.replay.end);
  const start = Math.max(Date.parse(rest.replay.start.length === 17 ? rest.replay.start.replace('Z', ':00Z') : rest.replay.start), end - REPLAY_LOOP_H * HOUR);
  return [start, end];
}

/** The time the replay shows `elapsedMs` into the loop (it starts again at the window's start). */
export function loopTime(window: [number, number], elapsedMs: number): number {
  const span = window[1] - window[0];
  const offset = ((elapsedMs / REPLAY_MS_PER_HOUR) * HOUR) % span;
  return window[0] + offset;
}

// --- the clock plate ---------------------------------------------------------------------------------------

/** What the room is looking at: the latest beat the stage drew. */
export type SeaBeat = 'rest' | 'forward' | 'radar' | 'targets' | 'coverage' | 'candidates' | 'heat' | 'boxes' | 'fleet'
  | 'look' | 'reach' | 'tasking' | 'filed';

export interface SeaFacts {
  /** The replay's clock (ms) and the vessels it shows. */
  replayAt?: number;
  vessels?: number;
  /** The pass on the stage, and the pass the AIS replay belongs to. */
  passId?: string;
  replayPassId?: string;
  counts?: TargetCounts;
  heardShare?: number;
  /** The officer's filed choice (the filed beat's sub); without it the sub points at the plate. */
  tasking?: { box: number; kept: number; total: number; lookStart?: string | null };
  fleetMonth?: string;
  look?: string;
  lookStart?: string;
  reach?: string;
  now?: number;
}

export function utcMinute(ms: number): string {
  const d = new Date(ms).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`;
}

/** "in 4 d 14 h", "in 3 h 20 min", "under way", from the look's start (ISO) and now (ms). */
export function countdown(startIso: string, now: number): string {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return '';
  const min = Math.round((t - now) / 60000);
  if (min <= 0) return 'under way or passed';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return d > 0 ? `in ${d} d ${h} h` : h > 0 ? `in ${h} h ${m} min` : `in ${m} min`;
}

/**
 * The clock plate's two lines for a beat, from the tools' own numbers: line one what the room is
 * looking at, line two what it means. Numbers come from the files the agent wrote (the received
 * share rides on the received area's feature), never from the stage's own measure.
 */
export function clockLines(beat: SeaBeat, f: SeaFacts): { lead: string; sub: string } {
  const pass = f.passId ? passWords(f.passId) : null;
  const c = f.counts;
  switch (beat) {
    case 'rest':
      return {
        lead: `AIS replay  ${f.replayAt ? utcMinute(f.replayAt) : ''}`.trim(),
        sub: `${f.vessels ?? 0} vessels broadcasting · the 36 hours to the radar pass · ${ATTRIBUTION}`,
      };
    case 'forward':
      return { lead: `AIS replay  ${f.replayAt ? utcMinute(f.replayAt) : ''}`.trim(), sub: 'running on to the radar pass' };
    case 'radar':
      return {
        lead: pass ? `${pass.satellite} radar  ${pass.when}` : 'Sentinel-1 radar',
        // The replay is one pass's: over any other pass, older or newer, it steps aside rather than mislead.
        sub: f.replayPassId && f.passId && f.replayPassId !== f.passId
          ? `the AIS replay is of the ${passWords(f.replayPassId)?.day ?? 'other'} pass, so it steps aside`
          : `AIS held at the pass minute · ${f.vessels ?? 0} vessels broadcasting`,
      };
    case 'targets': {
      if (!c) return { lead: 'Radar targets', sub: 'nothing is called dark before the coverage check' };
      const open = Math.max(0, c.targets - c.claimed - c.port);
      return {
        lead: `${c.targets} radar targets`,
        sub: `${c.claimed} accounted for by a broadcast · ${c.port} at port · ${open} not yet explained`,
      };
    }
    case 'coverage':
      // The received share is of the whole reserve: what the pass can check needs the imaged area.
      return {
        lead: typeof f.heardShare === 'number' ? `AIS received over ${Math.round(f.heardShare * 100)}% of the reserve` : 'Where AIS was received',
        sub: 'other ships\' AIS was received there near the pass · hatched: reception unknown',
      };
    case 'candidates':
      return {
        lead: `${c?.candidate ?? 0} ${(c?.candidate ?? 0) === 1 ? 'candidate' : 'candidates'}`,
        sub: 'no AIS where AIS was being received, seen by both detectors · a reason to look, not an accusation',
      };
    case 'heat':
      return { lead: 'Where to look next', sub: 'where radar targets with no AIS match were seen before · the history, not today\'s candidates' };
    case 'boxes':
      return { lead: 'Three patrol boxes', sub: 'each box: its share of past dark targets and its next radar look · the heat is history, not today\'s candidates' };
    case 'fleet':
      return {
        lead: `Squid fleet${f.fleetMonth ? `  ${f.fleetMonth}` : ''}`,
        sub: `its fishing hours · the reserve is the dashed outline · ${ATTRIBUTION}`,
      };
    case 'look':
      return {
        lead: f.look ? f.look.replace(/^next look\s+/, 'Next radar look  ') : 'Next radar look',
        sub: f.lookStart ? `${countdown(f.lookStart, f.now ?? Date.now())}, from ESA's published plan` : 'from ESA\'s published plan',
      };
    case 'reach':
      return {
        lead: pass ? `Earlier pass  ${pass.when}` : 'An earlier pass',
        sub: `${f.reach ? `${f.reach} · ` : ''}I cannot say which, if any, of these it is.`,
      };
    case 'tasking':
      return { lead: 'Patrol tasking  draft', sub: 'choose a box and the candidates, then approve' };
    case 'filed':
      // The filed sentence is the plate's alone (it says who filed it, and when); the clock states the choice.
      return { lead: 'Patrol tasking  filed', sub: f.tasking ? filedChoice(f.tasking, f.now ?? Date.now()) : 'the approved box and candidates are on the tasking plate' };
  }
}

/** "box 1 · 3 of 4 candidates · next radar look in 3 d 9 h": what was filed, without saying who filed it. */
function filedChoice(t: NonNullable<SeaFacts['tasking']>, now: number): string {
  const which = t.total === 0 ? 'a patrol of the box only' : `${t.kept} of ${t.total} ${t.total === 1 ? 'candidate' : 'candidates'}`;
  const when = t.lookStart ? countdown(t.lookStart, now) : '';
  return `box ${t.box} · ${which} · next radar look ${when || 'not planned yet'}`;
}

/** The beat a newly landed layer puts on the stage (the targets' depends on whether match_ais ran). */
export function beatFor(kind: VesselKind, counts?: TargetCounts): SeaBeat {
  switch (kind) {
    case 'radar': return 'radar';
    case 'targets': return counts?.matched ? 'candidates' : 'targets';
    case 'heard':
    case 'unproven': return 'coverage';
    case 'heat': return 'heat';
    case 'boxes': return 'boxes';
    case 'fleet': return 'fleet';
    case 'look': return 'look';
    case 'reach': return 'reach';
  }
}

/** Split a line into words and numbers, so the plate sets numbers in the mono face (the Tabular Rule). */
export function numberRuns(text: string): Array<{ text: string; num: boolean }> {
  const out: Array<{ text: string; num: boolean }> = [];
  const re = /\d[\d:.,%-]*(?:\s?UTC)?/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), num: false });
    out.push({ text: m[0], num: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), num: false });
  return out;
}

// --- the beats' paint ---------------------------------------------------------------------------------------

/** How the AIS furniture and the radar read in a beat. */
export interface AisLook {
  shown: boolean;
  wakes: number;
  faintWakes: number;
  trail: number;
  heads: number;
  headStroke: number;
  radar: number;
  /**
   * How far the coverage steps back: 'none' under the argument, 'hatch' while the candidates are
   * read (the reception-unknown hatch halves), 'all' under the forecast (its heat and boxes carry it).
   */
  quietCoverage: CoverageQuiet;
}

export type CoverageQuiet = 'none' | 'hatch' | 'all';

const CLAIM_BEATS: readonly SeaBeat[] = ['targets', 'coverage', 'candidates'];
const FORECAST_BEATS: readonly SeaBeat[] = ['heat', 'boxes', 'look', 'tasking', 'filed'];

/**
 * The traffic steps back while the room reads the claim (the comet tails go, the heads stay so the
 * hairlines have something to tie to), dims under the forecast, and steps aside for the fleet's
 * pull-back and for an earlier pass (the replay is the latest pass's, so over another date it would
 * mislead). The radar reads full under the argument and recedes under the forecast.
 */
export function aisLook(beat: SeaBeat, earlierPass = false): AisLook {
  const quietCoverage: CoverageQuiet = FORECAST_BEATS.includes(beat) || beat === 'fleet' ? 'all' : beat === 'candidates' ? 'hatch' : 'none';
  if (beat === 'fleet' || beat === 'reach' || earlierPass) {
    return { shown: false, wakes: 0, faintWakes: 0, trail: 0, heads: 0, headStroke: 0, radar: 0.8, quietCoverage };
  }
  if (CLAIM_BEATS.includes(beat)) return { shown: true, wakes: 0.045, faintWakes: 0.02, trail: 0, heads: 0.7, headStroke: 0.35, radar: 0.8, quietCoverage };
  if (FORECAST_BEATS.includes(beat)) return { shown: true, wakes: 0.13, faintWakes: 0.05, trail: 0.35, heads: 0.3, headStroke: 0.15, radar: 0.55, quietCoverage };
  return { shown: true, wakes: 0.13, faintWakes: 0.05, trail: 1, heads: 1, headStroke: 0.6, radar: 0.8, quietCoverage };
}

/** The stage's frame for the sea: the usual plates, and room at the top for the clock plate's two lines. */
export function seaPadding(base: { top: number; bottom: number; left: number; right: number }) {
  return { ...base, top: Math.max(base.top, 140) };
}

// --- the next look's time -------------------------------------------------------------------------------------

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The look's start from next_look's own words ("S1-D Oct 24 00:17 UTC", no year), in the year that
 * puts it nearest `now`, as ISO; null when the words carry no time.
 */
export function lookStartFrom(text: string | undefined, now: number): string | null {
  const m = (text || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2}):(\d{2})\s*UTC\b/i);
  if (!m) return null;
  const month = MONTH_ABBR.indexOf(m[1].slice(0, 3).toLowerCase());
  const [day, hh, mm] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (month < 0 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
  const year = new Date(now).getUTCFullYear();
  const t = [year - 1, year, year + 1]
    .map((y) => Date.UTC(y, month, day, hh, mm))
    .reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// --- labels inside a region, in the view --------------------------------------------------------------------

/**
 * Where a region's one label goes in the view the room sees: inside the region and the view's inner
 * 80%, as far as it can be (up to a cap) from the marks it must not cover, then from the region's
 * edge; null when no part of the region is in the view. `view` is [w, s, e, n].
 */
export function regionLabelPoint(
  geometry: Feature['geometry'],
  view: [number, number, number, number],
  avoid: ReadonlyArray<[number, number]> = [],
  grid = 28,
): [number, number] | null {
  const polys = polygonsOf(geometry).filter((p) => p.length > 0 && p[0].length >= 4);
  if (!polys.length) return null;
  const [w, s, e, n] = view;
  const dx = (e - w) * 0.1, dy = (n - s) * 0.1;
  const cap = 0.08 * Math.min(e - w, n - s);
  let best: { p: [number, number]; score: number } | null = null;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const p: [number, number] = [w + dx + ((i + 0.5) * (e - w - 2 * dx)) / grid, s + dy + ((j + 0.5) * (n - s - 2 * dy)) / grid];
      const inside = polys.find((poly) => inPolygon(p, poly));
      if (!inside) continue;
      const clear = avoid.reduce((d, a) => Math.min(d, Math.hypot(p[0] - a[0], p[1] - a[1])), Infinity);
      const score = 2 * Math.min(clear, cap) + Math.min(edgeDist(p, inside), cap);
      if (!best || score > best.score) best = { p, score };
    }
  }
  return best?.p ?? null;
}

// --- the radar's sweep --------------------------------------------------------------------------------------

/** The sweep's length: the satellite's track drawn across the frame. */
export const SWEEP_MS = 3800;

/**
 * The rows of the radar's preview drawn at `t` (0 to 1): from the south edge for an ascending pass
 * (it flew north), from the north for a descending one; `edge` is the bright leading band's far row.
 */
export function sweepRows(t: number, height: number, ascending: boolean): { from: number; to: number; edge: number } {
  const x = Math.min(1, Math.max(0, t));
  // Ease out: the track arrives fast and settles, as the satellite's pass reads.
  const eased = 1 - (1 - x) ** 2;
  const drawn = Math.round(eased * height);
  const band = Math.round(height * 0.04);
  if (ascending) return { from: height - drawn, to: height, edge: Math.min(height, height - drawn + band) };
  return { from: 0, to: drawn, edge: Math.max(0, drawn - band) };
}

// --- the tasking on the map ---------------------------------------------------------------------------------

/** A candidate's id in or out of the tasking (the officer's toggle). */
export function toggled(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].sort();
}

/**
 * The plate's summary line: "Patrol box 1 · check 3 of 4 candidates on the way". The box comes from
 * past dark targets and the candidates from the pass, so they are checked on the way, not in the box.
 */
export function taskingLine(box: number, kept: number, total: number): string {
  if (total === 0) return `Patrol box ${box} · a patrol of the box only`;
  return `Patrol box ${box} · check ${kept} of ${total} ${total === 1 ? 'candidate' : 'candidates'} on the way`;
}

/**
 * The clock's filed facts from the filed tasking: the officer's box, the candidates kept of the
 * draft's, and that box's next radar look; undefined until it is filed.
 */
export function filedFacts(state: {
  status: string;
  choice?: { box: number; candidateIds: readonly string[] } | null;
  card: { candidates: ReadonlyArray<{ id: string }> };
  boxes: ReadonlyArray<{ box: number; look: { start: string } | null }>;
} | null): SeaFacts['tasking'] {
  if (state?.status !== 'filed' || !state.choice) return undefined;
  const { box, candidateIds } = state.choice;
  const kept = state.card.candidates.filter((c) => candidateIds.includes(c.id)).length;
  const look = state.boxes.find((b) => b.box === box)?.look ?? null;
  return { box, kept, total: state.card.candidates.length, lookStart: look?.start ?? null };
}

/** The candidates' labels on the map (the radar target's id and why it is one, in mono). */
export const CANDIDATE_LABEL_SUFFIX = '  no AIS';
export const LEFT_OUT_SUFFIX = '  left out';

/** What the stage tells the agent once the officer has filed (the prompt's turn D: "Is it filed?"). */
export const taskingFiledMessage = (taskingId: string) => `The officer approved ${taskingId} on the map. Is it filed?`;

// --- bounds -----------------------------------------------------------------------------------------------

/** The [w, s, e, n] of every coordinate in a set of features (points, lines, polygons), or null. */
export function featureBounds(features: readonly Feature[]): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
      return;
    }
    c.forEach(visit);
  };
  for (const f of features) visit(f?.geometry?.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}
