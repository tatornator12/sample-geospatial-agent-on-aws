/**
 * Which S3 objects the UI may read through the backend (`/api/presigned-url`, `/api/geometry`).
 *
 * Both endpoints take an `s3://bucket/key` from the browser, and the browser gets its URLs from
 * the agent's stream, which is model-written. Without a check, any signed-in user could have the
 * backend sign or fetch any object its role can read: other buckets (locally, with an admin
 * profile), or the agents' own conversation state under `sessions/`. So a URL is accepted only
 * when it is in the data bucket and under a prefix the UI actually displays:
 *
 *   session_data/<session id>/...   rasters, footprints, inspections an agent wrote for a session
 *   use-cases/<case id>/...          replay cases
 *   methane/cache/ch4plm_<id>.tif    plume rasters the Methane Hunter caches for every session
 *
 * and only for the file types the UI renders. Session ids are unguessable (>= 33 chars, set by
 * the browser per session); they are not bound to a user here, which is acceptable for a
 * single-presenter demo and noted in the methane-hunter spec (task 5.4).
 */

export type S3Purpose = 'render' | 'geometry';

export type S3Access =
  | { ok: true; bucket: string; key: string }
  | { ok: false; status: 400 | 403 | 500; reason: string };

const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
const ALLOWED_KEYS: RegExp[] = [
  new RegExp(`^session_data/${SEGMENT}/`),
  new RegExp(`^use-cases/${SEGMENT}/`),
  /^methane\/cache\/ch4plm_[A-Za-z0-9_]{1,80}\.tif$/,
];

const EXTENSIONS: Record<S3Purpose, RegExp> = {
  // Map tiles (TiTiler reads the presigned COG) and evidence images.
  render: /\.(tif|tiff|png|jpg|jpeg)$/i,
  geometry: /\.(geojson|json)$/i,
};

export function checkS3Access(s3Url: unknown, dataBucket: string | undefined, purpose: S3Purpose): S3Access {
  if (!dataBucket) return { ok: false, status: 500, reason: 'S3_BUCKET_NAME is not configured' };
  if (typeof s3Url !== 'string' || s3Url.length === 0) {
    return { ok: false, status: 400, reason: 's3Url parameter is required' };
  }
  if (s3Url.length > 1100) return { ok: false, status: 400, reason: 's3Url is too long' };
  const match = s3Url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return { ok: false, status: 400, reason: 'Invalid S3 URL format. Expected: s3://bucket/key' };
  const [, bucket, key] = match;

  if (bucket !== dataBucket) return { ok: false, status: 403, reason: 'bucket not allowed' };
  // S3 keys are literal, but a key that looks like a path trick is never one the agents write.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(key) || key.includes('//') || key.split('/').some((s) => s === '.' || s === '..')) {
    return { ok: false, status: 403, reason: 'key not allowed' };
  }
  if (!ALLOWED_KEYS.some((re) => re.test(key))) return { ok: false, status: 403, reason: 'prefix not allowed' };
  if (!EXTENSIONS[purpose].test(key)) return { ok: false, status: 403, reason: 'file type not allowed' };
  return { ok: true, bucket, key };
}
