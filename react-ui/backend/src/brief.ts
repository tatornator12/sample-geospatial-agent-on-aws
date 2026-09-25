/**
 * The analyst's decision on a Methane Watch brief (requirement 12).
 *
 * The agent only ever writes a DRAFT (`session_data/<sid>/briefs/<id>.draft.json`, from the
 * agent's draft_brief tool). Filing is the analyst's act, made in the UI and executed here, never
 * by the model: the backend checks the ids, reads the draft from S3 (never from the browser),
 * confirms it belongs to the session and is still a draft, and writes the filed record beside it.
 * The agent's brief_status tool reads that record; it is the only way the agent can say "filed".
 *
 * Everything here is pure (ids, keys, the card, the filed markdown, the snapshot check), so the
 * rules are tested without S3; index.ts wires them to the routes.
 */

export const BRIEF_ID = /^brief-\d{8}T\d{6}-[0-9a-f]{6}$/;
/** AgentCore session ids: UUIDs or longer (33+ characters), plain characters only. */
export const SESSION_ID = /^[A-Za-z0-9-]{33,128}$/;
const CASE_ID = /^[a-z0-9-]{1,64}$/;

export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const DRAFT_MAX_BYTES = 200_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isBriefId(value: unknown): value is string {
  return typeof value === 'string' && BRIEF_ID.test(value);
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

export function isCaseId(value: unknown): value is string {
  return typeof value === 'string' && CASE_ID.test(value);
}

export interface BriefKeys {
  draft: string;
  filed: string;
  markdown: string;
  snapshot: string;
}

/** The S3 keys of one brief in a live session. Callers validate the ids first. */
export function sessionBriefKeys(sessionId: string, briefId: string): BriefKeys {
  const base = `session_data/${sessionId}/briefs/${briefId}`;
  return { draft: `${base}.draft.json`, filed: `${base}.filed.json`, markdown: `${base}.md`, snapshot: `${base}.png` };
}

/** A replay case keeps its brief's draft flat in the case folder; it is never filed. */
export function caseBriefDraftKey(caseId: string, briefId: string): string {
  return `use-cases/${caseId}/${briefId}.draft.json`;
}

const ASSESSMENT_ORDER = ['possible', 'less likely', 'cannot assess'];
const CONFIDENCE = ['low', 'moderate', 'high'];

export interface BriefCard {
  briefId: string;
  title: string;
  place: string;
  lat: number;
  lon: number;
  looks: number;
  candidates: number;
  passesRead: number;
  confidence: 'low' | 'moderate' | 'high';
  singleExplanation: string;
  /** Up to three unconfirmed hypotheses, "possible" first. */
  hypotheses: Array<{ label: string; assessment: string }>;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null;
}

function degrees(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * The card the UI shows, from a draft record, or null when the record is not the brief asked
 * for (wrong id, another session, malformed). `sessionId` null means a replay case (no session check).
 */
export function briefCard(record: unknown, briefId: string, sessionId: string | null): BriefCard | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (r.brief_id !== briefId) return null;
  if (sessionId !== null && r.session_id !== sessionId) return null;
  const b = r.brief as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object') return null;
  const title = text(b.title, 90);
  const place = text(b.place, 80);
  const lat = degrees(b.lat, 90);
  const lon = degrees(b.lon, 180);
  const looks = count(b.looks);
  const candidates = count(b.candidates);
  const passesRead = count(b.passes_read);
  const confidence = typeof b.confidence === 'string' && CONFIDENCE.includes(b.confidence) ? b.confidence : null;
  if (!title || !place || lat === null || lon === null || looks === null || candidates === null || passesRead === null || !confidence) {
    return null;
  }
  const rows = Array.isArray(b.explanations) ? b.explanations : [];
  const hypotheses = rows
    .map((e) => {
      const row = (e ?? {}) as Record<string, unknown>;
      const label = text(row.label, 80);
      const assessment = typeof row.assessment === 'string' && ASSESSMENT_ORDER.includes(row.assessment) ? row.assessment : null;
      return label && assessment ? { label, assessment } : null;
    })
    .filter((h): h is { label: string; assessment: string } => h !== null)
    .sort((a, c) => ASSESSMENT_ORDER.indexOf(a.assessment) - ASSESSMENT_ORDER.indexOf(c.assessment))
    .slice(0, 3);
  return {
    briefId,
    title,
    place,
    lat,
    lon,
    looks,
    candidates,
    passesRead,
    confidence: confidence as BriefCard['confidence'],
    singleExplanation: 'low without a ground or aircraft check',
    hypotheses,
  };
}

/** Why a draft record cannot be filed, or null when it can. */
export function fileRefusal(record: unknown, briefId: string, sessionId: string): string | null {
  if (!briefCard(record, briefId, sessionId)) return 'This draft does not belong to this session.';
  const r = record as Record<string, unknown>;
  if (r.status !== 'draft') return 'Only a draft can be filed.';
  if (typeof r.markdown !== 'string' || r.markdown.length > DRAFT_MAX_BYTES) return 'The draft has no brief text.';
  return null;
}

/** Who filed it, for the record: the signed-in email, or "analyst" (local development). */
export function filedBy(user: unknown): string {
  const email = (user as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email) ? email : 'analyst';
}

/** The filed brief's markdown: the draft's text with its status line replaced. */
export function filedMarkdown(draftMarkdown: string, by: string, at: string): string {
  const status = `Status: FILED by ${by} at ${at}. Filed by the analyst, not by the agent.`;
  const lines = draftMarkdown.split('\n');
  const i = lines.findIndex((l) => l.startsWith('Status: DRAFT'));
  if (i >= 0) lines[i] = status;
  else lines.push('', status);
  return lines.join('\n').replace(/\(draft `(brief-[^`]+)`, not filed\)/, '(`$1`, filed)');
}

export type Snapshot = { ok: true; png: Buffer | null } | { ok: false; reason: string };

/** The optional map snapshot: absent, or a base64 PNG data URL of at most 2 MB. */
export function decodeSnapshot(value: unknown): Snapshot {
  if (value === undefined || value === null || value === '') return { ok: true, png: null };
  if (typeof value !== 'string') return { ok: false, reason: 'snapshot must be a PNG data URL' };
  const prefix = 'data:image/png;base64,';
  if (!value.startsWith(prefix)) return { ok: false, reason: 'snapshot must be a PNG data URL' };
  const body = value.slice(prefix.length);
  if (body.length > Math.ceil((SNAPSHOT_MAX_BYTES * 4) / 3) + 4) return { ok: false, reason: 'snapshot is larger than 2 MB' };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return { ok: false, reason: 'snapshot is not base64' };
  const png = Buffer.from(body, 'base64');
  if (png.length > SNAPSHOT_MAX_BYTES) return { ok: false, reason: 'snapshot is larger than 2 MB' };
  if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, reason: 'snapshot is not a PNG' };
  }
  return { ok: true, png };
}
