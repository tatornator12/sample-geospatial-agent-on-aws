import { describe, expect, it } from 'vitest';
import { isMethaneLayer, type LayerMetadata } from './layerFormatting.ts';
import {
  METHANE_COLUMNS,
  METHANE_SITES,
  METHANE_TROPOMI,
  METHANE_VECTOR,
  globeCentre,
  isoDay,
  methaneGeometryHint,
  methaneLegend,
  methaneRasterHint,
} from './methaneLayers.ts';
import { parseRenderHint } from './render.ts';

const S = 's3://bucket/session_data/abc-123/methane/';

function layer(url: string, type: LayerMetadata['type'], render?: LayerMetadata['render']): LayerMetadata {
  return { id: 'x', sourceId: 'x', name: 'model-written title', url, type, render };
}

describe('isMethaneLayer (Methane Watch)', () => {
  it('knows the watch tools by file name under a methane folder or a methane replay case', () => {
    expect(isMethaneLayer(layer(`${S}watch_sites_v002.geojson`, 'geometry'))).toBe(true);
    expect(isMethaneLayer(layer(`${S}columns_EMIT_L2B_CH4ENH_002_20250801T0_1.geojson`, 'geometry'))).toBe(true);
    expect(isMethaneLayer(layer(`${S}tropomi_anomaly_south_caspian_2026-09-20_7d.tif`, 'raster'))).toBe(true);
    expect(isMethaneLayer(layer(`${S}pass_EMIT_L2B_CH4ENH_002_20250801T0_1.tif`, 'raster'))).toBe(true);
    expect(isMethaneLayer(layer('s3://bucket/use-cases/methane-watch-south-caspian/watch_sites_v002.geojson', 'geometry'))).toBe(true);
  });

  it('does not claim look-alike names outside the methane folders', () => {
    expect(isMethaneLayer(layer('s3://bucket/session_data/abc/rasters/pass_x.tif', 'raster'))).toBe(false);
    expect(isMethaneLayer(layer('s3://bucket/session_data/abc/columns_x.geojson', 'geometry'))).toBe(false);
    expect(isMethaneLayer(layer(`${S}ndvi_x.tif`, 'raster'))).toBe(false);
  });

  it('takes the watch group from a validated hint', () => {
    const hint = parseRenderHint({ kind: 'points', group: 'watch', property: 'repeat_dates' })!;
    expect(isMethaneLayer(layer('s3://bucket/anything.geojson', 'geometry', hint))).toBe(true);
  });
});

describe('methaneGeometryHint', () => {
  it('prefers a valid methane or watch hint of a vector kind', () => {
    const hint = parseRenderHint({ kind: 'columns', group: 'methane', property: 'ppm_m', ramp: 'plasma', rescale: [0, 1500] })!;
    expect(methaneGeometryHint(hint, 's3://bucket/x.geojson')).toBe(hint);
  });

  it('falls back to the tool defaults by file name', () => {
    expect(methaneGeometryHint(undefined, `${S}plumes_permian.geojson`)).toBe(METHANE_VECTOR);
    expect(methaneGeometryHint(undefined, `${S}watch_sites_v002.geojson`)).toBe(METHANE_SITES);
    expect(methaneGeometryHint(undefined, `${S}columns_scene.geojson`)).toBe(METHANE_COLUMNS);
  });

  it('is null for a raster hint, another group, or an unknown file', () => {
    expect(methaneGeometryHint(parseRenderHint({ kind: 'raster', group: 'methane' })!, 's3://b/x.geojson')).toBeNull();
    expect(methaneGeometryHint(parseRenderHint({ kind: 'vector', group: 'similar' })!, 's3://b/x.geojson')).toBeNull();
    expect(methaneGeometryHint(undefined, `${S}boundary.geojson`)).toBeNull();
    expect(methaneGeometryHint(undefined, 's3://bucket/session_data/a/watch_sites_v002.geojson')).toBeNull();
  });
});

describe('methaneRasterHint', () => {
  const tropomi = `${S}tropomi_anomaly_south_caspian_2026-09-23_14d.tif`;
  it('always caps a TROPOMI composite\'s zoom, even under an old hint', () => {
    const old = parseRenderHint({ kind: 'raster', colormap: 'magma', rescale: [0, 60], units: 'ppb', group: 'methane' })!;
    expect(methaneRasterHint(old, tropomi)?.max_zoom).toBe(8);
    expect(methaneRasterHint(old, tropomi)?.colormap).toBe('magma');
    expect(methaneRasterHint(undefined, tropomi)).toBe(METHANE_TROPOMI);
  });

  it('keeps any other hint as sent and falls back by file name', () => {
    const pass = parseRenderHint({ kind: 'raster', colormap: 'plasma', rescale: [0, 1500], group: 'methane' })!;
    expect(methaneRasterHint(pass, `${S}pass_x.tif`)).toBe(pass);
    expect(methaneRasterHint(undefined, `${S}pass_x.tif`)?.colormap).toBe('plasma');
    expect(methaneRasterHint(undefined, 's3://b/methane/cache/ch4plm_x.tif')?.colormap).toBe('plasma');
    expect(methaneRasterHint(undefined, 's3://b/session_data/a/rasters/tci_x.tif')).toBeNull();
    expect(methaneRasterHint(undefined, 's3://b/session_data/a/rasters/tropomi_anomaly_x.tif')).toBeNull();
  });
});

describe('methaneLegend', () => {
  it('gives plasma ppm·m and viridis ppb a row each, once, and flags the sites key', () => {
    const tropomi = parseRenderHint({ kind: 'raster', colormap: 'viridis', rescale: [0, 60], units: 'ppb', group: 'methane', legend: 'CH4 anomaly', max_zoom: 8 })!;
    const pass = parseRenderHint({ kind: 'raster', colormap: 'plasma', rescale: [0, 1500], units: 'ppm·m', group: 'methane', legend: 'CH4 enhancement' })!;
    const legend = methaneLegend([METHANE_SITES, tropomi, pass, METHANE_COLUMNS, undefined]);
    expect(legend.sites).toBe(true);
    expect(legend.ramps).toEqual([
      { ramp: 'viridis', lo: 0, hi: 60, units: 'ppb', label: 'CH4 anomaly' },
      { ramp: 'plasma', lo: 0, hi: 1500, units: 'ppm·m', label: 'CH4 enhancement' },
    ]);
  });

  it('names a ramp by its units when the hint gives no legend', () => {
    expect(methaneLegend([METHANE_VECTOR]).ramps[0].label).toBe('CH4 enhancement');
  });
});

describe('globeCentre', () => {
  const box = (w: number, s: number, e: number, n: number) => ({
    properties: { tier: 'watch_area' },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  });

  it('faces the circular mean of the watch areas, not the arithmetic one', () => {
    // Two areas either side of the antimeridian face 180, not 0.
    const [lon] = globeCentre([box(170, 0, 172, 2), box(-172, 0, -170, 2)])!;
    expect(Math.abs(Math.abs(lon) - 180)).toBeLessThan(0.01);
  });

  it('uses the sites when there are no areas, and is null when nothing is usable', () => {
    const site = { properties: { tier: 'site' }, geometry: { type: 'Point', coordinates: [53.6, 39.5] } };
    expect(globeCentre([site])).toEqual([53.6, 39.5]);
    expect(globeCentre([])).toBeNull();
    expect(globeCentre([{ properties: {}, geometry: null }])).toBeNull();
  });
});

describe('isoDay', () => {
  it('prints only an ISO day', () => {
    expect(isoDay('2025-08-01T06:12:00Z')).toBe('2025-08-01');
    expect(isoDay('<img src=x>')).toBe('n/a');
    expect(isoDay(20250801)).toBe('n/a');
  });
});
