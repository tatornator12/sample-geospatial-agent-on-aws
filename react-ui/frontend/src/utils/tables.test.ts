import { describe, expect, it } from 'vitest';
import { blankDashCells, capTableRows, twoColumnTables } from './tables.ts';

// The Great Circle answer as Sonnet 4.6 wrote it on Oct 14 (three columns, dashes for nothing).
const THREE = [
  '**The Great Circle Earthworks spans 362 m measured, about 366 m documented.**',
  '| Feature | Measured value | Documented value |',
  '|---|---|---|',
  '| Outer bank to outer bank | 362 m | ~366 m (nearly 1,200 ft) |',
  '| West interior ditch | -2.54 m below baseline | (interior ditch, record form) |',
  '| Max relief (bank crest to ditch floor) | 5.3 m | — |',
  '| Gateway width | — | nearly 200 ft |',
  '| Eagle Mound | at centre | record form |',
  'Culture: Hopewell.',
].join('\n');

describe('twoColumnTables', () => {
  it('folds a third column into the second, header included', () => {
    const out = twoColumnTables(THREE).split('\n');
    expect(out[1]).toBe('| Feature | Measured value (documented value) |');
    expect(out[2]).toBe('|---|---|');
    expect(out[3]).toBe('| Outer bank to outer bank | 362 m (~366 m (nearly 1,200 ft)) |');
    expect(out[4]).toBe('| West interior ditch | -2.54 m below baseline (interior ditch, record form) |');
  });

  it('drops a dash-only cell instead of printing it', () => {
    const out = twoColumnTables(THREE).split('\n');
    expect(out[5]).toBe('| Max relief (bank crest to ditch floor) | 5.3 m |');
    expect(out[6]).toBe('| Gateway width | nearly 200 ft |');
    expect(out[7]).toBe('| Eagle Mound | at centre (record form) |');
  });

  it('leaves the prose around the table and a two-column table alone', () => {
    const out = twoColumnTables(THREE).split('\n');
    expect(out[0]).toBe('**The Great Circle Earthworks spans 362 m measured, about 366 m documented.**');
    expect(out[8]).toBe('Culture: Hopewell.');
    const two = '| | |\n|---|---|\n| Culture | Hopewell |\n| Period | 1 to 400 CE |';
    expect(twoColumnTables(two)).toBe(two);
    expect(twoColumnTables('no table here\n| a lone pipe line')).toBe('no table here\n| a lone pipe line');
  });

  it('drops a lone "," cell (a dash the punctuation already reached) the way it drops a dash', () => {
    expect(twoColumnTables('| Metric | Value | Note |\n|---|---|---|\n| Mean NDVI | 0.65 | , |').split('\n')[2]).toBe('| Mean NDVI | 0.65 |');
  });

  it('reads four or more columns as a list of values, with no brackets, and keeps an escaped pipe inside a cell (B5)', () => {
    const four = '| Site | Form | km | Designation |\n|:--|:--|--:|:--|\n| Seip | circle | 112 | World Heritage |\n| Fort Hill | a \\| b | 133 | NRHP |';
    expect(twoColumnTables(four).split('\n')).toEqual([
      '| Site | Form · km · Designation |',
      '|---|---|',
      '| Seip | circle · 112 · World Heritage |',
      '| Fort Hill | a \\| b · 133 · NRHP |',
    ]);
  });
});

describe('blankDashCells', () => {
  it('empties an em dash, an en dash, a hyphen and a lone comma cell, in any number of columns', () => {
    const table = [
      '| Metric | Value | Note |',
      '|---|---|---|',
      '| Mean NDVI | 0.65 | — |',
      '| Median NDVI | 0.83 | – |',
      '| Water | - | , |',
      '| Dense | 80% | of the park |',
    ].join('\n');
    expect(blankDashCells(table).split('\n')).toEqual([
      '| Metric | Value | Note |',
      '|---|---|---|',
      '| Mean NDVI | 0.65 |  |',
      '| Median NDVI | 0.83 |  |',
      '| Water |  |  |',
      '| Dense | 80% | of the park |',
    ]);
    expect(blankDashCells('| Check | Result |\n|---|---|\n| Cloud | — |')).toBe('| Check | Result |\n|---|---|\n| Cloud |  |');
  });

  it('keeps the delimiter row, a cell with words around a dash, an escaped pipe and the prose as written', () => {
    const text = [
      'Mostly dense — the Reservoir is water.',
      '| a | b |',
      '|:--|--:|',
      '| 2024 — 2025 | a \\| b |',
      '- a list item, not a cell',
      '| a lone pipe line',
      '| — |',
    ].join('\n');
    expect(blankDashCells(text)).toBe(text);
  });
});

// The Permian ranking as the Methane Hunter wrote it (act2 review P1-3): ten rows, six columns.
const RANKING = [
  'The strongest plume in the Permian was near Midland, TX, on 2024-01-31.',
  '',
  '| Rank | Date | Peak ppm·m | Area km² | Hours | Place |',
  '|---|---|---|---|---|---|',
  ...Array.from({ length: 10 }, (_, i) => `| ${i + 1} | 2024-01-${String(31 - i).padStart(2, '0')} | ${(8130.7 - i * 100).toFixed(1)} | 1,435.4 | 2.0 | Midland, TX (Midland County) |`),
  '',
  'Rank 1 is the one to watch.',
].join('\n');

describe('a ranking (B5: answers bury the steps)', () => {
  it('folds six columns to one list of values per row, no nested parentheses', () => {
    const out = twoColumnTables(RANKING).split('\n');
    expect(out[2]).toBe('| Rank | Date · Peak ppm·m · Area km² · Hours · Place |');
    expect(out[4]).toBe('| 1 | 2024-01-31 · 8130.7 · 1,435.4 · 2.0 · Midland, TX (Midland County) |');
    expect(out[4]).not.toMatch(/\(\d/);
  });

  it('keeps five rows, then says how many more the transcript has', () => {
    const out = capTableRows(twoColumnTables(RANKING), 5).split('\n');
    const rows = out.filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(5);
    expect(rows[4]).toMatch(/^\| 5 \|/);
    const marker = out.indexOf('*+5 more rows in the transcript*');
    expect(marker).toBeGreaterThan(0);
    // A blank line before it (never read as a row) and before the prose after it.
    expect(out[marker - 1]).toBe('');
    expect(out[marker + 1]).toBe('');
    expect(out[out.length - 1]).toBe('Rank 1 is the one to watch.');
  });

  it('leaves a short table, a three-column measured and documented table and a two-column table as they were', () => {
    expect(capTableRows(THREE, 5)).toBe(THREE);
    expect(twoColumnTables(THREE).split('\n')[1]).toBe('| Feature | Measured value (documented value) |');
    const two = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(capTableRows(two, 5)).toBe(two);
    const six = `| a | b |\n|---|---|\n${[1, 2, 3, 4, 5, 6].map((n) => `| ${n} | x |`).join('\n')}`;
    expect(capTableRows(six, 5).split('\n').slice(-1)[0]).toBe('*+1 more row in the transcript*');
  });
});
