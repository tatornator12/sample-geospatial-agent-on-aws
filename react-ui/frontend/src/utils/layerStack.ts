/**
 * The layer stack in the layers plate: one list in draw order (top row drawn on top), held as
 * React state and mirrored to MapLibre. Every layer the agent put on the map restacks: imagery,
 * boundaries, footprints, sites, columns. Pure functions, so the order rules and the drag
 * geometry are testable without WebGL or a pointer.
 *
 * The stack lives in one band of the map's style: above the basemap, beneath the "ceiling" (the
 * lowest layer the plate does not list: the presenter's drawn shapes, the tips on the globe), so
 * a restack never buries what the presenter just drew.
 */
import { isMethaneLayer, isSimilarityLayer, type LayerMetadata } from './layerFormatting.ts';
import { indexLegendFor, type ColormapName } from './render.ts';
import { isTerrainLayer, terrainLegend, terrainRasterHint } from './archaeoLayers.ts';
import { AIS, ORCHID, vesselKind } from './vesselLayers.ts';

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
 * Where a new layer joins the stack (top first):
 * - `top`: a vector (a boundary, footprints, sites, columns) lands over everything;
 * - `aboveImagery`: a finding raster (an index, a change map, a methane raster) lands on top of
 *   the imagery, just under the vectors drawn over it, so an NDVI that lands after its scene is
 *   never hidden under it and never hides the outline;
 * - `bottom`: a scene (true colour) lands at the bottom, just above the basemap.
 */
export type StackPlace = 'top' | 'aboveImagery' | 'bottom';
export function insertInStack(
  order: readonly string[],
  id: string,
  place: StackPlace,
  isRaster: (id: string) => boolean = () => false,
): string[] {
  const rest = order.filter((x) => x !== id);
  if (place === 'top') return [id, ...rest];
  if (place === 'bottom') return [...rest, id];
  const firstRaster = rest.findIndex(isRaster);
  const at = firstRaster < 0 ? rest.length : firstRaster;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The stack's ceiling: the lowest layer above the basemap that the plate does not list, in the
 * map's style order (bottom first). Every listed layer goes directly beneath it. Undefined when
 * there is none (then the top of the style is the ceiling).
 */
export function stackCeiling(
  styleOrder: readonly string[],
  tracked: ReadonlySet<string>,
  basemapIds: readonly string[],
): string | undefined {
  let floor = -1;
  styleOrder.forEach((id, i) => {
    if (basemapIds.includes(id)) floor = i;
  });
  return styleOrder.find((id, i) => i > floor && !tracked.has(id) && !basemapIds.includes(id));
}

/**
 * The moveLayer calls that put the stack on the map. `groupsTopFirst` holds, per listed layer,
 * its map layers bottom first (a geometry's fill, hairline, outline, labels). The moves run bottom
 * group first, each layer directly beneath the ceiling, so a group keeps its own internal order
 * and the last group moved is the top of the stack.
 */
export function stackMoves(
  groupsTopFirst: ReadonlyArray<readonly string[]>,
  ceiling: string | undefined,
): Array<[string, string | undefined]> {
  return groupsTopFirst
    .slice()
    .reverse()
    .flatMap((group) => group.map((id) => [id, ceiling] as [string, string | undefined]));
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
  | { kind: 'similar'; key: 'similar' }
  /** The archaeologist's local relief: signed metres in the mono face, "lower" and "higher" in words. */
  | { kind: 'relief'; key: string; label: string; ramp: ColormapName; lo: number; hi: number; units: string }
  /** The archaeologist's hillshade: a key, not a ramp (grey is the ground lit from the north-west). */
  | { kind: 'hillshade'; key: 'hillshade' }
  /** The catalogue marks at rest: a dot per site on the public record, a ring on a World Heritage one. */
  | { kind: 'record'; key: 'record' }
  /** Dark Vessels' targets: a ring the radar saw, a disc a broadcast accounts for, an orchid candidate. */
  | { kind: 'vessels'; key: 'vessels' }
  /** Dark Vessels' coverage: heard water outlined, unproven water hatched. */
  | { kind: 'coverage'; key: 'coverage' }
  /** Dark Vessels' history heat (the candidates' hue, from clear) and the fleet's (the AIS hue). */
  | { kind: 'seaheat'; key: 'heat' | 'fleet'; label: string; low: string; high: string; colour: string };

const MEASURE_LABEL: Record<string, string> = { 'ppm·m': 'CH4 enhancement', ppb: 'CH4 anomaly' };

/** The legend a layer reads by, or null (true colour, boundaries, drawn shapes). */
export function layerLegend(layer: LayerMetadata): StackLegend | null {
  if (isSimilarityLayer(layer)) return { kind: 'similar', key: 'similar' };
  const sea = vesselKind(layer.url);
  if (sea) {
    if (sea === 'targets') return { kind: 'vessels', key: 'vessels' };
    if (sea === 'heard' || sea === 'unproven') return { kind: 'coverage', key: 'coverage' };
    if (sea === 'heat') return { kind: 'seaheat', key: 'heat', label: 'Radar targets with no AIS, seen before', low: 'fewer', high: 'more', colour: ORCHID };
    if (sea === 'fleet') return { kind: 'seaheat', key: 'fleet', label: 'Squid fleet fishing hours', low: 'fewer', high: 'more', colour: AIS };
    return null;
  }
  if (isTerrainLayer(layer)) {
    if (layer.type === 'geometry') return layer.render?.kind === 'points' ? { kind: 'record', key: 'record' } : null;
    const legend = terrainLegend(terrainRasterHint(layer.render, layer.url));
    if (!legend) return null;
    if (legend.kind === 'hillshade') return { kind: 'hillshade', key: 'hillshade' };
    return { kind: 'relief', key: `relief-${legend.hi}`, label: legend.label, ramp: 'rdbu_r', lo: legend.lo, hi: legend.hi, units: legend.units };
  }
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
 * The plate's legends, in the stack's order (the top row's first). A layer that is hidden, or that
 * the map cannot draw at this zoom, carries no legend; a ramp two layers share is shown once,
 * where its highest layer puts it. The keys (the sites' dot and ring, the similarity ramp) follow
 * the measure ramps.
 */
export function stackLegends(layersTopFirst: readonly LayerMetadata[], shown: (id: string) => boolean): StackLegend[] {
  const seen = new Set<string>();
  const out: StackLegend[] = [];
  for (const layer of layersTopFirst) {
    if (!shown(layer.id)) continue;
    const legend = layerLegend(layer);
    if (!legend || seen.has(legend.key)) continue;
    seen.add(legend.key);
    out.push(legend);
  }
  const isKey = (l: StackLegend) =>
    (l.kind === 'sites' || l.kind === 'similar' || l.kind === 'hillshade' || l.kind === 'record' || l.kind === 'vessels' || l.kind === 'coverage' ? 1 : 0);
  return out.sort((a, b) => isKey(a) - isKey(b));
}

/**
 * A coarse raster (the hint caps its zoom: TROPOMI's ~4 km cells) the map cannot draw this close
 * in: MapLibre hides a layer at and above its maxzoom. The plate says so instead of listing it as
 * drawn.
 */
export function outOfRange(layer: Pick<LayerMetadata, 'type' | 'render'>, zoom: number): boolean {
  const cap = layer.render?.max_zoom;
  return layer.type === 'raster' && typeof cap === 'number' && Number.isFinite(zoom) && zoom >= cap;
}

/** The live region's sentence after a move: where the layer is now, in the room's words. */
export function moveSentence(label: string, index: number, count: number): string {
  const where =
    index === 0 ? 'the top, drawn over every other layer' : index === count - 1 ? 'the bottom, just above the basemap' : `${index + 1} of ${count}`;
  return `${label} moved to ${where}.`;
}
