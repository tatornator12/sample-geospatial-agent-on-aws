/**
 * Methane Watch on the map: which style a methane layer gets, the legend rows the layers
 * plate shows, and where the globe turns to. Pure functions, so the map's choices are testable
 * without WebGL.
 *
 * Every hint here has already passed `parseRenderHint` (utils/render.ts); the defaults below are
 * the tools' own values (agents/methane-hunter/watch_tools.py), used when a layer arrived without
 * a valid hint and is recognised by its file name instead.
 */
import type { ColormapName, RenderHint } from './render.ts';

export const METHANE_RASTER: RenderHint = { kind: 'raster', colormap: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane' };
export const METHANE_VECTOR: RenderHint = {
  kind: 'vector', ramp: 'plasma', property: 'max_ppm_m', rescale: [0, 1500], units: 'ppm·m', group: 'methane', label: 'rank',
};
export const METHANE_SITES: RenderHint = { kind: 'points', group: 'watch', property: 'repeat_dates', label: 'repeat_dates', units: 'dates' };
export const METHANE_COLUMNS: RenderHint = {
  kind: 'columns', property: 'ppm_m', ramp: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane', legend: 'CH4 enhancement',
};

export const METHANE_TROPOMI: RenderHint = {
  kind: 'raster', colormap: 'viridis', rescale: [0, 60], units: 'ppb', group: 'methane', legend: 'CH4 anomaly', max_zoom: 8,
};
/** A ~4 km TROPOMI cell must never fill the screen over the EMIT finding and the ground. */
export const TROPOMI_MAX_ZOOM = 8;

/**
 * The style of a methane raster. The agent's hint wins, except that a TROPOMI composite
 * (`tropomi_anomaly_*.tif` in a methane folder) always carries a zoom cap: an older or
 * model-trimmed hint must not wall off the finding. Without a hint, the tool default by file
 * name; null for anything that is not a methane raster file.
 */
export function methaneRasterHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  const name = basenameOf(url);
  const tropomi = inMethaneTree(url) && /^tropomi_anomaly_.+\.tiff?$/.test(name);
  if (render) return tropomi && render.max_zoom === undefined ? { ...render, max_zoom: TROPOMI_MAX_ZOOM } : render;
  if (tropomi) return METHANE_TROPOMI;
  if (/^ch4plm_.+\.tiff?$/.test(name) || (inMethaneTree(url) && /^pass_.+\.tiff?$/.test(name))) return METHANE_RASTER;
  return null;
}

/** Metres of column per ppm·m: 9,000 ppm·m stands ~2.3 km tall over a 60 m cell, readable at a 55° tilt. */
export const COLUMN_METRES_PER_PPM_M = 0.25;

function basenameOf(url: string | undefined): string {
  return (url || '').toLowerCase().split('/').pop() ?? '';
}

function inMethaneTree(url: string | undefined): boolean {
  const u = (url || '').toLowerCase();
  return u.includes('/methane/') || u.includes('/use-cases/methane-');
}

/**
 * The style of a methane GeoJSON layer: the agent's hint when it is a methane or watch hint of
 * a vector kind, else the tool default picked by file name, else null (not a methane layer).
 */
export function methaneGeometryHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  if (render && render.kind !== 'raster' && (render.group === 'methane' || render.group === 'watch')) return render;
  if (!inMethaneTree(url)) return null;
  const name = basenameOf(url);
  if (!name.endsWith('.geojson')) return null;
  if (name.startsWith('plumes_')) return METHANE_VECTOR;
  if (name.startsWith('watch_sites_')) return METHANE_SITES;
  if (name.startsWith('columns_')) return METHANE_COLUMNS;
  return null;
}

export interface LegendRamp {
  ramp: ColormapName;
  lo: number;
  hi: number;
  units: string;
  /** What the ramp measures, e.g. "CH4 enhancement" or "CH4 anomaly". */
  label: string;
}

export interface MethaneLegend {
  /** One row per distinct ramp and units, in the order the layers arrived. */
  ramps: LegendRamp[];
  /** A watch baseline is on the map: explain the dots and rings. */
  sites: boolean;
}

const DEFAULT_LABEL: Record<string, string> = { 'ppm·m': 'CH4 enhancement', ppb: 'CH4 anomaly' };

/** The legend rows for the layers in the Methane group: plasma ppm·m and viridis ppb never share a bar. */
export function methaneLegend(hints: Array<RenderHint | undefined>): MethaneLegend {
  const ramps: LegendRamp[] = [];
  let sites = false;
  for (const hint of hints) {
    if (!hint) continue;
    if (hint.kind === 'points') {
      sites = true;
      continue;
    }
    const ramp = hint.colormap ?? hint.ramp;
    if (!ramp || !hint.rescale) continue;
    const units = hint.units ?? 'ppm·m';
    if (ramps.some((r) => r.ramp === ramp && r.units === units)) continue;
    ramps.push({ ramp, lo: hint.rescale[0], hi: hint.rescale[1], units, label: hint.legend ?? DEFAULT_LABEL[units] ?? 'CH4' });
  }
  return { ramps, sites };
}

type Feature = { properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null };

/**
 * Where the globe faces when the watch baseline lands: the circular mean longitude and the mean
 * latitude of the watch areas' centres (the polygons with `tier: 'watch_area'`), or of every
 * site when there are no areas. Null when nothing usable is in the collection.
 */
export function globeCentre(features: Feature[]): [number, number] | null {
  const centres: Array<[number, number]> = [];
  const areas = features.filter((f) => f?.properties?.tier === 'watch_area' && f.geometry?.type === 'Polygon');
  const pool = areas.length > 0 ? areas : features.filter((f) => f?.geometry?.type === 'Point');
  for (const f of pool) {
    const g = f.geometry!;
    const ring = g.type === 'Polygon' ? ((g.coordinates as number[][][])[0] ?? []) : [g.coordinates as number[]];
    const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length === 0) continue;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    centres.push([(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]);
  }
  if (centres.length === 0) return null;
  const rad = Math.PI / 180;
  const x = centres.reduce((s, [lon]) => s + Math.cos(lon * rad), 0);
  const y = centres.reduce((s, [lon]) => s + Math.sin(lon * rad), 0);
  const lon = Math.hypot(x, y) < 1e-9 ? centres[0][0] : Math.atan2(y, x) / rad;
  const lat = centres.reduce((s, [, la]) => s + la, 0) / centres.length;
  return [Math.round(lon * 100) / 100, Math.round(Math.max(-60, Math.min(60, lat)) * 100) / 100];
}

/** An ISO date (YYYY-MM-DD) from a feature property, or "n/a"; popups print nothing else. */
export function isoDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : 'n/a';
}
