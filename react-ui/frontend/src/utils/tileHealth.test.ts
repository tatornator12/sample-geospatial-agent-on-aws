import { describe, expect, it } from 'vitest';
import { createTileHealth, TILE_FAILURE_LIMIT } from './tileHealth.ts';

describe('tile health (a raster that draws no tile is flagged)', () => {
  it('is not failed after nine failures, and tips once at the tenth', () => {
    const h = createTileHealth();
    expect(TILE_FAILURE_LIMIT).toBe(10);
    for (let i = 0; i < 9; i += 1) expect(h.failed('lrm')).toBe(false);
    expect(h.isFailed('lrm')).toBe(false);
    expect(h.failed('lrm')).toBe(true);
    expect(h.isFailed('lrm')).toBe(true);
    // Only the failure that tips it says so: the next 70 errors do not set the flag again.
    for (let i = 0; i < 70; i += 1) expect(h.failed('lrm')).toBe(false);
    expect(h.isFailed('lrm')).toBe(true);
  });

  it('never fails a source that drew a tile (edge errors on a raster that is on the map)', () => {
    const h = createTileHealth();
    expect(h.loaded('tci')).toBe(false);
    for (let i = 0; i < 50; i += 1) expect(h.failed('tci')).toBe(false);
    expect(h.isFailed('tci')).toBe(false);
  });

  it('clears the flag when a tile loads after all (a cold TiTiler that recovers)', () => {
    const h = createTileHealth();
    for (let i = 0; i < 10; i += 1) h.failed('lrm');
    expect(h.isFailed('lrm')).toBe(true);
    expect(h.loaded('lrm')).toBe(true);
    expect(h.isFailed('lrm')).toBe(false);
    expect(h.loaded('lrm')).toBe(false); // already clear
    for (let i = 0; i < 20; i += 1) h.failed('lrm');
    expect(h.isFailed('lrm')).toBe(false);
  });

  it('keeps sources apart, and forgets one that leaves the map', () => {
    const h = createTileHealth(3);
    h.loaded('tci');
    for (let i = 0; i < 3; i += 1) {
      h.failed('lrm');
      h.failed('tci');
    }
    expect(h.isFailed('lrm')).toBe(true);
    expect(h.isFailed('tci')).toBe(false);
    expect(h.isFailed('hillshade')).toBe(false);
    h.forget('lrm');
    expect(h.isFailed('lrm')).toBe(false);
    expect(h.failed('lrm')).toBe(false); // counting starts again
  });
});
