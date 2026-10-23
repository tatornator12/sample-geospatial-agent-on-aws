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
/** The tip bars (follow_site's tipcolumns_<lat>_<lon>.geojson): this fortnight's TROPOMI cells around the
 *  followed site, ppb on the ice ramp, 40 m of bar per ppb (watch_tools.TIP_METRES_PER_PPB). */
export const METHANE_TIP_COLUMNS: RenderHint = {
  kind: 'columns', property: 'ppb', ramp: 'ice', rescale: [0, 140], units: 'ppb', group: 'methane', legend: 'CH4 anomaly',
  height_scale: 40,
};
/** The record bars from Carbon Mapper's own plume image (cmcolumns_<plume_id>.geojson), ppm·m like EMIT's. */
export const METHANE_CM_COLUMNS: RenderHint = {
  kind: 'columns', property: 'ppm_m', ramp: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane', legend: 'Carbon Mapper plume',
};
/** Carbon Mapper's plumes near the followed site (carbon_mapper_plumes' cmplumes_<lat>_<lon>.geojson). */
export const METHANE_DETECTIONS: RenderHint = {
  kind: 'detections', group: 'methane', property: 'rate_kg_h', units: 'kg/h', legend: 'Carbon Mapper plumes',
};
/** Carbon Mapper's licence asks for this wherever its data shows (board, legend, brief card). */
export const CARBON_MAPPER_SOURCE = 'Source: Carbon Mapper (data.carbonmapper.org)';
/** The legend's key for Carbon Mapper's plume rings. */
export const DETECTIONS_ROW = 'Carbon Mapper plume, 2025 on';
/** The rings' colour: mint, clear of plasma (EMIT), ice (TROPOMI) and fog (NASA's sites). */
export const DETECTIONS_COLOUR = '#6fe0b8';

/** The TROPOMI ppb ramp: cool (navy to pale cyan), never plasma's dark-purple-to-yellow family. */
export const TROPOMI_RAMP = 'ice' as const;
export const METHANE_TROPOMI: RenderHint = {
  kind: 'raster', colormap: TROPOMI_RAMP, rescale: [0, 60], units: 'ppb', group: 'methane', legend: 'CH4 anomaly', max_zoom: 8,
};
/** A ~4 km TROPOMI cell must never fill the screen over the EMIT finding and the ground. */
export const TROPOMI_MAX_ZOOM = 8;

/**
 * The style of a methane raster. The agent's hint wins, except that a TROPOMI composite
 * (`tropomi_anomaly_*.tif` in a methane folder) always carries a zoom cap and the TROPOMI ramp:
 * an older or model-trimmed hint must not wall off the finding, and a recording or runtime from
 * before the ramp change (viridis) must not read as plasma's twin. Without a hint, the tool
 * default by file name; null for anything that is not a methane raster file.
 */
export function methaneRasterHint(render: RenderHint | undefined, url: string | undefined): RenderHint | null {
  const name = basenameOf(url);
  const tropomi = inMethaneTree(url) && /^tropomi_anomaly_.+\.tiff?$/.test(name);
  if (render) {
    return tropomi ? { ...render, colormap: TROPOMI_RAMP, max_zoom: render.max_zoom ?? TROPOMI_MAX_ZOOM } : render;
  }
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
  if (name.startsWith('tipcolumns_')) return METHANE_TIP_COLUMNS;
  if (name.startsWith('cmcolumns_')) return METHANE_CM_COLUMNS;
  if (name.startsWith('cmplumes_')) return METHANE_DETECTIONS;
  return null;
}

export interface LegendRamp {
  ramp: ColormapName;
  lo: number;
  hi: number;
  units: string;
  /** What the ramp measures, e.g. "EMIT methane above background" (methaneRampLabel). */
  label: string;
}

export interface MethaneLegend {
  /** One row per distinct ramp and units, in the order the layers arrived. */
  ramps: LegendRamp[];
  /** A watch baseline is on the map: explain the dots and rings. */
  sites: boolean;
}

/** What an EMIT ramp (ppm·m: a plume, a pass window, footprints, columns) measures, in the room's words. */
export const EMIT_RAMP_LABEL = 'EMIT methane above background';
/** The watch baseline's row: NASA's EMIT plume product runs from 2022-08 to 2025-09-22. */
export const WATCH_SITES_ROW = 'NASA EMIT plume sites, 2022 to 2025';
/** The legend's line under the ramp while the 3D columns are on the stage. */
export const COLUMNS_NOTE = 'taller column, more methane';
/** The tip bars' line in the legend: their height is TROPOMI's anomaly over the area's median. */
export const TIP_COLUMNS_NOTE = 'taller bar, more methane in the air than usual';

/**
 * A methane ramp's name, by its units, never the tools' shorthand ("CH4 enhancement", "CH4
 * anomaly") or the model's words: ppm·m is EMIT's enhancement over its background; ppb is the
 * TROPOMI composite's anomaly over the area's median, with its days read from the composite's own
 * file name (`tropomi_anomaly_<area>_<end>_<N>d.tif`) when it carries them (A2 P1-4).
 */
export function methaneRampLabel(units: string, legend?: string, url?: string): string {
  if (units === 'ppm·m') return EMIT_RAMP_LABEL;
  if (units === 'ppb') {
    const days = Number(basenameOf(url).match(/^tropomi_anomaly_.+_(\d{1,2})d\.tiff?$/)?.[1]);
    return Number.isInteger(days) && days >= 1 && days <= 60
      ? `TROPOMI, ${days} days, above the area median`
      : 'TROPOMI, above the area median';
  }
  return legend ?? 'CH4';
}

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
    if (hint.kind === 'detections') continue;   // a key of its own (layerStack), never a ramp
    const ramp = hint.colormap ?? hint.ramp;
    if (!ramp || !hint.rescale) continue;
    const units = hint.units ?? 'ppm·m';
    if (ramps.some((r) => r.ramp === ramp && r.units === units)) continue;
    ramps.push({ ramp, lo: hint.rescale[0], hi: hint.rescale[1], units, label: methaneRampLabel(units, hint.legend) });
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

/** [west, south, east, north] of every finite position in a geometry's coordinates, or null. */
function coordsBox(coordinates: unknown): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        w = Math.min(w, c[0]);
        e = Math.max(e, c[0]);
        s = Math.min(s, c[1]);
        n = Math.max(n, c[1]);
      }
      return;
    }
    c.forEach(walk);
  };
  walk(coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

function finiteProp(f: Feature, key: string): number | null {
  const v = Number(f?.properties?.[key]);
  return f?.properties?.[key] !== undefined && f?.properties?.[key] !== null && Number.isFinite(v) ? v : null;
}

/**
 * Where a footprint's rank label stands: on its east edge at its centre's latitude, so "#1 8,130.7
 * ppm·m" sits beside the plume, not across it (A2 P1-6). Null without a usable outline.
 */
export function labelPointOutside(feature: Feature): [number, number] | null {
  const box = coordsBox(feature?.geometry?.coordinates);
  if (!box) return null;
  const lat = finiteProp(feature, 'center_lat');
  return [box[2], lat !== null && lat >= box[1] && lat <= box[3] ? lat : (box[1] + box[3]) / 2];
}

/** The widest a frame of ranked footprints may span, degrees of longitude, before it frames fewer. */
export const FOOTPRINT_FRAME_MAX_LON = 90;

/**
 * Where the camera goes for a ranked set of footprints (A2 P1-7): the whole set when it spans at
 * most 90° of longitude (a basin, a region); else ranks 1 to 3 when they do; else rank 1's centre
 * at zoom 5. "The strongest plume ever, anywhere" runs from Utah to New South Wales, whose box is
 * centred on Africa; the room should land on rank 1, not the Sahara. Null without footprints.
 */
export function footprintFrame(
  features: Feature[]
): { bounds: [number, number, number, number] } | { center: [number, number]; zoom: number } | null {
  const boxes = features
    .map((f) => ({ f, box: coordsBox(f?.geometry?.coordinates), rank: finiteProp(f, 'rank') }))
    .filter((x): x is { f: Feature; box: [number, number, number, number]; rank: number | null } => x.box !== null);
  if (boxes.length === 0) return null;
  const union = (list: typeof boxes): [number, number, number, number] => [
    Math.min(...list.map((x) => x.box[0])),
    Math.min(...list.map((x) => x.box[1])),
    Math.max(...list.map((x) => x.box[2])),
    Math.max(...list.map((x) => x.box[3])),
  ];
  const all = union(boxes);
  if (all[2] - all[0] <= FOOTPRINT_FRAME_MAX_LON) return { bounds: all };
  const ranked = [...boxes].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const top = union(ranked.slice(0, 3));
  if (top[2] - top[0] <= FOOTPRINT_FRAME_MAX_LON) return { bounds: top };
  const first = ranked[0];
  const lon = finiteProp(first.f, 'center_lon');
  const lat = finiteProp(first.f, 'center_lat');
  return {
    center: lon !== null && lat !== null ? [lon, lat] : [(first.box[0] + first.box[2]) / 2, (first.box[1] + first.box[3]) / 2],
    zoom: 5,
  };
}

/** An ISO date (YYYY-MM-DD) from a feature property, or "n/a"; popups print nothing else. */
export function isoDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : 'n/a';
}

/** Carbon Mapper's instrument codes (carbon_mapper.py INSTRUMENT_WORDS) in the room's words. */
export const CM_INSTRUMENT_WORDS: Record<string, string> = {
  tanager: 'Tanager-1',
  emit: 'EMIT',
  airborne: 'airborne',
  other: 'another instrument',
};

/** A rate as the room hears it: to the nearest 10 kg/h, with thousands separators. */
export function aboutKgH(value: number): string {
  return (Math.round(value / 10) * 10).toLocaleString('en-US');
}

/**
 * The popup a Carbon Mapper ring opens (MapView's detections layer): built only from
 * detectionPopupRows' date, fixed word and rate, and the source line, so nothing from the feature
 * reaches the HTML as written.
 */
export function detectionPopupHtml(p: Record<string, unknown>): string {
  const rows = detectionPopupRows(p);
  return (
    `<strong>Carbon Mapper plume, ${rows.date}</strong>` +
    `<div class="similar-popup__row"><span>Seen by</span><code>${rows.instrument}</code></div>` +
    `<div class="similar-popup__row"><span>Carbon Mapper's estimate</span><code>${rows.rate}</code></div>` +
    `<div class="similar-popup__row"><span>${CARBON_MAPPER_SOURCE}</span></div>`
  );
}

/** A Carbon Mapper plume's popup, from its feature's properties: only a date, a rate and a fixed word. */
export function detectionPopupRows(p: Record<string, unknown>): { date: string; instrument: string; rate: string } {
  const rate = typeof p.rate_kg_h === 'number' && Number.isFinite(p.rate_kg_h) && p.rate_kg_h >= 0 ? p.rate_kg_h : null;
  const code = typeof p.instrument === 'string' && Object.prototype.hasOwnProperty.call(CM_INSTRUMENT_WORDS, p.instrument) ? p.instrument : null;
  return {
    date: isoDay(p.date),
    instrument: code ? CM_INSTRUMENT_WORDS[code] : 'n/a',
    rate: rate === null ? 'not published' : `about ${aboutKgH(rate)} kg/h`,
  };
}
