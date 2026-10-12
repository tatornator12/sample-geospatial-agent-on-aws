/**
 * The stage's plates, in numbers the map can frame against. The step column is
 * `clamp(296px, 19vw, 380px)` wide in stage.css (365 px on a 1080p projector, 296 px at 1280);
 * the console and the prepared prompts take the bottom ~150 px since the caption band left; the
 * layers plate is 320 px at the right. The camera pads every frame clear of all three, so what it
 * lands on is what the room sees.
 */

export const STEP_COLUMN_MIN = 296;
export const STEP_COLUMN_MAX = 380;
export const STEP_COLUMN_VW = 0.19;

/** The step column's width (px) at a viewport width, as stage.css computes it. */
export function stepColumnWidth(viewportWidth: number): number {
  const w = Number.isFinite(viewportWidth) ? viewportWidth : 1920;
  return Math.round(Math.min(STEP_COLUMN_MAX, Math.max(STEP_COLUMN_MIN, w * STEP_COLUMN_VW)));
}

export interface StagePadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The camera's padding: the step column and its 16 px inset plus a 28 px breath, the console, the layers plate. */
export function stagePadding(viewportWidth: number): StagePadding {
  return { top: 90, bottom: 170, left: 16 + stepColumnWidth(viewportWidth) + 28, right: 370 };
}

/** Where the watch globe's centre sits: the middle of the area the plates leave free. */
export function globeOffset(p: StagePadding): [number, number] {
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
}

/**
 * The watch globe's zoom: the whole globe inside the area the plates leave free, with space around
 * it. MapLibre's globe is 512·2^z/π px across at zoom z; the globe fills 96% of the free area's
 * shorter side, up to zoom 2.5 (the old fixed size); a 1280x720 stage gets a ~450 px globe.
 */
export function globeZoom(mapWidth: number, mapHeight: number, p: StagePadding): number {
  const free = Math.min(mapWidth - p.left - p.right, mapHeight - p.top - p.bottom);
  if (!Number.isFinite(free) || free <= 0) return 2;
  const z = Math.log2((0.96 * free * Math.PI) / 512);
  return Math.round(Math.min(2.5, Math.max(0.5, z)) * 100) / 100;
}

/**
 * How far the step column may grow (its max-height, px) in a stage of this size. It stops above the
 * console when the two overlap horizontally (a narrow screen), else above the draw rail at the
 * bottom left. `docentTop` is the console stack's top edge measured from the stage's top.
 */
export function stepColumnMaxHeight(opts: {
  stageHeight: number;
  columnRight: number;
  docentLeft: number;
  docentTop: number;
  railTop: number;
  top?: number;
  gap?: number;
}): number {
  const top = opts.top ?? 16;
  const gap = opts.gap ?? 16;
  const overlaps = opts.columnRight + gap > opts.docentLeft;
  const floor = overlaps ? Math.min(opts.docentTop, opts.railTop) : opts.railTop;
  return Math.max(120, Math.round(floor - gap - top));
}
