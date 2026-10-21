/**
 * The stage's finding fits, with no padding left on the map (Group B review, GB-R2).
 *
 * MapLibre keeps an easeTo's `padding` on the transform, and every later fit adds the transform's
 * padding to its own. The watch globe is placed between the plates by padding, so after it every
 * methane fit was padded twice: at 1280 px the two side paddings (2 x 710 px) are wider than the
 * map, fitBounds gave up and the camera never left the globe; at 1920 the finding landed at half
 * size. Every finding's fit goes through here instead: it frames as if the map held no padding,
 * and any padding it does hold eases out during the same flight, so the globe never jumps.
 */
import type { CameraForBoundsOptions, FitBoundsOptions, LngLatBoundsLike, Map as MapLibreMap, PaddingOptions } from 'maplibre-gl';

export const NO_PADDING: PaddingOptions = { top: 0, bottom: 0, left: 0, right: 0 };

/** The parts of the map a fit uses. */
export type StageCameraMap = Pick<MapLibreMap, 'getPadding' | 'jumpTo' | 'cameraForBounds' | 'fitBounds' | 'flyTo' | 'easeTo'>;

/** True when the transform holds any padding (an easeTo or flyTo that carried one left it there). */
export function holdsPadding(p: Partial<PaddingOptions> | null | undefined): boolean {
  if (!p) return false;
  return [p.top, p.bottom, p.left, p.right].some((v) => typeof v === 'number' && v !== 0);
}

/**
 * The camera that frames `bounds` with the fit's own padding only, as if the map held none
 * (undefined when it cannot fit). Any held padding is put back before this returns, in the same
 * frame, so nothing on the screen moves.
 */
export function cameraForStage(
  map: StageCameraMap,
  bounds: LngLatBoundsLike,
  options?: CameraForBoundsOptions
): ReturnType<MapLibreMap['cameraForBounds']> {
  const held = map.getPadding();
  if (!holdsPadding(held)) return map.cameraForBounds(bounds, options);
  map.jumpTo({ padding: NO_PADDING });
  try {
    return map.cameraForBounds(bounds, options);
  } finally {
    map.jumpTo({ padding: held });
  }
}

/**
 * fitBounds for a finding: with no padding held it is MapLibre's own fitBounds, unchanged; with
 * padding held it flies (or eases, `linear`) to the same camera while the held padding eases to
 * zero, so the map holds none when it lands.
 */
export function fitStage(map: StageCameraMap, bounds: LngLatBoundsLike, options: FitBoundsOptions = {}): void {
  if (!holdsPadding(map.getPadding())) {
    map.fitBounds(bounds, options);
    return;
  }
  const cam = cameraForStage(map, bounds, options);
  if (!cam) return;
  // As fitBounds does: the computed camera, the caller's options over it, and the padding the
  // camera was computed for (none on the transform) as the flight's end.
  const move = { ...cam, ...options, padding: NO_PADDING };
  if (options.linear) map.easeTo(move);
  else map.flyTo(move);
}

/** Lets go of any held padding at once: the map is cleared, so there is no frame to keep still. */
export function releasePadding(map: Pick<MapLibreMap, 'getPadding' | 'jumpTo'>): void {
  if (holdsPadding(map.getPadding())) map.jumpTo({ padding: NO_PADDING });
}

/**
 * A box a few metres across round a point, for framing one point at a chosen zoom (`maxZoom`)
 * with the stage's padding, through fitBounds rather than an easeTo that would keep the padding.
 */
export function pointBox([lon, lat]: [number, number], halfDeg = 0.0005): [[number, number], [number, number]] {
  return [[lon - halfDeg, lat - halfDeg], [lon + halfDeg, lat + halfDeg]];
}
