/**
 * Which rasters on the stage have not drawn a single tile. A raster whose tiles all fail (a file
 * name the model mistyped answers every tile with a 500, TiTiler is down, the venue network drops
 * it) used to sit in the layers plate and the legend as if it were on the map, while the room saw
 * the basemap and heard the agent describe it (Act 4, P0-2). MapLibre reports a failed tile as an
 * `error` event and a drawn one as `sourcedata` with its tile; it does not report a 404 (the
 * normal empty tile past a raster's edge), so those never count here.
 *
 * A source is failed after `limit` errors with no tile loaded. It is reversible: a cold TiTiler
 * can answer 500 and then recover, and the first tile that loads clears the flag for good.
 */
export interface TileHealth {
  /** A tile of `id` drew. True when that clears a failed flag. */
  loaded(id: string): boolean;
  /** A tile of `id` failed. True once, at the failure that marks it failed. */
  failed(id: string): boolean;
  isFailed(id: string): boolean;
  /** The source left the map. */
  forget(id: string): void;
}

export const TILE_FAILURE_LIMIT = 10;

export function createTileHealth(limit: number = TILE_FAILURE_LIMIT): TileHealth {
  const sources = new Map<string, { loaded: number; errors: number; failed: boolean }>();
  const of = (id: string) => {
    let s = sources.get(id);
    if (!s) {
      s = { loaded: 0, errors: 0, failed: false };
      sources.set(id, s);
    }
    return s;
  };
  return {
    loaded(id) {
      const s = of(id);
      s.loaded += 1;
      if (!s.failed) return false;
      s.failed = false;
      return true;
    },
    failed(id) {
      const s = of(id);
      s.errors += 1;
      if (s.failed || s.loaded > 0 || s.errors < limit) return false;
      s.failed = true;
      return true;
    },
    isFailed: (id) => sources.get(id)?.failed ?? false,
    forget: (id) => {
      sources.delete(id);
    },
  };
}
