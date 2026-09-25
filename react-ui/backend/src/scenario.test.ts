import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isScenarioId, scenarioAgent, scenarioLayers, scenarioToolCalls } from './scenario';

const B = 'data-bucket';
const ID = 'methane-permian-2024';

describe('scenarioLayers', () => {
  it('maps files into the case prefix, keeping order, titles and render objects', () => {
    const layers = scenarioLayers({
      assets: {
        layers: [
          { file: 'geometry.geojson', title: 'Ranked', render: { kind: 'vector', group: 'methane' } },
          { file: 'ch4plm_EMIT_x.tif', title: '  Plume  ' },
        ],
      },
    }, B, ID);
    assert.deepEqual(layers, [
      { s3_url: `s3://${B}/use-cases/${ID}/geometry.geojson`, title: 'Ranked', render: { kind: 'vector', group: 'methane' } },
      { s3_url: `s3://${B}/use-cases/${ID}/ch4plm_EMIT_x.tif`, title: 'Plume' },
    ]);
  });

  it('drops URLs, paths, other file types and junk', () => {
    const layers = scenarioLayers({
      assets: {
        layers: [
          { file: 's3://other-bucket/x.tif' }, { file: '../sessions/a.geojson' }, { file: 'sub/x.tif' },
          { file: 'x.html' }, { file: '.hidden.tif' }, 'x.tif', null, { file: 'ok.tif', render: [1] },
        ],
      },
    }, B, ID);
    assert.deepEqual(layers, [{ s3_url: `s3://${B}/use-cases/${ID}/ok.tif`, title: 'ok.tif' }]);
    assert.deepEqual(scenarioLayers({}, B, ID), []);
    assert.deepEqual(scenarioLayers(null, B, ID), []);
  });

  it('caps the layer count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ file: `l${i}.tif` }));
    assert.equal(scenarioLayers({ assets: { layers: many } }, B, ID).length, 12);
  });
});

describe('scenarioToolCalls', () => {
  it('points this case\'s placeholders at the real bucket and leaves everything else alone', () => {
    const calls = scenarioToolCalls({
      tool_calls: [
        { name: 'inspect_image', params: { s3_url: `s3://bucket/use-cases/${ID}/tci.tif`, title: 'T' }, result: 'r' },
        { name: 'display_visual', params: { s3_url: 's3://bucket/use-cases/other-case/x.tif' } },
        { name: 'display_visual', params: { s3_url: `s3://bucket/use-cases/${ID}/../../sessions/a` } },
        { name: 'reverse_geocode', params: { lat: 31.9 } },
      ],
    }, B, ID) as Array<{ params: Record<string, unknown> }>;
    assert.equal(calls[0].params.s3_url, `s3://${B}/use-cases/${ID}/tci.tif`);
    assert.equal(calls[1].params.s3_url, 's3://bucket/use-cases/other-case/x.tif');
    assert.equal(calls[2].params.s3_url, `s3://bucket/use-cases/${ID}/../../sessions/a`);
    assert.deepEqual(calls[3].params, { lat: 31.9 });
  });
});

describe('scenarioAgent and isScenarioId', () => {
  it('accepts agent ids and scenario ids in their shapes only', () => {
    assert.equal(scenarioAgent({ agent: 'methane' }), 'methane');
    assert.equal(scenarioAgent({ agent: 'Methane Hunter' }), undefined);
    assert.equal(scenarioAgent({}), undefined);
    assert.equal(isScenarioId(ID), true);
    for (const bad of ['', '../x', 'A', 'a/b', 'x'.repeat(65), 42, null]) assert.equal(isScenarioId(bad), false);
  });
});
