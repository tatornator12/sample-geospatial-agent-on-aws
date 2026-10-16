"""Where to look: a hotspot map of past dark targets, checked on targets it never saw.

History is a list of dark detections (radar targets with no AIS: lon, lat, day, count). The map is
their count per grid cell before a cut-off day, optionally spread over neighbouring cells. The
prediction is the plain one: dark targets keep appearing where they appeared before. Its check is
measured, never claimed: fit on the years before, then count how many of the next period's dark
targets fall in the top 1, 2, 5 and 10% of the water, against what that much water would hold by
chance. The patrol boxes are the squares of water that held the most, without overlapping.

Pure numpy; the tool layer adds the next planned pass (plan.py) and the stage's words.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np


@dataclass(frozen=True)
class Grid:
    west: float
    south: float
    east: float
    north: float
    step: float             # degrees

    @property
    def shape(self) -> tuple[int, int]:
        return (int(round((self.north - self.south) / self.step)), int(round((self.east - self.west) / self.step)))

    def cell(self, lon: float, lat: float) -> tuple[int, int] | None:
        """(row, col) with row 0 at the south, or None outside the grid."""
        r = int(np.floor((lat - self.south) / self.step))
        c = int(np.floor((lon - self.west) / self.step))
        h, w = self.shape
        return (r, c) if 0 <= r < h and 0 <= c < w else None

    def bounds(self, r: int, c: int, size: int = 1) -> tuple[float, float, float, float]:
        w = self.west + c * self.step
        s = self.south + r * self.step
        return (round(w, 6), round(s, 6), round(w + size * self.step, 6), round(s + size * self.step, 6))


@dataclass(frozen=True)
class Detection:
    lon: float
    lat: float
    day: date
    n: int = 1


def surface(dets: list[Detection], grid: Grid, before: date | None = None, after: date | None = None,
            spread: int = 0, water: np.ndarray | None = None) -> np.ndarray:
    """Counts per cell for detections with after <= day < before, spread over (2·spread+1)² cells,
    zero where `water` is false."""
    h, w = grid.shape
    out = np.zeros((h, w), dtype=np.float64)
    for d in dets:
        if (before is not None and d.day >= before) or (after is not None and d.day < after):
            continue
        rc = grid.cell(d.lon, d.lat)
        if rc is not None:
            out[rc] += d.n
    if spread > 0:
        k = 2 * spread + 1
        padded = np.pad(out, spread)
        ii = np.pad(padded, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        out = (ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k]) / (k * k)
    if water is not None:
        out = np.where(water, out, 0.0)
    return out


def top_mask(score: np.ndarray, share: float, water: np.ndarray | None = None) -> np.ndarray:
    """The `share` of the water's cells with the highest score (ties broken by position, stably)."""
    cells = np.flatnonzero(water.ravel()) if water is not None else np.arange(score.size)
    k = max(1, int(round(len(cells) * share)))
    order = cells[np.argsort(-score.ravel()[cells], kind="stable")][:k]
    mask = np.zeros(score.size, dtype=bool)
    mask[order] = True
    return mask.reshape(score.shape)


@dataclass(frozen=True)
class Check:
    share: float            # of the water searched
    held: int               # test detections inside it
    total: int              # test detections in all
    @property
    def hit(self) -> float:
        return self.held / self.total if self.total else 0.0
    @property
    def lift(self) -> float:
        return self.hit / self.share if self.share else 0.0
    def as_dict(self) -> dict:
        return {"share_of_water": self.share, "held": self.held, "total": self.total,
                "hit": round(self.hit, 3), "lift": round(self.lift, 1)}


def backtest(dets: list[Detection], grid: Grid, cut: date, until: date | None = None, since: date | None = None,
             shares=(0.01, 0.02, 0.05, 0.10), spread: int = 0, water: np.ndarray | None = None) -> list[Check]:
    """Fit on [since, cut), test on [cut, until): how much of the test fell in the map's top shares."""
    train = surface(dets, grid, before=cut, after=since, spread=spread, water=water)
    test = surface(dets, grid, before=until, after=cut, water=water)
    total = int(round(test.sum()))
    out = []
    for s in shares:
        held = int(round(test[top_mask(train, s, water)].sum()))
        out.append(Check(share=s, held=held, total=total))
    return out


@dataclass(frozen=True)
class Box:
    bounds: tuple[float, float, float, float]   # west, south, east, north
    share_of_history: float                      # of all past dark targets on the grid
    count: float


def patrol_boxes(score: np.ndarray, grid: Grid, size: int, k: int = 3) -> list[Box]:
    """Up to `k` non-overlapping size × size squares of cells holding the most of `score`, best first."""
    total = float(score.sum())
    h, w = score.shape
    if total <= 0 or size > h or size > w:
        return []
    ii = np.pad(score, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    sums = ii[size:, size:] - ii[:-size, size:] - ii[size:, :-size] + ii[:-size, :-size]   # (h-size+1, w-size+1)
    taken = np.zeros((h, w), dtype=bool)
    boxes = []
    for _ in range(k):
        avail = sums.copy()
        # A square overlapping a chosen one is not available.
        for r in range(sums.shape[0]):
            row = taken[r:r + size]
            if not row.any():
                continue
            for c in range(sums.shape[1]):
                if row[:, c:c + size].any():
                    avail[r, c] = -1.0
        r, c = np.unravel_index(int(np.argmax(avail)), avail.shape)
        if avail[r, c] <= 0:
            break
        taken[r:r + size, c:c + size] = True
        boxes.append(Box(bounds=grid.bounds(r, c, size), share_of_history=round(float(sums[r, c]) / total, 3),
                         count=round(float(sums[r, c]), 2)))
    return boxes
