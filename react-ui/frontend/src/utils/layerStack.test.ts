import { describe, expect, it } from 'vitest';
import type { LayerMetadata } from './layerFormatting.ts';
import { METHANE_RASTER, METHANE_SITES, METHANE_TROPOMI, METHANE_VECTOR } from './methaneLayers.ts';
import {
  clampDrag,
  insertInStack,
  layerLegend,
  moveItem,
  moveSentence,
  rasterCeiling,
  slotIndex,
  slotLayout,
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
  it('puts a finding on top and a scene at the bottom', () => {
    expect(insertInStack(['tci'], 'ndvi', true)).toEqual(['ndvi', 'tci']);
    expect(insertInStack(['ndvi'], 'tci', false)).toEqual(['ndvi', 'tci']);
    expect(insertInStack(['ndvi', 'tci'], 'tci2', false)).toEqual(['ndvi', 'tci', 'tci2']);
  });
  it('never lists a layer twice', () => {
    expect(insertInStack(['a', 'b'], 'a', false)).toEqual(['b', 'a']);
  });
});

describe('rasterCeiling', () => {
  it('is the lowest vector above the basemap', () => {
    const style = [
      { id: 'esri-satellite-base', type: 'raster' },
      { id: 'gl-draw-polygon-fill', type: 'fill' },
      { id: 'cog-1', type: 'raster' },
      { id: 'geom-fill', type: 'fill' },
    ];
    expect(rasterCeiling(style, BASEMAPS)).toBe('gl-draw-polygon-fill');
  });
  it('skips anything under the basemap and is undefined with no vectors', () => {
    expect(
      rasterCeiling(
        [
          { id: 'bg', type: 'background' },
          { id: 'dark-base', type: 'raster' },
          { id: 'cog-1', type: 'raster' },
        ],
        BASEMAPS,
      ),
    ).toBeUndefined();
    expect(rasterCeiling([], BASEMAPS)).toBeUndefined();
  });
});

describe('stackMoves', () => {
  it('draws the stack in list order, every raster under every vector', () => {
    // The old escape: a raster moved "up" with no beforeId landed over the vectors and labels.
    const style = ['esri-satellite-base', 'tci', 'ndvi', 'gl-draw-polygon-fill', 'geom-fill', 'geom-labels'];
    const moves = stackMoves(['tci', 'ndvi'], 'gl-draw-polygon-fill');
    expect(simulate(style, moves)).toEqual(['esri-satellite-base', 'ndvi', 'tci', 'gl-draw-polygon-fill', 'geom-fill', 'geom-labels']);
  });
  it('stacks at the top when the map has no vectors', () => {
    const moves = stackMoves(['c', 'a', 'b'], undefined);
    expect(simulate(['dark-base', 'a', 'b', 'c'], moves)).toEqual(['dark-base', 'b', 'a', 'c']);
  });
  it('lifts a raster that had escaped above the vectors back under them', () => {
    const style = ['dark-base', 'tci', 'geom-fill', 'plume'];
    const moves = stackMoves(['plume', 'tci'], 'geom-fill');
    expect(simulate(style, moves)).toEqual(['dark-base', 'tci', 'plume', 'geom-fill']);
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
    expect(layerLegend(tropomi)).toMatchObject({ kind: 'measure', ramp: 'viridis', units: 'ppb', label: 'CH4 anomaly' });
    expect(layerLegend(sites)).toEqual({ kind: 'sites', key: 'sites' });
    expect(layerLegend(similar)).toEqual({ kind: 'similar', key: 'similar' });
  });

  it('orders by the highest row using each ramp, then the vectors, keys last', () => {
    expect(stackLegends([ndwi, tci, ndvi], [], all).map((l) => l.key)).toEqual(['NDWI', 'NDVI']);
    expect(stackLegends([ndvi, tci, ndwi], [], all).map((l) => l.key)).toEqual(['NDVI', 'NDWI']);
    expect(stackLegends([tropomi, plume], [sites, footprints], all).map((l) => l.key)).toEqual([
      'viridis-ppb',
      'plasma-ppm·m',
      'sites',
    ]);
    expect(stackLegends([], [similar, footprints], all).map((l) => l.key)).toEqual(['plasma-ppm·m', 'similar']);
  });

  it('shows no legend for a hidden layer, and a shared ramp once', () => {
    const shown = (id: string) => id !== 'ndvi';
    expect(stackLegends([ndvi, tci], [], shown)).toEqual([]);
    expect(stackLegends([plume], [footprints], all)).toHaveLength(1);
  });
});

describe('moveSentence', () => {
  it('says where the layer is now', () => {
    expect(moveSentence('NDVI', 0, 3)).toBe('NDVI moved to the top, drawn over the other imagery.');
    expect(moveSentence('NDVI', 2, 3)).toBe('NDVI moved to the bottom, just above the basemap.');
    expect(moveSentence('NDVI', 1, 3)).toBe('NDVI moved to 2 of 3.');
  });
});
