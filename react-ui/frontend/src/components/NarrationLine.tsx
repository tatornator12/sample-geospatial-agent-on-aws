/**
 * The agent's latest sentence, under the lit step while a turn streams (utils/narration.ts picks
 * and sanitises it). Calm on purpose: a new sentence replaces the old one at most every 2.5 s (the
 * newest waiting one lands when the interval is up), a sentence once shown is never shown again,
 * and the polite live region is there from the start of the turn so the first sentence is heard.
 */
import { useEffect, useRef, useState } from 'react';

export const NARRATION_INTERVAL_MS = 2500;

interface NarrationLineProps {
  /** The sentence the agent finished saying most recently, or null before it has said one. */
  text: string | null;
}

export function NarrationLine({ text }: NarrationLineProps) {
  const [shown, setShown] = useState<string | null>(null);
  const shownAt = useRef<number | null>(null);
  const said = useRef(new Set<string>());

  useEffect(() => {
    if (!text || said.current.has(text)) return;
    const wait = shownAt.current === null ? 0 : Math.max(0, shownAt.current + NARRATION_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      said.current.add(text);
      shownAt.current = Date.now();
      setShown(text);
    }, wait);
    // A newer sentence before the interval is up takes this one's place.
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <p className="stage-narration" aria-live="polite" aria-atomic="true">
      {shown && (
        <span key={shown} className="stage-narration__text">
          “{shown}”
        </span>
      )}
    </p>
  );
}
