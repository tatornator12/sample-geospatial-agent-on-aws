/**
 * Evidence: the images the agent looked at.
 *
 * Only tool INPUTS reach the UI over the stream, so an `inspect_image` call is known by its
 * `s3_url` and `title`. The saved rendering lives at a key derived from the raster's, mirroring
 * `_inspection_key` in geo_agent/utils/tools.py:
 *   s3://b/session_data/<sid>/rasters/x.tif  ->  s3://b/session_data/<sid>/inspections/x.jpg|png
 * True-colour scenes render as JPEG, everything else as PNG; both candidates are returned so the
 * loader can fall back if the first does not exist.
 */
import type { ToolCall } from '../types.ts';

export interface EvidenceItem {
  toolId: string;
  title: string;
  question?: string;
  sourceUrl: string;
  /** Candidate locations of the saved rendering, most likely first. */
  evidenceUrls: string[];
}

const TRUE_COLOUR = /(^|[/_-])(tci|visual|true[_-]?colou?r|rgb)([._-]|$)/i;

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Where the agent saved what it saw, or null when the URL is not a raster we know. Session
 * rasters map inside their own session. A shared plume raster (`s3://b/methane/cache/ch4plm_*.tif`,
 * cached once for every session) was inspected in THIS session, so it needs the session id.
 */
export function evidenceUrlsFor(rasterS3Url: string, sessionId?: string): string[] | null {
  const shared = rasterS3Url.match(/^s3:\/\/([^/]+)\/methane\/cache\/(ch4plm_[A-Za-z0-9_]+)\.tiff?$/);
  if (shared) {
    if (!sessionId || !SESSION_ID.test(sessionId)) return null;
    const base = `s3://${shared[1]}/session_data/${sessionId}/inspections/${shared[2]}`;
    return [`${base}.png`, `${base}.jpg`];
  }
  const match = rasterS3Url.match(/^(s3:\/\/[^/]+\/session_data\/[^/]+\/)[^/]+\/([^/]+)$/);
  if (!match) return null;
  const [, sessionPrefix, basename] = match;
  const stem = basename.includes('.') ? basename.slice(0, basename.lastIndexOf('.')) : basename;
  const base = `${sessionPrefix}inspections/${stem}`;
  return TRUE_COLOUR.test(stem) ? [`${base}.jpg`, `${base}.png`] : [`${base}.png`, `${base}.jpg`];
}

/** inspect_image calls with a usable s3_url and title, de-duplicated by tool id, in stream order. */
export function extractEvidence(tools: ToolCall[], sessionId?: string): EvidenceItem[] {
  const seen = new Set<string>();
  const items: EvidenceItem[] = [];
  for (const tool of tools) {
    if (tool.name !== 'inspect_image' || seen.has(tool.id)) continue;
    const s3Url = tool.params?.s3_url;
    const title = tool.params?.title;
    if (typeof s3Url !== 'string' || typeof title !== 'string' || !title) continue;
    const evidenceUrls = evidenceUrlsFor(s3Url, sessionId);
    if (!evidenceUrls) continue;
    seen.add(tool.id);
    items.push({
      toolId: tool.id,
      title,
      question: typeof tool.params.question === 'string' && tool.params.question ? tool.params.question : undefined,
      sourceUrl: s3Url,
      evidenceUrls,
    });
  }
  return items;
}
