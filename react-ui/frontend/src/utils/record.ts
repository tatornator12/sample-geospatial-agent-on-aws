/**
 * The followed site's record, for the stage (Methane Watch, approved 2026-10-23): what each source
 * saw at the site since January 2025, and how long before the TROPOMI tip the latest fine-scale
 * confirmation was. Built from the tools' own manifests only (the tip, the EMIT passes, Carbon
 * Mapper's plumes), never from model text; every word here is the stage's own.
 *
 * Also the brief card's one line about the gap (the draft's validated enums and numbers, worded
 * here), so the bracket on the timeline and the card's line say the same months from one function.
 */
import type { CmPlumes, PassFrame, Tip } from './steps.ts';

/** The record timeline starts here: the watch reads EMIT's passes and Carbon Mapper's plumes since 2025. */
export const RECORD_START = '2025-01-01';
/** Carbon Mapper plumes count within one TROPOMI footprint of the tip (the follow rule's radius). */
export const FOLLOW_RADIUS_KM = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function utc(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/** "10 Jun 2026": the stage's date, day first. */
export function dayMonthYear(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "6 to 20 Oct 2026", "28 Sep to 12 Oct 2026", "28 Dec 2025 to 10 Jan 2026". */
export function windowWords(start: string, end: string): string {
  const [ys, ms, ds] = parts(start);
  const [ye, me, de] = parts(end);
  if (ys === ye && ms === me) return `${ds} to ${de} ${MONTHS[me - 1]} ${ye}`;
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]} to ${de} ${MONTHS[me - 1]} ${ye}`;
  return `${dayMonthYear(start)} to ${dayMonthYear(end)}`;
}

/** The gap as the room hears it: "about 4 months", or "26 days" under 60 days ("1 day"). */
export function gapWords(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return `about ${Math.round(days / 30.44)} months`;
}

export type EmitMarkKind = 'seen' | 'faint' | 'clouded';
export type ConfirmedBy = 'emit' | 'carbon_mapper' | 'both';

export interface RecordMark {
  date: string;
  /** Position on the axis, 0 to 1. */
  at: number;
  /** Looks or plumes on that day. */
  count: number;
}

export interface RecordTimelineModel {
  /** The axis: the record's first day to the tip's last day. */
  axisStart: string;
  axisEnd: string;
  /** The TROPOMI window as a band, with its anomaly. */
  band: { start: string; end: string; from: number; to: number; ppb: number | null };
  emit: Array<RecordMark & { kind: EmitMarkKind }>;
  carbonMapper: RecordMark[];
  /** The latest fine-scale confirmation and the bracket from it to the tip's first day; null without one. */
  latest: { date: string; by: ConfirmedBy; at: number; days: number; words: string } | null;
}

/** A look's mark: methane seen, too faint or within noise, or clouded out (unread looks are not drawn). */
function emitKind(f: PassFrame): EmitMarkKind | null {
  if (f.verdict === 'candidate') return 'seen';
  if (f.short === 'too weak' || f.short === 'within noise') return 'faint';
  if (f.short === 'cloud or gap') return 'clouded';
  return null;
}

const KIND_ORDER: EmitMarkKind[] = ['seen', 'faint', 'clouded'];

/**
 * The timeline for the followed site, or null when there is no tip window to measure against.
 * EMIT: one mark per look day (the strongest verdict of that day). Carbon Mapper: one mark per
 * plume day within 7 km. The latest confirmation is the newer of the newest EMIT candidate and the
 * newest Carbon Mapper plume within 7 km, as the follow rule reads it.
 */
export function recordTimeline({ tip, frames, cm }: {
  tip: Tip | null | undefined; frames: PassFrame[] | null | undefined; cm: CmPlumes | null | undefined;
}): RecordTimelineModel | null {
  if (!tip?.end) return null;
  const end = tip.end;
  const bandStart = tip.start ?? (tip.days ? new Date(utc(end) - (tip.days - 1) * DAY_MS).toISOString().slice(0, 10) : end);
  const axisStart = RECORD_START;
  const span = Math.max(1, daysBetween(axisStart, end));
  const at = (iso: string) => Math.min(1, Math.max(0, daysBetween(axisStart, iso) / span));
  const inAxis = (iso: string) => iso >= axisStart && iso <= end;

  const byDay = new Map<string, { kind: EmitMarkKind; count: number }>();
  for (const f of frames ?? []) {
    const kind = emitKind(f);
    if (!kind || !inAxis(f.date)) continue;
    const prev = byDay.get(f.date);
    if (!prev) byDay.set(f.date, { kind, count: 1 });
    else byDay.set(f.date, { kind: KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(prev.kind) ? kind : prev.kind, count: prev.count + 1 });
  }
  const emit = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, at: at(date), count: v.count, kind: v.kind }));

  const radius = cm?.followRadiusKm ?? FOLLOW_RADIUS_KM;
  const cmDays = new Map<string, number>();
  for (const d of cm && !cm.unavailable ? cm.dates : []) {
    if (d.distanceKm > radius || !inAxis(d.date)) continue;
    cmDays.set(d.date, (cmDays.get(d.date) ?? 0) + 1);
  }
  const carbonMapper = [...cmDays.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, at: at(date), count }));

  const e = emit.filter((m) => m.kind === 'seen').map((m) => m.date).pop() ?? null;
  const c = carbonMapper.map((m) => m.date).pop() ?? null;
  let latest: RecordTimelineModel['latest'] = null;
  if (e || c) {
    const by: ConfirmedBy = e && c && e === c ? 'both' : e && (!c || e > c) ? 'emit' : 'carbon_mapper';
    const date = by === 'carbon_mapper' ? c! : e!;
    const days = daysBetween(date, bandStart);
    latest = { date, by, at: at(date), days, words: gapWords(Math.max(0, days)) };
  }
  return {
    axisStart, axisEnd: end,
    band: { start: bandStart, end, from: at(bandStart), to: 1, ppb: tip.anomalyPpb },
    emit, carbonMapper, latest,
  };
}

// --- the brief card's line ----------------------------------------------------------------------

export type Recommendation = 'recommend_new_look' | 'no_new_look_needed';
export type RecommendationReason =
  | 'confirmation_older_than_90_days' | 'no_confirmation_on_record' | 'last_look_clouded_out' | 'confirmed_within_90_days';

/** The draft's decision, as the backend serves it (validated enums, dates and counts only). */
export interface BriefDecision {
  recommendation: Recommendation;
  reason: RecommendationReason;
  latestConfirmed: { date: string; by: ConfirmedBy } | null;
  /** Days from the latest confirmation to the tip's first day (to the brief's day without a tip). */
  daysBetween: number | null;
  /** Whether the gap is measured to a TROPOMI tip ("tip") or to the brief's day ("brief"). */
  reference: 'tip' | 'brief';
  lastLook: { date: string; result: 'methane_seen' | 'too_faint' | 'within_noise' | 'clouded_out' | 'not_read' } | null;
  /** Separate days methane was confirmed at the site (EMIT candidates and Carbon Mapper plumes). */
  confirmedDates: number;
}

/**
 * The card's decision line (approved 2026-10-23, the bars): how long before this fortnight methane
 * was last seen up close here, then what the agent recommends. One point: the recommendation and its
 * reason. The latest close look's date is said once, on the step column with its bars; the card says
 * the days. Never "now", "still", "active".
 */
export interface DecisionLine {
  /** The latest close look, as words around its number of days (printed in mono); null without one. */
  confirmation: { before: string; days: string | null; after: string } | null;
  /** The recommendation in words, with its reason when the reason is not the gap itself. */
  recommendation: string;
}

export function decisionLine(d: BriefDecision, opts: { bars?: boolean } = {}): DecisionLine {
  let confirmation: DecisionLine['confirmation'] = null;
  if (d.latestConfirmed && d.daysBetween !== null) {
    const against = d.reference === 'tip' ? 'this fortnight' : 'this brief';
    confirmation = d.daysBetween <= 0
      ? { before: `Methane was seen up close here during ${against}.`, days: null, after: '' }
      : { before: 'Methane was last seen up close here ', days: `${d.daysBetween} ${d.daysBetween === 1 ? 'day' : 'days'}`,
          after: ` before ${against}.` };
  }
  const agent = d.recommendation === 'recommend_new_look' ? 'The agent recommends a new close look.' : 'No new close look is needed yet.';
  const because: Partial<Record<RecommendationReason, string>> = {
    // With the tip bars on the map, the card says whose they are (their window is said with them).
    no_confirmation_on_record: opts.bars
      ? "No close look has confirmed methane here, so the bars are TROPOMI's only."
      : 'No close look has confirmed methane here.',
    last_look_clouded_out: d.lastLook ? `EMIT's last look, on ${dayMonthYear(d.lastLook.date)}, was clouded out.` : '',
  };
  return { confirmation, recommendation: [because[d.reason], agent].filter(Boolean).join(' ') };
}

/** The whole line as text (tests, screen readers). */
export function decisionText(d: BriefDecision, opts: { bars?: boolean } = {}): string {
  const l = decisionLine(d, opts);
  const conf = l.confirmation ? `${l.confirmation.before}${l.confirmation.days ?? ''}${l.confirmation.after}` : null;
  return [conf, l.recommendation].filter(Boolean).join(' ');
}
