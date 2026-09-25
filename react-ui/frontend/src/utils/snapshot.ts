/**
 * A snapshot of the map for a filed brief: the stage's WebGL canvas (the map keeps its drawing
 * buffer), scaled to at most 1280 px wide, as a PNG data URL. Null when there is no map or the
 * canvas cannot be read; the brief is filed without it.
 */
const MAX_WIDTH = 1280;
/** The backend's cap is 2 MB of PNG; base64 is 4/3 of that plus the prefix. */
export const SNAPSHOT_MAX_CHARS = Math.floor((2 * 1024 * 1024 * 4) / 3);

export async function mapSnapshot(): Promise<string | null> {
  try {
    const source = document.querySelector<HTMLCanvasElement>('.map-canvas canvas');
    if (!source || source.width === 0 || source.height === 0) return null;
    const scale = Math.min(1, MAX_WIDTH / source.width);
    const out = document.createElement('canvas');
    out.width = Math.round(source.width * scale);
    out.height = Math.round(source.height * scale);
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch {
    return null; // a tainted or lost canvas: file without the picture
  }
}
