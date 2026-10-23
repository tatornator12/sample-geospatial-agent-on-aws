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

/** The camera's bottom padding when the console is not measured (its usual height plus a breath). */
export const CONSOLE_PADDING_MIN = 170;
/**
 * The camera's padding: the step column and its 16 px inset plus a 28 px breath, the console, the
 * layers plate. With the console measured (`consoleTop`, its top edge from the viewport's top, in
 * a viewport `viewportHeight` tall), the bottom clears it by 24 px however tall its prompts wrap
 * (two rows of plates at 1280), so nothing the map frames lands under it (A1 P1-7, A2 P1-8).
 */
export function stagePadding(
  viewportWidth: number,
  { viewportHeight, consoleTop }: { viewportHeight?: number; consoleTop?: number } = {}
): StagePadding {
  const measured =
    Number.isFinite(viewportHeight) && Number.isFinite(consoleTop) && (consoleTop as number) > 0 && (consoleTop as number) < (viewportHeight as number)
      ? (viewportHeight as number) - (consoleTop as number) + 24
      : 0;
  return { top: 90, bottom: Math.max(CONSOLE_PADDING_MIN, Math.round(measured)), left: 16 + stepColumnWidth(viewportWidth) + 28, right: 370 };
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

/** The tasking plate's body below this is not a choice any more: its legend and about two box rows. */
export const TASKING_MIN_BODY = 130;
/** The gap between the plates in the right column while the tasking plate is up (key, plate, basemap). */
export const TASKING_GAP = 10;
/** The tasking plate's width (stage.css `.tasking-plate`), on either side. */
export const TASKING_PLATE_WIDTH = 340;
/**
 * On a wide screen (the console clear of the right column, 1761 px and up) the right column is 360 px
 * while the plate is up, the key's plate and the tasking plate alike: the key's long rows and the
 * candidates' port names then take a line fewer, so both fit at 1920x1080.
 */
export const TASKING_PLATE_WIDTH_WIDE = 360;
export const TASKING_WIDE_FROM = 1761;

export function taskingPlateWidth(viewportWidth: number): number {
  return viewportWidth >= TASKING_WIDE_FROM ? TASKING_PLATE_WIDTH_WIDE : TASKING_PLATE_WIDTH;
}

/**
 * How far the tasking plate, standing in the step column's slot, reaches past the column (px): the
 * camera's frame keeps the boxes and candidates clear of that much more (296 px column at 1280: 44).
 */
export function taskingLeftOverhang(viewportWidth: number): number {
  return Math.max(0, taskingPlateWidth(viewportWidth) - stepColumnWidth(viewportWidth));
}

export interface TaskingSlotInput {
  /** The layers plate's bottom edge (its map key showing), from the stage's top. */
  keyBottom: number;
  /** The lowest the plate may reach on the right: above the basemap plate, or above the console where it reaches under the column. */
  rightFloor: number;
  /** The same in the step column's slot on the left: above the console or the draw rail, whichever is higher there. */
  leftFloor: number;
  /** The plate's height with nothing scrolled. */
  need: number;
  /** The least it is usable at: its head, its foot (Approve, Not now) and the start of its choices. */
  min: number;
  top?: number;
  gap?: number;
}

export interface TaskingSlot {
  side: 'right' | 'left';
  top: number;
  maxHeight: number;
  /** The plate's choices scroll inside it (its head and its foot never do). */
  scrolls: boolean;
}

/**
 * Where Dark Vessels' tasking plate stands, so the map key is never covered and Approve is always in
 * reach. In the right column under the key wherever the plate is usable there (the show's 1920x1080:
 * the key, the plate and the agent's answer are all on screen); its choices scroll if the column is
 * a little short. Where it is not (a 720p screen, or the layer list opened over the key's column), in
 * the step column's slot on the left, over the finished steps, whose answer is already cut off there.
 * Null when a measure is missing (the stylesheet's own place stands).
 */
export function taskingSlot(o: TaskingSlotInput): TaskingSlot | null {
  const top = o.top ?? 16;
  const gap = o.gap ?? TASKING_GAP;
  if (![o.keyBottom, o.rightFloor, o.leftFloor, o.need, o.min].every(Number.isFinite)) return null;
  const rightTop = Math.round(o.keyBottom + gap);
  const right = Math.round(o.rightFloor - rightTop);
  if (right >= o.min) return { side: 'right', top: rightTop, maxHeight: right, scrolls: right < Math.ceil(o.need) };
  const left = Math.max(0, Math.round(o.leftFloor - top));
  return { side: 'left', top, maxHeight: left, scrolls: left < Math.ceil(o.need) };
}
