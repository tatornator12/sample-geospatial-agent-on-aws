import { describe, expect, it, vi } from 'vitest';
import type { PaddingOptions } from 'maplibre-gl';
import { cameraForStage, fitStage, holdsPadding, NO_PADDING, pointBox, releasePadding, type StageCameraMap } from './stageCamera.ts';

// A map that adds the padding its transform holds to every fit, as MapLibre 6 does
// (camera_helper.ts cameraForBoxAndBearing), and keeps whatever padding a move ends on.
function fakeMap(width: number, held: PaddingOptions = NO_PADDING) {
  let padding = { ...held };
  const seen: PaddingOptions[] = [];
  const map = {
    getPadding: vi.fn(() => padding),
    jumpTo: vi.fn((o: { padding?: PaddingOptions }) => {
      if (o.padding) padding = { ...o.padding };
      return map;
    }),
    cameraForBounds: vi.fn((_b: unknown, o?: { padding?: PaddingOptions; maxZoom?: number }) => {
      seen.push({ ...padding });
      const own = o?.padding ?? NO_PADDING;
      const free = width - ((padding.left ?? 0) + (padding.right ?? 0) + (own.left ?? 0) + (own.right ?? 0));
      return free < 0 ? undefined : { center: { lng: -111.15, lat: 41.45 }, zoom: Math.min(o?.maxZoom ?? 22, 12), bearing: 0 };
    }),
    fitBounds: vi.fn(() => map),
    flyTo: vi.fn((o: { padding?: PaddingOptions }) => {
      if (o.padding) padding = { ...o.padding };
      return map;
    }),
    easeTo: vi.fn((o: { padding?: PaddingOptions }) => {
      if (o.padding) padding = { ...o.padding };
      return map;
    }),
  };
  return { map: map as unknown as StageCameraMap & typeof map, seen, padding: () => padding };
}

// The watch globe's padding at 1280x720 (the step column, the layers plate, the console), as recorded.
const GLOBE_1280 = { top: 24, bottom: 170, left: 340, right: 370 };
const STAGE_1280 = { top: 90, bottom: 170, left: 340, right: 370 };
const PLUME: [[number, number], [number, number]] = [[-111.2, 41.4], [-111.1, 41.5]];

describe('holdsPadding', () => {
  it('is false for no padding and true for any side', () => {
    expect(holdsPadding(NO_PADDING)).toBe(false);
    expect(holdsPadding(undefined)).toBe(false);
    expect(holdsPadding({ top: 0, bottom: 0, left: 1, right: 0 })).toBe(true);
  });
});

describe('fitStage (GB-R2: no padding left on the map)', () => {
  it('is MapLibre\'s own fitBounds when the map holds no padding', () => {
    const { map } = fakeMap(1920);
    fitStage(map, PLUME, { padding: STAGE_1280, maxZoom: 13, duration: 1800 });
    expect(map.fitBounds).toHaveBeenCalledWith(PLUME, { padding: STAGE_1280, maxZoom: 13, duration: 1800 });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('after the watch globe at 1280, frames the plume as if no padding were held and lands holding none', () => {
    const { map, seen, padding } = fakeMap(1280, GLOBE_1280);
    // Padded twice, the fit cannot be made at all: the bug the review recorded (zoom held at 5).
    expect(map.cameraForBounds(PLUME, { padding: STAGE_1280 })).toBeUndefined();
    fitStage(map, PLUME, { padding: STAGE_1280, maxZoom: 13, duration: 1800, pitch: 0 });
    expect(map.fitBounds).not.toHaveBeenCalled();
    // The camera was computed on a transform holding nothing, then the held padding went back.
    expect(seen.at(-1)).toEqual(NO_PADDING);
    expect(map.jumpTo).toHaveBeenNthCalledWith(1, { padding: NO_PADDING });
    expect(map.jumpTo).toHaveBeenNthCalledWith(2, { padding: GLOBE_1280 });
    // One flight to it, easing the globe's padding out on the way: none is left when it lands.
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    expect(map.flyTo.mock.calls[0][0]).toMatchObject({ zoom: 12, duration: 1800, pitch: 0, padding: NO_PADDING });
    expect(padding()).toEqual(NO_PADDING);
  });

  it('eases instead of flying when linear, so a world-set frame keeps the globe', () => {
    const { map, padding } = fakeMap(1920, GLOBE_1280);
    fitStage(map, pointBox([-111.15, 41.45]), { padding: STAGE_1280, maxZoom: 5, linear: true, duration: 1800 });
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo.mock.calls[0][0]).toMatchObject({ zoom: 5, padding: NO_PADDING });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(padding()).toEqual(NO_PADDING);
  });

  it('does nothing when even an unpadded map cannot fit, and puts the held padding back', () => {
    const { map, padding } = fakeMap(600, GLOBE_1280);
    fitStage(map, PLUME, { padding: STAGE_1280 });
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(padding()).toEqual(GLOBE_1280);
  });
});

describe('cameraForStage and releasePadding', () => {
  it('computes on an unpadded transform and leaves the held padding as it was', () => {
    const { map, seen, padding } = fakeMap(1280, GLOBE_1280);
    expect(cameraForStage(map, PLUME, { padding: STAGE_1280 })).toMatchObject({ zoom: 12 });
    expect(seen.at(-1)).toEqual(NO_PADDING);
    expect(padding()).toEqual(GLOBE_1280);
  });

  it('lets go of held padding at once, and touches nothing when none is held', () => {
    const held = fakeMap(1280, GLOBE_1280);
    releasePadding(held.map);
    expect(held.padding()).toEqual(NO_PADDING);
    const clear = fakeMap(1280);
    releasePadding(clear.map);
    expect(clear.map.jumpTo).not.toHaveBeenCalled();
  });
});

describe('pointBox', () => {
  it('is a small box centred on the point', () => {
    const [[w, s], [e, n]] = pointBox([-111.15, 41.45]);
    expect((w + e) / 2).toBeCloseTo(-111.15, 9);
    expect((s + n) / 2).toBeCloseTo(41.45, 9);
    expect(e - w).toBeLessThan(0.01);
  });
});
