"""Where a silent vessel could have been: the water it could reach from its last broadcast at a stated
speed, going round the islands, not over them (design component 8).

A grid over the water (row 0 at the south), land as obstacles, 8-connected. Each step costs its
length in km on the ground (east-west steps shrink with the cosine of the latitude). Dijkstra from
the cell of the last position, stopping at `max_km`, gives every cell's distance by water. The
reachable area is the cells within speed × hours. A last position that falls on a land cell (a
coarse coastline) starts from the nearest water cell instead, and says so.

Pure python (heapq) and numpy: on the radar box at 0.01 degrees (about 600 by 500 cells) it runs in a
second or two. The tool layer turns the mask into a shape for the map and lists the targets in it.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

KM_PER_DEG = 6371.0088 * math.pi / 180
KM_PER_NM = 1.852


@dataclass(frozen=True)
class WaterGrid:
    west: float
    south: float
    step: float                 # degrees
    water: np.ndarray           # bool (rows, cols), row 0 at the south

    @property
    def shape(self) -> tuple[int, int]:
        return self.water.shape

    def cell(self, lon: float, lat: float) -> tuple[int, int] | None:
        r = int(math.floor((lat - self.south) / self.step))
        c = int(math.floor((lon - self.west) / self.step))
        h, w = self.shape
        return (r, c) if 0 <= r < h and 0 <= c < w else None

    def centre(self, r: int, c: int) -> tuple[float, float]:
        return self.west + (c + 0.5) * self.step, self.south + (r + 0.5) * self.step


@dataclass(frozen=True)
class Reach:
    km: np.ndarray              # distance by water from the start, inf where not reached
    start: tuple[int, int]      # the cell it started from
    snapped_km: float           # how far the start was moved off land (0 when it was water)
    max_km: float

    @property
    def mask(self) -> np.ndarray:
        return self.km <= self.max_km


def reach_km(speed_kn: float, hours: float) -> float:
    """How far `speed_kn` goes in `hours`, in km."""
    if speed_kn <= 0 or hours < 0:
        raise ValueError("speed must be positive and hours not negative")
    return speed_kn * KM_PER_NM * hours


def _nearest_water(grid: WaterGrid, r0: int, c0: int, limit: int = 50) -> tuple[int, int] | None:
    h, w = grid.shape
    for ring in range(1, limit + 1):
        best = None
        for r in range(r0 - ring, r0 + ring + 1):
            for c in range(c0 - ring, c0 + ring + 1):
                if 0 <= r < h and 0 <= c < w and grid.water[r, c] and max(abs(r - r0), abs(c - c0)) == ring:
                    d = (r - r0) ** 2 + (c - c0) ** 2
                    if best is None or d < best[0]:
                        best = (d, r, c)
        if best:
            return best[1], best[2]
    return None


def by_water(grid: WaterGrid, lon: float, lat: float, max_km: float) -> Reach:
    """Every water cell's distance by water from (lon, lat), out to `max_km`."""
    start = grid.cell(lon, lat)
    if start is None:
        raise ValueError("the last position is outside the grid")
    snapped = 0.0
    if not grid.water[start]:
        moved = _nearest_water(grid, *start)
        if moved is None:
            raise ValueError("no water near the last position")
        (r0, c0), (r1, c1) = start, moved
        lat0 = grid.south + (r0 + 0.5) * grid.step
        snapped = math.hypot((r1 - r0) * grid.step * KM_PER_DEG, (c1 - c0) * grid.step * KM_PER_DEG * math.cos(math.radians(lat0)))
        start = moved
    h, w = grid.shape
    dist = np.full((h, w), np.inf)
    water = grid.water
    dy = grid.step * KM_PER_DEG
    rows_dx = [grid.step * KM_PER_DEG * math.cos(math.radians(grid.south + (r + 0.5) * grid.step)) for r in range(h)]
    dist[start] = 0.0
    heap = [(0.0, start[0], start[1])]
    while heap:
        d, r, c = heapq.heappop(heap)
        if d > dist[r, c]:
            continue
        dx = rows_dx[r]
        for rr, cc, step in ((r + 1, c, dy), (r - 1, c, dy), (r, c + 1, dx), (r, c - 1, dx),
                             (r + 1, c + 1, None), (r + 1, c - 1, None), (r - 1, c + 1, None), (r - 1, c - 1, None)):
            if not (0 <= rr < h and 0 <= cc < w) or not water[rr, cc]:
                continue
            if step is None:
                # A diagonal step may not cut a corner of land.
                if not (water[rr, c] and water[r, cc]):
                    continue
                step = math.hypot(dy, (dx + rows_dx[rr]) / 2)
            nd = d + step
            if nd <= max_km and nd < dist[rr, cc]:
                dist[rr, cc] = nd
                heapq.heappush(heap, (nd, rr, cc))
    return Reach(km=dist, start=start, snapped_km=round(snapped, 2), max_km=max_km)


def inside(reach: Reach, grid: WaterGrid, lon: float, lat: float) -> bool:
    rc = grid.cell(lon, lat)
    return bool(rc is not None and reach.mask[rc])


def km_to(reach: Reach, grid: WaterGrid, lon: float, lat: float) -> float | None:
    """Distance by water to a point (None when it is off the grid or not reached within max_km)."""
    rc = grid.cell(lon, lat)
    if rc is None or not np.isfinite(reach.km[rc]):
        return None
    return round(float(reach.km[rc]), 1)
