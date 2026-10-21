/**
 * Run something once the map's style can take a source and its layers.
 *
 * MapLibre's `isStyleLoaded()` is false while any source is still loading: the basemap's tiles
 * streaming after a camera move, or the source the geometry before this one has just added. The
 * events that used to be awaited (`styledata`, `idle`) may then never come for the one waiting,
 * and the layer was lost (the similarity map, P0-3). `addSource` itself needs only the style's
 * JSON parsed (`getStyle()` is defined from then on), so after a short wait the layer goes in
 * while the tiles stream, the way the raster loader has always added its sources.
 */

/** The parts of a MapLibre map this needs (a fake one in the tests). */
export interface StyleMap {
  isStyleLoaded(): boolean | void;
  getStyle(): unknown;
  once(type: 'styledata' | 'idle', listener: () => void): unknown;
  off(type: 'styledata' | 'idle', listener: () => void): unknown;
}

export interface StyleReadyOptions {
  /** How often to look again, in ms. */
  pollMs?: number;
  /** After this long, run as soon as the style's JSON is parsed, tiles streaming or not. */
  forceAfterMs?: number;
  /** A run later than this says so in the console. */
  warnAfterMs?: number;
  /** Give up (and say so) after this long: the map never got a style. */
  giveUpMs?: number;
  /** What was waiting, for the console. */
  label?: string;
}

/**
 * Runs `fn` exactly once: now when the style is loaded, otherwise on the first of `styledata`,
 * `idle`, a poll that sees the style loaded, or (after `forceAfterMs`) a poll that sees its JSON
 * parsed. Returns a cancel, which stops the wait (it does nothing once `fn` has run).
 */
export function whenStyleReady(map: StyleMap, fn: () => void, options: StyleReadyOptions = {}): () => void {
  const { pollMs = 250, forceAfterMs = 1500, warnAfterMs = 2000, giveUpMs = 15000, label = 'layer' } = options;
  if (map.isStyleLoaded()) {
    fn();
    return () => {};
  }
  const started = Date.now();
  let done = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    done = true;
    map.off('styledata', onEvent);
    map.off('idle', onEvent);
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const run = () => {
    if (done) return;
    stop();
    const waited = Date.now() - started;
    if (waited > warnAfterMs) console.warn(`⏳ ${label} waited ${waited} ms for the map's style`);
    fn();
  };
  function onEvent() {
    run();
  }
  map.once('styledata', onEvent);
  map.once('idle', onEvent);
  timer = setInterval(() => {
    if (done) return;
    const waited = Date.now() - started;
    if (map.isStyleLoaded() || (waited >= forceAfterMs && map.getStyle() !== undefined)) {
      run();
    } else if (waited >= giveUpMs) {
      stop();
      console.error(`❌ ${label} gave up after ${waited} ms: the map's style never loaded`);
    }
  }, pollMs);
  return stop;
}
