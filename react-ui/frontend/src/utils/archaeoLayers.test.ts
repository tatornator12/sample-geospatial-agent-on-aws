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
  LIGHT_SWEEP_MS,
  LOCAL_RELIEF,
  LOCAL_RELIEF_FINE,
  SITE_FRAME,
  TRANSECT,
  altitudeWords,
  companionDem,
  compassName,
  dialAzimuth,
  heritageProperty,
  inTerrainTree,
  recordLabels,
  shortSiteName,
  lightAltitude,
  lightSweep,
  stepLight,
  isTerrainLayer,
  marksBounds,
  signedMetres,
  siteWindow,
  siteWindowShare,
  reliefSite,
  reliefLegendLabel,
  FINE_RELIEF_WINDOW,
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
    expect(layerLegend(fine)).toMatchObject({ kind: 'relief', lo: -0.3, hi: 0.3, key: `relief-${fine.id}` });
    expect(layerLegend(hillshade)).toEqual({ kind: 'hillshade', key: 'hillshade' });
    expect(layerLegend(record)).toEqual({ kind: 'record', key: 'record' });
    expect(layerLegend(transect)).toBeNull();
    expect(terrainLegend(undefined)).toBeNull();
  });
  it('lists the relief ramps before the hillshade key, one per relief layer', () => {
    expect(stackLegends([hillshade, relief, fine], all).map((l) => l.key)).toEqual([`relief-${relief.id}`, `relief-${fine.id}`, 'hillshade']);
    expect(stackLegends([relief, relief], all)).toHaveLength(1);
  });
  it('names each relief legend by its site, from the row title (B16, A4 P1-6)', () => {
    const seip = { ...layer(`${S}lrm03_seip-earthworks.tif`, 'raster'), name: 'Seip Earthworks, local relief' };
    const circle = { ...relief, name: 'Great Circle Earthworks, local relief model' };
    expect(stackLegends([seip, circle], all).map((l) => ('label' in l ? l.label : ''))).toEqual([
      'Seip Earthworks: blue lower, red higher',
      'Great Circle Earthworks: blue lower, red higher',
    ]);
    // Only the site's own reading is shown when the earlier one is unticked.
    expect(stackLegends([seip, circle], (id) => id !== circle.id)).toHaveLength(1);
    expect(reliefLegendLabel('A relief map')).toBe('Local relief');
    expect(reliefLegendLabel(undefined)).toBe('Local relief');
  });
  it('knows a relief file by its site, and lands closer on a ploughed one (B16, B17)', () => {
    expect(reliefSite(`${S}lrm_newark-great-circle.tif`)).toBe('newark-great-circle');
    expect(reliefSite(`${S}lrm03_seip-earthworks.tif`)).toBe('seip-earthworks');
    expect(reliefSite(`${S}hillshade_newark-octagon.tif`)).toBeNull();
    expect(siteWindowShare(`${S}lrm03_seip-earthworks.tif`)).toBe(FINE_RELIEF_WINDOW);
    expect(siteWindowShare(`${S}lrm_newark-great-circle.tif`)).toBe(0.4);
    expect(siteWindowShare(`${S}hillshade_newark-octagon.tif`)).toBe(0.4);
    // The survey's close look is the frame's centre 1.2 km: the camera lands on the same ground.
    expect(reliefSite(`${S}lrm03_high-bank-works_site.tif`)).toBe('high-bank-works');
    expect(reliefSite(`${S}lrm_fort-hill_site.tif`)).toBe('fort-hill');
    expect(siteWindowShare(`${S}lrm03_high-bank-works_site.tif`)).toBeCloseTo(FINE_RELIEF_WINDOW * 2.5);
    expect(siteWindowShare(`${S}lrm_fort-hill_site.tif`)).toBe(1);
    // About 800 m of the 3 km frame.
    const [w, , e] = siteWindow([0, 0, 3, 3], FINE_RELIEF_WINDOW);
    expect(Math.round((e - w) * 1000)).toBe(810);
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

  it('turns slowly enough to follow: 12 s in all, never faster than about 63° a second', () => {
    expect(LIGHT_SWEEP_MS).toBe(12000);
    const dt = 1 / 1200; // 10 ms steps
    let fastest = 0;
    for (let t = 0; t < 1; t += dt) {
      const a = lightSweep(t), b = lightSweep(t + dt);
      const d = Math.abs(((b - a + 540) % 360) - 180); // the short way round
      fastest = Math.max(fastest, d / (dt * LIGHT_SWEEP_MS / 1000));
    }
    expect(fastest).toBeLessThan(64);
    expect(fastest).toBeGreaterThan(55);
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

describe('the record\'s names at rest', () => {
  it('prints the place, not the park', () => {
    expect(shortSiteName('Cahokia Mounds State Historic Site')).toBe('Cahokia Mounds');
    expect(shortSiteName('Monumental Earthworks of Poverty Point')).toBe('Poverty Point');
    expect(shortSiteName('Great Mound (Mounds State Park)')).toBe('Great Mound');
    expect(shortSiteName('Etowah Indian Mounds State Historic Site')).toBe('Etowah Indian Mounds');
    expect(shortSiteName('Plum Bayou Mounds Archeological State Park')).toBe('Plum Bayou Mounds');
    expect(shortSiteName('Pinson Mounds State Archaeological Park')).toBe('Pinson Mounds');
    expect(shortSiteName('Fort Hill Earthworks & Nature Preserve')).toBe('Fort Hill Earthworks');
    expect(shortSiteName('Ocmulgee Mounds National Historical Park')).toBe('Ocmulgee Mounds');
    expect(shortSiteName('Effigy Mounds National Monument')).toBe('Effigy Mounds');
    expect(shortSiteName('Aztalan State Park')).toBe('Aztalan');
    expect(shortSiteName('Serpent Mound')).toBe('Serpent Mound');
    expect(shortSiteName('State Park')).toBe('State Park');
  });

  it('reads the World Heritage property a component belongs to', () => {
    expect(heritageProperty('UNESCO World Heritage (Hopewell Ceremonial Earthworks, 2023) (component)')).toBe('Hopewell Ceremonial Earthworks');
    expect(heritageProperty('UNESCO World Heritage (1982); National Historic Landmark')).toBeNull();
    expect(heritageProperty('National Historic Landmark')).toBeNull();
    expect(heritageProperty(undefined)).toBeNull();
  });

  it('gives one label to a property\'s components and short names to the rest', () => {
    const pt = (name: string, lon: number, lat: number, designation: string, wh = false) => ({
      type: 'Feature', properties: { name, designation, world_heritage: wh }, geometry: { type: 'Point', coordinates: [lon, lat] },
    });
    const hopewell = 'UNESCO World Heritage (Hopewell Ceremonial Earthworks, 2023) (component)';
    const labels = recordLabels([
      pt('Octagon Earthworks', -82.45, 40.05, hopewell, true),
      pt('Great Circle Earthworks', -82.43, 40.04, hopewell, true),
      pt('Mound City Group', -83.0, 39.37, hopewell, true),
      pt('Cahokia Mounds State Historic Site', -90.06, 38.66, 'UNESCO World Heritage (1982)', true),
      pt('Serpent Mound', -83.43, 39.03, 'National Historic Landmark'),
      { type: 'Feature', properties: { name: 'No point' }, geometry: null },
    ]).features;
    expect(labels.map((f) => f.properties.label)).toEqual([
      'Hopewell Ceremonial Earthworks, 3 sites', 'Cahokia Mounds', 'Serpent Mound',
    ]);
    expect(labels[0].properties.heritage).toBe(true);
    expect(labels[0].geometry.coordinates[0]).toBeCloseTo((-82.45 - 82.43 - 83.0) / 3, 10);
    expect(labels[2].properties.heritage).toBe(false);
    // The shared label sits between dots (it keeps nothing out); a site's own sits on its dot.
    expect(labels.map((f) => f.properties.group)).toEqual([true, false, false]);
    expect(labels[2].geometry.coordinates).toEqual([-83.43, 39.03]);
    // A property with one component on the record keeps that component's own name.
    const lone = recordLabels([pt('Seip Earthworks', -83.2, 39.24, hopewell, true)]).features;
    expect(lone.map((f) => f.properties.label)).toEqual(['Seip Earthworks']);
  });
});

describe('companionDem', () => {
  it('finds the DEM show_terrain staged beside a hillshade, in a session or a replay case', () => {
    expect(companionDem('s3://geospatial-agent-on-aws-419324627248/session_data/931575d0-a79e/terrain/hillshade_newark-octagon.tif'))
      .toBe('s3://geospatial-agent-on-aws-419324627248/session_data/931575d0-a79e/terrain/dem_newark-octagon.tif');
    expect(companionDem('s3://my.bucket/use-cases/archaeologist-newark/hillshade_newark-octagon.tif'))
      .toBe('s3://my.bucket/use-cases/archaeologist-newark/dem_newark-octagon.tif');
  });

  it('is null for anything else', () => {
    expect(companionDem('s3://b/session_data/abc/terrain/lrm_newark-great-circle.tif')).toBeNull();
    expect(companionDem('s3://b/session_data/abc/rasters/hillshade_x.tif')).toBeNull();
    expect(companionDem('s3://b/archaeology/cache/v1/hillshade_newark-octagon.tif')).toBeNull();
    expect(companionDem('https://example.com/terrain/hillshade_x.tif')).toBeNull();
    expect(companionDem(undefined)).toBeNull();
  });
});
