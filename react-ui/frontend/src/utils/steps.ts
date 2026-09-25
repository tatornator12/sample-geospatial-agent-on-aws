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
};

/** What the room reads for a step group. */
export function groupName(group: StepGroup): string {
  const n = group.calls.length;
  const named = Object.prototype.hasOwnProperty.call(GROUP_NAMES, group.name) ? GROUP_NAMES[group.name] : undefined;
  if (named) return named(n);
  return n > 1 ? `${stepName(group.name)} ×${n}` : stepName(group.name);
}

/** The tool's own watch-area names (agents/methane-hunter/watch_tools.py WATCH_AREAS). */
export const WATCH_AREA_NAMES = [
  'permian basin',
  'south caspian',
  'zagros foreland',
  'shanxi coal basin',
  'orenburg and lower volga',
  'west siberia and yamal',
  'hassi messaoud',
] as const;

function knownArea(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (WATCH_AREA_NAMES as readonly string[]).includes(v) ? v : null;
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
  return null;
}

export const PLAN_STAGES = ['Baseline', 'Tip', 'Cue', 'Brief'] as const;
const STAGE_OF: Record<string, number> = {
  watch_baseline: 0,
  scan_tropomi: 1,
  check_recent_passes: 2,
  site_history: 2,
  draft_brief: 3,
  brief_status: 3,
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
