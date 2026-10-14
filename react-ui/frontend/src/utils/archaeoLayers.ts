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
import type { RenderHint } from './render.ts';

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
 * the edge of the Web Mercator world, 85° N, out of a 70° view; looking north it shows.)
 */
export const REST_PITCH = 70;
export const REST_BEARING = 290;
export const REST_EXAGGERATION = 6;
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
