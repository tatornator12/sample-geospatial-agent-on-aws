import { describe, expect, it } from 'vitest';
import { isMethaneLayer, type LayerMetadata } from './layerFormatting.ts';
import {
  METHANE_COLUMNS,
  METHANE_SITES,
  METHANE_TROPOMI,
  METHANE_VECTOR,
  barLanding,
  compositeLandsHidden,
  footprintFrame,
  globeCentre,
  isBarLayer,
  isTropomiComposite,
  isoDay,
  labelPointOutside,
  methaneGeometryHint,
  methaneLegend,
  methaneRampLabel,
  methaneRasterHint,
  tickChanges,
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
    // The ppb ramp is the stage's, whatever an old hint or recording says (magma, viridis).
    expect(methaneRasterHint(old, tropomi)?.colormap).toBe('ice');
    const recorded = parseRenderHint({ kind: 'raster', colormap: 'viridis', rescale: [0, 60], units: 'ppb', group: 'methane', max_zoom: 7 })!;
    expect(methaneRasterHint(recorded, tropomi)).toMatchObject({ colormap: 'ice', max_zoom: 7 });
    // Not a TROPOMI file: the hint stands as sent.
    expect(methaneRasterHint(recorded, 's3://b/session_data/s/methane/pass_x.tif')?.colormap).toBe('viridis');
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
      { ramp: 'viridis', lo: 0, hi: 60, units: 'ppb', label: 'TROPOMI, above the area median' },
      { ramp: 'plasma', lo: 0, hi: 1500, units: 'ppm·m', label: 'EMIT methane above background' },
    ]);
  });

  it('names a ramp by its units when the hint gives no legend', () => {
    expect(methaneLegend([METHANE_VECTOR]).ramps[0].label).toBe('EMIT methane above background');
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

describe('methaneRampLabel (B11, A2 P1-4)', () => {
  it("says what each ramp measures in the room's words, never the tools' shorthand", () => {
    expect(methaneRampLabel('ppm·m', 'CH4 enhancement')).toBe('EMIT methane above background');
    expect(methaneRampLabel('ppm·m')).toBe('EMIT methane above background');
    expect(methaneRampLabel('ppb', 'CH4 anomaly')).toBe('TROPOMI, above the area median');
    // The composite's days, from its own file name only.
    expect(methaneRampLabel('ppb', 'CH4 anomaly', 's3://b/use-cases/methane-watch-mission/tropomi_anomaly_south_caspian_2026-10-08_14d.tif')).toBe(
      'TROPOMI, 14 days, above the area median'
    );
    expect(methaneRampLabel('ppb', undefined, 's3://b/methane/x/tropomi_anomaly_amman_2026-10-08_7d.tif')).toBe('TROPOMI, 7 days, above the area median');
    expect(methaneRampLabel('ppb', undefined, 's3://b/methane/x/tropomi_anomaly_amman_2026-10-08_99d.tif')).toBe('TROPOMI, above the area median');
    expect(methaneRampLabel('dates', 'something else')).toBe('something else');
  });
});

const square = (w: number, s: number, e: number, n: number, properties: Record<string, unknown> = {}) => ({
  properties,
  geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
});

describe('labelPointOutside (B12, A2 P1-6)', () => {
  it("stands on the footprint's east edge at its centre's latitude", () => {
    expect(labelPointOutside(square(-102.0, 31.8, -101.9, 31.9, { center_lat: 31.86, center_lon: -101.95 }))).toEqual([-101.9, 31.86]);
    // No centre (or one outside the footprint): the box's middle latitude.
    expect(labelPointOutside(square(-102.0, 31.8, -101.9, 32.0))).toEqual([-101.9, 31.9]);
    expect(labelPointOutside(square(-102.0, 31.8, -101.9, 32.0, { center_lat: 40 }))).toEqual([-101.9, 31.9]);
    expect(labelPointOutside({ properties: {}, geometry: null })).toBeNull();
  });
});

describe('footprintFrame (B13, A2 P1-7)', () => {
  it('frames a regional set whole', () => {
    const permian = [square(-102.2, 31.6, -102.1, 31.7, { rank: 1 }), square(-103.5, 32.2, -103.4, 32.3, { rank: 2 })];
    expect(footprintFrame(permian)).toEqual({ bounds: [-103.5, 31.6, -102.1, 32.3] });
  });

  it('frames the top three when the whole set spans the world, and rank 1 when they do too', () => {
    const utah = square(-111.2, 41.4, -111.1, 41.5, { rank: 1, center_lon: -111.15, center_lat: 41.45 });
    const nsw = square(150.0, -32.5, 150.1, -32.4, { rank: 2 });
    const turkmen = square(53.6, 39.4, 53.7, 39.5, { rank: 3 });
    const texas = square(-102.0, 31.8, -101.9, 31.9, { rank: 2 });
    const nm = square(-104.0, 32.0, -103.9, 32.1, { rank: 3 });
    // Ranks 1 to 3 in the Americas, a fourth in Australia: the Americas.
    expect(footprintFrame([utah, texas, nm, square(150.0, -32.5, 150.1, -32.4, { rank: 4 })])).toEqual({ bounds: [-111.2, 31.8, -101.9, 41.5] });
    // Ranks 1 to 3 across the world: rank 1's centre, at zoom 5, never the box's middle over Africa.
    const frame = footprintFrame([nsw, turkmen, utah]);
    expect(frame).toEqual({ center: [-111.15, 41.45], zoom: 5 });
  });

  it('is null without footprints', () => {
    expect(footprintFrame([])).toBeNull();
  });
});

describe('the layers list keeps what the bars replace, unticked (approved 2026-10-26)', () => {
  // The order the live run lands them in: the baseline, the flat composite (when the agent shows
  // it), the tip bars, then the record bars (EMIT's or Carbon Mapper's).
  const geo = (id: string, file: string) => ({ id, type: 'geometry' as const, url: `${S}${file}`,
    render: methaneGeometryHint(undefined, `${S}${file}`) ?? undefined });
  const sites = geo('sites', 'watch_sites_v002.geojson');
  const composite = { id: 'tropomi', type: 'raster' as const, url: `${S}tropomi_anomaly_shanxi_coal_basin_2026-10-24_14d.tif` };
  const tipBars = geo('tip', 'tipcolumns_37.8927_113.5628.geojson');
  const emitBars = geo('emit', 'columns_EMIT_L2B_CH4ENH_002_20260725T060520_2620604_019.geojson');
  const cmBars = geo('cm', 'cmcolumns_tan20260826t084806c27s4001-I.geojson');
  const scene = { id: 'tci', type: 'raster' as const, url: `${S}tci_clipped_pingding_county_watch_site_2026-07-15.tif` };

  it('knows the bar layers and the flat composite by their file names', () => {
    expect([sites, composite, tipBars, emitBars, cmBars, scene].map((l) => [l.id, isBarLayer(l), isTropomiComposite(l)])).toEqual([
      ['sites', false, false], ['tropomi', false, true], ['tip', true, false], ['emit', true, false], ['cm', true, false],
      ['tci', false, false]]);
    // Outside a methane folder a tropomi-named file is not the act's composite.
    expect(isTropomiComposite({ ...composite, url: 's3://b/other/tropomi_anomaly_x_14d.tif' })).toBe(false);
  });

  it('the tip bars untick the flat composite; the record bars untick the tip bars and the composite; nothing leaves the list', () => {
    expect(barLanding([sites, composite], tipBars)).toEqual({ remove: [], hide: ['tropomi'] });
    expect(barLanding([sites, composite, tipBars], emitBars)).toEqual({ remove: [], hide: ['tropomi', 'tip'] });
    expect(barLanding([sites, tipBars, scene], cmBars)).toEqual({ remove: [], hide: ['tip'] });
    // The baseline and the ground scene are never touched.
    expect(barLanding([sites, tipBars, scene], cmBars).hide).not.toContain('sites');
  });

  it('the same file shown again replaces its first showing (one row per file)', () => {
    const again = { ...tipBars, id: 'tip-again' };
    expect(barLanding([sites, composite, tipBars], again)).toEqual({ remove: ['tip'], hide: ['tropomi'] });
  });

  it('a composite that lands after the bars lands unticked; before any bars, ticked', () => {
    expect(compositeLandsHidden([sites, emitBars], () => true)).toBe(true);
    expect(compositeLandsHidden([sites, emitBars], (id) => id !== 'emit')).toBe(false);
    expect(compositeLandsHidden([sites], () => true)).toBe(false);
  });

  it('one bar layer on the map at a time: ticking the tip bars unticks the record bars, and back', () => {
    const layers = [sites, composite, tipBars, emitBars, scene];
    const shownNow = new Set(['sites', 'emit', 'tci']);           // the record bars are on, the rest kept unticked
    const shown = (id: string) => shownNow.has(id);
    expect(tickChanges(layers, 'tip', true, shown)).toEqual({ tip: true, emit: false });
    expect(tickChanges(layers, 'emit', true, (id) => id === 'tip')).toEqual({ emit: true, tip: false });
    // The flat composite ticks freely, and so does everything else; unticking never ticks another.
    expect(tickChanges(layers, 'tropomi', true, shown)).toEqual({ tropomi: true });
    expect(tickChanges(layers, 'emit', false, shown)).toEqual({ emit: false });
    expect(tickChanges(layers, 'tci', false, shown)).toEqual({ tci: false });
  });
});
