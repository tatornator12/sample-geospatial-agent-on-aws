/**
 * The transect's marks as the stage prints them, on the map and in the column alike.
 *
 * `measure_profile` labels every crest a "bank" and every trough a "ditch", and writes the label
 * with Python's rounding (half to even: 2.25 is "+2.2 m"). Read across the Great Circle that gives
 * six labels: the two outer banks, the two inner ditches, and two "banks" inside the ring, which is
 * where the record has Eagle Mound. The map printed all six over each other, and the column
 * re-rounded the figures itself (`toFixed`: 2.25 is "+2.3 m"), so one mark read two ways (Act 4,
 * P1-1 and P1-2). Here:
 *  - one figure per mark, from one source: the tool's own label, and the same rounding wherever
 *    the stage rounds a height itself (`heightText`);
 *  - each mark's part in the section (`markRoles`): the map labels only the four marks that define
 *    the span, and a crest inside the ring is a "rise", not a bank.
 */

export type MarkRole = 'outer-bank' | 'inner-ditch' | 'interior' | 'other';

/** A height to the tenth of a metre, the way the tool rounds: an exact tie goes to the even tenth. */
export function roundTenths(m: number): number {
  // Only a multiple of 0.25 that is not one of 0.5 is an exact tie at one decimal in binary;
  // anything else rounds to the nearest tenth, which toFixed computes exactly.
  if (Number.isInteger(m * 4) && !Number.isInteger(m * 2)) {
    const below = Math.floor(m * 10);
    return (below % 2 === 0 ? below : below + 1) / 10;
  }
  return Number(m.toFixed(1));
}

/** "+2.2 m", "−2.5 m", "0.0 m": a signed height at one decimal, with a true minus sign. */
export function heightText(m: number): string {
  const r = roundTenths(m);
  if (r > 0) return `+${r.toFixed(1)} m`;
  if (r < 0) return `−${Math.abs(r).toFixed(1)} m`;
  return '0.0 m';
}

const FIGURE = /([+\-−])\s?(\d+(?:\.\d+)?)\s?m\b/;

/** A mark's figure: the one in the tool's label ("+2.2 m" in "bank +2.2 m"), else its offset rounded alike. */
export function markFigure(offsetM: number, label: string): string {
  const m = (label || '').match(FIGURE);
  if (m) return `${m[1] === '+' ? '+' : '−'}${m[2]} m`;
  return heightText(offsetM);
}

/**
 * Each mark's part in the section, in the order given. With two banks or more and a ditch inside
 * them: the first and last bank along the line are the outer banks, the first ditch after the
 * first and the last before the last are the inner ditches, and everything between the inner
 * ditches is interior. Anything else (and every mark of a section without that shape) is "other".
 */
export function markRoles(marks: ReadonlyArray<{ kind: unknown; atM: number | null }>): MarkRole[] {
  const roles: MarkRole[] = marks.map(() => 'other');
  const at = (i: number) => marks[i].atM as number;
  const placed = marks.map((_, i) => i).filter((i) => typeof marks[i].atM === 'number' && Number.isFinite(marks[i].atM));
  const banks = placed.filter((i) => marks[i].kind === 'bank').sort((a, b) => at(a) - at(b));
  if (banks.length < 2) return roles;
  const first = banks[0];
  const last = banks[banks.length - 1];
  const ditches = placed
    .filter((i) => marks[i].kind === 'ditch' && at(i) > at(first) && at(i) < at(last))
    .sort((a, b) => at(a) - at(b));
  if (ditches.length === 0) return roles;
  const innerFirst = ditches[0];
  const innerLast = ditches[ditches.length - 1];
  roles[first] = 'outer-bank';
  roles[last] = 'outer-bank';
  roles[innerFirst] = 'inner-ditch';
  roles[innerLast] = 'inner-ditch';
  for (const i of placed) {
    if (at(i) > at(innerFirst) && at(i) < at(innerLast)) roles[i] = 'interior';
  }
  return roles;
}

/** The words for a mark: the tool's label, except that a crest inside the ring is a "rise". */
export function stageMarkLabel(kind: 'bank' | 'ditch', label: string, offsetM: number, role: MarkRole): string {
  const figure = markFigure(offsetM, label);
  if (role === 'interior' && kind === 'bank') return `rise ${figure}`;
  return label || `${kind} ${figure}`;
}

type Feature = { type?: string; properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } | null };

/**
 * The transect's features for the map, each bank and ditch with a `stage_label`: its label for the
 * marks that define the span (and for every mark of a section without that shape), and nothing for
 * the marks inside the ring, which the section reads instead. The features are copies.
 */
export function stageTransectFeatures<F extends Feature>(features: F[], labelKey: string = 'label'): F[] {
  const isMark = (f: F) => f?.geometry?.type === 'Point' && (f.properties?.kind === 'bank' || f.properties?.kind === 'ditch');
  const marks = features.filter(isMark);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const roles = markRoles(marks.map((f) => ({ kind: f.properties?.kind, atM: num(f.properties?.at_m) })));
  const roleOf = new Map(marks.map((f, i) => [f, roles[i]]));
  return features.map((f) => {
    const role = roleOf.get(f);
    if (!role) return f;
    const raw = f.properties?.[labelKey];
    const label = typeof raw === 'string' ? raw : '';
    return { ...f, properties: { ...f.properties, stage_label: role === 'interior' ? '' : label } };
  });
}
