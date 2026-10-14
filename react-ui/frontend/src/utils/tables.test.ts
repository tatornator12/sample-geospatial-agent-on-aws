import { describe, expect, it } from 'vitest';
import { twoColumnTables } from './tables.ts';

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

  it('folds four columns and keeps an escaped pipe inside a cell', () => {
    const four = '| Site | Form | km | Designation |\n|:--|:--|--:|:--|\n| Seip | circle | 112 | World Heritage |\n| Fort Hill | a \\| b | 133 | NRHP |';
    expect(twoColumnTables(four).split('\n')).toEqual([
      '| Site | Form (km; designation) |',
      '|---|---|',
      '| Seip | circle (112; World Heritage) |',
      '| Fort Hill | a \\| b (133; NRHP) |',
    ]);
  });
});
