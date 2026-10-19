/**
 * The filing core: a human's decision filed beside the agent's draft. Shared by the Methane Watch
 * brief (POST /api/brief/approve) and the Dark Vessels patrol tasking (POST /api/tasking/approve).
 *
 * The rules every filing keeps:
 * - the draft is read from S3, never taken from the browser;
 * - a filed record already there means "filed", so a second click files nothing again (idempotent);
 * - the markdown and the optional map snapshot are written first, `<id>.filed.json` last: the
 *   agent's status tool reads that one, so it exists only once everything else is written;
 * - Slack (when configured) hears about it after, fire and forget; it never unfiles anything.
 */

/** AgentCore session ids: UUIDs or longer (33+ characters), plain characters only. */
export const SESSION_ID = /^[A-Za-z0-9-]{33,128}$/;

export const SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

/** The S3 keys of one filing in a live session: the draft, the filed record, the markdown, the snapshot. */
export interface FilingKeys {
  draft: string;
  filed: string;
  markdown: string;
  snapshot: string;
}

/** The keys under `session_data/<sid>/<folder>/<id>`. Callers validate the ids first. */
export function sessionFilingKeys(sessionId: string, folder: 'briefs' | 'taskings', id: string): FilingKeys {
  const base = `session_data/${sessionId}/${folder}/${id}`;
  return { draft: `${base}.draft.json`, filed: `${base}.filed.json`, markdown: `${base}.md`, snapshot: `${base}.png` };
}

/** Who filed it, for the record: the signed-in email, or "analyst" (local development). */
export function filedBy(user: unknown, fallback = 'analyst'): string {
  const email = (user as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email) ? email : fallback;
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

/** Where a filing reads and writes: S3 in the routes, a Map in the tests. */
export interface FilingStore {
  /** The object's text (at most `maxBytes`), or null when it does not exist. Other errors throw. */
  get(key: string, maxBytes: number): Promise<string | null>;
  put(key: string, body: string | Buffer, contentType: string): Promise<void>;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** What one kind of filing knows: how to check its draft, write its markdown and its record. */
export interface FilingPlan {
  keys: FilingKeys;
  draftMaxBytes: number;
  notFound: string;
  /** Why this draft cannot be filed, or null when it can (ownership, status, content). */
  refusal(record: unknown): string | null;
  markdown(record: unknown, by: string, at: string): string;
  /** The filed record (JSON); the routes add nothing to it. */
  filedRecord(record: unknown, by: string, at: string, snapshotKey: string | null): Record<string, unknown>;
  /** After filing, fire and forget (Slack). */
  notify?(record: unknown, by: string, at: string): void;
}

export type FilingResult =
  | { status: 200; body: { status: 'filed'; filedAt: unknown; filedBy: unknown; already?: true } }
  | { status: 404 | 409; body: { error: string } };

/** File one decision. Idempotent: a filed record already there is returned as it is. */
export async function fileDecision(store: FilingStore, plan: FilingPlan, png: Buffer | null, by: string, at: string): Promise<FilingResult> {
  const existing = parseJson(await store.get(plan.keys.filed, 10_000)) as { filed_at?: unknown; filed_by?: unknown } | null;
  if (existing) return { status: 200, body: { status: 'filed', filedAt: existing.filed_at, filedBy: existing.filed_by, already: true } };
  const record = parseJson(await store.get(plan.keys.draft, plan.draftMaxBytes));
  if (record === null) return { status: 404, body: { error: plan.notFound } };
  const refusal = plan.refusal(record);
  if (refusal) return { status: 409, body: { error: refusal } };
  await store.put(plan.keys.markdown, plan.markdown(record, by, at), 'text/markdown; charset=utf-8');
  if (png) await store.put(plan.keys.snapshot, png, 'image/png');
  // The filed record last: the agent's status tool reads it, so it exists only once everything else is written.
  const filed = plan.filedRecord(record, by, at, png ? plan.keys.snapshot : null);
  await store.put(plan.keys.filed, JSON.stringify(filed), 'application/json');
  plan.notify?.(record, by, at);
  return { status: 200, body: { status: 'filed', filedAt: at, filedBy: by } };
}
