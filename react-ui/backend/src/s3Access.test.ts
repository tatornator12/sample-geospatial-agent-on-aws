// Node's built-in test runner (no extra dependency; the image is node:20). Run: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkS3Access, type S3Purpose } from './s3Access';

const B = 'geospatial-agent-data';
const SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890-1234abcd';

describe('checkS3Access: what the UI reads', () => {
  const allowed: Array<[string, S3Purpose]> = [
    [`s3://${B}/session_data/${SID}/rasters/tci_clipped_midland_2023-12-28.tif`, 'render'],
    [`s3://${B}/session_data/${SID}/inspections/ch4plm_EMIT_L2B_CH4PLM_002_20240131T182459_002534.png`, 'render'],
    [`s3://${B}/session_data/${SID}/inspections/tci_x.jpg`, 'render'],
    [`s3://${B}/use-cases/palisades-fire/after/tci.tif`, 'render'],
    [`s3://${B}/methane/cache/ch4plm_EMIT_L2B_CH4PLM_002_20240131T182459_002534.tif`, 'render'],
    [`s3://${B}/session_data/${SID}/methane/plumes_ranked_permian_basin_2024-01-01_2024-12-31.geojson`, 'geometry'],
    [`s3://${B}/use-cases/lake-mead/geometry.geojson`, 'geometry'],
  ];
  for (const [url, purpose] of allowed) {
    it(`allows ${url} (${purpose})`, () => {
      const r = checkS3Access(url, B, purpose);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(`s3://${r.bucket}/${r.key}`, url);
    });
  }
});

describe('checkS3Access: everything else', () => {
  const refused: Array<[string, unknown, S3Purpose, number]> = [
    ['another bucket', `s3://someone-elses-bucket/session_data/${SID}/rasters/x.tif`, 'render', 403],
    ['agent conversation state', `s3://${B}/sessions/${SID}/agent.json`, 'geometry', 403],
    ['spike scratch space', `s3://${B}/spikes/emit/plume.tif`, 'render', 403],
    ['bucket root', `s3://${B}/secret.tif`, 'render', 403],
    ['session_data without a session', `s3://${B}/session_data/x.tif`, 'render', 403],
    ['dot-dot segment', `s3://${B}/session_data/${SID}/../../sessions/a.json`, 'geometry', 403],
    ['dot session id', `s3://${B}/session_data/../sessions/a.json`, 'geometry', 403],
    ['double slash', `s3://${B}/session_data//rasters/x.tif`, 'render', 403],
    ['control character', `s3://${B}/session_data/${SID}/r/x\u0000.tif`, 'render', 403],
    ['backslash', `s3://${B}/session_data/${SID}\\..\\x.tif`, 'render', 403],
    ['cache file that is not a plume', `s3://${B}/methane/cache/other.tif`, 'render', 403],
    ['cache subfolder', `s3://${B}/methane/cache/ch4plm_x/y.tif`, 'render', 403],
    ['markup for rendering', `s3://${B}/session_data/${SID}/x.html`, 'render', 403],
    ['raster as geometry', `s3://${B}/session_data/${SID}/x.tif`, 'geometry', 403],
    ['not an s3 URL', `https://${B}.s3.amazonaws.com/session_data/${SID}/x.tif`, 'render', 400],
    ['empty', '', 'render', 400],
    ['not a string (repeated query param)', ['s3://a/b'], 'render', 400],
    ['too long', `s3://${B}/session_data/${SID}/${'a'.repeat(1100)}.tif`, 'render', 400],
  ];
  for (const [why, url, purpose, status] of refused) {
    it(`refuses ${why}`, () => {
      const r = checkS3Access(url, B, purpose);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.status, status);
    });
  }

  it('fails closed when the data bucket is not configured', () => {
    assert.deepEqual(checkS3Access(`s3://${B}/use-cases/x/a.tif`, undefined, 'render'), {
      ok: false,
      status: 500,
      reason: 'S3_BUCKET_NAME is not configured',
    });
  });
});
