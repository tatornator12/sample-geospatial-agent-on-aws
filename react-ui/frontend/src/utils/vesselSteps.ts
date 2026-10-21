/**
 * Dark Vessels' step column (Act 3, the one open question; redesign §3.8.1): the grammar that turns
 * the turn's tool calls into the steps the room reads, the pass board's rows and states, and the
 * one line under a step for each accepted decision and each check.
 *
 * The map calls are not steps: a `display_visual` folds into the step whose file it shows, and a
 * chip inspection into the evidence step. A `decide` call is not a step either: its line sits under
 * the step the decision leads to. Nothing the model wrote reaches the stage: every line is worded
 * here from the enum values and numbers in the files the tools wrote (the board, one decision file
 * per accepted call, the coverage file), and a refused decision writes no file, so it shows no line.
 * No candidate count shows before the map has revealed that pass's candidates (R4.2).
 *
 * Pure, so all of it is tested on synthetic streams; StepColumn loads the files and renders it.
 */
import type { ToolCall } from '../types.ts';
import { groupName, type StepGroup } from './steps.ts';
import { passDay, passOf, vesselKind, type VesselKind } from './vesselLayers.ts';

// --- the grammar -----------------------------------------------------------------------------------

/** The act's own tools (agents/dark-vessels/dark_vessels.py LOCAL_TOOLS, less the shared ones). */
export const VESSEL_TOOLS: readonly string[] = [
  'list_passes', 'decide', 'find_pass', 'detect_vessels', 'check_ais_coverage', 'match_ais', 'gather_evidence',
  'predict_hotspots', 'next_look', 'draft_tasking', 'tasking_status', 'reachable_area', 'fleet_pattern',
];

/** StepColumn reads a turn with this grammar when it called any of the act's tools. */
export function isVesselTurn(tools: readonly ToolCall[]): boolean {
  return tools.some((t) => VESSEL_TOOLS.includes(t.name));
}

/** A step, with the map calls and chip inspections folded into it (they render under it, never as rows). */
export interface VesselGroup extends StepGroup {
  folded: ToolCall[];
}

/** The step a file kind's `display_visual` folds into: the first tool listed that has run, latest first. */
const FOLDS_INTO: Record<VesselKind, readonly string[]> = {
  radar: ['find_pass'],
  // The targets fold into the match once it has run for them, else into the detection.
  targets: ['match_ais', 'detect_vessels'],
  heard: ['check_ais_coverage'],
  unproven: ['check_ais_coverage'],
  heat: ['predict_hotspots'],
  boxes: ['predict_hotspots'],
  look: ['next_look'],
  reach: ['reachable_area'],
  fleet: ['fleet_pattern'],
};

const urlOf = (call: ToolCall): string | undefined => (typeof call.params?.s3_url === 'string' ? call.params.s3_url : undefined);
const isChip = (call: ToolCall) => call.name === 'inspect_image' && /\/chips\/[^/]+$/.test(urlOf(call) ?? '');

/** The latest group (by its first call) of any of `names`, among groups that started before `at`. */
function latestOf(groups: readonly VesselGroup[], names: readonly string[], at: number): VesselGroup | null {
  let best: VesselGroup | null = null;
  for (const g of groups) if (names.includes(g.name) && g.first - 1 < at && (!best || g.first > best.first)) best = g;
  return best;
}

/**
 * The turn's steps: consecutive calls of one tool are one step, `decide` is no step, and a
 * `display_visual` (by its file's kind) or a chip inspection folds into its step. A map call with
 * nothing to fold into stays a step, as on the other acts. The clean path is 10 steps.
 */
export function vesselGroups(tools: readonly ToolCall[]): VesselGroup[] {
  const groups: VesselGroup[] = [];
  let last: VesselGroup | null = null;
  tools.forEach((call, i) => {
    if (call.name === 'decide') return;
    const kind = call.name === 'display_visual' ? vesselKind(urlOf(call)) : null;
    const into = kind ? latestOf(groups, FOLDS_INTO[kind], i) : isChip(call) ? latestOf(groups, ['gather_evidence'], i) : null;
    if (into) {
      into.folded.push(call);
      return;
    }
    if (last && last.name === call.name) {
      last.calls.push(call);
      return;
    }
    last = { id: call.id || `${call.name}-${i + 1}`, name: call.name, calls: [call], folded: [], first: i + 1 };
    groups.push(last);
  });
  return groups;
}

/** What the room reads for a step: the radar's own look is "Look at the radar"; the rest as on every act. */
export function vesselGroupName(group: VesselGroup): string {
  return group.name === 'inspect_image' ? 'Look at the radar' : groupName(group);
}

// --- where the files are ---------------------------------------------------------------------------

export const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const CASE_ID = /^vessels-[a-z0-9-]{1,56}$/;
const CASE_DIR = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/use-cases\/(vessels-[a-z0-9-]{1,56})\/(?:[A-Za-z0-9._-]+\/)?[^/]+$/;
const SESSION_DIR = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/session_data\/([A-Za-z0-9._-]{1,128})\/vessels\//;

/** The rest file's bucket when it is a bucket name (else null: the column waits for a streamed s3_url). */
export function validBucket(value: unknown): string | null {
  return typeof value === 'string' && BUCKET_RE.test(value) ? value : null;
}

/**
 * Where this session's (or replay case's) vessel files live: from any streamed s3_url, the case
 * folder or THIS session's `vessels/` folder (another session's id is never followed). Before any
 * URL has streamed, `s3://<bucket>/use-cases/<caseId>/` in a replay or
 * `s3://<bucket>/session_data/<sessionId>/vessels/` live, from the rest file's bucket, so the board
 * can load before the radar. Null when neither is known.
 */
export function vesselsDirFrom(
  tools: readonly ToolCall[],
  sessionId: string | undefined,
  fallback: { bucket?: string | null; caseId?: string | null } = {},
): string | null {
  const sid = sessionId && SESSION_ID.test(sessionId) ? sessionId : null;
  for (const t of tools) {
    const url = urlOf(t);
    if (!url) continue;
    const replay = url.match(CASE_DIR);
    if (replay) return `s3://${replay[1]}/use-cases/${replay[2]}/`;
    const live = url.match(SESSION_DIR);
    if (live && sid && live[2] === sid) return `s3://${live[1]}/session_data/${sid}/vessels/`;
  }
  const bucket = validBucket(fallback.bucket);
  if (!bucket) return null;
  if (fallback.caseId) return CASE_ID.test(fallback.caseId) ? `s3://${bucket}/use-cases/${fallback.caseId}/` : null;
  return sid ? `s3://${bucket}/session_data/${sid}/vessels/` : null;
}

/**
 * How the tools name the board and the decision files (vessel_store.DECISION_KEYS): "call" by the
 * call's own tool-use id, "inputs" (the unbuilt fallback) by the call's validated inputs.
 */
export type DecisionKeys = 'call' | 'inputs';
export const DECISION_KEYS: DecisionKeys = 'call';
export const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const QUESTION_ID_RE = /^[0-9a-f]{12}$/;
const PASS_ID_RE = /^s1[a-d]-\d{8}t\d{4}$/;

/** The board file for this turn's latest list_passes call: passes_<id>.json, or passes_on_file.json. */
export function boardUrl(dir: string | null, tools: readonly ToolCall[], mode: DecisionKeys = DECISION_KEYS): string | null {
  const call = [...tools].reverse().find((t) => t.name === 'list_passes');
  if (!dir || !call) return null;
  if (mode === 'inputs') return `${dir}passes_on_file.json`;
  return TOOL_USE_ID_RE.test(call.id) ? `${dir}passes_${call.id}.json` : null;
}

// --- the decisions ---------------------------------------------------------------------------------

export type DecideStep = 'read_pass' | 'forecast' | 'draft' | 'stop';

/** Every (step, because) pair decide accepts (agents/dark-vessels/decide_tools.py PAIRS). */
export const DECIDE_PAIRS: Readonly<Record<DecideStep, readonly string[]>> = {
  read_pass: ['newest', 'widest', 'newest_wide', 'coverage_thin', 'no_candidates', 'asked'],
  forecast: ['coverage_thin', 'no_candidates'],
  draft: ['most_past_targets', 'soonest_look', 'near_candidates', 'only_planned_look'],
  stop: ['no_checked_pass'],
};

function pair(step: unknown, because: unknown): { step: DecideStep; because: string } | null {
  if (typeof step !== 'string' || typeof because !== 'string' || !Object.prototype.hasOwnProperty.call(DECIDE_PAIRS, step)) return null;
  return DECIDE_PAIRS[step as DecideStep].includes(because) ? { step: step as DecideStep, because } : null;
}

const validPass = (v: unknown): v is string => typeof v === 'string' && PASS_ID_RE.test(v) && passDay(v) !== null;
const validBox = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3;
const validPct = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;

/** The decision file for a streamed decide call: by its id ("call"), or by its validated inputs ("inputs"). */
export function decisionUrl(dir: string | null, questionId: string | null, call: ToolCall, mode: DecisionKeys = DECISION_KEYS): string | null {
  if (!dir || !questionId || !QUESTION_ID_RE.test(questionId) || call.name !== 'decide') return null;
  if (mode === 'call') return TOOL_USE_ID_RE.test(call.id) ? `${dir}decision_${questionId}_${call.id}.json` : null;
  const p = pair(call.params?.step, call.params?.because);
  if (!p) return null;
  const subject = p.step === 'read_pass' ? call.params?.pass_id : p.step === 'draft' ? call.params?.box : 'none';
  if (p.step === 'read_pass' && !validPass(subject)) return null;
  if (p.step === 'draft' && !validBox(subject)) return null;
  return `${dir}decision_${questionId}_${p.step}_${p.because}_${subject}.json`;
}

/** next_look's own words for a look ("S1-D Oct 24 00:17 UTC"), the only text a line takes from a file. */
const LOOK_TEXT = /^S1-[A-D] (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2} \d{2}:\d{2} UTC$/;

/** An accepted decision, field by field from its file; the facts are only the ones its line needs. */
export interface Decision {
  questionId: string;
  toolUseId: string | null;
  /** The tool's order of acceptance in the question (null when absent). */
  n: number | null;
  step: DecideStep;
  because: string;
  /** The pass read, the box drafted, or "none". */
  subject: string | number;
  facts: {
    imaged?: number;
    from?: string;
    checkable?: number;
    share?: number;
    look?: string;
    near?: number;
    passes?: Array<{ passId: string; checkable: number }>;
    standard?: number;
  };
}

/** A decision file, validated against its pair's own facts; null when it is not one this stage can word. */
export function parseDecision(raw: unknown): Decision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p = pair(r.step, r.because);
  const f = r.facts && typeof r.facts === 'object' ? (r.facts as Record<string, unknown>) : null;
  if (!p || !f || typeof r.question_id !== 'string' || !QUESTION_ID_RE.test(r.question_id)) return null;
  const toolUseId = typeof r.tool_use_id === 'string' && TOOL_USE_ID_RE.test(r.tool_use_id) ? r.tool_use_id : null;
  if (r.tool_use_id !== undefined && toolUseId === null) return null;
  const base = { questionId: r.question_id, toolUseId, n: Number.isInteger(r.n) ? (r.n as number) : null, ...p };
  const { because } = p;
  if (p.step === 'read_pass') {
    if (!validPass(r.subject) || (f.pass_id !== undefined && f.pass_id !== r.subject)) return null;
    if (because === 'coverage_thin' || because === 'no_candidates') {
      return validPass(f.from) && validPct(f.checkable_pct) ? { ...base, subject: r.subject, facts: { from: f.from, checkable: f.checkable_pct } } : null;
    }
    return validPct(f.imaged_pct) ? { ...base, subject: r.subject, facts: { imaged: f.imaged_pct } } : null;
  }
  if (p.step === 'forecast') {
    if (r.subject !== 'none' || !validPass(f.from) || !validPct(f.checkable_pct)) return null;
    return { ...base, subject: 'none', facts: { from: f.from, checkable: f.checkable_pct } };
  }
  if (p.step === 'draft') {
    if (!validBox(r.subject) || (f.box !== undefined && f.box !== r.subject)) return null;
    if (because === 'most_past_targets') return validPct(f.share_pct) ? { ...base, subject: r.subject, facts: { share: f.share_pct } } : null;
    if (because === 'soonest_look') return typeof f.look === 'string' && LOOK_TEXT.test(f.look) ? { ...base, subject: r.subject, facts: { look: f.look } } : null;
    if (because === 'near_candidates') {
      const near = f.candidates_near;
      return Number.isInteger(near) && (near as number) >= 1 && (near as number) <= 99 ? { ...base, subject: r.subject, facts: { near: near as number } } : null;
    }
    return { ...base, subject: r.subject, facts: {} };
  }
  // stop: every pass read, with what it could check, and the standard.
  const passes = Array.isArray(f.passes) ? f.passes : [];
  const read = passes.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .filter((x) => validPass(x.pass_id) && validPct(x.checkable_pct))
    .map((x) => ({ passId: x.pass_id as string, checkable: x.checkable_pct as number }));
  if (r.subject !== 'none' || read.length < 1 || read.length > 2 || read.length !== passes.length || !validPct(f.standard_pct)) return null;
  return { ...base, subject: 'none', facts: { passes: read, standard: f.standard_pct } };
}

// --- the lines -------------------------------------------------------------------------------------

/** "Decided:" for a choice (fog), "Checked:" for a rule outcome (label grey). */
export interface StepLine {
  label: 'Decided:' | 'Checked:';
  text: string;
}

/** Every line, label and sentence together, is at most this long (100 characters fill 4 lines at 1280). */
export const MAX_LINE_CHARS = 100;

/** The line an accepted decision prints, from its file's enum values and numbers; `stop` records a rule outcome. */
export function decisionLine(d: Decision): StepLine | null {
  const f = d.facts;
  const date = typeof d.subject === 'string' ? passDay(d.subject) : null;
  const from = f.from ? passDay(f.from) : null;
  const k = d.subject;
  const decided = (text: string): StepLine => ({ label: 'Decided:', text });
  switch (`${d.step}/${d.because}`) {
    case 'read_pass/newest': return decided(`Reading ${date}: the newest pass on file. It saw ${f.imaged}% of the reserve.`);
    case 'read_pass/widest': return decided(`Reading ${date}: of the passes on file, it saw the most of the reserve, ${f.imaged}%.`);
    case 'read_pass/newest_wide': return decided(`Reading ${date}: the newest pass that saw over half the reserve (${f.imaged}%).`);
    case 'read_pass/coverage_thin': return decided(`Set ${from} aside: it can check only ${f.checkable}% of the reserve. Reading ${date}.`);
    case 'read_pass/no_candidates': return decided(`No candidates on ${from} in the ${f.checkable}% it could check. Reading ${date} too.`);
    case 'read_pass/asked': return decided(`Reading ${date}, as asked. It saw ${f.imaged}% of the reserve.`);
    case 'forecast/coverage_thin': return decided(`Set ${from} aside: it can check only ${f.checkable}%. Going to where to look next.`);
    case 'forecast/no_candidates': return decided(`No candidates on ${from} in the ${f.checkable}% it could check. Going to where to look next.`);
    case 'draft/most_past_targets': return decided(`Drafting box ${k}: it held the most past dark targets, ${f.share}%.`);
    case 'draft/soonest_look': return decided(`Drafting box ${k}: its radar look comes first, ${f.look}.`);
    case 'draft/near_candidates': return decided(`Drafting box ${k}: ${f.near} of the candidates lie in or near it.`);
    case 'draft/only_planned_look': return decided(`Drafting box ${k}: the only box with a radar look planned.`);
    case 'stop/no_checked_pass': {
      const [a, b] = f.passes ?? [];
      if (!a) return null;
      return {
        label: 'Checked:',
        text: b
          ? `${passDay(a.passId)} and ${passDay(b.passId)} can check only ${a.checkable}% and ${b.checkable}%. No tasking can be drafted.`
          : `${passDay(a.passId)} can check only ${a.checkable}%, under the ${f.standard}% standard. No tasking can be drafted.`,
      };
    }
  }
  return null;
}

/**
 * The reveal wait (R4.2, review M2): a line that carries a candidate count for a pass waits until the
 * map has revealed that pass's candidates. The two `no_candidates` lines wait for their `from` pass;
 * `near_candidates` for the pass last read (the pass whose candidates the boxes counted).
 */
export function decisionWaits(d: Decision, revealed: Readonly<Record<string, number>>, lastRead: string | null): boolean {
  const shown = (pass: string | null | undefined) => !!pass && Object.prototype.hasOwnProperty.call(revealed, pass);
  if (d.because === 'no_candidates') return !shown(d.facts.from);
  if (d.because === 'near_candidates') return !shown(lastRead);
  return false;
}

/** The coverage check's numbers, from the received area's feature (check_ais_coverage writes them). */
export interface CoverageCheck {
  checkable: number;
  standard: number;
}

const share = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** A heard_<pass>.geojson as the coverage check's numbers; null when it carries no checkable share. */
export function parseHeard(raw: unknown): CoverageCheck | null {
  const features = raw && typeof raw === 'object' ? (raw as { features?: unknown }).features : null;
  const props = Array.isArray(features) && features[0] && typeof features[0] === 'object'
    ? ((features[0] as { properties?: unknown }).properties as Record<string, unknown> | null | undefined)
    : null;
  if (!props || !share(props.checkable) || !share(props.standard)) return null;
  return { checkable: props.checkable, standard: props.standard };
}

/** The coverage check against the standard, worded from the tool's own shares. */
export function coverageLine(c: CoverageCheck): StepLine {
  const pct = Math.round(c.checkable * 100);
  const floor = Math.round(c.standard * 100);
  return {
    label: 'Checked:',
    text: c.checkable < c.standard
      ? `This pass can check only ${pct}% of the reserve, under the ${floor}% standard.`
      : `This pass can check ${pct}% of the reserve, over the ${floor}% standard.`,
  };
}

/** The candidates the map revealed for a pass (the count is the map's, from its reveal). */
export function candidatesLine(n: number): StepLine {
  if (n === 0) return { label: 'Checked:', text: 'No candidates where AIS was received.' };
  return { label: 'Checked:', text: `${n} ${n === 1 ? 'candidate' : 'candidates'} where AIS was received, seen by both detectors.` };
}

// --- the board -------------------------------------------------------------------------------------

/** One pass on file, as the board shows it. */
export interface BoardRow {
  passId: string;
  /** "Oct 12" (passDay). */
  day: string;
  /** "S1D". */
  satellite: string;
  /** The share of the reserve the pass imaged, 0 to 1. */
  imaged: number;
  sensedMs: number;
}

/** The board file (list_passes' copy for the stage), validated field by field. */
export interface Board {
  questionId: string;
  startedAtMs: number;
  decisionKeys: DecisionKeys;
  rows: BoardRow[];
}

export const BOARD_MAX_ROWS = 12;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]00:00)$/;
const SATELLITE = /^(?:Sentinel-1|S1)([A-D])$/;

function isoMs(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_TIME.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * The board: its question, when it started, and at most 12 passes, newest first. A row with a field
 * that is not what the tool writes (the id, the ISO time, the satellite S1A to S1D, a share from 0
 * to 1) is left out; null when nothing is left or the file is not a board.
 */
export function parseBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const startedAtMs = isoMs(r.started_at);
  const decisionKeys = r.decision_keys === 'inputs' ? 'inputs' : r.decision_keys === 'call' ? 'call' : null;
  if (typeof r.question_id !== 'string' || !QUESTION_ID_RE.test(r.question_id) || startedAtMs === null || !decisionKeys || !Array.isArray(r.passes)) return null;
  const rows: BoardRow[] = [];
  for (const p of r.passes.slice(0, BOARD_MAX_ROWS)) {
    if (!p || typeof p !== 'object') continue;
    const x = p as Record<string, unknown>;
    const sensedMs = isoMs(x.sensed);
    const sat = typeof x.satellite === 'string' ? x.satellite.match(SATELLITE) : null;
    if (!validPass(x.pass_id) || sensedMs === null || !sat || !share(x.imaged_share)) continue;
    rows.push({ passId: x.pass_id, day: passDay(x.pass_id)!, satellite: `S1${sat[1]}`, imaged: x.imaged_share, sensedMs });
  }
  rows.sort((a, b) => b.sensedMs - a.sensedMs);
  return rows.length ? { questionId: r.question_id, startedAtMs, decisionKeys, rows } : null;
}

/** How far the presenting laptop's clock may sit from AWS time for an "inputs" board to count. */
export const BOARD_CLOCK_SKEW_MS = 30_000;

/**
 * Whether a loaded board is this turn's. A "call" board is named by its own call, so it always is;
 * the one "inputs" board (passes_on_file.json) counts only when its question started no earlier
 * than the turn's send time less 30 s, so a board from an earlier question never shows.
 */
export function boardAccepted(board: Board, mode: DecisionKeys, turnSentAt: number): boolean {
  if (board.decisionKeys !== mode) return false;
  return mode === 'call' || board.startedAtMs >= turnSentAt - BOARD_CLOCK_SKEW_MS;
}

/** A pass's state on the board, from the decision files only. */
export type BoardState = 'reading' | 'read' | 'thin' | 'empty';
export const BOARD_STATE_WORDS: Readonly<Record<BoardState, string>> = {
  reading: 'reading',
  read: 'read',
  thin: 'set aside',
  empty: 'no candidates',
};

/** Accepted decisions in the tool's order (its `n`), else in the order their calls streamed. */
function inOrder(decisions: readonly Decision[]): Decision[] {
  return decisions.map((d, i) => ({ d, i })).sort((a, b) => (a.d.n ?? a.i) - (b.d.n ?? b.i) || a.i - b.i).map(({ d }) => d);
}

/** The pass the question read last (the subject of its latest read_pass), or null. */
export function lastRead(decisions: readonly Decision[]): string | null {
  const reads = inOrder(decisions).filter((d) => d.step === 'read_pass');
  return reads.length ? (reads[reads.length - 1].subject as string) : null;
}

/**
 * Each pass's state: the latest read pass "reading", an earlier one "read"; the `from` pass of a
 * `coverage_thin` decision "set aside", and of a `no_candidates` decision "no candidates" once the
 * map has revealed that pass (before it, the row keeps "reading" or "read").
 */
export function boardStates(decisions: readonly Decision[], revealed: Readonly<Record<string, number>>): Record<string, BoardState> {
  const states: Record<string, BoardState> = {};
  const ordered = inOrder(decisions);
  const reads = ordered.filter((d) => d.step === 'read_pass').map((d) => d.subject as string);
  reads.forEach((p, i) => { states[p] = i === reads.length - 1 ? 'reading' : 'read'; });
  for (const d of ordered) {
    const from = d.facts.from;
    if (!from) continue;
    if (d.because === 'coverage_thin') states[from] = 'thin';
    else if (d.because === 'no_candidates' && Object.prototype.hasOwnProperty.call(revealed, from)) states[from] = 'empty';
  }
  return states;
}

/** The board shows 6 rows on a wide screen (1600 px and over), 4 below it. */
export const BOARD_WIDE_QUERY = '(min-width: 1600px)';
export function boardLimit(wide: boolean): number {
  return wide ? 6 : 4;
}

/**
 * The rows in view: the newest `limit`, with every marked row kept (a marked row replaces the oldest
 * unmarked one in view, so a pass the agent read is never hidden), newest first; `older` counts the
 * rest ("and N older").
 */
export function visibleBoardRows(rows: readonly BoardRow[], states: Readonly<Record<string, BoardState>>, limit: number): { rows: BoardRow[]; older: number } {
  const marked = (r: BoardRow) => Object.prototype.hasOwnProperty.call(states, r.passId);
  const shown = rows.slice(0, limit);
  for (const r of rows.slice(limit)) {
    if (!marked(r)) continue;
    let j = shown.length - 1;
    while (j >= 0 && marked(shown[j])) j--;
    if (j >= 0) shown.splice(j, 1);
    shown.push(r);
  }
  shown.sort((a, b) => b.sensedMs - a.sensedMs);
  return { rows: shown, older: rows.length - shown.length };
}

// --- the column ------------------------------------------------------------------------------------

/** What the column has loaded for this turn (StepColumn's VesselStepExtras loads it). */
export interface VesselColumnFiles {
  /** This turn's board, once loaded and accepted (boardAccepted). */
  board: Board | null;
  /** The decision files loaded, by the decide call's id. */
  decisions: Readonly<Record<string, Decision>>;
  /** The coverage files loaded, by pass id. */
  heard: Readonly<Record<string, CoverageCheck>>;
  /** The passes whose candidates the map has revealed, with the count it revealed (Chat.tsx). */
  revealed: Readonly<Record<string, number>>;
}

export interface VesselColumn {
  groups: VesselGroup[];
  /** The lines under each step, by group id, in the order their calls streamed. */
  lines: Record<string, StepLine[]>;
  /** The step that carries the board (this turn's latest "Weigh the passes on file"). */
  boardGroup: string | null;
  /** Each pass's state on the board. */
  states: Record<string, BoardState>;
}

/** Where a decision's line goes, by its step: the first tool listed that has (or will have) a step. */
const LEADS_TO: Record<Exclude<DecideStep, 'stop'>, readonly string[]> = {
  read_pass: ['find_pass'],
  forecast: ['predict_hotspots'],
  draft: ['next_look', 'draft_tasking'],
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What a find_pass step was called for, read as the tool reads `when`: pass ids and days ("latest" names none). */
function findCalledFor(group: VesselGroup): string[] {
  return group.calls
    .map((c) => (typeof c.params?.when === 'string' ? c.params.when.trim().toLowerCase() : ''))
    .filter((w) => PASS_ID_RE.test(w) || DAY_RE.test(w));
}

/** Whether a find_pass step was called for this pass, by its id or by its day ("2026-08-30"). */
function findNames(group: VesselGroup, pass: string): boolean {
  const day = `${pass.slice(4, 8)}-${pass.slice(8, 10)}-${pass.slice(10, 12)}`;
  return findCalledFor(group).some((w) => w === pass || w === day);
}

/** A decide call's own inputs agree with its file, and the file is this board's question's. */
function belongs(d: Decision, call: ToolCall, board: Board): boolean {
  return d.questionId === board.questionId && d.step === call.params?.step && d.because === call.params?.because
    && (d.toolUseId === null || d.toolUseId === call.id);
}

/**
 * The column for a vessel turn: its steps, and the lines under them.
 * - A decision's line renders only once its file has loaded, belongs to this board's question and
 *   matches the call's step and because (a refused call writes no file, so it shows no line), and
 *   after the map's reveal when it carries a candidate count (decisionWaits).
 * - It sits under the first step of the tool its decision leads to that streamed after it, else the
 *   nearest one before it (a decide streamed after its action), never one another accepted decision
 *   of the same step already holds; until that step streams, it waits. A read sits under the find
 *   called for its pass (by its id or its day) when one is; else it takes a find called for no pass
 *   ("latest") by the same rule, never one called for another pass. `stop` sits under the last step.
 * - The coverage line renders once that pass's received area has streamed to the map and its file
 *   has loaded, under the step it folded into; the candidates line once the map has revealed that
 *   pass, under its match_ais step.
 */
export function vesselColumn(tools: readonly ToolCall[], files: VesselColumnFiles): VesselColumn {
  const groups = vesselGroups(tools);
  const placed: Record<string, Array<StepLine & { at: number }>> = {};
  const put = (group: VesselGroup | null | undefined, line: StepLine | null, at: number) => {
    if (!group || !line) return;
    (placed[group.id] ??= []).push({ ...line, at });
  };
  const atOf = new Map(tools.map((t, i) => [t, i]));

  // The decisions: accepted, this question's, matching their calls.
  const board = files.board;
  const accepted: Array<{ call: ToolCall; d: Decision; at: number }> = [];
  if (board) {
    tools.forEach((call, at) => {
      if (call.name !== 'decide' || !Object.prototype.hasOwnProperty.call(files.decisions, call.id)) return;
      const d = files.decisions[call.id];
      if (belongs(d, call, board)) accepted.push({ call, d, at });
    });
  }
  const decisions = accepted.map((a) => a.d);
  const last = lastRead(decisions);
  const held = new Set<string>();
  for (const { d, at } of accepted) {
    const line = decisionLine(d);
    if (!line || decisionWaits(d, files.revealed, last)) continue;
    if (d.step === 'stop') {
      put(groups[groups.length - 1], line, at);
      continue;
    }
    let target: VesselGroup | null = null;
    for (const name of LEADS_TO[d.step]) {
      let free = groups.filter((g) => g.name === name && !held.has(g.id));
      if (d.step === 'read_pass') {
        // A read goes to the find called for its pass; only when there is none, by position to a find
        // called for no pass ("latest"), never to one called for another pass.
        const own = free.filter((g) => findNames(g, d.subject as string));
        free = own.length ? own : free.filter((g) => findCalledFor(g).length === 0);
      }
      target = free.find((g) => g.first - 1 > at) ?? [...free].reverse().find((g) => g.first - 1 < at) ?? null;
      if (target) break;
    }
    if (target) {
      held.add(target.id);
      put(target, line, at);
    }
  }

  // The checks: the coverage against the standard, then the candidates once revealed.
  for (const g of groups) {
    for (const call of g.folded) {
      if (vesselKind(urlOf(call)) !== 'heard') continue;
      const pass = passOf(urlOf(call));
      const check = pass && Object.prototype.hasOwnProperty.call(files.heard, pass) ? files.heard[pass] : null;
      if (check) put(g, coverageLine(check), atOf.get(call) ?? g.first - 1);
    }
  }
  for (const [pass, n] of Object.entries(files.revealed)) {
    if (!Number.isInteger(n) || n < 0) continue;
    const match = [...groups].reverse().find((g) => g.name === 'match_ais' && g.calls.some((c) => c.params?.pass_id === pass));
    const shown = match?.folded.find((c) => vesselKind(urlOf(c)) === 'targets' && passOf(urlOf(c)) === pass);
    if (match) put(match, candidatesLine(n), shown ? atOf.get(shown) ?? match.first - 1 : match.first - 1);
  }

  const lines: Record<string, StepLine[]> = {};
  for (const [id, ls] of Object.entries(placed)) lines[id] = ls.sort((a, b) => a.at - b.at).map(({ label, text }) => ({ label, text }));
  const boardGroup = [...groups].reverse().find((g) => g.name === 'list_passes')?.id ?? null;
  return { groups, lines, boardGroup, states: board ? boardStates(decisions, files.revealed) : {} };
}

// --- the height rules ------------------------------------------------------------------------------

/**
 * What keeps the lit step and its line in view while the agent works: a key that changes whenever
 * the lit step changes or a line appears under it (StepColumn scrolls that step into view on each
 * change, `scrollIntoView(litScrollOptions(...))`).
 */
export function litKey(column: VesselColumn, live: boolean): string {
  if (!live || column.groups.length === 0) return '';
  const lit = column.groups[column.groups.length - 1];
  return `${lit.id}:${column.lines[lit.id]?.length ?? 0}`;
}

export function litScrollOptions(reducedMotion: boolean): ScrollIntoViewOptions {
  return { block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' };
}

/**
 * When a vessel turn ends: an answer taller than the column's visible height scrolls its first line
 * to the top (at 1280 the answer at its cap is about 470 px against about 416 px); one that fits
 * keeps `nearest`, so the steps above it stay in view.
 */
export function answerScrollBlock(answerHeight: number, visibleHeight: number): 'start' | 'nearest' {
  return answerHeight > visibleHeight ? 'start' : 'nearest';
}
