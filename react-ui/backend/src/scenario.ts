/**
 * The parts of a replay case's config.json that go beyond the before/after scheme:
 *
 *   agent          which act the case belongs to (the UI selects it)
 *   assets.layers  [{file, title, render}] what goes on the map, in order
 *   tool_calls     the recorded steps; their `s3://bucket/use-cases/<id>/…` placeholders point here
 *
 * config.json is committed, reviewed content, but it is still read from S3 and handed to the
 * browser, so every field is checked: layers name a FILE inside the case's own prefix (never a
 * URL), titles are bounded strings, render hints are objects (the frontend validates them
 * against its allowlist), and only placeholders for this case are rewritten to the real bucket.
 */

export interface ScenarioLayer {
  s3_url: string;
  title: string;
  render?: Record<string, unknown>;
}

const LAYER_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(tif|tiff|geojson)$/;
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LAYERS = 12;

export function scenarioAgent(config: unknown): string | undefined {
  const agent = (config as { agent?: unknown } | null)?.agent;
  return typeof agent === 'string' && AGENT_ID.test(agent) ? agent : undefined;
}

/** Validated layers as URLs under `s3://<bucket>/use-cases/<id>/`; invalid entries are dropped. */
export function scenarioLayers(config: unknown, bucket: string, scenarioId: string): ScenarioLayer[] {
  const raw = (config as { assets?: { layers?: unknown } } | null)?.assets?.layers;
  if (!Array.isArray(raw)) return [];
  const out: ScenarioLayer[] = [];
  for (const entry of raw.slice(0, MAX_LAYERS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { file, title, render } = entry as Record<string, unknown>;
    if (typeof file !== 'string' || !LAYER_FILE.test(file)) continue;
    const layer: ScenarioLayer = {
      s3_url: `s3://${bucket}/use-cases/${scenarioId}/${file}`,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : file,
    };
    if (render && typeof render === 'object' && !Array.isArray(render)) layer.render = render as Record<string, unknown>;
    out.push(layer);
  }
  return out;
}

/**
 * Recorded tool calls with this case's placeholder URLs (`s3://bucket/use-cases/<id>/…`) pointed
 * at the real bucket, so the replayed steps' evidence chips resolve. Other values are untouched.
 */
export function scenarioToolCalls(config: unknown, bucket: string, scenarioId: string): unknown[] {
  const raw = (config as { tool_calls?: unknown } | null)?.tool_calls;
  if (!Array.isArray(raw)) return [];
  const placeholder = `s3://bucket/use-cases/${scenarioId}/`;
  const real = `s3://${bucket}/use-cases/${scenarioId}/`;
  return raw.map((call) => {
    if (!call || typeof call !== 'object') return call;
    const params = (call as { params?: unknown }).params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return call;
    const rewritten: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      rewritten[k] = typeof v === 'string' && v.startsWith(placeholder) && !v.includes('..') ? real + v.slice(placeholder.length) : v;
    }
    return { ...(call as object), params: rewritten };
  });
}

/** A scenario id as it may reach the agent runtime (invoke payload) and S3 keys. */
export function isScenarioId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}
