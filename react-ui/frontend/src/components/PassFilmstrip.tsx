/**
 * The cue step's filmstrip: every recent EMIT pass the agent read over the site, newest first,
 * as a small frame of the window it judged. Candidates stand at full strength; rejected passes
 * are dimmed, and the line under the frames says why in words ("2 candidates · 1 too weak").
 *
 * Tool outputs never reach the UI, so check_recent_passes writes a manifest beside its chips;
 * the step column loads and validates it (utils/steps.ts) and hands the frames here. Chips load
 * by presigned GET. Nothing here blocks the step column.
 */
import { useEffect, useState } from 'react';
import { getPresignedUrl } from '../services/api.ts';
import type { EvidenceItem } from '../utils/evidence.ts';
import { filmstripSummary, type PassFrame } from '../utils/steps.ts';

interface PassFilmstripProps {
  toolId: string;
  frames: PassFrame[];
  onOpen?: (item: EvidenceItem, imageUrl: string) => void;
}

export function PassFilmstrip({ toolId, frames, onOpen }: PassFilmstripProps) {
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const missing = frames.filter((f) => f.chipUrl && !images[f.chipUrl]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (f) => [f.chipUrl!, await getPresignedUrl(f.chipUrl!)] as const)).then((pairs) => {
      if (cancelled) return;
      setImages((prev) => {
        const next = { ...prev };
        pairs.forEach(([k, v]) => { if (v) next[k] = v; });
        return next;
      });
    });
    return () => { cancelled = true; };
    // `frames` is the identity to watch; `images` is only read to skip work already done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  if (frames.length === 0) return null;

  const open = (frame: PassFrame) => {
    const imageUrl = frame.chipUrl ? images[frame.chipUrl] : undefined;
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
          const label = `${f.date}: ${f.short}`;
          const imageUrl = f.chipUrl ? images[f.chipUrl] : undefined;
          return (
            <li key={f.date + (f.chipUrl ?? '')}>
              <button
                type="button"
                className={`pass-film__frame pass-film__frame--${f.verdict}`}
                onClick={() => open(f)}
                disabled={!imageUrl || !onOpen}
                aria-label={label}
                title={label}
              >
                {imageUrl ? <img src={imageUrl} alt="" /> : <span aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="pass-film__summary">{filmstripSummary(frames)}</p>
    </div>
  );
}
