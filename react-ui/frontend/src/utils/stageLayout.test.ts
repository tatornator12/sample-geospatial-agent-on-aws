import { describe, expect, it } from 'vitest';
import {
  TASKING_GAP,
  TASKING_MIN_BODY,
  TASKING_PLATE_WIDTH,
  globeOffset,
  globeZoom,
  stagePadding,
  stepColumnMaxHeight,
  stepColumnWidth,
  taskingLeftOverhang,
  taskingPlateWidth,
  taskingSlot,
} from './stageLayout.ts';

describe('stepColumnWidth', () => {
  it('follows clamp(296px, 19vw, 380px), as stage.css does', () => {
    expect(stepColumnWidth(1280)).toBe(296);
    expect(stepColumnWidth(1920)).toBe(365);
    expect(stepColumnWidth(3840)).toBe(380);
    expect(stepColumnWidth(Number.NaN)).toBe(365);
  });
});

describe('stagePadding and globeOffset', () => {
  it('pads the frame clear of the column, the console and the layers plate', () => {
    expect(stagePadding(1920)).toEqual({ top: 90, bottom: 170, left: 409, right: 370 });
    expect(stagePadding(1280).left).toBe(340);
    expect(globeOffset(stagePadding(1920))).toEqual([19.5, -40]);
  });
  it('clears the console as measured, never less than the usual 170 px (B7, B14)', () => {
    // 1280x720: two rows of plates put the console's top at 500 px.
    expect(stagePadding(1280, { viewportHeight: 720, consoleTop: 500 }).bottom).toBe(244);
    // 1920x1080: one row, the console's top at 960 px: the usual 170 px still wins.
    expect(stagePadding(1920, { viewportHeight: 1080, consoleTop: 960 }).bottom).toBe(170);
    // Not measured, or a measurement that makes no sense: the usual padding.
    expect(stagePadding(1280, { viewportHeight: 720 }).bottom).toBe(170);
    expect(stagePadding(1280, { viewportHeight: 720, consoleTop: 0 }).bottom).toBe(170);
    expect(stagePadding(1280, { viewportHeight: 720, consoleTop: 900 }).bottom).toBe(170);
    expect(stagePadding(1280, { viewportHeight: Number.NaN, consoleTop: 500 }).bottom).toBe(170);
    // The rest of the padding does not move.
    expect(stagePadding(1280, { viewportHeight: 720, consoleTop: 500 })).toMatchObject({ top: 90, left: 340, right: 370 });
  });
  it('fits the whole globe into the free area, up to zoom 2.5', () => {
    const pad = { ...stagePadding(1920), top: 24 };
    const z = globeZoom(1920, 1024, pad);
    // 512·2^z/π px across: the globe stays inside the 830 px between the top margin and the console.
    expect((512 * 2 ** z) / Math.PI).toBeLessThanOrEqual(830);
    expect(z).toBeGreaterThan(2.2);
    const small = globeZoom(1280, 664, { ...stagePadding(1280), top: 24 });
    expect((512 * 2 ** small) / Math.PI).toBeLessThanOrEqual(470);
    expect(globeZoom(3840, 2100, { ...stagePadding(3840), top: 24 })).toBe(2.5);
  });
});

describe('stepColumnMaxHeight', () => {
  it('runs down to the draw rail when the console is clear of the column (1080p)', () => {
    // Stage 1024 tall; column right edge 381; console from x 440, top 902; rail top 906.
    expect(stepColumnMaxHeight({ stageHeight: 1024, columnRight: 381, docentLeft: 440, docentTop: 902, railTop: 906 })).toBe(874);
  });
  it('stops above the console where the two overlap (1280x720)', () => {
    expect(stepColumnMaxHeight({ stageHeight: 664, columnRight: 312, docentLeft: 240, docentTop: 548, railTop: 546 })).toBe(514);
    expect(stepColumnMaxHeight({ stageHeight: 664, columnRight: 312, docentLeft: 240, docentTop: 500, railTop: 546 })).toBe(468);
  });
  it('never collapses below a usable height', () => {
    expect(stepColumnMaxHeight({ stageHeight: 200, columnRight: 312, docentLeft: 240, docentTop: 60, railTop: 90 })).toBe(120);
  });
});

describe('taskingSlot (Dark Vessels: the plate never covers the map key, Approve always in reach)', () => {
  // The plate's head and foot (padding, title, summary, status, Approve) and its choices.
  const fixed = 190;
  const min = fixed + TASKING_MIN_BODY;

  it('stands under the key in the right column at 1920x1080, nothing scrolled, when it fits', () => {
    // Stage 1024 tall; the key's plate ends at 470; the basemap plate's top is at 960 (floor 950).
    expect(TASKING_GAP).toBe(10);
    const slot = taskingSlot({ keyBottom: 470, rightFloor: 950, leftFloor: 888, need: 460, min });
    expect(slot).toEqual({ side: 'right', top: 480, maxHeight: 470, scrolls: false });
    // Its top is below the key's bottom: the key is never under it.
    expect(slot!.top).toBeGreaterThan(470);
  });

  it('stays on the right and scrolls its choices when the column is a little short', () => {
    const slot = taskingSlot({ keyBottom: 520, rightFloor: 950, leftFloor: 888, need: 460, min });
    expect(slot).toMatchObject({ side: 'right', top: 530, maxHeight: 420, scrolls: true });
    expect(slot!.maxHeight).toBeGreaterThanOrEqual(min);
  });

  it('moves over the finished steps where the right is too short to use (1280x720, or the list opened)', () => {
    // Stage 664 tall; the console reaches under the right column (its top at 518); the key ends at 470.
    const slot = taskingSlot({ keyBottom: 470, rightFloor: 502, leftFloor: 502, need: 460, min });
    expect(slot).toEqual({ side: 'left', top: 16, maxHeight: 486, scrolls: false });
    // A shorter left slot scrolls the choices; the plate never runs below its floor.
    const short = taskingSlot({ keyBottom: 470, rightFloor: 502, leftFloor: 420, need: 460, min });
    expect(short).toEqual({ side: 'left', top: 16, maxHeight: 404, scrolls: true });
    expect(short!.top + short!.maxHeight).toBeLessThanOrEqual(420);
  });

  it('keeps the plate usable at the edge: exactly its minimum on the right is still the right', () => {
    expect(taskingSlot({ keyBottom: 100, rightFloor: 110 + min, leftFloor: 900, need: 600, min })?.side).toBe('right');
    expect(taskingSlot({ keyBottom: 100, rightFloor: 109 + min, leftFloor: 900, need: 600, min })?.side).toBe('left');
  });

  it('leaves the stylesheet\'s place when a measure is missing, and never a negative height', () => {
    expect(taskingSlot({ keyBottom: Number.NaN, rightFloor: 948, leftFloor: 888, need: 460, min })).toBeNull();
    expect(taskingSlot({ keyBottom: 600, rightFloor: 500, leftFloor: 4, need: 460, min })).toMatchObject({ side: 'left', maxHeight: 0 });
  });

  it('frames the map clear of the plate where it reaches past a narrow step column', () => {
    // 340 px where the console reaches under the right column; 360 px on a wide screen (stage.css).
    expect([taskingPlateWidth(1280), taskingPlateWidth(1760), taskingPlateWidth(1761), taskingPlateWidth(1920)]).toEqual([340, 340, 360, 360]);
    expect(TASKING_PLATE_WIDTH).toBe(340);
    expect(taskingLeftOverhang(1280)).toBe(44);
    expect(taskingLeftOverhang(1761)).toBe(25);
    expect(taskingLeftOverhang(1920)).toBe(0);
  });
});
