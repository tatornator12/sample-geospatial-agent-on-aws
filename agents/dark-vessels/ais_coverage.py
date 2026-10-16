"""Heard water: where AIS could be heard around a radar pass (design decision 3).

A radar target with no broadcast near it only counts as a candidate where AIS could be heard at the
time. A satellite pass over empty water hears nothing, and silence there proves nothing. So the proof
is the traffic itself: a 0.05° cell is heard when, in at least one hour of the three either side of
the pass, two or more different broadcasting vessels were heard within 30 km of it. Everything else
in the reserve is unproven: "not evidence".

The rule wants two different vessels in the same hour. That is stricter than two across the whole
window, and it needs no link between one hour's positions and the next. The build hands this module
one position per vessel per hour with no key at all (`fixes_from_tracks` does that while the ids are
still in memory, then drops them).

The map draws the heard cells as one rounded shape. Closing it fills the seams and the inside
corners, and opening it rounds the outside corners. `agree` then puts back or takes out a target's
own cell wherever the rounding moved it across the line. That way the drawing never says something
the rule did not.

Pure numpy and shapely, no network. Grid comes from predict.py.
"""
from __future__ import annotations

import math
from collections.abc import Hashable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import shapely
from shapely.geometry import Point, box
from shapely.geometry.base import BaseGeometry

from predict import Grid

KM_PER_DEG = 6371.0088 * math.pi / 180      # one degree of latitude, mean Earth radius
RADIUS_KM = 30.0
WINDOW = timedelta(hours=3)
MIN_VESSELS = 2


@dataclass(frozen=True)
class Fix:
    """One broadcasting vessel's position in one hour. No key: two fixes in the same hour are two
    different vessels by construction (see `fixes_from_tracks`)."""
    lon: float
    lat: float
    hour: datetime          # the hour it was heard (UTC, on the hour)


def fixes_from_tracks(rows: Iterable[tuple[Hashable, datetime, float, float]], pass_time: datetime,
                      window: timedelta = WINDOW) -> list[Fix]:
    """(vessel key, time, lon, lat) rows to keyless fixes within `window` of the pass: one per vessel
    per hour (its first position that hour). The key is used here and dropped."""
    seen: dict[tuple[Hashable, datetime], Fix] = {}
    for key, t, lon, lat in sorted(rows, key=lambda r: r[1]):
        if abs(t - pass_time) > window:
            continue
        hour = t.replace(minute=0, second=0, microsecond=0)
        seen.setdefault((key, hour), Fix(float(lon), float(lat), hour))
    return list(seen.values())


def _centres(grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    h, w = grid.shape
    lat = grid.south + (np.arange(h) + 0.5) * grid.step
    lon = grid.west + (np.arange(w) + 0.5) * grid.step
    return np.meshgrid(lon, lat)            # each (h, w), row 0 at the south


def heard_cells(fixes: Iterable[Fix], grid: Grid, pass_time: datetime, radius_km: float = RADIUS_KM,
                window: timedelta = WINDOW, min_vessels: int = MIN_VESSELS,
                water: np.ndarray | None = None) -> np.ndarray:
    """True for each cell where, in some hour within `window` of the pass, at least `min_vessels`
    fixes lie within `radius_km` of the cell's centre. False outside `water`."""
    clon, clat = _centres(grid)
    kx = KM_PER_DEG * np.cos(np.radians(clat))
    heard = np.zeros(grid.shape, dtype=bool)
    by_hour: dict[datetime, list[Fix]] = {}
    for f in fixes:
        if abs(f.hour - pass_time) <= window:
            by_hour.setdefault(f.hour, []).append(f)
    r2 = radius_km * radius_km
    for hour_fixes in by_hour.values():
        if len(hour_fixes) < min_vessels:
            continue
        count = np.zeros(grid.shape, dtype=np.int32)
        for f in hour_fixes:
            dx = (f.lon - clon) * kx
            dy = (f.lat - clat) * KM_PER_DEG
            count += (dx * dx + dy * dy) <= r2
        heard |= count >= min_vessels
    if water is not None:
        heard &= water
    return heard


def heard_share(heard: np.ndarray, water: np.ndarray) -> float:
    """The heard share of the water's cells."""
    n = int(water.sum())
    return float((heard & water).sum()) / n if n else 0.0


def is_heard(heard: np.ndarray, grid: Grid, lon: float, lat: float) -> bool:
    rc = grid.cell(lon, lat)
    return bool(rc is not None and heard[rc])


def _cell_box(grid: Grid, r: int, c: int) -> BaseGeometry:
    return box(*grid.bounds(r, c))


def drawn_shape(heard: np.ndarray, grid: Grid, within: BaseGeometry | None = None,
                close_deg: float = 0.035, open_deg: float = 0.02) -> BaseGeometry:
    """The heard cells as one rounded shape for the map, clipped to `within` (the reserve)."""
    cells = [_cell_box(grid, int(r), int(c)) for r, c in zip(*np.nonzero(heard))]
    if not cells:
        return shapely.Polygon()
    g = shapely.union_all(cells)
    g = g.buffer(close_deg, quad_segs=6).buffer(-close_deg, quad_segs=6)
    g = g.buffer(-open_deg, quad_segs=6).buffer(open_deg, quad_segs=6)
    if within is not None:
        g = g.intersection(within)
    return g


@dataclass(frozen=True)
class Mended:
    shape: BaseGeometry
    added: tuple[tuple[int, int], ...]      # heard cells put back (a target in heard water fell outside)
    removed: tuple[tuple[int, int], ...]    # unproven cells taken out (a target in unproven water fell inside)


def agree(shape: BaseGeometry, heard: np.ndarray, grid: Grid,
          targets: Iterable[tuple[float, float]], within: BaseGeometry | None = None) -> Mended:
    """Make the drawing agree with the rule at every target: a target in a heard cell must lie inside
    the shape, a target in an unproven cell outside it. Where the rounding broke that, the target's
    own cell is added or cut, which is exactly what the rule says about that cell."""
    added, removed = [], []
    for lon, lat in targets:
        rc = grid.cell(lon, lat)
        if rc is None:
            continue
        inside = shape.covers(Point(lon, lat))
        cell = _cell_box(grid, *rc)
        if heard[rc] and not inside:
            shape = shapely.union_all([shape, cell if within is None else cell.intersection(within)])
            added.append(rc)
        elif not heard[rc] and inside:
            shape = shape.difference(cell)
            removed.append(rc)
    return Mended(shape=shape, added=tuple(added), removed=tuple(removed))


def disagreements(shape: BaseGeometry, heard: np.ndarray, grid: Grid,
                  targets: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    """Targets whose side of the drawn line is not their cell's (empty once `agree` has run)."""
    out = []
    for lon, lat in targets:
        rc = grid.cell(lon, lat)
        if rc is not None and bool(heard[rc]) != shape.covers(Point(lon, lat)):
            out.append((lon, lat))
    return out
