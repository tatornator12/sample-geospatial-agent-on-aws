/**
 * The step column's grammar for an agentic mission: consecutive calls of one tool read as one
 * step ("Scan 9 watch areas"), the watch mission shows where it is on its plan
 * (Baseline · Tip · Cue · Brief), and the cue step says what it is following.
 *
 * Only tool INPUTS reach the UI over the stream, and they are model-written: nothing here prints
 * an input verbatim. Watch areas are printed only when they are one of the tool's own names;
 * coordinates only as numbers; dates only as validated ISO days (YYYY-MM-DD that is a real
 * date); areas only computed from numeric inputs (a region's name is never printed).
 */
import type { ToolCall } from '../types.ts';
import { stepName } from './stageCopy.ts';

export interface StepGroup {
  /** The first call's id (stable React key and evidence anchor). */
  id: string;
  name: string;
  calls: ToolCall[];
  /** 1-based position of the first call in the turn. */
  first: number;
}

/** Consecutive calls of the same tool, as one step each. */
export function groupSteps(steps: ToolCall[]): StepGroup[] {
  const groups: StepGroup[] = [];
  steps.forEach((step, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === step.name) last.calls.push(step);
    else groups.push({ id: step.id || `${step.name}-${i + 1}`, name: step.name, calls: [step], first: i + 1 });
  });
  return groups;
}

const GROUP_NAMES: Record<string, (n: number) => string> = {
  scan_tropomi: (n) => (n > 1 ? `Scan ${n} watch areas` : 'Scan a watch area'),
  check_recent_passes: (n) => (n > 1 ? `Cue EMIT on ${n} sites` : 'Cue EMIT'),
  carbon_mapper_plumes: (n) => (n > 1 ? `Check Carbon Mapper on ${n} sites` : 'Check Carbon Mapper'),
  site_history: (n) => (n > 1 ? `Check ${n} site histories` : 'Check the site history'),
  inspect_image: (n) => (n > 1 ? `Look at ${n} images` : 'Look at the image'),
  display_visual: (n) => (n > 1 ? `Put ${n} layers on the map` : 'Put it on the map'),
  reverse_geocode: (n) => (n > 1 ? `Name ${n} places` : 'Name the place'),
  // The archaeologist's condition survey (calls of the agent's own, made after a look).
  record_condition: (n) => (n > 1 ? `Judge ${n} sites` : 'Judge what still shows'),
};

/** What the room reads for a step group. */
export function groupName(group: StepGroup): string {
  // A survey's verdicts count the sites judged: a refused verdict and its retry are one site.
  const sites = group.name === 'record_condition'
    ? new Set(group.calls.map((c) => c.params?.site_id).filter((s): s is string => typeof s === 'string')).size
    : 0;
  const n = sites || group.calls.length;
  const named = Object.prototype.hasOwnProperty.call(GROUP_NAMES, group.name) ? GROUP_NAMES[group.name] : undefined;
  if (named) return named(n);
  return n > 1 ? `${stepName(group.name)} ×${n}` : stepName(group.name);
}

/**
 * The watch areas, mirrored from the tool (agents/methane-hunter/watch_tools.py WATCH_AREAS): the
 * tool's own key, the label the stage prints (country included: the room may hear any of them),
 * a short form for the globe, and the area's centre. Nothing printed about an area comes from a
 * model-written string or a manifest's text; only its numbers are read.
 */
export interface WatchArea {
  name: string;
  label: string;
  short: string;
  centre: [number, number];
}
// Mirrors WATCH_AREAS in agents/methane-hunter/watch_tools.py (same keys; centres are the boxes'
// centres). The tool writes the tip manifests by key; the stage prints these labels, never the model's.
export const WATCH_AREAS: readonly WatchArea[] = [
  { name: 'permian basin', label: 'Permian Basin, United States', short: 'Permian', centre: [-102.75, 32.0] },
  { name: 'south caspian', label: 'South Caspian, Turkmenistan', short: 'S. Caspian', centre: [57.25, 39.0] },
  { name: 'amu darya basin', label: 'Amu Darya basin, Turkmenistan and Uzbekistan', short: 'Amu Darya', centre: [64.75, 38.75] },
  { name: 'zagros foreland', label: 'Zagros foreland, Iran', short: 'Zagros', centre: [50.0, 31.25] },
  { name: 'shanxi coal basin', label: 'Shanxi and Ordos coal basins, China', short: 'Shanxi', centre: [111.3, 37.65] },
  { name: 'orenburg and lower volga', label: 'Orenburg and lower Volga, Russia', short: 'Orenburg', centre: [50.25, 48.75] },
  { name: 'west siberia and yamal', label: 'West Siberia and Yamal, Russia', short: 'W. Siberia', centre: [72.5, 66.0] },
  { name: 'hassi messaoud', label: 'Hassi Messaoud and Berkine, Algeria', short: 'Hassi Messaoud', centre: [7.0, 30.25] },
  { name: 'amman', label: 'Amman, Jordan', short: 'Amman', centre: [36.1, 31.85] },
];
export const WATCH_AREA_NAMES = WATCH_AREAS.map((a) => a.name);

function knownArea(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return WATCH_AREA_NAMES.includes(v) ? v : null;
}

export function watchArea(name: string): WatchArea | undefined {
  return WATCH_AREAS.find((a) => a.name === name);
}

/** The tip manifest scan_tropomi wrote for this call (key from its `area`, spaces to underscores). */
export function tipManifestUrl(dir: string | null, call: ToolCall): string | null {
  if (!dir || call.name !== 'scan_tropomi') return null;
  const area = knownArea(call.params?.area);
  return area ? `${dir}tip_${area.replace(/ /g, '_')}.json` : null;
}

export interface Tip {
  area: WatchArea;
  /** The top hotspot's anomaly above the area's background, ppb; null when the scan found none. */
  anomalyPpb: number | null;
  validDays: number | null;
  emit: boolean;
  /** The top hotspot, where EMIT is cued. */
  point: [number, number] | null;
  end: string | null;
  days: number | null;
}

function num(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : null;
}

/** A tip, field by field from the manifest's numbers; the words come from WATCH_AREAS. Null when not a tip. */
export function parseTip(raw: unknown, areaName: string): Tip | null {
  const area = watchArea(areaName);
  if (!area || !raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.area !== areaName) return null;
  const top = r.top && typeof r.top === 'object' ? (r.top as Record<string, unknown>) : null;
  const lat = top ? num(top.lat, -90, 90) : null;
  const lon = top ? num(top.lon, -180, 180) : null;
  return {
    area,
    anomalyPpb: top ? num(top.anomaly_ppb, -1000, 1000) : null,
    validDays: top ? num(top.valid_days, 0, 60) : null,
    emit: r.emit_can_look === true,
    point: lat !== null && lon !== null ? [lon, lat] : null,
    end: typeof r.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.end) ? r.end : null,
    days: num(r.days, 1, 60),
  };
}

/** Tips strongest first; areas EMIT cannot look at keep their place (the board says so). */
export function rankTips(tips: Tip[]): Tip[] {
  return [...tips].sort((a, b) => (b.anomalyPpb ?? -Infinity) - (a.anomalyPpb ?? -Infinity));
}

/** Whether a tip's hotspot is one of the points EMIT was cued on this turn (same 2-decimal point). */
export function tipCued(tip: Tip, cues: ToolCall[]): boolean {
  if (!tip.point) return false;
  const [lon, lat] = tip.point;
  return cues.some((c) => coord(c.params?.lat, 2) === lat.toFixed(2) && coord(c.params?.lon, 2) === lon.toFixed(2));
}

const SCENE_IN_URL = /(EMIT_L2B_CH4ENH_002_\d{8}T\d{6}_\d{7}_\d{3})/;
const CM_POINT_IN_URL = /\/cmplumes_(-?\d{1,3}\.\d{4})_(-?\d{1,3}\.\d{4})\.geojson$/;

/**
 * Which cued site the agent followed: the one whose passes include the EMIT scene it then put on the
 * map or looked at (pass_<scene>.tif, columns_<scene>.geojson), or, for a site followed for Carbon
 * Mapper's plumes alone, the one whose Carbon Mapper points it put on the map
 * (cmplumes_<lat>_<lon>.geojson, the cue's own point). Index into `cues`, or null before the agent
 * commits.
 */
export function chosenCue(cues: ToolCall[], framesByCue: Array<PassFrame[] | null>, later: ToolCall[]): number | null {
  const looked = later.filter((t) => t.name === 'display_visual' || t.name === 'inspect_image');
  const urls = looked.map((t) => (typeof t.params?.s3_url === 'string' ? t.params.s3_url : '')).filter((u) => !!u);
  const scenes = urls.map((u) => u.match(SCENE_IN_URL)?.[1]).filter((s): s is string => !!s);
  for (let i = 0; i < cues.length; i++) {
    const frames = framesByCue[i];
    if (scenes.length > 0 && frames?.some((f) => f.chipUrl && scenes.some((s) => f.chipUrl!.includes(s)))) return i;
  }
  if (scenes.length > 0) return null;
  // At 2 decimals, as the board matches a tip to its cue (tipCued).
  const points = urls.map((u) => u.match(CM_POINT_IN_URL)).filter((m): m is RegExpMatchArray => !!m);
  for (let i = 0; i < cues.length; i++) {
    const lat = coord(cues[i].params?.lat, 2);
    const lon = coord(cues[i].params?.lon, 2);
    if (points.some((m) => coord(m[1], 2) === lat && coord(m[2], 2) === lon)) return i;
  }
  return null;
}

function coord(value: unknown, digits: number): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}

// Mirrors get_all_images_from_gdf's days_delta (geo_agent/utils/sentinel_utils.py:45): get_rasters
// searches the 60 days that END on current_date_str.
export const SCENE_WINDOW_DAYS = 60;
// Mirrors MAX_CHANGE_DETECTION_AREA_KM2 (geo_agent/config.py:430): run_change_detection works pixel
// by pixel up to this area; anything larger goes to scan_region_change's embedding grid.
export const PIXEL_LIMIT_KM2 = 5000;
const EARTH_RADIUS_KM = 6371.0088;

/** A model-written date as an ISO day, only when it is YYYY-MM-DD and a real date; else null. */
export function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
}

/** The ISO day `days` before a valid ISO day. */
export function dayMinus(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** The scenes the agent rejected (exclude_dates, a comma or semicolon separated string or a list): valid days only, sorted, at most 3. */
export function excludedDays(value: unknown): string[] {
  const parts = typeof value === 'string' ? value.split(/[,;]/) : Array.isArray(value) ? value : [];
  const days = parts.map(isoDay).filter((d): d is string => d !== null);
  return [...new Set(days)].sort().slice(0, 3);
}

/** A [west, south, east, north] box in degrees (a list of 4 numbers, or a JSON string of one) as km², or null. */
export function bboxAreaKm2(value: unknown): number | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [w, s, e, n] = v as number[];
  if (!(w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90)) return null;
  const rad = Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * (e - w) * rad * (Math.sin(n * rad) - Math.sin(s * rad));
}

/** An area for the room: two significant figures, grouped the British way ("9,500"). */
function areaText(km2: number): string {
  return Number(km2.toPrecision(2)).toLocaleString('en-GB');
}

function month(year: unknown, mon: unknown): string | null {
  return Number.isInteger(year) && Number.isInteger(mon) && (year as number) >= 2000 && (year as number) <= 2100 && (mon as number) >= 1 && (mon as number) <= 12
    ? `${year}-${String(mon).padStart(2, '0')}`
    : null;
}

/** "a", "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The AI Archaeologist's line (agents/ai-archaeologist/site_tools.py BEARINGS, same keys; pinned by
// tests/test_stage_mirror.py): the agent picks one of four bearings through the site's centre, and
// the stage prints its own label for it, never the model's string.
export const BEARING_LABELS: Readonly<Record<string, string>> = { 'n-s': 'N–S', 'ne-sw': 'NE–SW', 'e-w': 'E–W', 'nw-se': 'NW–SE' };
// The catalogue's sites with a stored verified transect (agents/ai-archaeologist/data/sites_v1.json):
// measured with no bearing, they are read on the record's line.
export const VERIFIED_TRANSECT_SITES: readonly string[] = ['newark-great-circle'];

/** Which line measure_profile read, from its last call's inputs: the agent's bearing, the record's line, or the default. */
function measureLine(group: StepGroup): { text: string } | null {
  const params = group.calls[group.calls.length - 1]?.params ?? {};
  const bearing = params.bearing;
  if (bearing === undefined || bearing === null) {
    return typeof params.site_id === 'string' && VERIFIED_TRANSECT_SITES.includes(params.site_id)
      ? { text: "The record's verified line" }
      : { text: 'E–W through the centre, the default line' };
  }
  const code = typeof bearing === 'string' ? bearing.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(BEARING_LABELS, code) ? { text: `${BEARING_LABELS[code]}, the agent's line` } : null;
}

/** The "skipping …" line: the scenes the agent inspected and turned down, across the group's calls. */
function skipping(group: StepGroup): { mono?: string } {
  const days = excludedDays(group.calls.flatMap((c) => excludedDays(c.params?.exclude_dates)));
  return days.length > 0 ? { mono: `skipping ${days.join(' · ')}` } : {};
}

/**
 * The line under a step: the watch areas a scan covered, or the point EMIT was cued on (with the
 * adapt line when a TROPOMI tip came first); for the Earth Analyst, the scene window and the scenes
 * it skipped, or the area that chose the embedding grid; for the AI Archaeologist, the line it
 * measured. Null when there is nothing safe to say.
 */
export function groupDetail(group: StepGroup, earlier: StepGroup[] = []): { text: string; mono?: string; points?: string[] } | null {
  if (group.name === 'scan_tropomi') {
    const areas = [...new Set(group.calls.map((c) => knownArea(c.params?.area)).filter((a): a is string => !!a))];
    return areas.length > 0 ? { text: areas.join(' · ') } : null;
  }
  if (group.name === 'check_recent_passes') {
    const points = group.calls
      .map((c) => [coord(c.params?.lat, 2), coord(c.params?.lon, 2)])
      .filter(([la, lo]) => la !== null && lo !== null)
      .map(([la, lo]) => `${la}, ${lo}`);
    // The cue follows the tip when a TROPOMI scan came earlier in the turn (the map update for the
    // tip rides in the same response, so it is not always the step right before).
    const tip = earlier.some((g) => g.name === 'scan_tropomi');
    const text = tip ? 'Following the TROPOMI tip' : 'Recent EMIT passes';
    return { text, ...(points.length > 0 ? { mono: points.join(' · '), points } : {}) };
  }
  if (group.name === 'carbon_mapper_plumes') {
    const r = group.calls.map((c) => c.params?.radius_km).find((v) => typeof v === 'number' && v >= 0.5 && v <= 10);
    return { text: `Carbon Mapper's public plumes, within ${typeof r === 'number' ? r : 5} km since 2025` };
  }
  if (group.name === 'thermal_anomalies') {
    const nights = group.calls.map((c) => c.params?.nights).find((n) => typeof n === 'number' && n >= 1 && n <= 60);
    return { text: `VIIRS night-time heat, last ${typeof nights === 'number' ? nights : 30} nights` };
  }
  if (group.name === 'nearby_infrastructure') {
    const r = group.calls.map((c) => c.params?.radius_km).find((v) => typeof v === 'number' && v >= 0.5 && v <= 5);
    return { text: `Overture Maps, by type, within ${typeof r === 'number' ? r : 2} km` };
  }
  if (group.name === 'registry_lookup') {
    const r = group.calls.map((c) => c.params?.radius_km).find((v) => typeof v === 'number' && v >= 0.5 && v <= 5);
    return { text: `OGIM public registry, operators of record, within ${typeof r === 'number' ? r : 2} km` };
  }
  // The Earth Analyst: the window it searched and the scenes it turned down, then the size of the
  // area that decided between the embedding grid and pixel-level change.
  if (group.name === 'get_rasters') {
    const ends = [...new Set(group.calls.map((c) => isoDay(c.params?.current_date_str)).filter((d): d is string => !!d))].sort();
    const text =
      ends.length === 1
        ? `Scenes from ${dayMinus(ends[0], SCENE_WINDOW_DAYS)} to ${ends[0]}`
        : ends.length > 3
          ? `Scenes in the ${SCENE_WINDOW_DAYS} days to each of ${ends.length} dates`
          : ends.length > 1
            ? `Scenes in the ${SCENE_WINDOW_DAYS} days to ${listed(ends)}`
            : `Scenes from the last ${SCENE_WINDOW_DAYS} days`;
    return { text, ...skipping(group) };
  }
  if (group.name === 'get_rasters_for_dates') {
    const pair = group.calls
      .map((c) => [isoDay(c.params?.date1_str), isoDay(c.params?.date2_str)])
      .find(([a, b]) => a !== null && b !== null);
    const text = pair ? `Two ${SCENE_WINDOW_DAYS}-day windows, to ${pair[0]} and to ${pair[1]}` : `Two ${SCENE_WINDOW_DAYS}-day windows`;
    return { text, ...skipping(group) };
  }
  if (group.name === 'scan_region_change') {
    const area = group.calls.map((c) => bboxAreaKm2(c.params?.bbox)).find((a): a is number => a !== null);
    const text =
      area === undefined
        ? 'A whole region, on the embedding grid'
        : area > PIXEL_LIMIT_KM2
          ? `About ${areaText(area)} km², so an embedding scan`
          : `About ${areaText(area)} km², scanned on the embedding grid`;
    const months = group.calls
      .map((c) => [month(c.params?.year1, c.params?.month1), month(c.params?.year2, c.params?.month2)])
      .find(([a, b]) => a !== null && b !== null);
    return { text, ...(months ? { mono: `${months[0]} · ${months[1]}` } : {}) };
  }
  if (group.name === 'run_change_detection') {
    const dates = group.calls
      .map((c) => [isoDay(c.params?.date1_str), isoDay(c.params?.date2_str)])
      .find(([a, b]) => a !== null && b !== null);
    return {
      text: `Pixel by pixel, for areas up to ${PIXEL_LIMIT_KM2.toLocaleString('en-GB')} km²`,
      ...(dates ? { mono: `${dates[0]} · ${dates[1]}` } : {}),
    };
  }
  // The AI Archaeologist: the line it measured, its own bearing or the record's line.
  if (group.name === 'measure_profile') return measureLine(group);
  // Its similar sites come from the record's words, not the LiDAR: the room reads that once, here.
  if (group.name === 'find_similar_sites') return { text: "Matched on the public record's descriptions" };
  return null;
}

export const PLAN_STAGES = ['Baseline', 'Tip', 'Cue', 'Check', 'Brief'] as const;
const STAGE_OF: Record<string, number> = {
  watch_baseline: 0,
  scan_tropomi: 1,
  check_recent_passes: 2,
  site_history: 2,
  // Carbon Mapper is part of choosing where to look (the plan's "3 cue EMIT and check Carbon Mapper").
  carbon_mapper_plumes: 2,
  thermal_anomalies: 3,
  nearby_infrastructure: 3,
  registry_lookup: 3,
  draft_brief: 4,
  brief_status: 4,
};

/** The furthest stage of the watch plan this turn reached, or null when this is not a watch turn. */
export function planStage(steps: ToolCall[]): number | null {
  let stage: number | null = null;
  for (const s of steps) {
    const at = Object.prototype.hasOwnProperty.call(STAGE_OF, s.name) ? STAGE_OF[s.name] : undefined;
    if (at !== undefined && (stage === null || at > stage)) stage = at;
  }
  return stage;
}

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const CASE_DIR = /^(s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/use-cases\/([a-z0-9-]{1,64})\/[^/]+$/;
const SESSION_DIR = /^(s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/session_data\/([A-Za-z0-9._-]{1,128})\//;

/**
 * Where this session's (or replay case's) methane files live, from any s3_url a tool was given:
 * `s3://b/session_data/<sid>/methane/` for a live session (only THIS session's id), or
 * `s3://b/use-cases/<id>/` for a replay case, which keeps its files flat. Null when unknown.
 */
export function methaneDirFrom(tools: ToolCall[], sessionId?: string): string | null {
  for (const t of tools) {
    const url = t.params?.s3_url;
    if (typeof url !== 'string') continue;
    const replay = url.match(CASE_DIR);
    if (replay) return `${replay[1]}/use-cases/${replay[2]}/`;
    const live = url.match(SESSION_DIR);
    if (live && sessionId && SESSION_ID.test(sessionId) && live[2] === sessionId) {
      return `${live[1]}/session_data/${sessionId}/methane/`;
    }
  }
  return null;
}

/** The filmstrip manifest check_recent_passes wrote for this call (key from its lat/lon, 4 decimals). */
export function passManifestUrl(dir: string | null, call: ToolCall): string | null {
  if (!dir || call.name !== 'check_recent_passes') return null;
  const lat = coord(call.params?.lat, 4);
  const lon = coord(call.params?.lon, 4);
  if (lat === null || lon === null) return null;
  return `${dir}passes_${lat}_${lon}.json`;
}

/** Carbon Mapper's record carbon_mapper_plumes wrote for this call (key from its lat/lon, 4 decimals). */
export function cmPlumesUrl(dir: string | null, call: ToolCall): string | null {
  if (!dir || call.name !== 'carbon_mapper_plumes') return null;
  const lat = coord(call.params?.lat, 4);
  const lon = coord(call.params?.lon, 4);
  if (lat === null || lon === null) return null;
  return `${dir}cmplumes_${lat}_${lon}.json`;
}

export type CmInstrument = 'tanager' | 'emit' | 'airborne' | 'other';
const CM_INSTRUMENTS: readonly CmInstrument[] = ['tanager', 'emit', 'airborne', 'other'];

/** Carbon Mapper's plumes near a cued site, as the tool counted them: numbers, dates and a code only. */
export interface CmPlumes {
  /** The cued point the record is for, [lon, lat]. */
  point: [number, number];
  radiusKm: number;
  since: string;
  count: number;
  /** The newest plume's date, YYYY-MM-DD; null when there is none. */
  latest: string | null;
  /** Carbon Mapper's estimate for that plume, kg/h; null when none is published. */
  rateKgH: number | null;
  instrument: CmInstrument | null;
  /** The catalogue could not be read and nothing was cached: the board says so (no numbers, no source). */
  unavailable: boolean;
}

/** The record, field by field; null when it is not one (a count or a radius out of range, a bad date). */
export function parseCmPlumes(raw: unknown): CmPlumes | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = num(r.lat, -90, 90);
  const lon = num(r.lon, -180, 180);
  const radiusKm = num(r.radius_km, 0.5, 10);
  const since = isoDay(r.since);
  if (lat === null || lon === null || radiusKm === null || !since) return null;
  if (r.status === 'unavailable') {
    return { point: [lon, lat], radiusKm, since, count: 0, latest: null, rateKgH: null, instrument: null, unavailable: true };
  }
  const count = typeof r.count === 'number' && Number.isInteger(r.count) && r.count >= 0 && r.count <= 10_000 ? r.count : null;
  if (count === null) return null;
  const latest = count > 0 ? isoDay(r.latest) : null;
  if (count > 0 && !latest) return null;
  const instrument = (CM_INSTRUMENTS as readonly unknown[]).includes(r.instrument) ? (r.instrument as CmInstrument) : null;
  return {
    point: [lon, lat], radiusKm, since, count, latest, rateKgH: count > 0 ? num(r.rate_kg_h, 0, 1_000_000) : null, instrument,
    unavailable: false,
  };
}

/** "Carbon Mapper: 45 plumes · latest 2026-06-20 · ~270 kg/h"; "Carbon Mapper: no plumes within 5 km". */
export function cmLineText(c: CmPlumes): string {
  if (c.unavailable) return 'Carbon Mapper: could not be checked';
  if (c.count === 0) return `Carbon Mapper: no plumes within ${c.radiusKm} km`;
  const rate = c.rateKgH !== null ? ` · ~${(Math.round(c.rateKgH / 10) * 10).toLocaleString('en-US')} kg/h` : '';
  return `Carbon Mapper: ${c.count} ${c.count === 1 ? 'plume' : 'plumes'} · latest ${c.latest}${rate}`;
}

export type PassShort = 'candidate' | 'too weak' | 'within noise' | 'cloud or gap' | 'error';
const SHORTS: readonly PassShort[] = ['candidate', 'too weak', 'within noise', 'cloud or gap', 'error'];

export interface PassFrame {
  date: string;
  verdict: 'candidate' | 'rejected' | 'error';
  short: PassShort;
  reason: string | null;
  peak: number | null;
  chipUrl: string | null;
}

const CHIP = /^passchip_[A-Za-z0-9_.-]{1,120}\.png$/;

/** The manifest's passes, validated field by field (at most 12); null when it is not a manifest. */
export function parseManifest(raw: unknown, dir: string): PassFrame[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { passes?: unknown }).passes)) return null;
  const frames: PassFrame[] = [];
  for (const p of (raw as { passes: unknown[] }).passes.slice(0, 12)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const verdict = r.verdict === 'candidate' || r.verdict === 'rejected' || r.verdict === 'error' ? r.verdict : null;
    if (!date || !verdict) continue;
    const short = (SHORTS as readonly unknown[]).includes(r.short) ? (r.short as PassShort) : verdict === 'candidate' ? 'candidate' : 'error';
    const reason = typeof r.reason === 'string' && r.reason.length <= 200 ? r.reason : null;
    const peak = typeof r.peak_ppm_m === 'number' && Number.isFinite(r.peak_ppm_m) ? r.peak_ppm_m : null;
    const chipUrl = typeof r.chip === 'string' && CHIP.test(r.chip) ? `${dir}${r.chip}` : null;
    frames.push({ date, verdict, short, reason, peak, chipUrl });
  }
  return frames;
}

/**
 * The reason for the choice, per cued site: candidate passes out of the passes read, and the newest
 * candidate's date (the tie-break: methane_config.py W4). Counted from the manifest's validated
 * frames, so it matches the filmstrip; the date prints only as a real ISO day.
 */
export interface CueTally {
  candidates: number;
  read: number;
  /** The newest candidate pass, YYYY-MM-DD; null when there is none. */
  latest: string | null;
}

export function cueTally(frames: PassFrame[]): CueTally {
  const days = frames
    .filter((f) => f.verdict === 'candidate')
    .map((f) => isoDay(f.date))
    .filter((d): d is string => d !== null)
    .sort();
  return {
    candidates: frames.filter((f) => f.verdict === 'candidate').length,
    read: frames.length,
    latest: days.length > 0 ? days[days.length - 1] : null,
  };
}

/** "2 of 4 candidate passes · latest 2026-04-25", "0 of 4 candidate passes", "1 of 1 candidate pass". */
export function cueTallyText(t: CueTally): string {
  const noun = t.read === 1 ? 'candidate pass' : 'candidate passes';
  return `${t.candidates} of ${t.read} ${noun}${t.latest ? ` · latest ${t.latest}` : ''}`;
}

/**
 * The cue step's filmstrips in the mission's end frame: every cued site stays, the one the agent
 * followed with its frames and the others as their summary line only (the end frame is already
 * taller than the column, act2 review P1-2). While working, in the full list, or before the agent
 * commits, every strip is whole.
 */
export function endFrameFilms<T extends { call: ToolCall }>(
  films: T[],
  chosenCall: ToolCall | null,
  collapsed: boolean
): Array<T & { summaryOnly: boolean }> {
  return films.map((f) => ({ ...f, summaryOnly: collapsed && chosenCall !== null && f.call !== chosenCall }));
}

/** "2 candidates · 1 too weak · 1 cloud or gap": the filmstrip in words, candidates first. */
export function filmstripSummary(frames: PassFrame[]): string {
  const counts = new Map<PassShort, number>();
  frames.forEach((f) => counts.set(f.short, (counts.get(f.short) ?? 0) + 1));
  return SHORTS.filter((s) => counts.has(s))
    .map((s) => {
      const n = counts.get(s)!;
      return s === 'candidate' ? `${n} candidate${n === 1 ? '' : 's'}` : `${n} ${s}`;
    })
    .join(' · ');
}
