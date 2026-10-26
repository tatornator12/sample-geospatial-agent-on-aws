/**
 * The cue step's filmstrip: the newest EMIT passes the agent read over the site (FILM_FRAMES of
 * them; the record timeline above the followed site draws every look), oldest first, left to right,
 * so they read the same way as the record's date axis, each a small frame of the window it judged
 * with its date under it (approved 2026-10-26). A pass that saw methane wears the record's own
 * "methane seen" orange; rejected passes are dimmed; a clouded-out pass is a dark frame with the
 * record's clouded-out tick. The line under the frames says the verdicts in words
 * ("2 candidates · 1 too weak").
 *
 * Tool outputs never reach the UI, so check_recent_passes writes a manifest beside its chips;
 * the step column loads and validates it (utils/steps.ts) and hands the frames here. Chips load
 * by presigned GET. Nothing here blocks the step column.
 */
import { useEffect, useState } from 'react';
import { getPresignedUrl } from '../services/api.ts';
import type { EvidenceItem } from '../utils/evidence.ts';
import { dayMonth, dayMonthYear } from '../utils/record.ts';
import { FILM_FRAMES, filmCaption, filmFrames, filmstripSummary, passWords, type PassFrame } from '../utils/steps.ts';

interface PassFilmstripProps {
  toolId: string;
  frames: PassFrame[];
  onOpen?: (item: EvidenceItem, imageUrl: string) => void;
  /** Only the line in words (the end frame keeps the site the agent did not follow this way): no frames, no chip loads. */
  summaryOnly?: boolean;
  /** The frames without their line in words: the record timeline above says it (the followed site). */
  noSummary?: boolean;
}

export function PassFilmstrip({ toolId, frames: all, onOpen, summaryOnly = false, noSummary = false }: PassFilmstripProps) {
  const [images, setImages] = useState<Record<string, string>>({});
  // The newest frames are the evidence one press away; the line in words counts every pass read.
  const shown = filmFrames(all, FILM_FRAMES);

  useEffect(() => {
    if (summaryOnly) return;
    let cancelled = false;
    const missing = shown.map((s) => s.frame).filter((f) => f.chipUrl && !images[f.chipUrl]);
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
    // `all` is the identity to watch; `images` is only read to skip work already done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, summaryOnly]);

  if (all.length === 0) return null;
  if (summaryOnly) {
    return (
      <div className="pass-film">
        <p className="pass-film__summary">{filmstripSummary(all)}</p>
      </div>
    );
  }

  const open = (frame: PassFrame) => {
    const imageUrl = frame.chipUrl ? images[frame.chipUrl] : undefined;
    if (!imageUrl || !onOpen || !frame.chipUrl) return;
    const peak = frame.peak !== null ? `, peak ${frame.peak.toLocaleString('en-US', { maximumFractionDigits: 1 })} ppm·m` : '';
    onOpen(
      {
        toolId: `${toolId}:${frame.date}`,
        title: `EMIT pass, ${dayMonthYear(frame.date)}: ${passWords(frame)}`,
        question: frame.reason ? `${frame.reason}${peak}` : undefined,
        sourceUrl: frame.chipUrl,
        evidenceUrls: [frame.chipUrl],
      },
      imageUrl
    );
  };

  const caption = filmCaption(shown.length, all.length);
  const captionText = caption.map((p) => p.text).join('');
  return (
    <div className="pass-film">
      {/* Whose frames these are, so no date above them is ever read as theirs. */}
      <p className="pass-film__caption" aria-hidden="true">
        {caption.map((p, i) => (p.mono ? <span key={i} className="pass-film__num">{p.text}</span> : <span key={i}>{p.text}</span>))}
      </p>
      <ul className="pass-film__frames" aria-label={`${captionText}, oldest first`}>
        {shown.map(({ frame: f, index }, k) => {
          const label = `${dayMonthYear(f.date)}, ${passWords(f)}`;
          const imageUrl = f.chipUrl ? images[f.chipUrl] : undefined;
          const [day, month] = dayMonth(f.date).split(' ');
          // The year where it starts: under the first frame and the first of each new year, so a
          // strip from June 2025 to August 2026 never reads as "Jun, Aug, Apr".
          const year = f.date.slice(0, 4);
          const newYear = k === 0 || shown[k - 1].frame.date.slice(0, 4) !== year;
          const clouded = f.short === 'cloud or gap';
          // A date alone is not unique: one orbit can give two granules over a site on the same day,
          // and a pass with no chip (cloud or gap) has no URL to tell them apart. The manifest's
          // position settles the key.
          return (
            <li key={`${index}:${f.date}:${f.chipUrl ?? ''}`} className="pass-film__cell">
              <button
                type="button"
                className={`pass-film__frame pass-film__frame--${f.verdict}${clouded ? ' pass-film__frame--clouded' : ''}`}
                onClick={() => open(f)}
                disabled={!imageUrl || !onOpen}
                aria-label={label}
                title={label}
              >
                {imageUrl ? <img src={imageUrl} alt="" /> : <span className="pass-film__blank" aria-hidden="true" />}
              </button>
              {/* The date under its frame, outside the button, so a dimmed frame never dims its date. */}
              <span className={`pass-film__date${f.verdict === 'candidate' ? ' pass-film__date--seen' : ''}`} aria-hidden="true">
                <span>{day}</span> <span>{month}</span>
                {newYear && <> <span className="pass-film__year">{year}</span></>}
              </span>
            </li>
          );
        })}
      </ul>
      {!noSummary && <p className="pass-film__summary">{filmstripSummary(all)}</p>}
    </div>
  );
}
