/**
 * A replay case can hold a layer back: `delay_ms` on its `assets.layers` entry. The Octagon's
 * hillshade lands 8 s after the true colour has landed, as in the live turn, so the room sees the
 * site from space alone before the LiDAR shows what is under the grass.
 *
 * The backend passes whole numbers from 0 to 15,000 only (react-ui/backend/src/scenario.ts); the
 * stage checks again, so anything else lands at once.
 */
export const MAX_HOLD_MS = 15_000;

/** The wait for a layer, in milliseconds: 0 (land at once) unless a whole number up to MAX_HOLD_MS. */
export function holdMs(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_HOLD_MS ? value : 0;
}

export interface Held<T> {
  item: T;
  delayMs: number;
}

export interface HoldTimers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const browserTimers: HoldTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface HeldAfterLanding {
  /** The map says a raster has landed (its URL). */
  landed(url: string): void;
  /** Cancels the hold and every timer still waiting. */
  cancel(): void;
}

/**
 * Holds layers until the rasters before them have landed on the map, then for their own wait, so
 * the scene stands alone for the whole wait however long it took to arrive. If one of them never
 * lands (a source that fails), the waits start anyway after `fallbackMs`.
 */
export function holdAfterLanding<T>(
  before: readonly string[],
  held: readonly Held<T>[],
  land: (item: T) => void,
  superseded: () => boolean,
  timers: HoldTimers = browserTimers,
  fallbackMs: number = MAX_HOLD_MS,
): HeldAfterLanding {
  const waiting = new Set(before);
  let started = false;
  let cancelWaits: (() => void) | null = null;
  let fallback: unknown = null;
  const start = () => {
    if (started) return;
    started = true;
    if (fallback !== null) timers.clear(fallback);
    if (!superseded()) cancelWaits = scheduleHeld(held, land, superseded, timers);
  };
  if (held.length === 0) started = true;
  else if (waiting.size === 0) start();
  else fallback = timers.set(start, fallbackMs);
  return {
    landed(url) {
      if (started || !waiting.delete(url)) return;
      if (waiting.size === 0) start();
    },
    cancel() {
      started = true;
      if (fallback !== null) timers.clear(fallback);
      cancelWaits?.();
    },
  };
}

/**
 * Lands each held item after its wait, unless the case has been let go of by then (`superseded`:
 * a reset, another case). Returns the function that cancels every timer still waiting.
 */
export function scheduleHeld<T>(
  held: readonly Held<T>[],
  land: (item: T) => void,
  superseded: () => boolean,
  timers: HoldTimers = browserTimers,
): () => void {
  const ids = held.map(({ item, delayMs }) =>
    timers.set(() => {
      if (!superseded()) land(item);
    }, delayMs)
  );
  return () => ids.forEach((id) => timers.clear(id));
}
