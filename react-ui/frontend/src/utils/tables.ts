/**
 * The stage's tables: two columns at most. The prompts ask the agents for two-column tables with
 * the documented figure beside the measurement in the same cell; when a model writes three or
 * more anyway, the step column (about 350 px wide) cannot show them, so the stage folds every
 * column after the second into the second: "362 m | ~366 m" becomes "362 m (~366 m)", and the
 * header "Measured | Documented" becomes "Measured (documented)". A cell that is only a dash (the
 * model's "nothing here") is dropped rather than printed as a comma: blankDashCells empties it
 * before the stage's punctuation (utils/caption.ts) would turn the dash into "," and the fold
 * into "(,)". A lone "," (a dash the punctuation already reached) counts as a dash.
 *
 * A table of four or more columns (a ranking) reads as a list of values instead: the extras join
 * the second with " · " and no brackets ("2024-01-31 · 8,130.7 · Midland, TX"), so a row never
 * nests parentheses. The step column shows five rows of any table at most (capTableRows); the
 * transcript keeps every row.
 */

const DASH_ONLY = /^[\s\u2013\u2014,-]*$/;
const TABLE_ROW = /^\s*\|/;
const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

function fold(cells: string[], isHeader: boolean, columns: number): [string, string] {
  const first = cells[0] ?? '';
  const second = DASH_ONLY.test(cells[1] ?? '') ? '' : (cells[1] ?? '');
  const extras = cells.slice(2).filter((c) => !DASH_ONLY.test(c));
  if (extras.length === 0) return [first, second];
  if (columns >= 4) return [first, [second, ...extras].filter(Boolean).join(' · ')];
  const joined = extras.join('; ');
  if (!second) return [first, joined];
  // An extra already in parentheses sits beside the value as it is; anything else is wrapped.
  const wrapped = /^\(.*\)$/.test(joined) ? joined : `(${isHeader ? joined.toLowerCase() : joined})`;
  return [first, `${second} ${wrapped}`];
}

/**
 * Every markdown table's dash-only cells ("—", "–", "-", or a lone ",") emptied, in any number of
 * columns; the delimiter row, the other cells and the text around the tables stay as written.
 */
export function blankDashCells(text: string): string {
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
    let row = 0;
    while (i < lines.length && TABLE_ROW.test(lines[i])) {
      const line = lines[i];
      const cells = row === 1 ? [] : splitRow(line);   // row 1 is the delimiter
      out.push(cells.some((c) => c !== '' && DASH_ONLY.test(c))
        ? `| ${cells.map((c) => (DASH_ONLY.test(c) ? '' : c)).join(' | ')} |`
        : line);
      row += 1;
      i += 1;
    }
  }
  return out.join('\n');
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
    const [h1, h2] = fold(header, true, header.length);
    out.push(`| ${h1} | ${h2} |`, '|---|---|');
    for (const line of block.slice(2)) {
      const [c1, c2] = fold(splitRow(line), false, header.length);
      out.push(`| ${c1} | ${c2} |`);
    }
  }
  return out.join('\n');
}

/**
 * Every markdown table cut to its first `max` data rows; a cut table is followed by one italic
 * line, "+N more rows in the transcript" (the stage prints it in label grey: stage.css), after a
 * blank line so it is never read as another row. The text around the tables stays as written.
 */
export function capTableRows(text: string, max: number): string {
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
    const more = block.length - 2 - max;
    if (more <= 0) {
      out.push(...block);
      continue;
    }
    out.push(...block.slice(0, 2 + max), '', `*+${more} more ${more === 1 ? 'row' : 'rows'} in the transcript*`);
    if (i < lines.length && lines[i].trim() !== '') out.push('');
  }
  return out.join('\n');
}
