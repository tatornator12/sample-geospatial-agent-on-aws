import { describe, expect, it } from 'vitest';
import { globeOffset, globeZoom, stagePadding, stepColumnMaxHeight, stepColumnWidth } from './stageLayout.ts';

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
