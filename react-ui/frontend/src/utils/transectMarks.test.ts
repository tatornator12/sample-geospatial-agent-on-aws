import { describe, expect, it } from 'vitest';
import { heightText, markFigure, markRoles, roundTenths, stageMarkLabel, stageTransectFeatures } from './transectMarks.ts';

// The Great Circle's marks as measure_profile wrote them (use-cases/archaeologist-great-circle/
// profile_newark-great-circle.geojson): the labels are Python's, half to even (2.25 is "+2.2 m").
const MARKS = [
  { kind: 'bank', offset_m: 1.81, at_m: 33, label: 'bank +1.8 m' },
  { kind: 'ditch', offset_m: -2.54, at_m: 45, label: 'ditch −2.5 m' },
  { kind: 'bank', offset_m: 2.02, at_m: 208, label: 'bank +2.0 m' },
  { kind: 'bank', offset_m: 2.25, at_m: 227, label: 'bank +2.2 m' },
  { kind: 'ditch', offset_m: -2.68, at_m: 383, label: 'ditch −2.7 m' },
  { kind: 'bank', offset_m: 2.62, at_m: 395, label: 'bank +2.6 m' },
];
type F = { type: string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const FEATURES: F[] = [
  { type: 'Feature', properties: { kind: 'transect', label: 'east-west through the centre (430 m)' }, geometry: { type: 'LineString', coordinates: [[-82.433615, 40.040979], [-82.428576, 40.041042]] } },
  ...MARKS.map((p, i) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [-82.4336 + i * 0.001, 40.041] } })),
];

describe('one rounding for every height the stage prints', () => {
  it('rounds an exact tie to the even tenth, as the tool does, and anything else to the nearest', () => {
    expect(roundTenths(2.25)).toBe(2.2);   // the Eagle Mound crest: +2.2 m, never +2.3 m
    expect(roundTenths(2.75)).toBe(2.8);
    expect(roundTenths(-2.25)).toBe(-2.2);
    expect(roundTenths(0.25)).toBe(0.2);
    expect(roundTenths(2.24)).toBe(2.2);
    expect(roundTenths(2.62)).toBe(2.6);
    expect(roundTenths(-2.68)).toBe(-2.7);
    expect(roundTenths(2.65)).toBe(2.6);   // 2.65 is a little under 2.65 in binary: not a tie
    expect(roundTenths(2.45)).toBe(2.5);   // and 2.45 a little over
  });

  it('writes a signed height with a true minus sign', () => {
    expect(heightText(2.25)).toBe('+2.2 m');
    expect(heightText(-2.54)).toBe('−2.5 m');
    expect(heightText(0.04)).toBe('0.0 m');
    expect(heightText(-0.04)).toBe('0.0 m');
    expect(heightText(1)).toBe('+1.0 m');
  });

  it("takes a mark's figure from the tool's label, else rounds its offset alike", () => {
    expect(markFigure(2.25, 'bank +2.2 m')).toBe('+2.2 m');
    expect(markFigure(-2.54, 'ditch −2.5 m')).toBe('−2.5 m');
    expect(markFigure(-2.54, 'ditch -2.5 m')).toBe('−2.5 m');
    expect(markFigure(2.25, '')).toBe('+2.2 m');
    expect(markFigure(2.25, 'crest')).toBe('+2.2 m');
  });
});

describe('the marks that define the span', () => {
  it('reads the Great Circle as outer banks, inner ditches and two rises inside the ring', () => {
    const roles = markRoles(MARKS.map((m) => ({ kind: m.kind, atM: m.at_m })));
    expect(roles).toEqual(['outer-bank', 'inner-ditch', 'interior', 'interior', 'inner-ditch', 'outer-bank']);
  });

  it('keeps the order it was given', () => {
    const shuffled = [MARKS[3], MARKS[0], MARKS[5], MARKS[1], MARKS[4], MARKS[2]];
    expect(markRoles(shuffled.map((m) => ({ kind: m.kind, atM: m.at_m })))).toEqual(
      ['interior', 'outer-bank', 'outer-bank', 'inner-ditch', 'inner-ditch', 'interior'],
    );
  });

  it('gives "other" to every mark of a section without that shape', () => {
    expect(markRoles([{ kind: 'bank', atM: 10 }, { kind: 'ditch', atM: 20 }])).toEqual(['other', 'other']);
    expect(markRoles([{ kind: 'bank', atM: 10 }, { kind: 'bank', atM: 90 }])).toEqual(['other', 'other']);
    expect(markRoles([{ kind: 'ditch', atM: 5 }, { kind: 'bank', atM: 10 }, { kind: 'bank', atM: 90 }])).toEqual(['other', 'other', 'other']);
    expect(markRoles([])).toEqual([]);
  });

  it('calls a crest inside the ring a rise and keeps the tool\'s words for the rest', () => {
    expect(stageMarkLabel('bank', 'bank +2.2 m', 2.25, 'interior')).toBe('rise +2.2 m');
    expect(stageMarkLabel('bank', 'bank +2.6 m', 2.62, 'outer-bank')).toBe('bank +2.6 m');
    expect(stageMarkLabel('ditch', 'ditch −2.7 m', -2.68, 'inner-ditch')).toBe('ditch −2.7 m');
    expect(stageMarkLabel('ditch', 'ditch −0.4 m', -0.4, 'interior')).toBe('ditch −0.4 m');
    expect(stageMarkLabel('bank', '', 2.25, 'other')).toBe('bank +2.2 m');
  });
});

describe('the transect on the map', () => {
  it('labels the four marks that define the span and leaves the rises to the section', () => {
    const out = stageTransectFeatures(FEATURES);
    const labels = out.slice(1).map((f) => f.properties?.stage_label);
    expect(labels).toEqual(['bank +1.8 m', 'ditch −2.5 m', '', '', 'ditch −2.7 m', 'bank +2.6 m']);
    expect(out[0]).toBe(FEATURES[0]); // the line is untouched
    expect(FEATURES[3].properties).not.toHaveProperty('stage_label'); // copies, not edits
  });

  it('reads the label from the property the hint names', () => {
    const named: F[] = FEATURES.map((f) => ({ ...f, properties: { ...f.properties, words: f.properties.label, label: undefined } }));
    expect(stageTransectFeatures(named, 'words').slice(1).map((f) => f.properties?.stage_label)[0]).toBe('bank +1.8 m');
  });
});
