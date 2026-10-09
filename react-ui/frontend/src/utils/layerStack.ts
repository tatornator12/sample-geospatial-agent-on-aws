/**
 * The imagery stack in the layers plate: one list in draw order (top row drawn on top), held as
 * React state and mirrored to MapLibre. Pure functions, so the order rules and the drag geometry
 * are testable without WebGL or a pointer.
 *
 * Every raster lives in one band of the map's style: above the basemap, beneath the lowest
 * vector (the "ceiling"). Vectors (boundaries, footprints, sites, drawn shapes, labels) are
 * always drawn over the imagery; only the imagery is reordered.
 */
import { isMethaneLayer, isSimilarityLayer, type LayerMetadata } from './layerFormatting.ts';
import { indexLegendFor, type ColormapName } from './render.ts';

/** Move one entry from `from` to `to` (both indexes in the same list); a copy, never in place. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Where a new raster joins the stack (top first): a finding (an index, a change map, a methane
 * raster) goes on top of the imagery, a scene (true colour) to the bottom, just above the basemap,
 * so an NDVI that lands after its scene is never hidden under it.
 */
export function insertInStack(order: readonly string[], id: string, onTop: boolean): string[] {
  const rest = order.filter((x) => x !== id);
  return onTop ? [id, ...rest] : [...rest, id];
}

export interface StyleLayerRef {
  id: string;
  type?: string;
}

/**
 * The raster ceiling: the lowest non-raster layer above the basemap, in the map's style order
 * (bottom first). Every raster is placed directly beneath it, so no raster ever covers a vector
 * or a label. Undefined when the map has no vectors yet (then the top is the ceiling).
 */
export function rasterCeiling(styleOrder: readonly StyleLayerRef[], basemapIds: readonly string[]): string | undefined {
  let floor = -1;
  styleOrder.forEach((l, i) => {
    if (basemapIds.includes(l.id)) floor = i;
  });
  return styleOrder.find((l, i) => i > floor && l.type !== undefined && l.type !== 'raster')?.id;
}

/**
 * The moveLayer calls that put the stack (top first) on the map: bottom first, each directly
 * beneath the ceiling, so the last one moved is the top of the imagery.
 */
export function stackMoves(orderTopFirst: readonly string[], ceiling: string | undefined): Array<[string, string | undefined]> {
  return orderTopFirst
    .slice()
    .reverse()
    .map((id) => [id, ceiling] as [string, string | undefined]);
}

/**
 * The drop slot for a row being dragged: its index in the new order. `tops` and `heights` are
 * the rows' measured offsets inside the list at drag start; `dy` is how far the row has moved.
 * A neighbour gives way once the held row's leading edge crosses its midpoint (half a row of
 * travel, not a whole one): going down, the bottom edge; going up, the top edge.
 */
export function slotIndex(tops: readonly number[], heights: readonly number[], from: number, dy: number): number {
  const top = tops[from] + dy;
  const bottom = top + heights[from];
  let slot = 0;
  for (let i = 0; i < tops.length; i++) {
    if (i === from) continue;
    const mid = tops[i] + heights[i] / 2;
    if (i < from ? mid <= top : mid < bottom) slot++;
  }
  return slot;
}

/**
 * How far each row slides while a row is held over slot `to`: the other rows close the gap the
 * row left and open one where it would land. Also the slot band's offset from the list's top.
 */
export function slotLayout(
  tops: readonly number[],
  heights: readonly number[],
  from: number,
  to: number,
): { shifts: number[]; slotTop: number } {
  const n = tops.length;
  if (n === 0) return { shifts: [], slotTop: 0 };
  const gap = n > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;
  const indexes = moveItem(
    tops.map((_, i) => i),
    from,
    to,
  );
  const shifts = new Array<number>(n).fill(0);
  let y = tops[0];
  let slotTop = tops[0];
  for (const i of indexes) {
    if (i === from) slotTop = y;
    shifts[i] = y - tops[i];
    y += heights[i] + gap;
  }
  return { shifts, slotTop };
}

/** How far a held row may travel: its top stays between the list's first and last row. */
export function clampDrag(tops: readonly number[], heights: readonly number[], from: number, dy: number): number {
  const n = tops.length;
  if (n === 0) return 0;
  const min = tops[0] - tops[from];
  const max = tops[n - 1] + heights[n - 1] - heights[from] - tops[from];
  return Math.max(min, Math.min(max, dy));
}

// ---------------------------------------------------------------------------------------------
// Legends: one per distinct ramp among the visible layers, ordered by the highest row using it.
// ---------------------------------------------------------------------------------------------

export type StackLegend =
  /** An Earth index or the change map: ends in words. */
  | { kind: 'index'; key: string; label: string; ramp: ColormapName; low: string; high: string }
  /** A methane measure: numeric ends in the mono face, the units after the high end. */
  | { kind: 'measure'; key: string; label: string; ramp: ColormapName; lo: number; hi: number; units: string }
  /** The watch baseline's dots and rings. */
  | { kind: 'sites'; key: 'sites' }
  /** The similarity map's violet ramp. */
  | { kind: 'similar'; key: 'similar' };

const MEASURE_LABEL: Record<string, string> = { 'ppm·m': 'CH4 enhancement', ppb: 'CH4 anomaly' };

/** The legend a layer reads by, or null (true colour, boundaries, drawn shapes). */
export function layerLegend(layer: LayerMetadata): StackLegend | null {
  if (isSimilarityLayer(layer)) return { kind: 'similar', key: 'similar' };
  if (isMethaneLayer(layer)) {
    const hint = layer.render;
    if (!hint) return null;
    if (hint.kind === 'points') return { kind: 'sites', key: 'sites' };
    const ramp = hint.colormap ?? hint.ramp;
    if (!ramp || !hint.rescale) return null;
    const units = hint.units ?? 'ppm·m';
    return {
      kind: 'measure',
      key: `${ramp}-${units}`,
      label: hint.legend ?? MEASURE_LABEL[units] ?? 'CH4',
      ramp,
      lo: hint.rescale[0],
      hi: hint.rescale[1],
      units,
    };
  }
  if (layer.type !== 'raster') return null;
  const index = indexLegendFor(layer.url);
  return index ? { kind: 'index', key: index.label, label: index.label, ramp: index.ramp, low: index.low, high: index.high } : null;
}

/**
 * The plate's legends: the imagery's first, top row first, then the vectors' (methane columns
 * and footprints, the sites key, the similarity ramp). Hidden layers carry no legend; a ramp
 * two layers share is shown once, where its highest layer puts it.
 */
export function stackLegends(
  rastersTopFirst: readonly LayerMetadata[],
  vectorsTopFirst: readonly LayerMetadata[],
  visible: (id: string) => boolean,
): StackLegend[] {
  const seen = new Set<string>();
  const collect = (layers: readonly LayerMetadata[]) => {
    const out: StackLegend[] = [];
    for (const layer of layers) {
      if (!visible(layer.id)) continue;
      const legend = layerLegend(layer);
      if (!legend || seen.has(legend.key)) continue;
      seen.add(legend.key);
      out.push(legend);
    }
    return out;
  };
  const fromImagery = collect(rastersTopFirst);
  // Among the vectors' legends the measure ramps come before the keys (a stable sort).
  const isKey = (l: StackLegend) => (l.kind === 'sites' || l.kind === 'similar' ? 1 : 0);
  const fromVectors = collect(vectorsTopFirst).sort((a, b) => isKey(a) - isKey(b));
  return [...fromImagery, ...fromVectors];
}

/** The live region's sentence after a move: where the layer is now, in the room's words. */
export function moveSentence(label: string, index: number, count: number): string {
  const where =
    index === 0 ? 'the top, drawn over the other imagery' : index === count - 1 ? 'the bottom, just above the basemap' : `${index + 1} of ${count}`;
  return `${label} moved to ${where}.`;
}
