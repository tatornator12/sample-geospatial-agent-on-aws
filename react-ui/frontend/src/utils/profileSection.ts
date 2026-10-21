/**
 * The cross-section: the measured ground along the archaeologist's transect, drawn in the step
 * column as the measurement lands. `measure_profile` writes the line's samples into the transect
 * GeoJSON (every metre or so, offsets from the baseline) and each bank and ditch as a point that
 * knows where it sits along the line; this module turns that into an SVG the room can read, with
 * the heights on a labelled axis (a 430 m line a few metres high needs vertical exaggeration,
 * and the axis says so instead of a footnote).
 */
import type { Feature } from 'geojson';
import { heightText, markRoles, stageMarkLabel, type MarkRole } from './transectMarks.ts';

export interface ProfileMark {
  kind: 'bank' | 'ditch';
  atM: number;
  offsetM: number;
  /** As the stage prints it: the tool's label, a crest inside the ring as a "rise" (utils/transectMarks.ts). */
  label: string;
  role: MarkRole;
}

export interface ProfileData {
  siteId: string;
  label: string;
  lengthM: number;
  baselineM: number;
  spanM: number | null;
  maxReliefM: number | null;
  /** [distance along the line in m, height above the baseline in m or null where the LiDAR has a gap]. */
  samples: Array<[number, number | null]>;
  marks: ProfileMark[];
}

const PROFILE_FILE = /profile_([a-z0-9][a-z0-9-]{1,63})\.geojson$/i;
const MAX_SAMPLES = 1200;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The site id a transect file is named for, or null. */
export function profileSiteId(sourceUrl: string | undefined): string | null {
  const m = (sourceUrl || '').match(PROFILE_FILE);
  return m ? m[1].toLowerCase() : null;
}

/** A section from the transect GeoJSON the tool wrote, or null when the line carries no samples. */
export function profileFromFeatures(features: Feature[], sourceUrl: string | undefined): ProfileData | null {
  const siteId = profileSiteId(sourceUrl);
  if (!siteId) return null;
  const line = features.find((f) => f.geometry?.type === 'LineString' && f.properties?.kind === 'transect');
  const p = (line?.properties ?? {}) as Record<string, unknown>;
  if (!Array.isArray(p.profile) || p.profile.length < 2) return null;
  const samples: Array<[number, number | null]> = [];
  for (const row of p.profile.slice(0, MAX_SAMPLES)) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const d = num(row[0]);
    if (d === null) continue;
    samples.push([d, num(row[1])]);
  }
  if (samples.length < 2) return null;
  const read: Array<Omit<ProfileMark, 'role'>> = [];
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue;
    const q = (f.properties ?? {}) as Record<string, unknown>;
    const atM = num(q.at_m);
    const offsetM = num(q.offset_m);
    if ((q.kind !== 'bank' && q.kind !== 'ditch') || atM === null || offsetM === null) continue;
    read.push({ kind: q.kind, atM, offsetM, label: typeof q.label === 'string' ? q.label.slice(0, 24) : '' });
  }
  read.sort((a, b) => a.atM - b.atM);
  const roles = markRoles(read);
  const marks: ProfileMark[] = read.map((m, i) => ({
    ...m,
    role: roles[i],
    label: stageMarkLabel(m.kind, m.label, m.offsetM, roles[i]),
  }));
  return {
    siteId,
    label: typeof p.label === 'string' ? p.label.slice(0, 80) : '',
    lengthM: num(p.length_m) ?? samples[samples.length - 1][0],
    baselineM: num(p.baseline_m) ?? 0,
    spanM: num(p.outer_banks_span_m),
    maxReliefM: num(p.max_relief_m),
    samples,
    marks,
  };
}

export interface SectionLayout {
  width: number;
  height: number;
  /** The ground, as SVG path data; a gap in the LiDAR breaks the line. */
  path: string;
  /** The same ground closed down to the baseline, for a faint wash under the line. */
  fill: string;
  baselineY: number;
  /** The left edge of the plot (the axis labels sit to its left). */
  x0: number;
  x1: number;
  xFor: (m: number) => number;
  yFor: (m: number) => number;
  /** Horizontal rules with their labels, three at most: "+2 m", "0", "−2 m". */
  ticks: Array<{ y: number; label: string }>;
  /**
   * Every bank and ditch gets its mark; only the tallest bank and the deepest ditch get a label
   * (the two figures the answer quotes), so the section reads from the back of the room.
   */
  marks: Array<ProfileMark & { x: number; y: number; labelled: boolean; labelY: number; anchor: 'start' | 'middle' | 'end' }>;
  /** Vertical exaggeration of the drawing, for the description. */
  exaggeration: number;
}

const fmt = (m: number) => (m > 0 ? `+${m} m` : m < 0 ? `−${Math.abs(m)} m` : '0');

/**
 * Pixel geometry for a section `width` × `height` px. The plot leaves a gutter on the left for the
 * axis labels and room above and below for the mark labels; heights span the data, padded, and
 * always include the baseline.
 */
export function sectionLayout(p: ProfileData, width: number, height: number): SectionLayout {
  const gutter = 46;
  // Room above for the bank's label and below for the ditch's (15 px mono, centred 14 px off the mark).
  const padTop = 24, padBottom = 24;
  const x0 = gutter, x1 = Math.max(gutter + 40, width - 8);
  const heights = p.samples.map((s) => s[1]).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...heights, ...p.marks.map((m) => m.offsetM));
  const hi = Math.max(0, ...heights, ...p.marks.map((m) => m.offsetM));
  const span = Math.max(1, hi - lo);
  const yTop = padTop, yBottom = height - padBottom;
  const yFor = (m: number) => yBottom - ((m - lo) / span) * (yBottom - yTop);
  const length = Math.max(1, p.lengthM);
  const xFor = (m: number) => x0 + (Math.min(length, Math.max(0, m)) / length) * (x1 - x0);

  let path = '';
  let open = false;
  for (const [d, z] of p.samples) {
    if (z === null) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${xFor(d).toFixed(1)} ${yFor(z).toFixed(1)}`;
    open = true;
  }
  // The wash: the ground over the baseline, run by run, closed to the baseline.
  const baselineY = yFor(0);
  let fill = '';
  let runStart: number | null = null;
  let last: [number, number] | null = null;
  const closeRun = () => {
    if (runStart !== null && last) fill += `L${last[0].toFixed(1)} ${baselineY.toFixed(1)}L${runStart.toFixed(1)} ${baselineY.toFixed(1)}Z`;
    runStart = null;
    last = null;
  };
  for (const [d, z] of p.samples) {
    if (z === null) {
      closeRun();
      continue;
    }
    const x = xFor(d), y = yFor(z);
    if (runStart === null) {
      runStart = x;
      fill += `M${x.toFixed(1)} ${baselineY.toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      fill += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    last = [x, y];
  }
  closeRun();

  // Three rules at most, on whole metres (1, 2, 5 or 10 apart), always the baseline: a 128 px
  // section with a rule a metre is a ladder, not an axis.
  const step = [1, 2, 5, 10].find((s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= 3) ?? 20;
  const ticks: Array<{ y: number; label: string }> = [];
  for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k += 1) ticks.push({ y: yFor(k * step), label: fmt(k * step) });
  if (!ticks.some((t) => t.label === '0')) ticks.push({ y: baselineY, label: '0' });

  // The two figures the answer quotes: the tallest bank (label above its dot) and the deepest
  // ditch (label below its ring). Near an end of the line a label anchors to the end it is near.
  const tallest = p.marks.reduce<ProfileMark | null>((a, m) => (m.kind === 'bank' && (!a || m.offsetM > a.offsetM) ? m : a), null);
  const deepest = p.marks.reduce<ProfileMark | null>((a, m) => (m.kind === 'ditch' && (!a || m.offsetM < a.offsetM) ? m : a), null);
  const labelHalf = 52;
  const marks = p.marks.map((m) => {
    const x = xFor(m.atM), y = yFor(m.offsetM);
    const anchor: 'start' | 'middle' | 'end' = x - labelHalf < x0 ? 'start' : x + labelHalf > x1 ? 'end' : 'middle';
    return { ...m, x, y, labelled: m === tallest || m === deepest, labelY: y + (m.kind === 'bank' ? -14 : 14), anchor };
  });

  const exaggeration = ((yBottom - yTop) / span) / ((x1 - x0) / length);
  return { width, height, path, fill, baselineY, x0, x1, xFor, yFor, ticks, marks, exaggeration: Math.round(exaggeration) };
}

/**
 * The cursor. The presenter runs a finger along the section (or along the line on the map) and
 * both show the same spot: the section a rule and a dot at that distance, the map a dot at the
 * same point on the transect. These helpers are the arithmetic both sides share.
 */

/** The ground's height above the baseline `atM` metres along the line, or null in a LiDAR gap. */
export function heightAt(p: ProfileData, atM: number): number | null {
  const s = p.samples;
  if (s.length === 0 || !Number.isFinite(atM)) return null;
  if (atM <= s[0][0]) return s[0][1];
  if (atM >= s[s.length - 1][0]) return s[s.length - 1][1];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= atM) lo = mid;
    else hi = mid;
  }
  const [d0, z0] = s[lo];
  const [d1, z1] = s[hi];
  if (z0 === null || z1 === null) return null;
  const f = d1 > d0 ? (atM - d0) / (d1 - d0) : 0;
  return z0 + (z1 - z0) * f;
}

/** The distance along the line a pixel column of the section stands for, clamped to the line. */
export function distanceAtX(layout: Pick<SectionLayout, 'x0' | 'x1'>, lengthM: number, x: number): number {
  const span = Math.max(1, layout.x1 - layout.x0);
  return (Math.min(1, Math.max(0, (x - layout.x0) / span))) * Math.max(0, lengthM);
}

/** "at 312 m, +1.4 m": where the cursor is and how high the ground stands there. */
export function cursorWords(atM: number, height: number | null): string {
  const at = `at ${Math.round(atM)} m`;
  if (height === null) return `${at}, no LiDAR return`;
  // Rounded the way the marks are, so the cursor on a mark reads the mark's own figure.
  return `${at}, ${heightText(height)}`;
}

type LngLat = [number, number];
const M_PER_DEG = 111_320;

/** A polyline in local metres (equirectangular about its first vertex): ample for a 2 km line. */
function localMetres(coords: LngLat[]): Array<[number, number]> {
  const k = Math.cos(((coords[0]?.[1] ?? 0) * Math.PI) / 180);
  return coords.map(([lng, lat]) => [(lng - coords[0][0]) * M_PER_DEG * k, (lat - coords[0][1]) * M_PER_DEG]);
}

/** The point a share `f` of the way along a polyline, by ground length. */
export function pointAlong(coords: LngLat[], f: number): LngLat | null {
  if (coords.length < 2) return null;
  const m = localMetres(coords);
  const seg = m.slice(1).map((p, i) => Math.hypot(p[0] - m[i][0], p[1] - m[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total <= 0) return coords[0];
  let want = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < seg.length; i += 1) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(1, want / seg[i]) : 0;
      const [a, b] = [coords[i], coords[i + 1]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    want -= seg[i];
  }
  return coords[coords.length - 1];
}

/** The share of the way along a polyline of the point on it nearest `p`, by ground length. */
export function nearestAlong(coords: LngLat[], p: LngLat): number | null {
  if (coords.length < 2) return null;
  const m = localMetres([...coords, p]);
  const q = m.pop()!;
  let best = Infinity, bestAt = 0, run = 0;
  for (let i = 0; i + 1 < m.length; i += 1) {
    const [ax, ay] = m[i], [bx, by] = m[i + 1];
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((q[0] - ax) * vx + (q[1] - ay) * vy) / len2)) : 0;
    const d = Math.hypot(ax + vx * t - q[0], ay + vy * t - q[1]);
    const len = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestAt = run + t * len;
    }
    run += len;
  }
  return run > 0 ? bestAt / run : 0;
}

/** One sentence for the room and the screen reader: what the section shows. */
export function sectionDescription(p: ProfileData, exaggeration: number): string {
  // Each mark in the words the map prints (the tool's own figure), not re-rounded here.
  const marks = p.marks.map((m) => `${m.label || `${m.kind} ${heightText(m.offsetM)}`} at ${Math.round(m.atM)} m`).join(', ');
  const span = p.spanM !== null ? `, ${Math.round(p.spanM)} m bank to bank` : '';
  return `Cross-section along the transect, ${Math.round(p.lengthM)} m, heights about ${exaggeration} times exaggerated${span}${marks ? `: ${marks}` : ''}.`;
}
