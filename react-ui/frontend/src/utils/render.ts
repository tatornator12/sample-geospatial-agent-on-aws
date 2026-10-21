/**
 * `render` hints: how an agent says a layer should look.
 *
 * An agent passes `render` inside its `display_visual` tool input (the Methane Hunter's tools
 * build it; the model copies it). It is model-written, and it reaches tile URLs, MapLibre
 * expressions and the DOM, so it is validated against allowlists here: a known kind, colormap
 * and group; a numeric rescale with lo < hi; a lon/lat box; property names as plain
 * identifiers; short labels with only safe characters. Any field that fails drops the whole
 * hint (null), and the layer falls back to today's file-name styling, so the map never goes
 * blank and nothing unvalidated is ever used.
 */

/** raster: a COG through TiTiler; vector: graduated outlines; points: site dots and repeat rings;
 * columns: 3D cells extruded by a numeric property. */
export type RenderKind = 'raster' | 'vector' | 'points' | 'columns';
export const RENDER_KINDS: readonly RenderKind[] = ['raster', 'vector', 'points', 'columns'];

// `gray` and `rdbu_r` are the AI Archaeologist's terrain products (a hillshade, a local relief model).
export const COLORMAPS = ['plasma', 'viridis', 'magma', 'ice', 'rdylgn', 'rdylgn_r', 'blues', 'spectral', 'gray', 'rdbu_r'] as const;
export type ColormapName = (typeof COLORMAPS)[number];

// `maritime` is Dark Vessels' (Act 3): the radar, its targets, the coverage, the forecast. The stage
// styles those by the tools' file names (utils/vesselLayers.ts); the group only says whose they are.
export const RENDER_GROUPS = ['methane', 'watch', 'change', 'similar', 'imagery', 'index', 'boundary', 'terrain', 'maritime'] as const;
export type RenderGroup = (typeof RENDER_GROUPS)[number];

export interface RenderHint {
  kind: RenderKind;
  /** Raster colormap (TiTiler colormap_name). */
  colormap?: ColormapName;
  /** Vector ramp for the graduated outline. */
  ramp?: ColormapName;
  rescale?: [number, number];
  units?: string;
  group?: RenderGroup;
  legend?: string;
  /** Vector: the numeric feature property the ramp is driven by. */
  property?: string;
  /** Vector: the feature property shown as the label (e.g. `rank`). */
  label?: string;
  /** [west, south, east, north] in degrees: where the camera goes when the layer lands. */
  bounds?: [number, number, number, number];
  /** The layer is hidden above this zoom (a coarse raster must not fill the screen). */
  max_zoom?: number;
  /** Raster: the DEM a hillshade was lit from (an s3:// COG in the session or a replay case), so the stage can light it live. */
  dem?: string;
}

// The DEM rides in the session's terrain folder (show_terrain's copy) or flat in a replay case;
// the backend's presign allowlist agrees (s3Access.ts). Nothing else is ever fetched from a hint.
const DEM_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(session_data\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/terrain|use-cases\/[A-Za-z0-9][A-Za-z0-9._-]{0,127})\/dem_[a-z0-9][a-z0-9-]{1,63}\.tif$/;

/** A DEM the stage may presign and light: the session's terrain folder or a replay case, `dem_<site>.tif`. */
export function isStageDemUrl(url: unknown): url is string {
  return typeof url === 'string' && DEM_URL.test(url);
}

const TEXT_MAX = 24;
const SAFE_TEXT = /^[\w ·°%/.-]+$/u;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,31}$/;

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TEXT_MAX && SAFE_TEXT.test(trimmed) ? trimmed : null;
}

function finitePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lo, hi] = value;
  if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo < hi ? [lo, hi] : null;
}

function lonLatBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [w, s, e, n] = value as number[];
  const inRange = w >= -180 && e <= 180 && s >= -90 && n <= 90;
  return inRange && w < e && s < n ? [w, s, e, n] : null;
}

/** A validated hint, or null when the input is absent or any field fails. Accepts an object or its JSON string. */
export function parseRenderHint(input: unknown): RenderHint | null {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > 2000) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isOneOf(RENDER_KINDS, r.kind)) return null;
  const hint: RenderHint = { kind: r.kind };

  // Each optional field: absent is fine; present and invalid rejects the hint.
  if (r.colormap !== undefined) {
    if (!isOneOf(COLORMAPS, r.colormap)) return null;
    hint.colormap = r.colormap;
  }
  if (r.ramp !== undefined) {
    if (!isOneOf(COLORMAPS, r.ramp)) return null;
    hint.ramp = r.ramp;
  }
  if (r.rescale !== undefined) {
    const pair = finitePair(r.rescale);
    if (!pair) return null;
    hint.rescale = pair;
  }
  if (r.group !== undefined) {
    if (!isOneOf(RENDER_GROUPS, r.group)) return null;
    hint.group = r.group;
  }
  for (const key of ['units', 'legend'] as const) {
    if (r[key] === undefined) continue;
    const text = safeText(r[key]);
    if (!text) return null;
    hint[key] = text;
  }
  for (const key of ['property', 'label'] as const) {
    if (r[key] === undefined) continue;
    const value = r[key];
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) return null;
    hint[key] = value;
  }
  if (r.max_zoom !== undefined) {
    if (typeof r.max_zoom !== 'number' || !Number.isFinite(r.max_zoom) || r.max_zoom < 0 || r.max_zoom > 22) return null;
    hint.max_zoom = r.max_zoom;
  }
  if (r.bounds !== undefined) {
    const box = lonLatBox(r.bounds);
    if (!box) return null;
    hint.bounds = box;
  }
  if (r.dem !== undefined) {
    if (typeof r.dem !== 'string' || !DEM_URL.test(r.dem)) return null;
    hint.dem = r.dem;
  }
  return hint;
}

/** TiTiler query parameters for a single-band raster hint, or null when the hint does not set a colormap. */
export function tileParamsFor(hint: RenderHint | null | undefined): string | null {
  if (!hint || hint.kind !== 'raster' || !hint.colormap) return null;
  const params = ['bidx=1'];
  if (hint.rescale) params.push(`rescale=${hint.rescale[0]},${hint.rescale[1]}`);
  params.push(`colormap_name=${hint.colormap}`);
  return params.join('&');
}

/** Colour anchors (low to high) for the ramps the map can draw; matplotlib's values at 0, ¼, ½, ¾, 1. */
export const RAMP_ANCHORS: Partial<Record<ColormapName, string[]>> = {
  plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
  // cmocean "ice" as TiTiler draws it (its colorMaps/ice entries 0, 64, 128, 191, 255): the cool
  // TROPOMI ppb ramp, read against plasma's hot ppm·m.
  ice: ['#030512', '#383874', '#427ab7', '#79bdd0', '#eafcfd'],
  rdylgn: ['#a50026', '#f46d43', '#ffffbf', '#66bd63', '#006837'],
  rdylgn_r: ['#006837', '#66bd63', '#ffffbf', '#f46d43', '#a50026'],
  blues: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  spectral: ['#9e0142', '#f46d43', '#ffffbf', '#66c2a5', '#5e4fa2'],
  // The archaeologist's terrain, as TiTiler draws them (its colorMaps entries 0, 64, 128, 191, 255):
  // a hillshade's greys, and ColorBrewer RdBu reversed for the local relief (ditch blue, bank red).
  gray: ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'],
  rdbu_r: ['#053061', '#6bacd0', '#f7f6f6', '#e58368', '#67001f'],
};

/**
 * The Earth Analyst's index legends: what TiTiler draws for a raster the map recognises by its
 * file name (the same rules as the tile URLs in MapView), so the stage can show the ramp it is
 * looking at. Null for true-colour and anything unknown.
 */
export interface IndexLegend {
  label: string;
  ramp: ColormapName;
  lo: number;
  hi: number;
  /** What the two ends mean, in words, for the back row. */
  low: string;
  high: string;
}
export function indexLegendFor(url: string): IndexLegend | null {
  const u = (url || '').toLowerCase();
  if (u.includes('change_detection') || u.includes('change-detection')) {
    return { label: 'Change', ramp: 'rdylgn_r', lo: 0, hi: 0.5, low: 'no change', high: 'most change' };
  }
  // "no vegetation", not "bare": water and roofs read low too (Central Park's Reservoir, A1 P1-6).
  if (u.includes('ndvi_') || u.includes('ndvi-')) return { label: 'NDVI', ramp: 'rdylgn', lo: 0, hi: 1, low: 'no vegetation', high: 'dense vegetation' };
  if (u.includes('ndwi_') || u.includes('ndwi-')) return { label: 'NDWI', ramp: 'blues', lo: -1, hi: 1, low: 'dry', high: 'open water' };
  if (u.includes('nbr_') || u.includes('nbr-') || u.includes('/nbr.')) {
    // Raw NBR is not burn severity (that needs a before and after): low is burnt or bare ground.
    return { label: 'NBR', ramp: 'spectral', lo: -1, hi: 1, low: 'burnt or bare', high: 'healthy vegetation' };
  }
  return null;
}

/** A MapLibre `interpolate` colour expression over `property` from lo to hi with the ramp's anchors. */
export function rampExpression(ramp: ColormapName, property: string, lo: number, hi: number): unknown[] | null {
  const anchors = RAMP_ANCHORS[ramp];
  if (!anchors || !IDENTIFIER.test(property) || !(lo < hi)) return null;
  const stops = anchors.flatMap((colour, i) => [lo + ((hi - lo) * i) / (anchors.length - 1), colour]);
  return ['interpolate', ['linear'], ['to-number', ['get', property], lo], ...stops];
}

/** CSS gradient for a legend ramp bar. */
export function rampGradient(ramp: ColormapName | undefined): string | null {
  const anchors = ramp ? RAMP_ANCHORS[ramp] : undefined;
  if (!anchors) return null;
  return `linear-gradient(90deg, ${anchors.map((c, i) => `${c} ${(i * 100) / (anchors.length - 1)}%`).join(', ')})`;
}
