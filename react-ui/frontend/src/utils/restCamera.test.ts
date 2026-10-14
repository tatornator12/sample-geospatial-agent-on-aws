import { describe, expect, it } from 'vitest';
import { fitPitched, type Camera, type Lens } from './restCamera.ts';

const SIZE = { width: 1920, height: 1024 };
const PAD = { top: 300, bottom: 170, left: 480, right: 410 };

/** A flat map: 256·2^z px per degree about the camera's centre, at the container's middle. */
const flat: Lens = (cam) => {
  const k = 2 ** cam.zoom;
  return {
    project: ([lng, lat]) => [SIZE.width / 2 + (lng - cam.center[0]) * k, SIZE.height / 2 - (lat - cam.center[1]) * k],
    unproject: ([x, y]) => [cam.center[0] + (x - SIZE.width / 2) / k, cam.center[1] - (y - SIZE.height / 2) / k],
  };
};

/** A crude perspective: the far (north) side squeezed towards a horizon above the window. */
const tilted: Lens = (cam) => {
  const base = flat(cam);
  const squeeze = (y: number) => SIZE.height / 2 + (y - SIZE.height / 2) * (y < SIZE.height / 2 ? 0.55 : 1.25);
  const unsqueeze = (y: number) => SIZE.height / 2 + (y - SIZE.height / 2) / (y < SIZE.height / 2 ? 0.55 : 1.25);
  return {
    project: (p) => {
      const [x, y] = base.project(p);
      return [x, squeeze(y)];
    },
    unproject: ([x, y]) => base.unproject([x, unsqueeze(y)]),
  };
};

// The record's corners and middle (west Spiro to east Etowah, south Poverty Point to north Effigy).
const SITES: Array<[number, number]> = [[-94.57, 35.31], [-80.74, 34.13], [-91.4, 32.64], [-91.18, 43.09], [-89.5, 37.0]];

function box(lens: Lens, cam: Camera) {
  const { project } = lens(cam);
  const px = SITES.map(project);
  return {
    x0: Math.min(...px.map((p) => p[0])), x1: Math.max(...px.map((p) => p[0])),
    y0: Math.min(...px.map((p) => p[1])), y1: Math.max(...px.map((p) => p[1])),
  };
}

describe('fitPitched', () => {
  const start: Camera = { center: [-80, 30], zoom: 3, pitch: 70, bearing: 25 };

  for (const [name, lens] of [['a flat map', flat], ['a tilted one', tilted]] as const) {
    it(`fills the free window and centres the sites in it, on ${name}`, () => {
      const cam = fitPitched(SITES, start, SIZE, PAD, lens);
      const b = box(lens, cam);
      const fx0 = PAD.left, fx1 = SIZE.width - PAD.right, fy0 = PAD.top, fy1 = SIZE.height - PAD.bottom;
      // Inside the window (a pixel of slack), touching it on the binding side.
      expect(b.x0).toBeGreaterThanOrEqual(fx0 - 1);
      expect(b.x1).toBeLessThanOrEqual(fx1 + 1);
      expect(b.y0).toBeGreaterThanOrEqual(fy0 - 1);
      expect(b.y1).toBeLessThanOrEqual(fy1 + 1);
      const fillX = (b.x1 - b.x0) / (fx1 - fx0), fillY = (b.y1 - b.y0) / (fy1 - fy0);
      expect(Math.max(fillX, fillY)).toBeGreaterThan(0.98);
      expect(Math.abs((b.x0 + b.x1) / 2 - (fx0 + fx1) / 2)).toBeLessThan(2);
      expect(Math.abs((b.y0 + b.y1) / 2 - (fy0 + fy1) / 2)).toBeLessThan(2);
      // Pitch and bearing are the caller's.
      expect(cam.pitch).toBe(70);
      expect(cam.bearing).toBe(25);
    });
  }

  it('leaves the camera alone with nothing to fit or no room', () => {
    expect(fitPitched([], start, SIZE, PAD, flat)).toBe(start);
    expect(fitPitched(SITES, start, { width: 800, height: 400 }, PAD, flat)).toBe(start);
  });
});
