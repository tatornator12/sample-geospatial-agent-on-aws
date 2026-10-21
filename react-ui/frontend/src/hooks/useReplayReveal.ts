/**
 * A replay case shows the work before the answer (A1 P1-1): its recorded steps arrive one call at
 * a time, the last one lit, then the answer or the brief. A long mission is still under 6 s: the
 * interval is 600 ms, or less when there are more than ten calls. Under prefers-reduced-motion
 * everything shows at once. A new key (another case) or none (a new session) ends the reveal and
 * its timer.
 */
import { useEffect, useState } from 'react';

/** The time between two revealed calls, ms. */
export function revealStepMs(calls: number): number {
  return Math.min(600, 6000 / Math.max(1, calls));
}

export interface ReplayReveal {
  /** How many of the replay's calls are on the column. */
  shown: number;
  /** Still revealing: the last shown call is lit and the answer waits. */
  revealing: boolean;
}

interface RevealState {
  key: string | null;
  shown: number;
  done: boolean;
}

export function useReplayReveal(key: string | null, calls: number, reducedMotion: boolean): ReplayReveal {
  const animate = !!key && calls > 0 && !reducedMotion;
  const [state, setState] = useState<RevealState>({ key: null, shown: calls, done: true });

  useEffect(() => {
    if (!animate) {
      setState({ key, shown: calls, done: true });
      return;
    }
    let shown = 1;
    setState({ key, shown, done: false });
    const timer = setInterval(() => {
      if (shown < calls) {
        shown += 1;
        setState({ key, shown, done: false });
      } else {
        clearInterval(timer);
        setState({ key, shown: calls, done: true });
      }
    }, revealStepMs(calls));
    return () => clearInterval(timer);
  }, [key, calls, animate]);

  // The render after a new key, before the effect has started it: nothing shown yet, so the
  // answer never flashes up before its steps.
  if (state.key !== key) return animate ? { shown: 0, revealing: true } : { shown: calls, revealing: false };
  return { shown: Math.min(state.shown, calls), revealing: !state.done };
}
