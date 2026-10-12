import { describe, expect, it } from 'vitest';
import type { LayerMetadata } from './layerFormatting.ts';
import { METHANE_RASTER, METHANE_SITES, METHANE_TROPOMI, METHANE_VECTOR } from './methaneLayers.ts';
import {
  clampDrag,
  insertInStack,
  layerLegend,
  moveItem,
  moveSentence,
  outOfRange,
  slotIndex,
  slotLayout,
  stackCeiling,
  stackLegends,
  stackMoves,
} from './layerStack.ts';

const BASEMAPS = ['dark-base', 'esri-satellite-base'];

const raster = (id: string, url: string, extra: Partial<LayerMetadata> = {}): LayerMetadata => ({
  id,
  sourceId: `${id}-src`,
  name: id,
  url,
  type: 'raster',
  ...extra,
});
const vector = (id: string, url: string, extra: Partial<LayerMetadata> = {}): LayerMetadata => ({
  id,
  sourceId: `${id}-src`,
  name: id,
  url,
  type: 'geometry',
  ...extra,
});

/** Apply moveLayer(id, beforeId) calls to a bottom-first id list, as MapLibre does. */
function simulate(order: string[], moves: Array<[string, string | undefined]>): string[] {
  let next = order.slice();
  for (const [id, before] of moves) {
    next = next.filter((x) => x !== id);
    const at = before === undefined ? next.length : next.indexOf(before);
    next.splice(at < 0 ? next.length : at, 0, id);
  }
  return next;
}

describe('moveItem', () => {
  it('moves an entry and leaves the input alone', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
  it('clamps the target and ignores a bad source', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -4)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('insertInStack', () => {
  const rasters = new Set(['tci', 'tci2', 'ndvi', 'ndvi2']);
  const isRaster = (id: string) => rasters.has(id);
  it('puts a vector on top, a finding over the imagery and a scene at the bottom', () => {
    expect(insertInStack(['tci'], 'geom', 'top', isRaster)).toEqual(['geom', 'tci']);
    // The finding lands under the boundary drawn over the imagery, above the scene.
    expect(insertInStack(['geom', 'tci'], 'ndvi', 'aboveImagery', isRaster)).toEqual(['geom', 'ndvi', 'tci']);
    expect(insertInStack(['geom', 'ndvi', 'tci'], 'ndvi2', 'aboveImagery', isRaster)).toEqual(['geom', 'ndvi2', 'ndvi', 'tci']);
    expect(insertInStack(['geom', 'ndvi'], 'tci2', 'bottom', isRaster)).toEqual(['geom', 'ndvi', 'tci2']);
  });
  it('puts the first finding under every vector when there is no imagery yet', () => {
    expect(insertInStack(['sites', 'footprints'], 'ndvi', 'aboveImagery', isRaster)).toEqual(['sites', 'footprints', 'ndvi']);
  });
  it('keeps the presenter\'s order: a raster moved over a vector stays there', () => {
    expect(insertInStack(['tci', 'geom'], 'ndvi', 'aboveImagery', isRaster)).toEqual(['ndvi', 'tci', 'geom']);
  });
  it('never lists a layer twice', () => {
    expect(insertInStack(['a', 'b'], 'a', 'bottom')).toEqual(['b', 'a']);
  });
});

describe('stackCeiling', () => {
  it('is the lowest layer above the basemap that the plate does not list', () => {
    const style = ['esri-satellite-base', 'cog-1', 'gl-draw-polygon-fill', 'geom-fill', 'watch-tips-marks'];
    expect(stackCeiling(style, new Set(['cog-1', 'geom-fill']), BASEMAPS)).toBe('gl-draw-polygon-fill');
  });
  it('skips anything under the basemap and is undefined when everything is listed', () => {
    expect(stackCeiling(['bg', 'dark-base', 'cog-1'], new Set(['cog-1']), BASEMAPS)).toBeUndefined();
    expect(stackCeiling([], new Set(), BASEMAPS)).toBeUndefined();
  });
});

describe('stackMoves', () => {
  it('draws the stack in list order with each geometry\'s layers kept together and in order', () => {
    const style = ['esri-satellite-base', 'geom-fill', 'geom-outline', 'geom-labels', 'tci', 'ndvi', 'gl-draw-polygon-fill'];
    // The presenter put the scene on top, then the boundary, then the NDVI.
    const moves = stackMoves([['tci'], ['geom-fill', 'geom-outline', 'geom-labels'], ['ndvi']], 'gl-draw-polygon-fill');
    expect(simulate(style, moves)).toEqual([
      'esri-satellite-base', 'ndvi', 'geom-fill', 'geom-outline', 'geom-labels', 'tci', 'gl-draw-polygon-fill',
    ]);
  });
  it('stacks at the top when nothing unlisted sits above the stack', () => {
    const moves = stackMoves([['c'], ['a'], ['b']], undefined);
    expect(simulate(['dark-base', 'a', 'b', 'c'], moves)).toEqual(['dark-base', 'b', 'a', 'c']);
  });
  it('keeps the drawn shapes over a stack that had a layer above them', () => {
    const style = ['dark-base', 'tci', 'gl-draw-polygon-fill', 'plume'];
    const moves = stackMoves([['plume'], ['tci']], 'gl-draw-polygon-fill');
    expect(simulate(style, moves)).toEqual(['dark-base', 'tci', 'plume', 'gl-draw-polygon-fill']);
  });
});

describe('outOfRange', () => {
  it('is true for a capped raster at or past its cap only', () => {
    const tropomi = { type: 'raster' as const, render: METHANE_TROPOMI };
    expect(outOfRange(tropomi, 7.9)).toBe(false);
    expect(outOfRange(tropomi, 8)).toBe(true);
    expect(outOfRange(tropomi, 12.7)).toBe(true);
    expect(outOfRange({ type: 'raster', render: METHANE_RASTER }, 14)).toBe(false);
    expect(outOfRange({ type: 'geometry', render: METHANE_TROPOMI }, 14)).toBe(false);
  });
});

describe('slotIndex and slotLayout', () => {
  const tops = [0, 36, 72];
  const heights = [36, 36, 36];
  it('finds the slot from the held row centre', () => {
    expect(slotIndex(tops, heights, 0, 0)).toBe(0);
    expect(slotIndex(tops, heights, 0, 17)).toBe(0);
    expect(slotIndex(tops, heights, 0, 19)).toBe(1);
    expect(slotIndex(tops, heights, 0, 60)).toBe(2);
    expect(slotIndex(tops, heights, 2, -40)).toBe(1);
    expect(slotIndex(tops, heights, 2, -72)).toBe(0);
  });
  it('slides the neighbours and puts the slot where the row lands', () => {
    expect(slotLayout(tops, heights, 0, 2)).toEqual({ shifts: [72, -36, -36], slotTop: 72 });
    expect(slotLayout(tops, heights, 2, 0)).toEqual({ shifts: [36, 36, -72], slotTop: 0 });
    expect(slotLayout(tops, heights, 1, 1)).toEqual({ shifts: [0, 0, 0], slotTop: 36 });
  });
  it('handles rows of different heights (a name on two lines)', () => {
    const t = [0, 56, 92];
    const h = [56, 36, 36];
    // The tall row goes to the bottom: the two short rows move up by its height.
    expect(slotLayout(t, h, 0, 2)).toEqual({ shifts: [72, -56, -56], slotTop: 72 });
  });
  it('keeps the held row inside the list', () => {
    expect(clampDrag(tops, heights, 0, -50)).toBe(0);
    expect(clampDrag(tops, heights, 0, 500)).toBe(72);
    expect(clampDrag(tops, heights, 2, -500)).toBe(-72);
    expect(clampDrag(tops, heights, 1, 10)).toBe(10);
  });
});

describe('legends', () => {
  const ndvi = raster('ndvi', 's3://b/ndvi_clipped_lake_mead_2025-01-01.tif');
  const tci = raster('tci', 's3://b/tci_clipped_lake_mead_2025-01-01.tif');
  const ndwi = raster('ndwi', 's3://b/ndwi_clipped_lake_mead_2025-01-01.tif');
  const plume = raster('plume', 's3://b/methane/s/pass_2025.tif', { render: METHANE_RASTER });
  const tropomi = raster('tropomi', 's3://b/methane/s/tropomi_anomaly_2025.tif', { render: METHANE_TROPOMI });
  const footprints = vector('fp', 's3://b/methane/s/plumes_2025.geojson', { render: METHANE_VECTOR });
  const sites = vector('sites', 's3://b/methane/s/watch_sites_2025.geojson', { render: METHANE_SITES });
  const similar = vector('sim', 's3://b/similar_central_park_new_york_202507.geojson');
  const all = () => true;

  it('reads each layer by its own ramp', () => {
    expect(layerLegend(ndvi)).toMatchObject({ kind: 'index', label: 'NDVI', ramp: 'rdylgn' });
    expect(layerLegend(tci)).toBeNull();
    expect(layerLegend(plume)).toMatchObject({ kind: 'measure', ramp: 'plasma', units: 'ppm·m', lo: 0, hi: 1500 });
    expect(layerLegend(tropomi)).toMatchObject({ kind: 'measure', ramp: 'ice', units: 'ppb', label: 'CH4 anomaly' });
    expect(layerLegend(sites)).toEqual({ kind: 'sites', key: 'sites' });
    expect(layerLegend(similar)).toEqual({ kind: 'similar', key: 'similar' });
  });

  it('orders by the highest row using each ramp, keys last', () => {
    expect(stackLegends([ndwi, tci, ndvi], all).map((l) => l.key)).toEqual(['NDWI', 'NDVI']);
    expect(stackLegends([ndvi, tci, ndwi], all).map((l) => l.key)).toEqual(['NDVI', 'NDWI']);
    expect(stackLegends([sites, footprints, tropomi, plume], all).map((l) => l.key)).toEqual([
      'plasma-ppm·m',
      'ice-ppb',
      'sites',
    ]);
    expect(stackLegends([similar, footprints], all).map((l) => l.key)).toEqual(['plasma-ppm·m', 'similar']);
  });

  it('shows no legend for a hidden or undrawable layer, and a shared ramp once', () => {
    const shown = (id: string) => id !== 'ndvi' && id !== 'tropomi';
    expect(stackLegends([ndvi, tci], shown)).toEqual([]);
    expect(stackLegends([tropomi, plume], shown).map((l) => l.key)).toEqual(['plasma-ppm·m']);
    expect(stackLegends([plume, footprints], all)).toHaveLength(1);
  });
});

describe('moveSentence', () => {
  it('says where the layer is now', () => {
    expect(moveSentence('NDVI', 0, 3)).toBe('NDVI moved to the top, drawn over every other layer.');
    expect(moveSentence('NDVI', 2, 3)).toBe('NDVI moved to the bottom, just above the basemap.');
    expect(moveSentence('NDVI', 1, 3)).toBe('NDVI moved to 2 of 3.');
  });
});
