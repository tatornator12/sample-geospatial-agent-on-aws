import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { profileFromFeatures, profileSiteId, sectionDescription, sectionLayout } from './profileSection.ts';

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
