/**
 * Dark Vessels (Act 3): the officer's decision on a patrol tasking (design component 9).
 *
 * The agent drafts (`draft_tasking` writes `session_data/<sid>/taskings/<id>.draft.json` from the
 * session's own records); the officer chooses on the map (one of the three patrol boxes, the
 * candidates in or out) and approves; only this route files it, through the filing core
 * (filing.ts): the markdown and the map snapshot first, `<id>.filed.json` last, which is what the
 * agent's `tasking_status` reads. A replay case keeps its draft flat in the case folder and is
 * never filed. Pure, so the card, the choice, the markdown and the Slack message are tested
 * without S3 or Slack.
 */
import { sessionFilingKeys, type FilingKeys } from './filing';

export const TASKING_ID = /^tasking-\d{8}T\d{6}-[0-9a-f]{6}$/;
export const TASKING_DRAFT_MAX_BYTES = 100_000;
/** The session's patrol boxes (predict_hotspots' record), read to let the officer pick another box. */
export const HOTSPOTS_MAX_BYTES = 50_000;
const CANDIDATE_ID = /^T\d{2}$/;
const PASS_ID = /^s1[a-d]-\d{8}t\d{4}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
// The language rules hold on the backend too (requirement 11): a tasking names candidates, never
// culprits, and never carries a vessel's identifier. The tool checked the notes; this checks again.
const FORBIDDEN = /\b(illegal|illegally|poach\w*|criminal\w*|guilty|caught|smuggl\w*|pirat\w*|culprit\w*|suspect\w*|offender\w*|violat\w*|perpetrat\w*|wrongdo\w*)\b/i;
const IDENTIFIER = /\b(\d{9}|IMO\s*\d{7}|MMSI\w*|call\s*sign\w*)\b/i;

export function isTaskingId(value: unknown): value is string {
  return typeof value === 'string' && TASKING_ID.test(value);
}

export function sessionTaskingKeys(sessionId: string, taskingId: string): FilingKeys {
  return sessionFilingKeys(sessionId, 'taskings', taskingId);
}

export function caseTaskingDraftKey(caseId: string, taskingId: string): string {
  return `use-cases/${caseId}/${taskingId}.draft.json`;
}

export function sessionHotspotsKey(sessionId: string): string {
  return `session_data/${sessionId}/vessels/hotspots.json`;
}

/** The newest draft among the keys under a session's taskings/ folder (the id carries its time), or null. */
export function newestTaskingId(keys: readonly string[]): string | null {
  const ids = keys
    .map((k) => k.match(/(?:^|\/)(tasking-\d{8}T\d{6}-[0-9a-f]{6})\.draft\.json$/)?.[1])
    .filter((id): id is string => !!id)
    .sort();
  return ids.length ? ids[ids.length - 1] : null;
}

export interface TaskingLook {
  satellite: string;
  start: string;
  share: number;
  text: string;
}

export interface TaskingBox {
  box: number;
  bounds: [number, number, number, number];
  share: number;
  look: TaskingLook | null;
}

export interface TaskingCandidate {
  id: string;
  lon: number;
  lat: number;
  port: string;
  portKm: number;
  nearestBroadcastKm: number | null;
}

export interface TaskingCard {
  taskingId: string;
  draftedAt: string;
  passId: string;
  passSensed: string;
  counts: { broadcasting: number; port: number; unproven: number; seen_once: number; candidate: number };
  heardShare: number;
  /** The box the agent drafted (the officer may choose another of the session's boxes). */
  box: TaskingBox;
  candidates: TaskingCandidate[];
  /** The prediction's check, as measured: the top 5% of the water held `hit` of `total` (`lift` x chance). */
  check: { hit: number; total: number; lift: number } | null;
  notes: string[];
  sentence: string;
  attribution: string;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!t || t.length > max || /[<>`|\u0000-\u001f\u007f]/.test(t) || FORBIDDEN.test(t) || IDENTIFIER.test(t)) return null;
  return t;
}

function num(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null;
}

function bounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [w, s, e, n] = value.map((v) => num(v, -180, 180));
  if (w === null || s === null || e === null || n === null || !(w < e && s < n) || Math.abs(s) > 90 || Math.abs(n) > 90) return null;
  return [w, s, e, n];
}

function look(value: unknown): TaskingLook | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const satellite = typeof v.satellite === 'string' && /^S1[A-D]$/.test(v.satellite) ? v.satellite : null;
  const start = typeof v.start === 'string' && ISO.test(v.start) ? v.start : null;
  const share = num(v.share, 0, 1);
  const lookText = text(v.text, 40);
  return satellite && start && share !== null && lookText ? { satellite, start, share, text: lookText } : null;
}

/** One of predict_hotspots' boxes (the draft's `box`, or a row of the session's hotspots.json). */
export function taskingBox(value: unknown): TaskingBox | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const box = typeof v.box === 'number' && Number.isInteger(v.box) && v.box >= 1 && v.box <= 3 ? v.box : null;
  const b = bounds(v.bounds);
  const share = num(v.share_of_past_dark_targets, 0, 1);
  if (box === null || !b || share === null) return null;
  return { box, bounds: b, share, look: look(v.next_look ?? v.look) };
}

/** The session's three boxes from predict_hotspots' record, in order; [] when absent or malformed. */
export function sessionBoxes(record: unknown): TaskingBox[] {
  const rows = (record as { boxes?: unknown } | null)?.boxes;
  if (!Array.isArray(rows)) return [];
  return rows.map(taskingBox).filter((b): b is TaskingBox => b !== null).slice(0, 3);
}

/** The card for a draft, validated field by field; null when it is not this tasking's draft. */
export function taskingCard(record: unknown, taskingId: string): TaskingCard | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (r.tasking_id !== taskingId) return null;
  const draftedAt = typeof r.drafted_at === 'string' && ISO.test(r.drafted_at) ? r.drafted_at : null;
  const passId = typeof r.pass_id === 'string' && PASS_ID.test(r.pass_id) ? r.pass_id : null;
  const passSensed = typeof r.pass_sensed === 'string' && ISO.test(r.pass_sensed) ? r.pass_sensed : null;
  const c = (r.counts ?? {}) as Record<string, unknown>;
  const counts = {
    broadcasting: count(c.broadcasting), port: count(c.port), unproven: count(c.unproven),
    seen_once: count(c.seen_once), candidate: count(c.candidate),
  };
  const heardShare = num(r.heard_share, 0, 1);
  // The draft carries its box's next look beside the box.
  const box = taskingBox({ ...(r.box as object ?? {}), next_look: r.look });
  if (!draftedAt || !passId || !passSensed || Object.values(counts).some((v) => v === null) || heardShare === null || !box) return null;
  const candidates: TaskingCandidate[] = [];
  for (const row of Array.isArray(r.candidates) ? r.candidates : []) {
    const v = (row ?? {}) as Record<string, unknown>;
    const id = typeof v.id === 'string' && CANDIDATE_ID.test(v.id) ? v.id : null;
    const lon = num(v.lon, -180, 180);
    const lat = num(v.lat, -90, 90);
    const port = text(v.port, 60);
    const portKm = num(v.port_km, 0, 5000);
    if (!id || lon === null || lat === null || !port || portKm === null) return null;
    candidates.push({ id, lon, lat, port, portKm, nearestBroadcastKm: num(v.nearest_broadcast_km, 0, 5000) });
  }
  if (candidates.length > 20 || new Set(candidates.map((x) => x.id)).size !== candidates.length) return null;
  const top5 = ((r.check ?? {}) as Record<string, unknown>).top_5pct as Record<string, unknown> | undefined;
  const hit = num(top5?.hit, 0, 1);
  const total = count(top5?.total);
  const lift = num(top5?.lift, 0, 1000);
  const notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => text(n, 220));
  if (notes.length > 3 || notes.some((n) => n === null)) return null;
  const sentence = text(r.sentence, 200);
  const attribution = text(r.attribution, 80);
  if (!sentence || !attribution) return null;
  return {
    taskingId, draftedAt, passId, passSensed,
    counts: counts as TaskingCard['counts'], heardShare, box, candidates,
    check: hit !== null && total !== null && lift !== null ? { hit, total, lift } : null,
    notes: notes as string[], sentence, attribution,
  };
}

/** What the officer chose on the map. */
export interface TaskingChoice {
  box: TaskingBox;
  candidateIds: string[];
}

/**
 * The officer's choice, checked against the draft and the session's boxes: the box one of the
 * three (the draft's when not named), the candidates a subset of the draft's (all when not named).
 */
export function taskingChoice(card: TaskingCard, boxes: readonly TaskingBox[], box: unknown, candidateIds: unknown):
  { ok: true; choice: TaskingChoice } | { ok: false; reason: string } {
  let chosen = card.box;
  if (box !== undefined && box !== null) {
    if (typeof box !== 'number' || !Number.isInteger(box)) return { ok: false, reason: 'box must be 1, 2 or 3' };
    const found = box === card.box.box ? card.box : boxes.find((b) => b.box === box);
    if (!found) return { ok: false, reason: 'box must be one of the session\'s patrol boxes' };
    chosen = found;
  }
  let ids = card.candidates.map((x) => x.id);
  if (candidateIds !== undefined && candidateIds !== null) {
    if (!Array.isArray(candidateIds) || candidateIds.length > 20 || !candidateIds.every((x) => typeof x === 'string' && CANDIDATE_ID.test(x))) {
      return { ok: false, reason: 'candidateIds must be like ["T01", "T02"]' };
    }
    const known = new Set(ids);
    const unknown = candidateIds.filter((x) => !known.has(x));
    if (unknown.length) return { ok: false, reason: `not candidates in this draft: ${unknown.join(', ')}` };
    const keep = new Set(candidateIds as string[]);
    ids = ids.filter((x) => keep.has(x));
  }
  return { ok: true, choice: { box: chosen, candidateIds: ids } };
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function satelliteName(passId: string): string {
  return `Sentinel-1${passId.charAt(2).toUpperCase()}`;
}

function candidateLine(c: TaskingCandidate): string {
  const nearest = c.nearestBroadcastKm === null ? 'no broadcast at the pass' : `nearest broadcast ${c.nearestBroadcastKm.toFixed(1)} km`;
  return `${c.id}: ${c.portKm.toFixed(1)} km from ${c.port}; ${nearest}`;
}

/** The filed tasking as the officer approved it (markdown, beside the draft). */
export function taskingMarkdown(card: TaskingCard, choice: TaskingChoice, by: string, at: string): string {
  const inIds = new Set(choice.candidateIds);
  const kept = card.candidates.filter((c) => inIds.has(c.id));
  const dropped = card.candidates.filter((c) => !inIds.has(c.id));
  const [w, s, e, n] = choice.box.bounds;
  const k = card.counts;
  const lines = [
    `# Patrol tasking: box ${choice.box.box}, Galápagos Marine Reserve`,
    '',
    `Status: FILED by ${by} at ${at}. Filed by the officer, not by the agent.`,
    '',
    `- Radar pass: ${satelliteName(card.passId)}, ${utcMinute(card.passSensed)} (\`${card.passId}\`)`,
    `- AIS was heard over ${pct(card.heardShare)} of the reserve at the pass`,
    `- Targets: ${k.broadcasting} broadcasting, ${k.port} at port, ${k.unproven} in unproven water (not evidence), ` +
      `${k.seen_once} seen by one detector only, ${k.candidate} candidates`,
    `- Box ${choice.box.box}: ${pct(choice.box.share)} of past dark targets; ${w.toFixed(2)}, ${s.toFixed(2)} to ${e.toFixed(2)}, ${n.toFixed(2)}`,
    `- Next radar look over the box: ${choice.box.look ? choice.box.look.text : 'none planned yet in ESA\'s published plan'}`,
    ...(card.check
      ? [`- The prediction's check: the top 5% of the water held ${pct(card.check.hit)} of the ${card.check.total} dark targets checked (${card.check.lift}x chance)`]
      : []),
    '',
    `## Candidates in this tasking (${kept.length} of ${card.candidates.length})`,
    '',
    ...(kept.length ? kept.map((c) => `- ${candidateLine(c)}`) : ['- None: a patrol of the box only.']),
    ...(dropped.length ? ['', `Left out by the officer: ${dropped.map((c) => c.id).join(', ')}`] : []),
    '',
    card.sentence,
    ...(card.notes.length ? ['', '## Notes from the draft', '', ...card.notes.map((x) => `- ${x}`)] : []),
    '',
    card.attribution,
    '',
    `Drafted by the agent at ${card.draftedAt} (\`${card.taskingId}\`); the officer chose the box and the candidates.`,
    '',
  ];
  return lines.join('\n');
}

/** The filed record `tasking_status` reads (it needs only `filed_at`; the rest is the officer's choice). */
export function taskingFiledRecord(card: TaskingCard, choice: TaskingChoice, sessionId: string, by: string, at: string,
                                   keys: FilingKeys, snapshotKey: string | null): Record<string, unknown> {
  return {
    tasking_id: card.taskingId, session_id: sessionId, status: 'filed', filed_at: at, filed_by: by,
    box: choice.box.box, candidate_ids: choice.candidateIds, look: choice.box.look,
    markdown_key: keys.markdown, snapshot_key: snapshotKey,
  };
}

/** What the plate shows once filed: the record's choice, if it is well formed. */
export function filedChoice(record: unknown): { box: number; candidateIds: string[] } | null {
  const r = (record ?? {}) as Record<string, unknown>;
  const box = typeof r.box === 'number' && Number.isInteger(r.box) && r.box >= 1 && r.box <= 3 ? r.box : null;
  const ids = Array.isArray(r.candidate_ids) && r.candidate_ids.every((x) => typeof x === 'string' && CANDIDATE_ID.test(x))
    ? (r.candidate_ids as string[]) : null;
  return box !== null && ids ? { box, candidateIds: ids } : null;
}

/** Why a draft cannot be filed, or null when it can. */
export function taskingRefusal(record: unknown, taskingId: string): string | null {
  if (!taskingCard(record, taskingId)) return 'This draft is not a well-formed tasking of this session.';
  if ((record as Record<string, unknown>).status !== 'draft') return 'Only a draft can be filed.';
  return null;
}

// --- Slack -------------------------------------------------------------------------------------

/** Slack mrkdwn: the control characters that could break out of a field or spoof a link. */
function plain(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string);
}

export interface FiledTasking {
  card: TaskingCard;
  choice: TaskingChoice;
  filedBy: string;
  filedAt: string;
  markdownKey: string;
  bucket: string;
}

/**
 * The variables the "Patrol taskings" Workflow Builder trigger declares, all of data type Text,
 * keys exactly as written: Slack matches the payload's keys to the trigger's variables by name.
 * The fixed sentences (who decided, what a candidate is, the attribution) are typed once into the
 * workflow's message and are not sent. The backend's .env.example lists these keys beside
 * SLACK_TASKING_WEBHOOK_URL; the test pins the list so the two never drift.
 */
export const TASKING_WORKFLOW_VARIABLES = [
  'title', 'filed_by', 'filed_at', 'box', 'next_look', 'candidates', 'left_out', 'pass', 'tasking_id', 'markdown_key',
] as const;

export type TaskingWorkflowVariables = Record<(typeof TASKING_WORKFLOW_VARIABLES)[number], string>;

/**
 * The flat variables for the tasking's Workflow Builder trigger (SLACK_TASKING_WEBHOOK_URL only:
 * the brief's workflow says "brief"). Lists arrive laid out, one bullet per line. Candidates by
 * their id, distance from port and nearest broadcast; the box by its centre, never a target's
 * position; no vessel identity reaches here (the card's validator refuses it).
 */
export function taskingWorkflowPayload(f: FiledTasking): TaskingWorkflowVariables {
  const { card, choice } = f;
  const kept = card.candidates.filter((c) => choice.candidateIds.includes(c.id));
  const dropped = card.candidates.filter((c) => !choice.candidateIds.includes(c.id));
  const [w, s, e, n] = choice.box.bounds;
  const k = card.counts;
  const targets = k.broadcasting + k.port + k.unproven + k.seen_once + k.candidate;
  const look = choice.box.look;
  return {
    title: `Box ${choice.box.box}, Galápagos Marine Reserve, ${kept.length} of ${card.candidates.length} candidates`,
    filed_by: f.filedBy,
    filed_at: utcMinute(f.filedAt),
    box: `Box ${choice.box.box} held ${pct(choice.box.share)} of past dark targets; centre ${((s + n) / 2).toFixed(4)}, ${((w + e) / 2).toFixed(4)}`,
    next_look: look ? `Sentinel-1${look.satellite.charAt(2)}, ${utcMinute(look.start)}` : 'none planned yet in ESA\'s published plan',
    candidates: kept.length ? kept.map((c) => `• ${candidateLine(c)}`).join('\n') : '• None: a patrol of the box only.',
    left_out: dropped.length ? dropped.map((c) => c.id).join(', ') : 'none',
    pass: `${satelliteName(card.passId)}, ${utcMinute(card.passSensed)}. AIS was heard over ${pct(card.heardShare)} of the reserve; ` +
      `${targets} radar targets, ${k.candidate} candidates.`,
    tasking_id: card.taskingId,
    markdown_key: `s3://${f.bucket}/${f.markdownKey}`,
  };
}

/** The Block Kit message for a Slack app's incoming webhook: the workflow's layout, set by the backend. */
export function taskingMessage(f: FiledTasking): Record<string, unknown> {
  const v = taskingWorkflowPayload(f);
  const p = Object.fromEntries(Object.entries(v).map(([key, value]) => [key, plain(value)])) as TaskingWorkflowVariables;
  const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });
  return {
    text: `Patrol tasking filed: ${p.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Patrol tasking filed', emoji: false } },
      section(`*${p.title}*\nFiled by ${p.filed_by} at ${p.filed_at}. The officer decided; the agent drafted.`),
      section(`*Where and when*\n${p.box}\nNext radar look: ${p.next_look}`),
      section(`*Candidates*\n${p.candidates}\nLeft out by the officer: ${p.left_out}\n${plain(f.card.sentence)}`),
      section(`*From the pass*\n${p.pass}`),
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `${plain(f.card.attribution)} · \`${p.tasking_id}\`` },
          { type: 'mrkdwn', text: `\`${p.markdown_key}\`` },
        ],
      },
    ],
  };
}
