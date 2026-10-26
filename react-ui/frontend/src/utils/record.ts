/**
 * The followed site's record, for the stage (Methane Watch, approved 2026-10-23): what each source
 * saw at the site since January 2025, and how long before the TROPOMI tip the latest fine-scale
 * confirmation was. Built from the tools' own manifests only (the tip, the EMIT passes, Carbon
 * Mapper's plumes), never from model text; every word here is the stage's own.
 *
 * Also the brief card's one line about the gap (the draft's validated enums and numbers, worded
 * here), so the bracket on the timeline and the card's line say the same days.
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

/** "25 Jul": a pass's date under its frame (the axis above it says the year). */
export function dayMonth(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "11 to 24 Oct", "28 Sep to 12 Oct", "28 Dec to 10 Jan": the fortnight over its band (the axis says the year). */
export function windowShortWords(start: string, end: string): string {
  const [, ms, ds] = parts(start);
  const [, me, de] = parts(end);
  return ms === me ? `${ds} to ${de} ${MONTHS[me - 1]}` : `${ds} ${MONTHS[ms - 1]} to ${de} ${MONTHS[me - 1]}`;
}

function daysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
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

/** A run of the stage's words; `mono` marks a date or a figure (printed in the mono face). */
export interface AxisPart {
  text: string;
  mono?: boolean;
}

/**
 * The shared date axis under the three rows (approved 2026-10-26): a tick at each month's first day
 * (January's taller, with its year beside it), the latest close look's date at its mark, the gap from
 * it to the fortnight's first day in days, and the fortnight's own words over its band.
 */
export interface RecordAxis {
  ticks: Array<{ at: number; year: boolean }>;
  years: Array<{ at: number; text: string }>;
  /** "11 to 24 Oct": the fortnight, over its band at the axis's right end. */
  fortnight: string;
  /** The latest fine-scale confirmation's date at its mark ("25 Jul 2026"); null without one. */
  latest: { at: number; text: string } | null;
  /**
   * The bracket from the latest confirmation to the fortnight's first day, and its words ("78 days to
   * 11 Oct": pinned to the first day, as the follow rule measures it, never to the fortnight's end).
   * Null without a confirmation or when it is inside the fortnight.
   */
  gap: { from: number; to: number; days: number; words: AxisPart[] } | null;
  /** The latest confirmation is inside the fortnight: its words instead of a bracket. */
  during: AxisPart[] | null;
}

export interface RecordTimelineModel {
  /** The axis: the record's first day to the tip's last day. */
  axisStart: string;
  axisEnd: string;
  /** The TROPOMI window as a band, with its anomaly. */
  band: { start: string; end: string; from: number; to: number; ppb: number | null };
  emit: Array<RecordMark & { kind: EmitMarkKind }>;
  carbonMapper: RecordMark[];
  /** Whether Carbon Mapper was read at this point: an empty row says which ("none since January 2025"). */
  carbonMapperRead: 'read' | 'unavailable' | 'not_checked';
  /** The latest fine-scale confirmation and the bracket from it to the tip's first day; null without one. */
  latest: { date: string; by: ConfirmedBy; at: number; days: number; words: string } | null;
  axis: RecordAxis;
}

/** What an empty row says, in the room's words (never a blank hairline). */
export function emptyRowWords(row: 'emit' | 'carbon_mapper', read: RecordTimelineModel['carbonMapperRead'] = 'read'): string {
  if (row === 'emit') return 'no pass read since January 2025';
  return read === 'unavailable' ? 'could not be read' : read === 'not_checked' ? 'not checked here' : 'none since January 2025';
}

/** A look's mark: methane seen, too faint or within noise, or clouded out (unread looks are not drawn). */
function emitKind(f: PassFrame): EmitMarkKind | null {
  if (f.verdict === 'candidate') return 'seen';
  if (f.short === 'too weak' || f.short === 'within noise') return 'faint';
  if (f.short === 'cloud or gap') return 'clouded';
  return null;
}

const KIND_ORDER: EmitMarkKind[] = ['seen', 'faint', 'clouded'];

/** Month ticks and year labels from the axis's first day to its last. */
function axisTicks(axisStart: string, end: string, at: (iso: string) => number): Pick<RecordAxis, 'ticks' | 'years'> {
  const ticks: RecordAxis['ticks'] = [];
  const years: RecordAxis['years'] = [];
  let [y, m] = parts(axisStart);
  if (parts(axisStart)[2] !== 1) m += 1;
  for (let guard = 0; guard < 240; guard++) {
    if (m > 12) { y += 1; m = 1; }
    const iso = `${y}-${String(m).padStart(2, '0')}-01`;
    if (iso > end) break;
    ticks.push({ at: at(iso), year: m === 1 });
    if (m === 1) years.push({ at: at(iso), text: String(y) });
    m += 1;
  }
  return { ticks, years };
}

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
    latest = { date, by, at: at(date), days, words: daysText(Math.max(0, days)) };
  }
  const band = { start: bandStart, end, from: at(bandStart), to: 1, ppb: tip.anomalyPpb };
  const axis: RecordAxis = {
    ...axisTicks(axisStart, end, at),
    fortnight: windowShortWords(bandStart, end),
    latest: latest ? { at: latest.at, text: dayMonthYear(latest.date) } : null,
    gap: latest && latest.days > 0
      ? { from: latest.at, to: band.from, days: latest.days,
          words: [{ text: daysText(latest.days), mono: true }, { text: ' to ' }, { text: dayMonth(bandStart), mono: true }] }
      : null,
    during: latest && latest.days <= 0 ? [{ text: 'during this fortnight' }] : null,
  };
  return {
    axisStart, axisEnd: end, band, emit, carbonMapper,
    carbonMapperRead: !cm ? 'not_checked' : cm.unavailable ? 'unavailable' : 'read',
    latest, axis,
  };
}

// --- the axis's labels, laid out in lines ---------------------------------------------------------

/** The width of one mono character at the stage's 15 px (Atkinson Hyperlegible Mono, measured 9.48 px). */
export const MONO_CHAR_PX = 9.5;
/** The space kept between two labels on one line, and between a label and its bracket. */
export const LABEL_GAP_PX = 8;

export interface PlacedLabel {
  /** The label's line under the ticks: 0 is the years' line. */
  line: number;
  /** Its left edge and width, px from the axis's left end. */
  left: number;
  width: number;
}

export interface AxisLayout {
  years: Array<PlacedLabel & { text: string }>;
  latest: (PlacedLabel & { text: string }) | null;
  /** The gap's words and its bracket (from the latest mark to the fortnight's first day). */
  gap: (PlacedLabel & { words: AxisPart[]; bracket: { left: number; right: number; line: number }; inside: boolean }) | null;
  during: (PlacedLabel & { words: AxisPart[] }) | null;
  /** How many label lines the axis needs (the years' line included). */
  lines: number;
}

/** A label's width on the stage: every character at the mono width (prose runs a little narrower, so this never under-measures). */
export function labelWidth(text: string | AxisPart[], charPx = MONO_CHAR_PX): number {
  const chars = typeof text === 'string' ? text.length : text.reduce((n, p) => n + p.text.length, 0);
  return Math.ceil(chars * charPx);
}

const overlaps = (a: { left: number; width: number }, b: { left: number; width: number }, gap: number) =>
  a.left < b.left + b.width + gap && b.left < a.left + a.width + gap;

/**
 * Where the axis's labels go at a given width (px), so none is ever shrunk below 15 px: the years on
 * the first line at their Januaries; the latest close look's date with its right edge at its mark (on
 * the years' line when it clears them, else the next); the gap's words inside the bracket when they
 * fit there, else just left of it on the line after the date, the bracket beside them; the words of a
 * confirmation inside the fortnight right-aligned on the line after the date. Pure, so the stage's
 * line breaks at 1280 and 1920 wide are tested.
 */
export function axisLayout(axis: RecordAxis, width: number, charPx = MONO_CHAR_PX, gapPx = LABEL_GAP_PX): AxisLayout {
  const W = Math.max(1, width);
  const clampLeft = (left: number, w: number) => Math.max(0, Math.min(W - w, left));
  const years: AxisLayout['years'] = [];
  for (const y of axis.years) {
    const w = labelWidth(y.text, charPx);
    const placed = { text: y.text, line: 0, left: clampLeft(y.at * W + 2, w), width: w };
    if (years.length > 0 && overlaps(years[years.length - 1], placed, gapPx)) continue;
    years.push(placed);
  }
  let latest: AxisLayout['latest'] = null;
  if (axis.latest) {
    const w = labelWidth(axis.latest.text, charPx);
    const box = { left: clampLeft(axis.latest.at * W - w, w), width: w };
    latest = { text: axis.latest.text, ...box, line: years.some((y) => overlaps(y, box, gapPx)) ? 1 : 0 };
  }
  let gap: AxisLayout['gap'] = null;
  if (axis.gap && latest) {
    const x = axis.gap.from * W;
    const right = Math.max(x + 4, axis.gap.to * W);
    const w = labelWidth(axis.gap.words, charPx);
    if (right - x >= w + 2 * gapPx) {
      // Inside the bracket, on the date's line (the date ends where the bracket starts).
      const clash = latest.line === 0 && years.some((y) => overlaps(y, { left: x, width: right - x }, gapPx));
      const line = clash ? 1 : latest.line;
      gap = { words: axis.gap.words, left: x + (right - x - w) / 2, width: w, line, bracket: { left: x, right, line }, inside: true };
    } else if (x - gapPx - w >= 0) {
      // Just left of the bracket, on the line after the date: "78 days to 11 Oct ⌊__⌋".
      const line = latest.line + 1;
      gap = { words: axis.gap.words, left: x - gapPx - w, width: w, line, bracket: { left: x, right, line }, inside: false };
    } else {
      // No room either side (a narrow column, an early confirmation): the bracket on the line after
      // the date, its words under it, ending where it ends.
      const line = latest.line + 1;
      gap = { words: axis.gap.words, left: clampLeft(right - w, w), width: w, line: line + 1, bracket: { left: x, right, line }, inside: false };
    }
  }
  let during: AxisLayout['during'] = null;
  if (axis.during && latest) {
    const w = labelWidth(axis.during, charPx);
    during = { words: axis.during, left: W - w, width: w, line: latest.line + 1 };
  }
  const lines = 1 + Math.max(0, latest?.line ?? 0, gap?.line ?? 0, gap?.bracket.line ?? 0, during?.line ?? 0);
  return { years, latest, gap, during, lines };
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
