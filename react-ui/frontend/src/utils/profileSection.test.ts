import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import {
  cursorWords,
  distanceAtX,
  heightAt,
  nearestAlong,
  pointAlong,
  profileFromFeatures,
  profileSiteId,
  sectionDescription,
  sectionLayout,
} from './profileSection.ts';

// What measure_profile writes for the Great Circle (shortened): the line with its samples, the marks.
const URL = 's3://b/session_data/abc/terrain/profile_newark-great-circle.geojson';
const samples: Array<[number, number | null]> = [];
for (let d = 0; d <= 430; d += 10) {
  const r = Math.abs(d - 215);
  const z = 2.5 * Math.exp(-(((r - 181) / 6) ** 2)) - 2.6 * Math.exp(-(((r - 168) / 5) ** 2));
  samples.push([d, Math.round(z * 100) / 100]);
}
samples[12] = [120, null]; // a gap in the LiDAR
const FEATURES: Feature[] = [
  {
    type: 'Feature',
    properties: { kind: 'transect', label: 'east-west (430 m)', length_m: 430, baseline_m: 263.1, max_relief_m: 5.3, outer_banks_span_m: 362, profile: samples },
    geometry: { type: 'LineString', coordinates: [[-82.433, 40.041], [-82.428, 40.041]] },
  },
  { type: 'Feature', properties: { kind: 'bank', offset_m: 1.81, at_m: 34, label: 'bank +1.8 m' }, geometry: { type: 'Point', coordinates: [-82.4326, 40.041] } },
  { type: 'Feature', properties: { kind: 'ditch', offset_m: -2.54, at_m: 47, label: 'ditch −2.5 m' }, geometry: { type: 'Point', coordinates: [-82.4325, 40.041] } },
  { type: 'Feature', properties: { kind: 'bank', offset_m: 2.2, at_m: 212, label: 'bank +2.2 m' }, geometry: { type: 'Point', coordinates: [-82.4305, 40.041] } },
  { type: 'Feature', properties: { kind: 'bank', offset_m: 2.0, at_m: 222, label: 'bank +2.0 m' }, geometry: { type: 'Point', coordinates: [-82.4304, 40.041] } },
  { type: 'Feature', properties: { kind: 'bank', offset_m: 2.62, at_m: 396, label: 'bank +2.6 m' }, geometry: { type: 'Point', coordinates: [-82.4283, 40.041] } },
];

describe('profileFromFeatures', () => {
  it('reads the section and the marks off the transect the tool wrote', () => {
    const p = profileFromFeatures(FEATURES, URL)!;
    expect(p.siteId).toBe('newark-great-circle');
    expect(p).toMatchObject({ lengthM: 430, baselineM: 263.1, spanM: 362, maxReliefM: 5.3, label: 'east-west (430 m)' });
    expect(p.samples).toHaveLength(44);
    expect(p.samples[12]).toEqual([120, null]);
    expect(p.marks.map((m) => `${m.kind}@${m.atM}`)).toEqual(['bank@34', 'ditch@47', 'bank@212', 'bank@222', 'bank@396']);
  });

  it('is null without a profile, for a file that is not a transect, and for junk rows', () => {
    expect(profileFromFeatures(FEATURES, 's3://b/session_data/abc/geometries/site_x.geojson')).toBeNull();
    const bare = [{ ...FEATURES[0], properties: { kind: 'transect', label: 'x' } }] as Feature[];
    expect(profileFromFeatures(bare, URL)).toBeNull();
    const junk = [{ ...FEATURES[0], properties: { kind: 'transect', profile: [['a', 'b'], [1], 'x', [0, 1]] } }] as Feature[];
    expect(profileFromFeatures(junk, URL)).toBeNull();
    expect(profileSiteId('s3://b/use-cases/archaeologist-great-circle/profile_newark-great-circle.geojson')).toBe('newark-great-circle');
    expect(profileSiteId('s3://b/x/profile_../etc.geojson')).toBeNull();
  });
});

describe('sectionLayout', () => {
  const p = profileFromFeatures(FEATURES, URL)!;
  const L = sectionLayout(p, 320, 120);

  it('maps distance to the plot width and height to the padded range, baseline included', () => {
    expect(L.xFor(0)).toBe(L.x0);
    expect(L.xFor(430)).toBe(L.x1);
    expect(L.yFor(0)).toBe(L.baselineY);
    expect(L.yFor(2.62)).toBeLessThan(L.baselineY);   // up is up
    expect(L.yFor(-2.6)).toBeGreaterThan(L.baselineY);
    expect(L.yFor(2.62)).toBeGreaterThanOrEqual(20);  // inside the top pad
    expect(L.exaggeration).toBeGreaterThan(10);
  });

  it('breaks the ground line and the wash at a gap', () => {
    expect((L.path.match(/M/g) ?? []).length).toBe(2);
    expect((L.fill.match(/Z/g) ?? []).length).toBe(2);
  });

  it('labels the axis with three signed rules at most, the baseline always one of them', () => {
    expect(L.ticks.map((t) => t.label)).toEqual(['−2 m', '0', '+2 m']);
    const tall = sectionLayout({ ...p, samples: [[0, -7.5], [430, 8.2]], marks: [] }, 320, 120);
    expect(tall.ticks.map((t) => t.label)).toEqual(['−5 m', '0', '+5 m']);
    const flat = sectionLayout({ ...p, samples: [[0, 0.2], [430, 0.4]], marks: [] }, 320, 120);
    expect(flat.ticks.map((t) => t.label)).toEqual(['0']);
  });

  it('marks every bank and ditch and labels only the tallest bank and the deepest ditch', () => {
    expect(L.marks).toHaveLength(5);
    const labelled = L.marks.filter((m) => m.labelled);
    expect(labelled.map((m) => m.label)).toEqual(['ditch −2.5 m', 'bank +2.6 m']);
    const [ditch, bank] = labelled;
    expect(bank.labelY).toBeLessThan(bank.y);     // a bank's label above its dot
    expect(ditch.labelY).toBeGreaterThan(ditch.y); // a ditch's below its ring
    expect(bank.anchor).toBe('end');               // 396 of 430 m: it hangs off the right end
    expect(ditch.anchor).toBe('start');            // 47 m: it hangs off the left end
    expect(Math.max(...L.marks.map((m) => m.labelY + 8))).toBeLessThanOrEqual(120);
    expect(Math.min(...L.marks.map((m) => m.labelY - 8))).toBeGreaterThanOrEqual(0);
  });

  it('describes itself in one sentence', () => {
    expect(sectionDescription(p, L.exaggeration)).toMatch(/^Cross-section along the transect, 430 m, heights about \d+ times exaggerated, 362 m bank to bank: bank \+1\.8 m at 34 m, ditch −2\.5 m at 47 m/);
  });
});

describe('the Great Circle as the tool measured it (one figure per mark, Eagle Mound a rise)', () => {
  // The file's own marks: two inner ditches, and two crests inside the ring where the record has
  // Eagle Mound. 2.25 m is "+2.2 m" in the tool's label (half to even).
  const GC: Feature[] = [
    FEATURES[0],
    ...([
      ['bank', 1.81, 33, 'bank +1.8 m'],
      ['ditch', -2.54, 45, 'ditch −2.5 m'],
      ['bank', 2.02, 208, 'bank +2.0 m'],
      ['bank', 2.25, 227, 'bank +2.2 m'],
      ['ditch', -2.68, 383, 'ditch −2.7 m'],
      ['bank', 2.62, 395, 'bank +2.6 m'],
    ] as const).map(([kind, offset, at, label]): Feature => ({
      type: 'Feature',
      properties: { kind, offset_m: offset, at_m: at, label },
      geometry: { type: 'Point', coordinates: [-82.433 + at / 85000, 40.041] },
    })),
  ];
  const gc = profileFromFeatures(GC, URL)!;

  it('reads the crests inside the ring as rises, in the tool\'s own figures', () => {
    expect(gc.marks.map((m) => m.role)).toEqual(['outer-bank', 'inner-ditch', 'interior', 'interior', 'inner-ditch', 'outer-bank']);
    expect(gc.marks.map((m) => m.label)).toEqual(['bank +1.8 m', 'ditch −2.5 m', 'rise +2.0 m', 'rise +2.2 m', 'ditch −2.7 m', 'bank +2.6 m']);
  });

  it('describes the mark at 227 m as the map prints it: +2.2 m, never +2.3 m', () => {
    const d = sectionDescription(gc, 12);
    expect(d).toContain('rise +2.2 m at 227 m');
    expect(d).toContain('rise +2.0 m at 208 m');
    expect(d).not.toContain('+2.3');
    expect(d).not.toMatch(/bank \+2\.[02] m/);
  });

  it('still labels the tallest bank and the deepest ditch in the drawing', () => {
    const labelled = sectionLayout(gc, 320, 120).marks.filter((m) => m.labelled).map((m) => m.label);
    expect(labelled).toEqual(['ditch −2.7 m', 'bank +2.6 m']);
  });

  it('reads the cursor on a tie the same way (2.25 m is +2.2 m)', () => {
    expect(cursorWords(227, 2.25)).toBe('at 227 m, +2.2 m');
    expect(cursorWords(138, 0.25)).toBe('at 138 m, +0.2 m');
  });
});

describe('the section cursor arithmetic', () => {
  const p = profileFromFeatures(FEATURES, URL)!;
  const line = FEATURES[0].geometry as unknown as { coordinates: Array<[number, number]> };

  it('reads the height between samples, and null in a LiDAR gap', () => {
    const [d0, z0] = p.samples[3] as [number, number];
    const [d1, z1] = p.samples[4] as [number, number];
    expect(heightAt(p, d0)).toBeCloseTo(z0, 10);
    expect(heightAt(p, (d0 + d1) / 2)).toBeCloseTo((z0 + z1) / 2, 10);
    // 120 m is the gap: anything between 110 and 130 has no reading.
    expect(heightAt(p, 115)).toBeNull();
    expect(heightAt(p, 125)).toBeNull();
    // Off the ends: the end readings.
    expect(heightAt(p, -5)).toBe(p.samples[0][1]);
    expect(heightAt(p, 9999)).toBe(p.samples[p.samples.length - 1][1]);
  });

  it('turns a pixel column into a distance along the line, clamped to it', () => {
    const layout = { x0: 46, x1: 346 };
    expect(distanceAtX(layout, 430, 46)).toBe(0);
    expect(distanceAtX(layout, 430, 196)).toBeCloseTo(215, 10);
    expect(distanceAtX(layout, 430, 346)).toBe(430);
    expect(distanceAtX(layout, 430, 10)).toBe(0);
    expect(distanceAtX(layout, 430, 900)).toBe(430);
  });

  it('says where the cursor is in the stage form', () => {
    expect(cursorWords(212.4, 2.18)).toBe('at 212 m, +2.2 m');
    expect(cursorWords(47, -2.54)).toBe('at 47 m, −2.5 m');
    expect(cursorWords(0, 0.01)).toBe('at 0 m, 0.0 m');
    expect(cursorWords(120, null)).toBe('at 120 m, no LiDAR return');
  });

  it('puts a distance on the map line and reads a map point back as a distance', () => {
    const mid = pointAlong(line.coordinates, 0.5)!;
    expect(mid[0]).toBeCloseTo(-82.4305, 6);
    expect(mid[1]).toBeCloseTo(40.041, 6);
    expect(pointAlong(line.coordinates, 0)).toEqual(line.coordinates[0]);
    expect(pointAlong(line.coordinates, 1)![0]).toBeCloseTo(line.coordinates[1][0], 10);
    // A point a little off the line, a quarter of the way along, reads as a quarter.
    expect(nearestAlong(line.coordinates, [-82.43175, 40.0412])!).toBeCloseTo(0.25, 3);
    // Beyond an end, the end.
    expect(nearestAlong(line.coordinates, [-82.44, 40.041])!).toBe(0);
    expect(pointAlong([[0, 0]], 0.5)).toBeNull();
    expect(nearestAlong([[0, 0]], [0, 0])).toBeNull();
  });

  it('walks a bent line by ground length, not by vertex count', () => {
    // An L: 100 m east, then 300 m north (at the equator, 1e-3 deg is about 111 m).
    const bent: Array<[number, number]> = [[0, 0], [0.0009, 0], [0.0009, 0.0027]];
    const quarter = pointAlong(bent, 0.25)!;
    expect(quarter[0]).toBeCloseTo(0.0009, 6);
    expect(quarter[1]).toBeCloseTo(0, 6);
    expect(nearestAlong(bent, [0.0009, 0.00135])!).toBeCloseTo(0.625, 3);
  });
});
