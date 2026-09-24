/**
 * Layer classification for the layers plate: the similarity group (Week 3) and the
 * existing raster groups it must not disturb.
 */
import { describe, expect, it } from 'vitest';
import {
  boundsWithin,
  findComparePair,
  formatLayerDisplayText,
  formatSimilarityLabel,
  groupLayers,
  isSimilarityLayer,
  rasterPlaceKey,
  type LayerMetadata,
} from './layerFormatting.ts';

function layer(over: Partial<LayerMetadata>): LayerMetadata {
  return { id: 'l1', sourceId: 's1', name: 'Layer', url: '', type: 'geometry', ...over };
}

const similar = layer({
  id: 'sim',
  name: 'Places like Central Park across New York',
  url: 's3://b/session_data/sess/geometries/similar_central_park_new_york_202507.geojson',
});
const boundary = layer({ id: 'geo', name: 'Central Park', url: 's3://b/session_data/sess/geometries/central_park.geojson' });
const tci = layer({ id: 'tci', type: 'raster', name: 'Satellite Image of Central Park', url: 's3://b/r/tci_clipped_central_park_2025-07-12.tif', date: '2025-07-12' });
const ndvi = layer({ id: 'ndvi', type: 'raster', name: 'NDVI Vegetation Map of Central Park', url: 's3://b/r/ndvi_central_park.tif' });
const change = layer({ id: 'chg', type: 'raster', name: 'Change Detection', url: 's3://b/r/change_detection_x.tif' });

describe('isSimilarityLayer', () => {
  it('is decided by the file name, not the title', () => {
    expect(isSimilarityLayer(similar)).toBe(true);
    expect(isSimilarityLayer(layer({ ...similar, name: 'Boundary' }))).toBe(true);
    expect(isSimilarityLayer(layer({ ...boundary, name: 'Places like Central Park' }))).toBe(false);
  });

  it('requires a geometry layer and the similar_ prefix on the basename only', () => {
    expect(isSimilarityLayer(layer({ ...similar, type: 'raster' }))).toBe(false);
    expect(isSimilarityLayer(layer({ url: 's3://b/similar_x/geometries/central_park.geojson' }))).toBe(false);
    expect(isSimilarityLayer(layer({ url: 's3://b/g/similar_central_park_new_york_202507.tif' }))).toBe(false);
    expect(isSimilarityLayer(layer({ url: '' }))).toBe(false);
  });
});

describe('groupLayers', () => {
  it('puts a similarity result in its own group and out of Boundaries', () => {
    const groups = groupLayers([similar, boundary, tci, ndvi, change]);
    expect(groups.similarPlaces.map(l => l.id)).toEqual(['sim']);
    expect(groups.geometries.map(l => l.id)).toEqual(['geo']);
    expect(groups.changeDetection.map(l => l.id)).toEqual(['chg']);
    expect(groups.tci.map(l => l.id)).toEqual(['tci']);
    expect(groups.spectralIndices.map(l => l.id)).toEqual(['ndvi']);
  });
});

describe('formatSimilarityLabel', () => {
  it('reads the example from the title and the month from the file name', () => {
    expect(formatSimilarityLabel(similar)).toBe('Places like Central Park · Jul 2025');
    expect(formatLayerDisplayText(similar, 'similar')).toBe('Places like Central Park · Jul 2025');
  });

  it('handles the title forms the model actually writes', () => {
    const t = (name: string) => formatSimilarityLabel(layer({ ...similar, name }));
    expect(t('Places Similar to Central Park — New York State, July 2025')).toBe('Places like Central Park · Jul 2025');
    expect(t('Places like Central Park, ranked')).toBe('Places like Central Park · Jul 2025');
    expect(t('Look-alikes resembling Central Park within New York')).toBe('Places like Central Park · Jul 2025');
  });

  it('falls back to the slug when the title is not in the expected form', () => {
    expect(formatSimilarityLabel(layer({ ...similar, name: 'Similar places' }))).toBe(
      'Places like central park new york · Jul 2025',
    );
  });

  it('returns the title untouched when the file name is not a similarity result', () => {
    expect(formatSimilarityLabel(boundary)).toBe('Central Park');
  });
});

describe('findComparePair', () => {
  const folsom21 = layer({ id: 'f21', type: 'raster', name: 'Satellite Image of Folsom Lake - 2021-07-23', url: 's3://b/r/tci_clipped_folsom_lake_2021-07-23.tif', date: '2021-07-23' });
  const folsom22 = layer({ id: 'f22', type: 'raster', name: 'Folsom Lake TCI 2022', url: 's3://b/r/tci_clipped_folsom_lake_2022-08-12.tif', date: '2022-08-12' });
  const folsom23 = layer({ id: 'f23', type: 'raster', name: 'Folsom Lake TCI 2023', url: 's3://b/r/tci_clipped_folsom_lake_2023-07-01.tif', date: '2023-07-01' });
  const westPoint = layer({ id: 'wp', type: 'raster', name: 'Rank 1 Match: West Point, NY — Sentinel-2 TCI, 2025-06-03', url: 's3://b/r/tci_clipped_west_point_ny_2025-06-03.tif', date: '2025-06-03' });
  const lakeGeorge = layer({ id: 'lg', type: 'raster', name: 'Rank 2 Match: Lake George — Sentinel-2 TCI, 2025-07-21', url: 's3://b/r/tci_clipped_lake_george_ny_2025-07-21.tif', date: '2025-07-21' });

  it('pairs two dates of the same place, earliest left', () => {
    expect(findComparePair([folsom22, folsom21])).toEqual({ left: folsom21, right: folsom22 });
  });

  it('does not pair two different places (the eyes on two similarity matches)', () => {
    expect(findComparePair([westPoint, lakeGeorge])).toBeNull();
  });

  it('ignores same-place same-date duplicates and picks the widest span', () => {
    expect(findComparePair([folsom22, folsom23, folsom21, westPoint])).toEqual({ left: folsom21, right: folsom23 });
    expect(findComparePair([folsom21, layer({ ...folsom21, id: 'dup' })])).toBeNull();
  });

  it('reads the place from the file name, not the title', () => {
    expect(rasterPlaceKey(westPoint)).toBe('west_point_ny');
    expect(rasterPlaceKey(layer({ ...westPoint, url: 's3://b/r/scene.tif' }))).toBeNull();
    expect(findComparePair([westPoint, layer({ ...westPoint, id: 'x', url: 's3://b/r/scene.tif' })])).toBeNull();
  });
});

describe('boundsWithin', () => {
  it('is true only when inner is fully inside outer', () => {
    const ny: [number, number, number, number] = [-79.76, 40.5, -71.86, 45.02];
    expect(boundsWithin([-74.0, 40.7, -73.9, 40.8], ny)).toBe(true);
    expect(boundsWithin([-80.0, 40.7, -73.9, 40.8], ny)).toBe(false);
    expect(boundsWithin(undefined, ny)).toBe(false);
    expect(boundsWithin([-74.0, 40.7, -73.9, 40.8], undefined)).toBe(false);
  });
});
