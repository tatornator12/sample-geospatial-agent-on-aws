/**
 * The stage's tables: two columns at most. The prompts ask the agents for two-column tables with
 * the documented figure beside the measurement in the same cell; when a model writes three or
 * more anyway, the step column (about 350 px wide) cannot show them, so the stage folds every
 * column after the second into the second: "362 m | ~366 m" becomes "362 m (~366 m)", and the
 * header "Measured | Documented" becomes "Measured (documented)". A cell that is only a dash (the
 * model's "nothing here") is dropped rather than printed as a comma.
 */

const DASH_ONLY = /^[\s\u2013\u2014-]*$/;
const TABLE_ROW = /^\s*\|/;
const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

function fold(cells: string[], isHeader: boolean): [string, string] {
  const first = cells[0] ?? '';
  const second = DASH_ONLY.test(cells[1] ?? '') ? '' : (cells[1] ?? '');
  const extras = cells.slice(2).filter((c) => !DASH_ONLY.test(c));
  if (extras.length === 0) return [first, second];
  const joined = extras.join('; ');
  if (!second) return [first, joined];
  // An extra already in parentheses sits beside the value as it is; anything else is wrapped.
  const wrapped = /^\(.*\)$/.test(joined) ? joined : `(${isHeader ? joined.toLowerCase() : joined})`;
  return [first, `${second} ${wrapped}`];
}

/** Fold every markdown table in `text` with more than two columns down to two. */
export function twoColumnTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const startsTable = TABLE_ROW.test(lines[i]) && i + 1 < lines.length && DELIMITER_ROW.test(lines[i + 1]);
    if (!startsTable) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && TABLE_ROW.test(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }
    const header = splitRow(block[0]);
    if (header.length <= 2) {
      out.push(...block);
      continue;
    }
    const [h1, h2] = fold(header, true);
    out.push(`| ${h1} | ${h2} |`, '|---|---|');
    for (const line of block.slice(2)) {
      const [c1, c2] = fold(splitRow(line), false);
      out.push(`| ${c1} | ${c2} |`);
    }
  }
  return out.join('\n');
}
