/**
 * A camera that frames a set of points from a steep, pitched angle. MapLibre's fitBounds ignores
 * pitch when it picks the zoom (a 70° view of a continent comes out a whole level too far away),
 * so the archaeologist's rest view fits by looking: project the points with a trial camera, then
 * zoom and slide until their screen box fills the window the plates leave free. Pure, with the
 * projection injected, so it is tested without a map.
 */

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The map's projection at a camera: lng/lat to container px, and back. */
export type Lens = (camera: Camera) => {
  project: (lngLat: [number, number]) => [number, number];
  unproject: (px: [number, number]) => [number, number];
};

const finite = (p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * The camera at `start`'s pitch and bearing whose view puts every point inside the free window
 * (the container less `pad`), as large as fits, centred in it. A few rounds converge; the result
 * is `start` when there is nothing to fit or no room to fit it in.
 */
export function fitPitched(
  points: Array<[number, number]>,
  start: Camera,
  size: { width: number; height: number },
  pad: Padding,
  lens: Lens,
  rounds = 10,
): Camera {
  const fx0 = pad.left, fx1 = size.width - pad.right;
  const fy0 = pad.top, fy1 = size.height - pad.bottom;
  if (points.length === 0 || fx1 - fx0 < 10 || fy1 - fy0 < 10) return start;
  let camera = start;
  for (let i = 0; i < rounds; i += 1) {
    const { project, unproject } = lens(camera);
    const px = points.map(project).filter(finite);
    if (px.length === 0) break;
    const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const scale = Math.min((fx1 - fx0) / Math.max(1, x1 - x0), (fy1 - fy0) / Math.max(1, y1 - y0));
    // Slide so the points' box centre sits on the free window's centre, then zoom to fill it.
    const dx = (x0 + x1) / 2 - (fx0 + fx1) / 2;
    const dy = (y0 + y1) / 2 - (fy0 + fy1) / 2;
    const center = unproject([size.width / 2 + dx, size.height / 2 + dy]);
    if (!finite(center)) break;
    const dz = Math.log2(scale);
    camera = { ...camera, center, zoom: camera.zoom + dz };
    if (Math.abs(dz) < 0.005 && Math.hypot(dx, dy) < 1) break;
  }
  return camera;
}

/**
 * How much MapLibre scales a viewport-aligned label drawn at container row `y` of a pitched view.
 * The symbol shader multiplies text-size by clamp(0.5 + 0.5 · d_centre / d_anchor, 0, 4); on flat
 * ground d_centre / d_anchor = 1 − tan(pitch) · (centreY − y) / f, with f = (H / 2) / tan(fov / 2)
 * the camera's distance to the centre in px. In the rest view a name near the horizon draws at
 * about 85% of its size and one in the foreground at about 120%.
 */
export function labelPerspective(y: number, height: number, pitchDeg: number, fovDeg = 36.87, centreY = height / 2): number {
  const f = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const ratio = 1 - (Math.tan((pitchDeg * Math.PI) / 180) * (centreY - y)) / f;
  return Math.min(4, Math.max(0, 0.5 + 0.5 * ratio));
}

/**
 * The text-size that draws at no less than `floor` px at that perspective: a far name grows to land
 * at the floor (the Back Row Rule's 15 px), never past twice it; a near one keeps `floor` and the
 * depth it is drawn at.
 */
export function sizeAtLeast(floor: number, perspective: number): number {
  if (!(perspective > 0) || perspective >= 1) return floor;
  return Math.min(2 * floor, Math.ceil((floor / perspective) * 10) / 10);
}
