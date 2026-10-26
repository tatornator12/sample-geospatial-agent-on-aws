/**
 * The followed site and its two bar layers, for the stage (Methane Watch, approved 2026-10-23).
 *
 * follow_site writes `follow.json` (agents/methane-hunter/follow_tools.py) when it accepts the
 * agent's follow under the 90-day switch rule: the reason as an enum, the step 1 follow and the
 * followed hotspot (area key, rank, anomaly, latest confirmation and its days before the tip window),
 * the tip window, and the files of the two bar layers (the tip bars, then the record bars). Every word
 * the stage says about them is written here from those enums, dates and numbers; nothing the model
 * wrote reaches these lines.
 */
import type { ToolCall } from '../types.ts';
import { WATCH_AREA_NAMES } from './steps.ts';

export type FollowReason = 'newest_confirmation' | 'stronger_tip' | 'top_spot_stale_switched' | 'top_spot_stale_no_fresher';
const REASONS: readonly FollowReason[] = ['newest_confirmation', 'stronger_tip', 'top_spot_stale_switched', 'top_spot_stale_no_fresher'];
export type ConfirmedBy = 'emit' | 'carbon_mapper' | 'both';
const BY: readonly ConfirmedBy[] = ['emit', 'carbon_mapper', 'both'];

export interface FollowPoint {
  /** The watch area's key (WATCH_AREAS in steps.ts). */
  area: string;
  /** The hotspot's rank in its area's scan (1 to 3). */
  rank: number;
  lat: number;
  lon: number;
  anomalyPpb: number | null;
  latest: { date: string; by: ConfirmedBy } | null;
  /** Days from the latest confirmation to the tip window's first day (negative: inside it). */
  daysBeforeTip: number | null;
}

export interface Follow {
  reason: FollowReason;
  tip: { start: string; end: string };
  step1: FollowPoint;
  followed: FollowPoint;
  /** How many more hotspots step 2 checked (0 when step 2 did not apply). */
  checked: number;
  /** The rule's threshold in days (follow.json's `gap_days`; the tools' GAP_DAYS, 90). */
  gapDays: number;
  tipBars: { file: string } | null;
  recordBars: { by: 'emit' | 'carbon_mapper'; date: string; file: string; daysBeforeTip: number } | null;
}

/** The 90-day switch rule's threshold (agents/methane-hunter/follow_rule.py GAP_DAYS). */
export const GAP_DAYS = 90;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIP_FILE = /^tipcolumns_-?\d{1,3}\.\d{4}_-?\d{1,3}\.\d{4}\.geojson$/;
const RECORD_FILE = /^(cmcolumns_[A-Za-z0-9_.-]{1,80}|columns_EMIT_L2B_CH4ENH_[A-Za-z0-9_]{1,60})\.geojson$/;

function isoDay(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? value : null;
}

function num(value: unknown, lo: number, hi: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : null;
}

function whole(value: unknown, lo: number, hi: number): number | null {
  const n = num(value, lo, hi);
  return n !== null && Number.isInteger(n) ? n : null;
}

function point(raw: unknown): FollowPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const area = typeof r.area === 'string' && WATCH_AREA_NAMES.includes(r.area) ? r.area : null;
  const rank = whole(r.rank, 1, 3);
  const lat = num(r.lat, -90, 90);
  const lon = num(r.lon, -180, 180);
  if (!area || rank === null || lat === null || lon === null) return null;
  let latest: FollowPoint['latest'] = null;
  let daysBeforeTip: number | null = null;
  if (r.latest !== null && r.latest !== undefined) {
    const l = r.latest as Record<string, unknown>;
    const date = isoDay(l?.date);
    const by = (BY as readonly unknown[]).includes(l?.by) ? (l.by as ConfirmedBy) : null;
    daysBeforeTip = whole(r.days_before_tip, -10_000, 10_000);
    if (!date || !by || daysBeforeTip === null) return null;
    latest = { date, by };
  }
  return { area, rank, lat, lon, anomalyPpb: num(r.anomaly_ppb, -1000, 1000), latest, daysBeforeTip };
}

/** follow.json, field by field; null when any part is malformed (the stage then says nothing of it). */
export function parseFollow(raw: unknown): Follow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const reason = (REASONS as readonly unknown[]).includes(r.reason) ? (r.reason as FollowReason) : null;
  const tip = r.tip && typeof r.tip === 'object' ? (r.tip as Record<string, unknown>) : null;
  const start = isoDay(tip?.start);
  const end = isoDay(tip?.end);
  const step1 = point(r.step1);
  const followed = point(r.followed);
  const checked = whole(r.checked, 0, 12);
  if (!reason || !start || !end || start > end || !step1 || !followed || checked === null) return null;
  // A file written before follow_site recorded its threshold carries none: the rule's own 90 days.
  const gapDays = r.gap_days === undefined ? GAP_DAYS : whole(r.gap_days, 1, 365);
  if (gapDays === null) return null;
  const tb = r.tip_bars && typeof r.tip_bars === 'object' ? (r.tip_bars as Record<string, unknown>) : null;
  const tipBars = tb && typeof tb.file === 'string' && TIP_FILE.test(tb.file) ? { file: tb.file } : null;
  let recordBars: Follow['recordBars'] = null;
  if (r.record_bars && typeof r.record_bars === 'object') {
    const rb = r.record_bars as Record<string, unknown>;
    const by = rb.by === 'emit' || rb.by === 'carbon_mapper' ? rb.by : null;
    const date = isoDay(rb.date);
    const days = whole(rb.days_before_tip, -10_000, 10_000);
    const file = typeof rb.file === 'string' && RECORD_FILE.test(rb.file) ? rb.file : null;
    if (by && date && days !== null && file && (by === 'carbon_mapper') === file.startsWith('cmcolumns_')) {
      recordBars = { by, date, file, daysBeforeTip: days };
    }
  }
  return { reason, tip: { start, end }, step1, followed, checked, gapDays, tipBars, recordBars };
}

/** Where follow.json is, once the agent called follow_site this session (or in this replay). */
export function followUrl(dir: string | null, tools: ToolCall[]): string | null {
  return dir && tools.some((t) => t.name === 'follow_site') ? `${dir}follow.json` : null;
}

// --- the words -------------------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

/** "20 June 2026" (the plate) or "20 Jun 2026" (the legend). */
export function dayWords(iso: string, short = false): string {
  const [y, m, d] = ymd(iso);
  return `${d} ${(short ? SHORT : MONTHS)[m - 1]} ${y}`;
}

/** "7 to 21 October 2026", "28 September to 12 October 2026", "28 December 2025 to 10 January 2026". */
export function windowLongWords(start: string, end: string, short = false): string {
  const names = short ? SHORT : MONTHS;
  const [ys, ms, ds] = ymd(start);
  const [ye, me, de] = ymd(end);
  if (ys === ye && ms === me) return `${ds} to ${de} ${names[me - 1]} ${ye}`;
  if (ys === ye) return `${ds} ${names[ms - 1]} to ${de} ${names[me - 1]} ${ye}`;
  return `${dayWords(start, short)} to ${dayWords(end, short)}`;
}

const RANK = ['', 'top', 'second', 'third'];
/** The watch area as a sentence says it ("in the south Caspian"); the stage's own words, never a manifest's. */
const AREA_IN: Record<string, string> = {
  'permian basin': 'the Permian Basin',
  'south caspian': 'the south Caspian',
  'amu darya basin': 'the Amu Darya basin',
  'zagros foreland': 'the Zagros foreland',
  'shanxi coal basin': 'Shanxi',
  'orenburg and lower volga': 'Orenburg and the lower Volga',
  'west siberia and yamal': 'West Siberia',
  'hassi messaoud': 'Hassi Messaoud',
  amman: 'Amman',
};

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function spot(p: FollowPoint): string {
  return `the ${RANK[p.rank]} spot in ${AREA_IN[p.area] ?? 'this area'}`;
}

/** A run of the stage's words; `mono` marks a figure (the Tabular Rule: numbers in the mono face). */
export interface WordPart {
  text: string;
  mono?: boolean;
}

/**
 * The follow decision in the stage's words (one sentence, under the follow step): which spot the
 * agent follows and why, by the 90-day rule, with the gap and the rule's threshold from follow.json's
 * own numbers. "Seen up close" is a fine-scale confirmation (an EMIT pass that saw methane, or a
 * Carbon Mapper plume within 7 km). "Within N days" is the rule; "during this fortnight" is a
 * confirmation inside the tip window.
 */
export function decisionParts(f: Follow): WordPart[] {
  const s1 = f.step1;
  const fo = f.followed;
  const inside = fo.daysBeforeTip !== null && fo.daysBeforeTip <= 0;
  const n = (v: number | null): WordPart => ({ text: days(v ?? 0), mono: true });
  const rule: WordPart = { text: days(f.gapDays), mono: true };
  const t = (text: string): WordPart => ({ text });
  switch (f.reason) {
    case 'newest_confirmation':
      // The rule's step 1 held, so step 2 never ran: the line says the gap, the rule, and that the
      // agent checks no more spots (the replay's switch to a spot ranked 2 or 3 is the other case).
      return inside
        ? [t(`Methane was seen up close at ${spot(fo)} during this fortnight, so the agent stays with it and checks no more spots.`)]
        : [t(`Methane was last seen up close at ${spot(fo)} `), n(fo.daysBeforeTip), t(' before this fortnight, within '), rule,
          t(', so the agent stays with it and checks no more spots.')];
    case 'top_spot_stale_switched':
      if (s1.latest) {
        return [t(`Methane was last seen up close at ${spot(s1)} `), n(s1.daysBeforeTip), t(` before this fortnight, so the agent is following ${spot(fo)}, `),
          ...(inside ? [t('seen up close during this fortnight')] : [t('last seen up close '), n(fo.daysBeforeTip), t(' before')]), t('.')];
      }
      return [t(`Methane has not been seen up close at either top spot, so the agent is following ${spot(fo)}, `),
        ...(inside ? [t('seen up close during this fortnight')] : [t('last seen up close '), n(fo.daysBeforeTip), t(' before this fortnight')]), t('.')];
    case 'top_spot_stale_no_fresher':
      return [t(`Methane was last seen up close at ${spot(s1)} `), n(s1.daysBeforeTip),
        t(` before this fortnight, and at none of the ${f.checked} next spots within `), rule, t(', so the agent stays with it.')];
    case 'stronger_tip':
      return [t(`Methane has not been seen up close at either top spot, or at the ${f.checked} next spots within `), rule,
        t(`, so the agent follows the stronger tip, ${spot(fo)}.`)];
  }
}

/** The follow decision as one sentence (tests, screen readers, the transcript). */
export function decisionWords(f: Follow): string {
  return decisionParts(f).map((p) => p.text).join('');
}

/** The tip bars' plate line: the window once, and what height means. */
export function tipBarsLine(f: Follow): string {
  return `TROPOMI, ${windowLongWords(f.tip.start, f.tip.end)}. Taller bars mean more methane in the air than usual for this area.`;
}

/** The record bars' plate line: whose look, its date once, and how long before the fortnight it was. */
export function recordBarsLine(f: Follow): string | null {
  const r = f.recordBars;
  if (!r) return null;
  const when = r.daysBeforeTip <= 0 ? 'That is within this fortnight.' : `That is ${days(r.daysBeforeTip)} before this fortnight began.`;
  return r.by === 'carbon_mapper'
    ? `Carbon Mapper's image of this plume, ${dayWords(r.date)}. ${when}`
    : `EMIT saw methane here on ${dayWords(r.date)}. ${when}`;
}

export type BarKind = 'tip' | 'emit' | 'carbon_mapper';

function basename(url: string | undefined): string {
  return (url || '').split('/').pop() ?? '';
}

/** The layers list's row names for the bar layers: what they are (the legend rows carry the dates). */
export const BAR_ROWS: Record<BarKind, string> = {
  tip: 'TROPOMI around the site, in 3D',
  emit: 'EMIT pass, in 3D',
  carbon_mapper: 'Carbon Mapper plume, in 3D',
};

/** Which bar layer a columns file is, by its name (the tools' own file names, never a title). */
export function barKind(url: string | undefined): BarKind | null {
  const name = basename(url);
  if (/^tipcolumns_.+\.geojson$/.test(name)) return 'tip';
  if (/^cmcolumns_.+\.geojson$/.test(name)) return 'carbon_mapper';
  if (/^columns_EMIT_.+\.geojson$/.test(name)) return 'emit';
  return null;
}

/** The legend row's name for a bar layer, with its date when follow.json names the file. */
export function barLegendLabel(url: string | undefined, follow: Follow | null | undefined): string | null {
  const kind = barKind(url);
  const name = basename(url);
  if (!kind) return null;
  if (kind === 'tip') {
    return follow?.tipBars?.file === name ? `TROPOMI, ${windowLongWords(follow.tip.start, follow.tip.end, true)}` : 'TROPOMI around the site';
  }
  const r = follow?.recordBars?.file === name ? follow.recordBars : null;
  if (kind === 'carbon_mapper') return r ? `Carbon Mapper plume, ${dayWords(r.date, true)}` : 'Carbon Mapper plume';
  // EMIT's columns carry their scene's day in the file name (the tool's own id).
  const stamp = name.match(/_(?:002|003)_(\d{4})(\d{2})(\d{2})T/);
  const day = r?.date ?? (stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}` : null);
  return day && isoDay(day) ? `EMIT, ${dayWords(day, true)}` : 'EMIT';
}

/** Whether a call put a bar layer from follow.json on the map: which one, or null. */
export function barShown(call: ToolCall, follow: Follow | null): 'tip' | 'record' | null {
  if (!follow || call.name !== 'display_visual') return null;
  const name = basename(typeof call.params?.s3_url === 'string' ? call.params.s3_url : undefined);
  if (follow.tipBars && name === follow.tipBars.file) return 'tip';
  if (follow.recordBars && name === follow.recordBars.file) return 'record';
  return null;
}

/** The same point, to 4 decimals (the tools' manifests key their points so). */
export function samePoint(p: { lat: number; lon: number }, lat: unknown, lon: unknown): boolean {
  const la = typeof lat === 'number' ? lat : typeof lat === 'string' ? Number(lat) : NaN;
  const lo = typeof lon === 'number' ? lon : typeof lon === 'string' ? Number(lon) : NaN;
  return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la - p.lat) < 0.006 && Math.abs(lo - p.lon) < 0.006;
}
