import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whenStyleReady, type StyleMap } from './styleReady.ts';

/** A map whose style loads when the test says: `loaded` (no source loading) and `parsed` (the JSON is in). */
function fakeMap(state: { loaded: boolean; parsed: boolean }) {
  const listeners: Record<string, Array<() => void>> = { styledata: [], idle: [] };
  const map: StyleMap & { fire: (type: 'styledata' | 'idle') => void; count: (type: string) => number } = {
    isStyleLoaded: () => state.loaded,
    getStyle: () => (state.parsed ? { version: 8, sources: {}, layers: [] } : undefined),
    once: (type, fn) => {
      listeners[type].push(fn);
    },
    off: (type, fn) => {
      listeners[type] = listeners[type].filter((l) => l !== fn);
    },
    fire: (type) => {
      const fns = listeners[type];
      listeners[type] = [];
      fns.forEach((fn) => fn());
    },
    count: (type) => listeners[type].length,
  };
  return map;
}

describe('whenStyleReady (the geometry wait)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs at once when the style is loaded', () => {
    const fn = vi.fn();
    whenStyleReady(fakeMap({ loaded: true, parsed: true }), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs on styledata', () => {
    const map = fakeMap({ loaded: false, parsed: true });
    const fn = vi.fn();
    whenStyleReady(map, fn);
    expect(fn).not.toHaveBeenCalled();
    map.fire('styledata');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(map.count('idle')).toBe(0); // the other listener is taken off
  });

  it('runs on the poll that sees the style loaded', () => {
    const state = { loaded: false, parsed: true };
    const fn = vi.fn();
    whenStyleReady(fakeMap(state), fn);
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    state.loaded = true;
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs at 1.5 s while tiles stream (isStyleLoaded stays false) once the style JSON is in', () => {
    // P0-3: the second of two geometries, or any while the basemap streams, never saw an event.
    const map = fakeMap({ loaded: false, parsed: true });
    const fn = vi.fn();
    whenStyleReady(map, fn);
    vi.advanceTimersByTime(1250);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled(); // 1.5 s is not a long wait
    expect(map.count('styledata') + map.count('idle')).toBe(0);
  });

  it('does not run before the style JSON is parsed, warns when it ran late, and runs once it parses', () => {
    const state = { loaded: false, parsed: false };
    const fn = vi.fn();
    whenStyleReady(fakeMap(state), fn, { label: 'Geometry "Places like Central Park"' });
    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled();
    state.parsed = true;
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/Places like Central Park" waited \d+ ms/);
  });

  it('runs once when styledata, idle and the poll all come', () => {
    const state = { loaded: false, parsed: true };
    const map = fakeMap(state);
    const fn = vi.fn();
    whenStyleReady(map, fn);
    state.loaded = true;
    map.fire('styledata');
    map.fire('idle');
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does nothing once cancelled (the map was removed)', () => {
    const map = fakeMap({ loaded: false, parsed: true });
    const fn = vi.fn();
    const cancel = whenStyleReady(map, fn);
    cancel();
    map.fire('styledata');
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(map.count('styledata') + map.count('idle')).toBe(0);
  });

  it('gives up at 15 s with an error when the style never parses', () => {
    const fn = vi.fn();
    whenStyleReady(fakeMap({ loaded: false, parsed: false }), fn);
    vi.advanceTimersByTime(14750);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(error).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); // the poll stopped
  });
});
