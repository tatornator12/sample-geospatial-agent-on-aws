/**
 * The cue step's filmstrip: every recent EMIT pass the agent read over the site, newest first,
 * as a small frame of the window it judged. Candidates stand at full strength; rejected passes
 * are dimmed, and the line under the frames says why in words ("2 candidates · 1 too weak").
 *
 * Tool outputs never reach the UI, so check_recent_passes writes a manifest beside its chips;
 * its key comes from the call's lat/lon (utils/steps.ts). The manifest is read through the
 * backend's allowlisted geometry route and validated field by field; chips load by presigned GET.
 * Nothing here blocks the step column: it waits quietly, then settles to nothing if absent.
 */
import { useEffect, useState } from 'react';
import { getPresignedUrl, loadGeometry } from '../services/api.ts';
import type { EvidenceItem } from '../utils/evidence.ts';
import { filmstripSummary, parseManifest, type PassFrame } from '../utils/steps.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 45_000;

interface PassFilmstripProps {
  toolId: string;
  manifestUrl: string;
  /** The manifest's folder: chips are named relative to it. */
  dir: string;
  /** The call has finished (the manifest is written before the tool returns). */
  ready: boolean;
  onOpen?: (item: EvidenceItem, imageUrl: string) => void;
}

type Loaded = { frame: PassFrame; imageUrl: string | null };

export function PassFilmstrip({ toolId, manifestUrl, dir, ready, onOpen }: PassFilmstripProps) {
  const [frames, setFrames] = useState<Loaded[] | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const attempt = async () => {
      const raw = await loadGeometry(manifestUrl);
      if (cancelled) return;
      const parsed = raw ? parseManifest(raw, dir) : null;
      if (!parsed) {
        if (Date.now() - started < GIVE_UP_MS) timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      const loaded = await Promise.all(
        parsed.map(async (frame) => ({ frame, imageUrl: frame.chipUrl ? await getPresignedUrl(frame.chipUrl) : null }))
      );
      if (!cancelled) setFrames(loaded);
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [manifestUrl, dir, ready]);

  if (!frames || frames.length === 0) return null;

  const open = ({ frame, imageUrl }: Loaded) => {
    if (!imageUrl || !onOpen || !frame.chipUrl) return;
    const peak = frame.peak !== null ? `, peak ${frame.peak.toLocaleString('en-US', { maximumFractionDigits: 1 })} ppm·m` : '';
    onOpen(
      {
        toolId: `${toolId}:${frame.date}`,
        title: `EMIT pass ${frame.date}: ${frame.short}`,
        question: frame.reason ? `${frame.reason}${peak}` : undefined,
        sourceUrl: frame.chipUrl,
        evidenceUrls: [frame.chipUrl],
      },
      imageUrl
    );
  };

  return (
    <div className="pass-film">
      <ul className="pass-film__frames" aria-label="Recent EMIT passes, newest first">
        {frames.map((f) => {
          const label = `${f.frame.date}: ${f.frame.short}`;
          return (
            <li key={f.frame.date + (f.frame.chipUrl ?? '')}>
              <button
                type="button"
                className={`pass-film__frame pass-film__frame--${f.frame.verdict}`}
                onClick={() => open(f)}
                disabled={!f.imageUrl || !onOpen}
                aria-label={label}
                title={label}
              >
                {f.imageUrl ? <img src={f.imageUrl} alt="" /> : <span aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="pass-film__summary">{filmstripSummary(frames.map((f) => f.frame))}</p>
    </div>
  );
}
