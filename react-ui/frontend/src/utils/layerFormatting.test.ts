/**
 * Layer classification for the layers plate: the similarity group (Week 3) and the
 * existing raster groups it must not disturb.
 */
import { describe, expect, it } from 'vitest';
import {
  formatLayerDisplayText,
  formatSimilarityLabel,
  groupLayers,
  isSimilarityLayer,
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
