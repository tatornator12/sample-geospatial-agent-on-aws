/**
 * An evidence chip: the image the agent looked at, pinned under the step that looked.
 *
 * The rendering is saved to S3 by the agent while the tool runs, so the chip is born as a
 * "looking…" placeholder and resolves once a presigned GET succeeds. The saved key is derived
 * from the raster URL (two candidates: jpg/png); each is tried, then retried every 2 s for up
 * to 60 s, after which the chip settles quietly into a "not saved" state. Nothing here ever
 * blocks the caption or the map.
 */
import { useEffect, useRef, useState } from 'react';
import { getPresignedUrl } from '../services/api.ts';
import type { EvidenceItem } from '../utils/evidence.ts';

const RETRY_MS = 2000;
const GIVE_UP_MS = 60_000;

type LoadState = 'looking' | 'ready' | 'missing';

interface EvidenceChipProps {
  item: EvidenceItem;
  /** Called with the resolved image URL when the presenter opens the chip. */
  onOpen: (item: EvidenceItem, imageUrl: string) => void;
}

/** Resolve to a loadable image URL, or null when the object is not there (yet). */
async function probe(candidates: string[]): Promise<string | null> {
  for (const s3Url of candidates) {
    const url = await getPresignedUrl(s3Url);
    if (!url) continue;
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (ok) return url;
  }
  return null;
}

export function EvidenceChip({ item, onOpen }: EvidenceChipProps) {
  const [state, setState] = useState<LoadState>('looking');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async () => {
      const url = await probe(item.evidenceUrls);
      if (cancelled) return;
      if (url) {
        setImageUrl(url);
        setState('ready');
      } else if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setState('missing');
      } else {
        timer = setTimeout(attempt, RETRY_MS);
      }
    };
    void attempt();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [item.evidenceUrls]);

  const open = () => {
    if (state === 'ready' && imageUrl) onOpen(item, imageUrl);
  };

  return (
    <button
      type="button"
      className={`evidence-chip evidence-chip--${state}`}
      onClick={open}
      disabled={state !== 'ready'}
      aria-label={
        state === 'ready'
          ? `Open evidence: ${item.title}`
          : state === 'looking'
            ? `${item.title}: the agent is looking`
            : `${item.title}: image not saved`
      }
      title={item.question || item.title}
    >
      <span className="evidence-chip__frame">
        {state === 'ready' && imageUrl ? (
          <img className="evidence-chip__image" src={imageUrl} alt="" />
        ) : (
          <span className="evidence-chip__placeholder" aria-hidden="true">
            {state === 'looking' ? (
              <span className="docent-working">
                <i />
                <i />
                <i />
              </span>
            ) : (
              'not saved'
            )}
          </span>
        )}
      </span>
      <span className="evidence-chip__title">{item.title}</span>
    </button>
  );
}
