import { describe, expect, it } from 'vitest';
import { parseRenderHint, rampExpression, rampGradient, tileParamsFor } from './render.ts';

// The hints the Methane Hunter's tools emit (agents/methane-hunter/methane_tools.py).
const RASTER = {
  kind: 'raster', colormap: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane',
  legend: 'CH4 enhancement', bounds: [-101.83, 31.84, -101.73, 31.92],
};
const VECTOR = {
  kind: 'vector', property: 'max_ppm_m', ramp: 'plasma', rescale: [0, 1500], units: 'ppm·m',
  group: 'methane', label: 'rank',
};

describe('parseRenderHint', () => {
  it('accepts the tool hints unchanged, as objects or JSON strings', () => {
    expect(parseRenderHint(RASTER)).toEqual(RASTER);
    expect(parseRenderHint(VECTOR)).toEqual(VECTOR);
    expect(parseRenderHint(JSON.stringify(VECTOR))).toEqual(VECTOR);
  });

  it('returns null for absent or non-object input', () => {
    for (const bad of [undefined, null, '', 'plasma', 42, [], '{not json']) {
      expect(parseRenderHint(bad)).toBeNull();
    }
  });

  it.each([
    ['unknown kind', { kind: 'html' }],
    ['colormap outside the allowlist', { kind: 'raster', colormap: 'plasma&url=https://evil' }],
    ['ramp outside the allowlist', { kind: 'vector', ramp: 'jet' }],
    ['reversed rescale', { kind: 'raster', rescale: [1500, 0] }],
    ['non-finite rescale', { kind: 'raster', rescale: [0, Infinity] }],
    ['string rescale', { kind: 'raster', rescale: ['0', '1500'] }],
    ['unknown group', { kind: 'raster', group: 'admin' }],
    ['markup in a label', { kind: 'raster', legend: '<img src=x onerror=alert(1)>' }],
    ['over-long units', { kind: 'raster', units: 'x'.repeat(25) }],
    ['property that is not an identifier', { kind: 'vector', property: "max'] , ['literal" }],
    ['bounds out of range', { kind: 'raster', bounds: [-200, 0, 10, 10] }],
    ['inverted bounds', { kind: 'raster', bounds: [10, 10, 0, 0] }],
    ['bounds with a NaN', { kind: 'raster', bounds: [0, 0, NaN, 10] }],
  ])('rejects the whole hint on %s', (_why, hint) => {
    expect(parseRenderHint(hint)).toBeNull();
  });

  it('accepts the Methane Watch kinds and group, and a bounded max_zoom (Week 4c)', () => {
    const sites = { kind: 'points', group: 'watch', property: 'repeat_dates', label: 'repeat_dates', units: 'dates' };
    const columns = { kind: 'columns', property: 'ppm_m', ramp: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane' };
    const tropomi = { kind: 'raster', colormap: 'viridis', rescale: [0, 60], units: 'ppb', group: 'methane', max_zoom: 8 };
    expect(parseRenderHint(sites)).toEqual(sites);
    expect(parseRenderHint(columns)).toEqual(columns);
    expect(parseRenderHint(tropomi)).toEqual(tropomi);
    for (const z of [-1, 23, NaN, '8']) expect(parseRenderHint({ ...tropomi, max_zoom: z })).toBeNull();
  });

  it('ignores fields it does not know', () => {
    expect(parseRenderHint({ kind: 'raster', colormap: 'viridis', onclick: 'x' })).toEqual({ kind: 'raster', colormap: 'viridis' });
  });
});

describe('tileParamsFor', () => {
  it('builds the TiTiler query from a raster hint', () => {
    expect(tileParamsFor(parseRenderHint(RASTER))).toBe('bidx=1&rescale=0,1500&colormap_name=plasma');
  });
  it('is null without a colormap or for vectors', () => {
    expect(tileParamsFor(parseRenderHint({ kind: 'raster' }))).toBeNull();
    expect(tileParamsFor(parseRenderHint(VECTOR))).toBeNull();
    expect(tileParamsFor(null)).toBeNull();
  });
});

describe('ramps', () => {
  it('interpolates the plasma anchors over the rescale', () => {
    const expr = rampExpression('plasma', 'max_ppm_m', 0, 1500)!;
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['to-number', ['get', 'max_ppm_m'], 0]]);
    expect(expr.slice(3)).toEqual([0, '#0d0887', 375, '#7e03a8', 750, '#cc4778', 1125, '#f89540', 1500, '#f0f921']);
  });
  it('refuses unknown ramps, bad properties and empty ranges', () => {
    expect(rampExpression('rdylgn', 'max_ppm_m', 0, 1)).toBeNull();
    expect(rampExpression('plasma', 'a b', 0, 1)).toBeNull();
    expect(rampExpression('plasma', 'v', 1, 1)).toBeNull();
  });
  it('gives the legend a CSS gradient', () => {
    expect(rampGradient('plasma')).toBe('linear-gradient(90deg, #0d0887 0%, #7e03a8 25%, #cc4778 50%, #f89540 75%, #f0f921 100%)');
    expect(rampGradient(undefined)).toBeNull();
  });
});
