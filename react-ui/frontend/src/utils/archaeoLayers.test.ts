import { describe, expect, it } from 'vitest';
import type { LayerMetadata } from './layerFormatting.ts';
import { layerLegend, stackLegends } from './layerStack.ts';
import {
  HILLSHADE,
  LIGHT_ALTITUDE,
  LIGHT_ALTITUDE_RANGE,
  LIGHT_AZIMUTH,
  LIGHT_HIGH,
  LIGHT_SUNSET,
  LOCAL_RELIEF,
  LOCAL_RELIEF_FINE,
  SITE_FRAME,
  TRANSECT,
  altitudeWords,
  compassName,
  dialAzimuth,
  inTerrainTree,
  lightAltitude,
  lightSweep,
  stepLight,
  isTerrainLayer,
  marksBounds,
  signedMetres,
  siteWindow,
  terrainGeometryHint,
  terrainLegend,
  terrainRasterHint,
  transectParts,
} from './archaeoLayers.ts';
import { parseRenderHint, tileParamsFor } from './render.ts';

const S = 's3://bucket/session_data/abc-123/terrain/';

// The tools' own hints (agents/ai-archaeologist/site_tools.py show_terrain and measure_profile).
const HILLSHADE_HINT = {
  kind: 'raster', colormap: 'gray', rescale: [1, 255], group: 'terrain', legend: 'Hillshade',
  bounds: [-82.447979, 40.027501, -82.412259, 40.054956],
};
const LRM_HINT = {
  kind: 'raster', colormap: 'rdbu_r', rescale: [-1, 1], units: 'm', group: 'terrain', legend: 'Local relief',
  bounds: [-82.447979, 40.027501, -82.412259, 40.054956],
};
const TRANSECT_HINT = { kind: 'vector', group: 'terrain', label: 'label' };

function layer(url: string, type: LayerMetadata['type'], render?: LayerMetadata['render']): LayerMetadata {
  return { id: url, sourceId: 'x', name: 'model-written title', url, type, render };
}

describe('parseRenderHint accepts the archaeologist terrain hints (Week 5)', () => {
  it('passes the three tool hints unchanged', () => {
    expect(parseRenderHint(HILLSHADE_HINT)).toEqual(HILLSHADE_HINT);
    expect(parseRenderHint(LRM_HINT)).toEqual(LRM_HINT);
    expect(parseRenderHint(TRANSECT_HINT)).toEqual(TRANSECT_HINT);
  });
  it('builds the TiTiler query for the terrain ramps', () => {
    expect(tileParamsFor(parseRenderHint(HILLSHADE_HINT))).toBe('bidx=1&rescale=1,255&colormap_name=gray');
    expect(tileParamsFor(parseRenderHint(LRM_HINT))).toBe('bidx=1&rescale=-1,1&colormap_name=rdbu_r');
  });
});

describe('terrainRasterHint', () => {
  it('prefers a valid terrain raster hint', () => {
    const hint = parseRenderHint(LRM_HINT)!;
    expect(terrainRasterHint(hint, 's3://bucket/anything.tif')).toBe(hint);
  });
  it('falls back to the tool defaults by file name under a terrain folder or an archaeologist case', () => {
    expect(terrainRasterHint(undefined, `${S}hillshade_newark-octagon.tif`)).toBe(HILLSHADE);
    expect(terrainRasterHint(undefined, `${S}lrm_newark-great-circle.tif`)).toBe(LOCAL_RELIEF);
    expect(terrainRasterHint(undefined, `${S}lrm03_hopeton-earthworks.tif`)).toBe(LOCAL_RELIEF_FINE);
    expect(terrainRasterHint(undefined, 's3://bucket/use-cases/archaeologist-newark/hillshade_newark-octagon.tif')).toBe(HILLSHADE);
  });
  it('is null for a non-terrain hint, a look-alike name elsewhere, or a scene', () => {
    expect(terrainRasterHint(parseRenderHint({ kind: 'raster', colormap: 'plasma', group: 'methane' })!, `${S}x.tif`)).toBeNull();
    expect(terrainRasterHint(undefined, 's3://bucket/session_data/abc/rasters/hillshade_x.tif')).toBeNull();
    expect(terrainRasterHint(undefined, `${S}tci_clipped_newark_2026-10-05.tif`)).toBeNull();
    expect(inTerrainTree('s3://bucket/session_data/abc/rasters/x.tif')).toBe(false);
  });
});

describe('terrainGeometryHint', () => {
  it('prefers a valid terrain vector hint', () => {
    const hint = parseRenderHint(TRANSECT_HINT)!;
    expect(terrainGeometryHint(hint, 's3://bucket/x.geojson')).toBe(hint);
  });
  it('knows the transect and the site frame by file name', () => {
    expect(terrainGeometryHint(undefined, `${S}profile_newark-great-circle.geojson`)).toBe(TRANSECT);
    expect(terrainGeometryHint(undefined, 's3://bucket/session_data/abc/geometries/site_newark-octagon.geojson')).toBe(SITE_FRAME);
  });
  it('is null for a raster hint, another group, or an unknown file', () => {
    expect(terrainGeometryHint(parseRenderHint(HILLSHADE_HINT)!, 's3://b/x.geojson')).toBeNull();
    expect(terrainGeometryHint(parseRenderHint({ kind: 'vector', group: 'similar' })!, 's3://b/x.geojson')).toBeNull();
    expect(terrainGeometryHint(undefined, 's3://bucket/session_data/abc/geometries/boundary.geojson')).toBeNull();
    expect(terrainGeometryHint(undefined, `${S}profile_x.tif`)).toBeNull();
  });
});

describe('isTerrainLayer and the plate', () => {
  const hillshade = layer(`${S}hillshade_newark-octagon.tif`, 'raster', parseRenderHint(HILLSHADE_HINT)!);
  const relief = layer(`${S}lrm_newark-great-circle.tif`, 'raster', parseRenderHint(LRM_HINT)!);
  const fine = layer(`${S}lrm03_hopeton-earthworks.tif`, 'raster');
  const transect = layer(`${S}profile_newark-great-circle.geojson`, 'geometry', parseRenderHint(TRANSECT_HINT)!);
  const record = layer('s3://archaeology-record/sites_public.geojson', 'geometry', parseRenderHint({ kind: 'points', group: 'terrain', label: 'name' })!);
  const tci = layer('s3://bucket/session_data/abc/rasters/tci_clipped_newark_2026-10-05.tif', 'raster');
  const all = () => true;

  it('claims the terrain layers by hint or file name, never by title', () => {
    expect([hillshade, relief, fine, transect, record].map(isTerrainLayer)).toEqual([true, true, true, true, true]);
    expect(isTerrainLayer(tci)).toBe(false);
    expect(isTerrainLayer(layer(tci.url, 'raster'))).toBe(false); // a title saying "LiDAR hillshade" changes nothing
  });
  it('reads the relief in signed metres and the hillshade and record as keys', () => {
    expect(layerLegend(relief)).toMatchObject({ kind: 'relief', ramp: 'rdbu_r', lo: -1, hi: 1, units: 'm', label: 'Local relief' });
    expect(layerLegend(fine)).toMatchObject({ kind: 'relief', lo: -0.3, hi: 0.3, key: 'relief-0.3' });
    expect(layerLegend(hillshade)).toEqual({ kind: 'hillshade', key: 'hillshade' });
    expect(layerLegend(record)).toEqual({ kind: 'record', key: 'record' });
    expect(layerLegend(transect)).toBeNull();
    expect(terrainLegend(undefined)).toBeNull();
  });
  it('lists the relief ramp before the hillshade key, and one relief per stretch', () => {
    expect(stackLegends([hillshade, relief, fine], all).map((l) => l.key)).toEqual(['relief-1', 'relief-0.3', 'hillshade']);
    expect(stackLegends([relief, relief], all)).toHaveLength(1);
  });
  it('prints the legend ends the way the record does', () => {
    expect(signedMetres(-1)).toBe('−1 m');
    expect(signedMetres(1)).toBe('+1 m');
    expect(signedMetres(-0.3)).toBe('−0.3 m');
  });
});

describe('the transect and the record on the map', () => {
  // measure_profile's collection for the Great Circle (east-west, 430 m).
  const features = [
    { properties: { kind: 'transect', label: 'east-west through the centre (430 m)' }, geometry: { type: 'LineString', coordinates: [[-82.433615, 40.040979], [-82.428576, 40.041042]] } },
    { properties: { kind: 'bank', offset_m: 1.81, label: 'bank +1.8 m' }, geometry: { type: 'Point', coordinates: [-82.433228, 40.040984] } },
    { properties: { kind: 'ditch', offset_m: -2.54, label: 'ditch −2.5 m' }, geometry: { type: 'Point', coordinates: [-82.433088, 40.040986] } },
    { properties: { kind: 'other' }, geometry: { type: 'Point', coordinates: [-82.43, 40.04] } },
  ];
  it('splits the line from the bank and ditch marks', () => {
    const { line, marks } = transectParts(features);
    expect(line?.properties?.kind).toBe('transect');
    expect(marks.map((m) => m.properties?.label)).toEqual(['bank +1.8 m', 'ditch −2.5 m']);
  });
  it('frames the record by its points only', () => {
    expect(marksBounds(features)).toEqual([-82.433228, 40.04, -82.43, 40.040986]);
    expect(marksBounds([features[0]])).toBeNull();
    expect(marksBounds([])).toBeNull();
  });
});

describe('siteWindow', () => {
  it('keeps the centre of a frame and shrinks each side by the share', () => {
    const [w, s, e, n] = siteWindow([-82.448, 40.0275, -82.412, 40.055], 0.5);
    expect((w + e) / 2).toBeCloseTo(-82.43, 10);
    expect((s + n) / 2).toBeCloseTo(40.04125, 10);
    expect(e - w).toBeCloseTo(0.018, 10);
    expect(n - s).toBeCloseTo(0.01375, 10);
  });

  it('lands on the middle 1.2 km of a 3 km frame by default', () => {
    // Degrees of longitude at Newark: 3 km is about 0.0357; the window should be 0.4 of that.
    const [w, , e] = siteWindow([-82.447979, 40.027501, -82.412259, 40.054956]);
    expect(e - w).toBeCloseTo(0.4 * (-82.412259 - -82.447979), 10);
  });
});

describe('the raking light', () => {
  it('sinks the sun first, then takes it once round, back to the north-west', () => {
    expect(lightAltitude(0)).toBe(LIGHT_HIGH);
    expect(lightAltitude(LIGHT_SUNSET)).toBeCloseTo(LIGHT_ALTITUDE, 10);
    expect(lightAltitude(1)).toBeCloseTo(LIGHT_ALTITUDE, 10);
    // Lower all the way down, never below the raking angle.
    const heights = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map((t) => lightAltitude(t));
    heights.slice(1).forEach((h, i) => expect(h).toBeLessThan(heights[i]));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(LIGHT_ALTITUDE - 1e-9);
    // The azimuth holds while the sun sinks, then turns once and lands where it started.
    expect(lightSweep(0)).toBe(LIGHT_AZIMUTH);
    expect(lightSweep(LIGHT_SUNSET)).toBe(LIGHT_AZIMUTH);
    expect(lightSweep((1 + LIGHT_SUNSET) / 2)).toBeCloseTo((LIGHT_AZIMUTH + 180) % 360, 6);
    expect(lightSweep(1)).toBeCloseTo(LIGHT_AZIMUTH, 6);
    expect(lightSweep(2)).toBeCloseTo(LIGHT_AZIMUTH, 6);
  });

  it('names the sun\'s height in the room\'s words', () => {
    expect(altitudeWords(8)).toMatch(/long shadows/);
    expect(altitudeWords(LIGHT_ALTITUDE)).toMatch(/walls stand up/);
    expect(altitudeWords(40)).toMatch(/shadows shorten/);
    expect(altitudeWords(60)).toMatch(/flat/);
  });

  it('reads the dial as the room sees the map', () => {
    // North-up map: up is north, right is east, down-left is south-west.
    expect(dialAzimuth(0, -10, 0)).toBe(0);
    expect(dialAzimuth(10, 0, 0)).toBe(90);
    expect(dialAzimuth(-10, 10, 0)).toBe(225);
    // The ground view turns the map 35°: straight up on screen is 35° on the map.
    expect(dialAzimuth(0, -10, 35)).toBe(35);
    expect(dialAzimuth(-10, -10, 35)).toBe(350);
    expect(dialAzimuth(0, 0, 35)).toBe(35);
    expect(compassName(dialAzimuth(-10, -10, 0))).toBe('north-west');
  });

  it('steps by keyboard: 5° on the arrows, 45° (or 15° of height) on the page keys', () => {
    expect(stepLight(315, 'ArrowRight', 'azimuth')).toBe(320);
    expect(stepLight(2, 'ArrowLeft', 'azimuth')).toBe(357);
    expect(stepLight(315, 'PageUp', 'azimuth')).toBe(0);
    expect(stepLight(25, 'PageDown', 'altitude')).toBe(LIGHT_ALTITUDE_RANGE[0] + 5);
    expect(stepLight(LIGHT_ALTITUDE_RANGE[1], 'ArrowUp', 'altitude')).toBe(LIGHT_ALTITUDE_RANGE[1]);
    expect(stepLight(25, 'Enter', 'azimuth')).toBeNull();
  });
});
