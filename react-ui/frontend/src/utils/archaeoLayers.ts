/**
 * The AI Archaeologist on the map: which style a terrain layer gets, the legends the layers
 * plate shows for it, and the ground view the act is read at. Pure functions, so the map's
 * choices are testable without WebGL.
 *
 * Every hint here has already passed `parseRenderHint` (utils/render.ts); the defaults below are
 * the tools' own values (agents/ai-archaeologist/site_tools.py), used when a layer arrived without
 * a valid hint and is recognised by its file name instead. Everything the act puts on the map is
 * a site already on the public record (the agent's catalogue); nothing here can place a point.
 */
import { isStageDemUrl, type RenderHint } from './render.ts';

/** A hillshade: the ground lit from the north-west, greys 1–255 (0 is nodata). */
export const HILLSHADE: RenderHint = { kind: 'raster', colormap: 'gray', rescale: [1, 255], group: 'terrain', legend: 'Hillshade' };
/** A local relief model: metres above (red) or below (blue) the 21 m neighbourhood, ±1 m for standing walls. */
export const LOCAL_RELIEF: RenderHint = {
  kind: 'raster', colormap: 'rdbu_r', rescale: [-1, 1], units: 'm', group: 'terrain', legend: 'Local relief',
};
/** Ploughed walls (Hopeton, Seip, High Bank): ±0.3 m. */
export const LOCAL_RELIEF_FINE: RenderHint = { ...LOCAL_RELIEF, rescale: [-0.3, 0.3] };
/** The transect measure_profile wrote: a line, and a point per bank and ditch with its label. */
export const TRANSECT: RenderHint = { kind: 'vector', group: 'terrain', label: 'label' };
/** A catalogue site's 3 km frame (find_known_site). */
export const SITE_FRAME: RenderHint = { kind: 'vector', group: 'terrain' };
/** The catalogue on the map at rest: one mark per site on the public record. */
export const RECORD_MARKS: RenderHint = { kind: 'points', group: 'terrain', label: 'name' };

/**
 * The ground view: the act is read from a low oblique angle over the 3D ground, lit (in the
 * hillshade) from the north-west, so the camera looks north-east across the light. Relief is
 * exaggerated so a 2 m bank reads from the back row; the legend prints the factor.
 */
export const GROUND_PITCH = 60;
export const GROUND_BEARING = 35;
export const RELIEF_EXAGGERATION = 3;
/** How close the camera comes to a site's frame (3 km) and to a transect (a few hundred metres). */
export const FRAME_MAX_ZOOM = 16;
export const TRANSECT_MAX_ZOOM = 17;
/** The record marks vanish once the camera dives to a site. */
export const MARKS_MAX_ZOOM = 9;

/**
 * The record at rest: the eastern woodlands at dusk, not a globe in space. The camera stands low
 * over the southern Appalachians looking west-north-west across the Mississippi into the sunset,
 * the horizon in the frame with the last light on it; the continent's own relief is stood up and
 * lit by the low western sun, so the ridges and the valleys every site on the record sits in read
 * as landform. The satellite ground goes to a dark monochrome under it. (Looking west also keeps
 * the edge of the Web Mercator world, 85° N, out of a steep view; looking north it shows.) 65°, not
 * the first take's 70°: the record spreads deeper down the window and the far names shrink less;
 * at 1280x720 it names one more site (18 of 21 against 17).
 */
export const REST_PITCH = 65;
export const REST_BEARING = 290;
export const REST_EXAGGERATION = 6;
/** The rest view's names, in px as drawn (the Back Row Rule): the far ones are sized up to it. */
export const REST_LABEL_SIZE = 15;
/**
 * The rest view's left margin when the step column is down (it is, at rest): room for a name to
 * the left of the westmost dot, so the record spreads across the whole stage, not the right 3/4.
 */
export const REST_EDGE = 120;
/** The share of the window kept over the farthest site for the land running on to the horizon. */
export const REST_TOP_SHARE = 0.22;
/** The map allows the rest view's pitch (MapLibre's default ceiling is 60). */
export const MAX_PITCH = 75;
export const REST_SKY = {
  'sky-color': '#0f141b',
  'horizon-color': '#4d3427',
  'fog-color': '#1a1714',
  'sky-horizon-blend': 0.5,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.3,
  'atmosphere-blend': 0,
} as const;
/** No sky: what the other acts and the ground scene see. */
export const NO_SKY = {
  'sky-color': 'transparent',
  'horizon-color': 'transparent',
  'fog-color': 'transparent',
  'fog-ground-blend': 1,
  'atmosphere-blend': 0,
} as const;
/** The continental relief: a low sun from the west, a bone highlight, shadows to the dome. */
export const REST_LIGHT = { azimuth: 260, altitude: 28 };
export const REST_RELIEF_HIGHLIGHT = 'rgba(222, 204, 172, 0.5)';
/** How far the satellite ground recedes at rest: darker and greyer than under a finding. */
export const REST_BASEMAP = { brightness: 0.3, saturation: -1 };

/**
 * The light. A hillshade's hint names the DEM it was lit from; the stage serves that DEM as
 * terrain-RGB through TiTiler and lights it itself with MapLibre's hillshade layer (the GDAL
 * "basic" model, which takes the sun's height as well as its direction), so the sun is a
 * parameter. When the LiDAR lands the sun starts high, where the ground reads flat, sinks to a
 * raking angle so the walls stand up, then goes once round the earthwork and settles where the
 * baked product was lit (north-west, 315°); after that the presenter moves it from the light plate.
 * The baked hillshade raster under it is served as a flat grey sheet (its own COG, rescaled to one
 * value) so the live light reads on paper, not on satellite imagery.
 */
export const LIGHT_AZIMUTH = 315;
/** The raking sun the sweep settles at, in degrees above the horizon. */
export const LIGHT_ALTITUDE = 25;
/** Where the sweep starts: a high sun, the flat ground pale and the walls faint. */
export const LIGHT_HIGH = 50;
/**
 * The light plate's height control: 5° (long shadows) to 50° (a high sun). Higher than that the
 * flat ground goes nearly white, which on a dark stage is a flash, not a lesson.
 */
export const LIGHT_ALTITUDE_RANGE: [number, number] = [5, 50];
export const LIGHT_SWEEP_MS = 8000;
/** The share of the sweep the sun spends sinking before it goes round. */
export const LIGHT_SUNSET = 0.25;
export const LIGHT_EXAGGERATION = 1;
/** A grey sheet from the hillshade's own 1–255 values: a rescale so wide every pixel is mid-grey. */
export const PAPER_RESCALE: [number, number] = [-100000, 100000];
/** How long a terrain product takes to surface over the scene under it (the dissolve). */
export const REVEAL_MS = 1800;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * The light's azimuth at `t` in [0, 1] of the sweep: held while the sun sinks, then one full turn
 * from 315° back to 315°, eased.
 */
export function lightSweep(t: number, from: number = LIGHT_AZIMUTH): number {
  const x = clamp01((clamp01(t) - LIGHT_SUNSET) / (1 - LIGHT_SUNSET));
  return (from + 360 * easeInOut(x)) % 360;
}

/** The sun's height at `t`: from high to the raking angle over the first quarter, then held. */
export function lightAltitude(t: number, high: number = LIGHT_HIGH, low: number = LIGHT_ALTITUDE): number {
  const x = clamp01(clamp01(t) / LIGHT_SUNSET);
  return high + (low - high) * easeOut(x);
}

/** "north-west" for 315: the compass point the light comes from, for the legend and the plate. */
export function compassName(azimuth: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}

/** What the sun's height does to the ground, in the room's words. */
export function altitudeWords(altitude: number): string {
  if (altitude <= 15) return 'very low: long shadows';
  if (altitude <= 30) return 'low: walls stand up';
  if (altitude <= 40) return 'mid: shadows shorten';
  return 'high: the ground reads flat';
}

/**
 * The azimuth a point on the dial means. The dial is drawn as the room sees the map (rotated by
 * the camera's bearing, so the sun on the dial sits where the light comes from on screen): a
 * pointer `dx` px right and `dy` px down of the dial's centre is the light from that screen
 * direction, turned back to map north.
 */
export function dialAzimuth(dx: number, dy: number, bearing: number): number {
  if (dx === 0 && dy === 0) return ((bearing % 360) + 360) % 360;
  const screen = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((screen + bearing) % 360 + 360) % 360);
}

/** A keyboard step on the dial or the height: arrows by 5, Page keys by 45 (azimuth) or 15 (height). */
export function stepLight(value: number, key: string, kind: 'azimuth' | 'altitude'): number | null {
  const small = 5;
  const big = kind === 'azimuth' ? 45 : 15;
  const delta =
    key === 'ArrowRight' || key === 'ArrowUp' ? small
      : key === 'ArrowLeft' || key === 'ArrowDown' ? -small
        : key === 'PageUp' ? big
          : key === 'PageDown' ? -big
            : null;
  if (delta === null) return null;
  if (kind === 'azimuth') return (((value + delta) % 360) + 360) % 360;
  const [lo, hi] = LIGHT_ALTITUDE_RANGE;
  return Math.min(hi, Math.max(lo, value + delta));
}

/** TiTiler's terrain-RGB tiles for a presigned DEM: the source MapLibre lights and could stand up. */
export function demTilesUrl(titilerUrl: string, presignedDem: string): string {
  return `${titilerUrl}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(presignedDem)}&algorithm=terrarium`;
}

/**
 * The DEM a hillshade was lit from, by the tool's own file names: `show_terrain` writes
 * `terrain/hillshade_<site>.tif` and stages `terrain/dem_<site>.tif` beside it (a replay case keeps
 * both flat in its folder). The stage uses this when the model passed the hillshade's render hint
 * on without its `dem` (it copies the hint, and once in a while drops a key), and checks the file
 * is there before it trades the baked hillshade for the live light.
 */
export function companionDem(hillshadeUrl: string | undefined): string | null {
  const m = (hillshadeUrl || '').match(/^(s3:\/\/[^/]+\/(?:session_data\/[^/]+\/terrain|use-cases\/[^/]+))\/hillshade_([a-z0-9][a-z0-9-]{1,63})\.tif$/);
  if (!m) return null;
  const dem = `${m[1]}/dem_${m[2]}.tif`;
  return isStageDemUrl(dem) ? dem : null;
}

/** The hillshade product, as against the local relief model: only the hillshade gets a live light. */
export function isHillshadeHint(hint: RenderHint | null | undefined): boolean {
  return !!hint && hint.kind === 'raster' && hint.group === 'terrain' && hint.colormap === 'gray';
}

/**
 * The share of a terrain frame the camera lands on. Every frame is a 3 km square centred on the
 * site (scripts/build_site_catalogue.py); the earthwork itself is a few hundred metres to a
 * kilometre across, so the reveal frames the middle 1.2 km and the oblique view carries the rest
 * of the frame out towards the horizon.
 */
export const SITE_WINDOW = 0.4;

/** The central part of a frame, [west, south, east, north], for the camera to land on. */
export function siteWindow(
  bounds: [number, number, number, number], share: number = SITE_WINDOW,
): [number, number, number, number] {
  const [w, s, e, n] = bounds;
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const hw = ((e - w) / 2) * share, hh = ((n - s) / 2) * share;
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

function basenameOf(url: string | undefined): string {
  return (url || '').toLowerCase().split('/').pop() ?? '';
}

/** A session's `terrain/` folder, or an archaeologist replay case, which keeps its files flat. */
export function inTerrainTree(url: string | undefined): boolean {
  const u = (url || '').toLowerCase();
  return u.includes('/terrain/') || u.includes('/use-cases/archaeologist-');
}

/**
 * The style of a terrain raster: the agent's hint when it is a terrain raster hint, else the
 * tool default by file name (`hillshade_<site>.tif`, `lrm_<site>.tif`, `lrm03_<site>.tif`), else
 * null (not a terrain raster).
 */
export function terrainRasterHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  if (render && render.kind === 'raster' && render.group === 'terrain') return render;
  if (!inTerrainTree(url)) return null;
  const name = basenameOf(url);
  if (/^hillshade_.+\.tiff?$/.test(name)) return HILLSHADE;
  if (/^lrm03_.+\.tiff?$/.test(name)) return LOCAL_RELIEF_FINE;
  if (/^lrm_.+\.tiff?$/.test(name)) return LOCAL_RELIEF;
  return null;
}

/**
 * The style of a terrain GeoJSON layer: the agent's hint when it is a terrain hint of a vector
 * kind, else the tool default by file name (`profile_<site>.geojson`, `site_<site>.geojson`),
 * else null.
 */
export function terrainGeometryHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  if (render && render.kind !== 'raster' && render.group === 'terrain') return render;
  const name = basenameOf(url);
  if (!name.endsWith('.geojson')) return null;
  if (inTerrainTree(url) && name.startsWith('profile_')) return TRANSECT;
  const frame = /^site_[a-z0-9-]+\.geojson$/.test(name);
  if (frame && (inTerrainTree(url) || (url || '').toLowerCase().includes('/geometries/'))) return SITE_FRAME;
  return null;
}

/** A layer of the archaeologist's act, by its validated hint or the tools' file names; never by its title. */
export function isTerrainLayer(layer: { type: 'raster' | 'geometry'; url: string; render?: RenderHint }): boolean {
  return layer.type === 'raster'
    ? terrainRasterHint(layer.render, layer.url) !== null
    : terrainGeometryHint(layer.render, layer.url) !== null;
}

/** The legend a terrain raster reads by: the hillshade's key, or the relief ramp with its metres. */
export type TerrainLegend =
  | { kind: 'hillshade' }
  | { kind: 'relief'; lo: number; hi: number; units: string; label: string };

export function terrainLegend(hint: RenderHint | null | undefined): TerrainLegend | null {
  if (!hint || hint.kind !== 'raster') return null;
  if (hint.colormap === 'gray') return { kind: 'hillshade' };
  if (hint.colormap === 'rdbu_r' && hint.rescale) {
    return { kind: 'relief', lo: hint.rescale[0], hi: hint.rescale[1], units: hint.units ?? 'm', label: hint.legend ?? 'Local relief' };
  }
  return null;
}

/** "−1 m" / "+1 m": a signed metre value for the legend's ends, in the record's precision. */
export function signedMetres(value: number, units = 'm'): string {
  const digits = Math.abs(value) < 1 ? 1 : 0;
  const n = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return `${value < 0 ? '−' : '+'}${n} ${units}`;
}

type Feature = { properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null };

/** The transect's features by kind: the line, and the bank and ditch points the labels stand on. */
export function transectParts(features: Feature[]): { line: Feature | null; marks: Feature[] } {
  const line = features.find((f) => f?.geometry?.type === 'LineString') ?? null;
  const marks = features.filter(
    (f) => f?.geometry?.type === 'Point' && (f.properties?.kind === 'bank' || f.properties?.kind === 'ditch'),
  );
  return { line, marks };
}

/**
 * A site's name as the rest view prints it: the place, not the park. "Cahokia Mounds State
 * Historic Site" is "Cahokia Mounds", "Monumental Earthworks of Poverty Point" is "Poverty Point";
 * a continent of 28 names fits twice as many labels at half the width.
 */
export function shortSiteName(name: string): string {
  let s = (name || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^Monumental Earthworks of /, '').trim();
  const tails = [
    ' State Historic Site', ' National Historical Park', ' National Monument', ' Archeological State Park',
    ' Archaeological State Park', ' State Archaeological Park', ' Archaeological Park', ' Archaeological Center',
    ' State Park', ' & Nature Preserve',
  ];
  for (let changed = true; changed;) {
    changed = false;
    for (const t of tails) {
      if (s.endsWith(t) && s.length > t.length) {
        s = s.slice(0, -t.length).trim();
        changed = true;
      }
    }
  }
  return s || name;
}

type RecordFeature = { type?: string; properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null };

/** The World Heritage property a component belongs to: "Hopewell Ceremonial Earthworks", or null. */
export function heritageProperty(designation: unknown): string | null {
  const m = typeof designation === 'string' ? designation.match(/UNESCO World Heritage \(([^,()]+?),\s*\d{4}\)/) : null;
  return m ? m[1].trim() : null;
}

/**
 * The rest view's name labels: one per site under its short name, except that the components of
 * one World Heritage property on the record (the eight Hopewell Ceremonial Earthworks, within a
 * day's drive of each other in Ohio) share one label at their middle, "Hopewell Ceremonial
 * Earthworks, 8 sites", instead of eight names that collide into none. Every dot stays its own.
 * A site's own label sits on its dot (`group` false), so the same points keep the other names off
 * those dots; a shared label sits between its dots (`group` true) and keeps nothing out (keeping
 * the names off all eight Hopewell dots too costs Fort Hill's and Miamisburg's names, measured).
 * `size`, when set, is the text-size that lands the name at 15 px at the rest view's depth
 * (restCamera.ts sizeAtLeast).
 */
export interface RecordLabel {
  type: 'Feature';
  properties: { label: string; heritage: boolean; group: boolean; size?: number };
  geometry: { type: 'Point'; coordinates: [number, number] };
}
export function recordLabels(features: RecordFeature[]): { type: 'FeatureCollection'; features: RecordLabel[] } {
  const points = features.flatMap((f) => {
    const c = f?.geometry?.type === 'Point' ? (f.geometry.coordinates as number[]) : null;
    return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [{ f, c: [c[0], c[1]] as [number, number] }] : [];
  });
  const groups = new Map<string, Array<[number, number]>>();
  for (const { f, c } of points) {
    const prop = heritageProperty(f.properties?.designation);
    if (prop) groups.set(prop, [...(groups.get(prop) ?? []), c]);
  }
  const out: RecordLabel[] = [];
  for (const [prop, cs] of groups) {
    if (cs.length < 2) continue;
    const lon = cs.reduce((a, c) => a + c[0], 0) / cs.length;
    const lat = cs.reduce((a, c) => a + c[1], 0) / cs.length;
    out.push({ type: 'Feature', properties: { label: `${prop}, ${cs.length} sites`, heritage: true, group: true }, geometry: { type: 'Point', coordinates: [lon, lat] } });
  }
  for (const { f, c } of points) {
    const prop = heritageProperty(f.properties?.designation);
    if (prop && (groups.get(prop)?.length ?? 0) >= 2) continue;
    const name = typeof f.properties?.name === 'string' ? f.properties.name : '';
    if (!name) continue;
    out.push({ type: 'Feature', properties: { label: shortSiteName(name), heritage: f.properties?.world_heritage === true, group: false }, geometry: { type: 'Point', coordinates: c } });
  }
  return { type: 'FeatureCollection', features: out };
}

/** [west, south, east, north] of a point collection, or null when nothing is usable. */
export function marksBounds(features: Feature[]): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of features) {
    if (f?.geometry?.type !== 'Point') continue;
    const c = f.geometry.coordinates as number[];
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
  }
  return Number.isFinite(w) && w < e && s < n ? [w, s, e, n] : null;
}
