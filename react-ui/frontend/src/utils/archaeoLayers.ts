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
