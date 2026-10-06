/**
 * The step column's grammar for an agentic mission: consecutive calls of one tool read as one
 * step ("Scan 7 watch areas"), the watch mission shows where it is on its plan
 * (Baseline · Tip · Cue · Brief), and the cue step says what it is following.
 *
 * Only tool INPUTS reach the UI over the stream, and they are model-written: nothing here prints
 * an input verbatim. Watch areas are printed only when they are one of the tool's own names;
 * coordinates only as numbers.
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
  site_history: (n) => (n > 1 ? `Check ${n} site histories` : 'Check the site history'),
  inspect_image: (n) => (n > 1 ? `Look at ${n} images` : 'Look at the image'),
  display_visual: (n) => (n > 1 ? `Put ${n} layers on the map` : 'Put it on the map'),
  reverse_geocode: (n) => (n > 1 ? `Name ${n} places` : 'Name the place'),
};

/** What the room reads for a step group. */
export function groupName(group: StepGroup): string {
  const n = group.calls.length;
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
export const WATCH_AREAS: readonly WatchArea[] = [
  { name: 'permian basin', label: 'Permian Basin, United States', short: 'Permian', centre: [-102.75, 32.0] },
  { name: 'south caspian', label: 'South Caspian, Turkmenistan', short: 'S. Caspian', centre: [57.25, 39.0] },
  { name: 'zagros foreland', label: 'Zagros foreland, Iran', short: 'Zagros', centre: [50.0, 31.25] },
  { name: 'shanxi coal basin', label: 'Shanxi coal basin, China', short: 'Shanxi', centre: [112.4, 37.65] },
  { name: 'orenburg and lower volga', label: 'Orenburg and lower Volga, Russia', short: 'Orenburg', centre: [50.25, 48.75] },
  { name: 'west siberia and yamal', label: 'West Siberia and Yamal, Russia', short: 'W. Siberia', centre: [72.5, 66.0] },
  { name: 'hassi messaoud', label: 'Hassi Messaoud, Algeria', short: 'Hassi Messaoud', centre: [6.0, 31.75] },
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

/**
 * Which cued site the agent followed: the one whose passes include the EMIT scene it then put on the
 * map or looked at (pass_<scene>.tif, columns_<scene>.geojson). Index into `cues`, or null before
 * the agent commits.
 */
export function chosenCue(cues: ToolCall[], framesByCue: Array<PassFrame[] | null>, later: ToolCall[]): number | null {
  const scenes = later
    .filter((t) => t.name === 'display_visual' || t.name === 'inspect_image')
    .map((t) => (typeof t.params?.s3_url === 'string' ? t.params.s3_url.match(SCENE_IN_URL)?.[1] : undefined))
    .filter((s): s is string => !!s);
  if (scenes.length === 0) return null;
  for (let i = 0; i < cues.length; i++) {
    const frames = framesByCue[i];
    if (frames?.some((f) => f.chipUrl && scenes.some((s) => f.chipUrl!.includes(s)))) return i;
  }
  return null;
}

function coord(value: unknown, digits: number): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}

/**
 * The line under a step: the watch areas a scan covered, or the point EMIT was cued on (with the
 * adapt line when a TROPOMI tip came first). Null when there is nothing safe to say.
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
  if (group.name === 'thermal_anomalies') {
    const nights = group.calls.map((c) => c.params?.nights).find((n) => typeof n === 'number' && n >= 1 && n <= 60);
    return { text: `VIIRS night-time heat, last ${typeof nights === 'number' ? nights : 30} nights` };
  }
  if (group.name === 'nearby_infrastructure') {
    const r = group.calls.map((c) => c.params?.radius_km).find((v) => typeof v === 'number' && v >= 0.5 && v <= 5);
    return { text: `Overture Maps, by type, within ${typeof r === 'number' ? r : 2} km` };
  }
  return null;
}

export const PLAN_STAGES = ['Baseline', 'Tip', 'Cue', 'Check', 'Brief'] as const;
const STAGE_OF: Record<string, number> = {
  watch_baseline: 0,
  scan_tropomi: 1,
  check_recent_passes: 2,
  site_history: 2,
  thermal_anomalies: 3,
  nearby_infrastructure: 3,
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
