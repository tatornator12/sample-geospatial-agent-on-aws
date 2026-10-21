import { describe, expect, it } from 'vitest';
import { COVERAGE_LABEL_QUIET, SEA_OPACITY, paintCoverage, quietCoverageLabels } from './seaStage.ts';

/** A map that holds every layer and records the last value painted per layer and property. */
function fakeMap() {
  const paint = new Map<string, unknown>();
  const map = {
    getLayer: () => ({}),
    setPaintProperty: (id: string, prop: string, value: unknown) => paint.set(`${id} ${prop}`, value),
  };
  return { map: map as unknown as Parameters<typeof paintCoverage>[0], paint };
}

describe('the coverage as the argument moves on', () => {
  it('halves the reception-unknown hatch and keeps the region words, quieter, while the candidates are read', () => {
    const { map, paint } = fakeMap();
    quietCoverageLabels(map, 'cov-unproven-fill');
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(COVERAGE_LABEL_QUIET);
    expect(COVERAGE_LABEL_QUIET).toBeGreaterThan(0);
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'hatch');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(SEA_OPACITY.unprovenQuiet);
    expect(SEA_OPACITY.unprovenQuiet).toBeLessThan(SEA_OPACITY.unproven);
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(COVERAGE_LABEL_QUIET);
    paintCoverage(map, 'heard', 'cov-heard-fill', 'hatch');
    expect(paint.get('cov-heard-fill fill-opacity')).toBe(SEA_OPACITY.heard);
  });

  it('steps both areas back and takes their words away under the forecast', () => {
    const { map, paint } = fakeMap();
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'all');
    paintCoverage(map, 'heard', 'cov-heard-fill', 'all');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(0.2);
    expect(paint.get('cov-heard-fill fill-opacity')).toBe(0.03);
    expect(paint.get('cov-unproven-labels text-opacity')).toBe(0);
    expect(paint.get('cov-heard-labels text-opacity')).toBe(0);
  });

  it('leaves the region words as they arrived under the argument', () => {
    const { map, paint } = fakeMap();
    paintCoverage(map, 'unproven', 'cov-unproven-fill', 'none');
    expect(paint.get('cov-unproven-fill fill-opacity')).toBe(SEA_OPACITY.unproven);
    expect(paint.has('cov-unproven-labels text-opacity')).toBe(false);
  });
});
