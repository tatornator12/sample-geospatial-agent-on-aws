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
    return _smooth(out, spread, water)


def _smooth(counts: np.ndarray, spread: int, water: np.ndarray | None) -> np.ndarray:
    """Counts spread over (2·spread+1)² cells, zero where `water` is false (the map's one fit)."""
    out = counts
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
class Rolling:
    """The rolling check: before each radar day the map is refitted on everything before that day,
    and that day's dark targets are counted in its top `share` of the water and in the boxes drawn
    from the same fit."""
    share: float            # of the water in the top cells
    held: int               # dark targets in the top cells, over every radar day
    total: int              # dark targets on those days
    days: int               # radar days: days in the window with one or more dark targets on the water
    days_hit: int           # radar days with one or more in the top cells
    boxes_held: int
    boxes_days_hit: int
    boxes_share: float      # of the water in the boxes, the mean over the radar days

    @property
    def hit(self) -> float:
        return self.held / self.total if self.total else 0.0

    @property
    def lift(self) -> float:
        return self.hit / self.share if self.share else 0.0

    @property
    def boxes_hit(self) -> float:
        return self.boxes_held / self.total if self.total else 0.0

    @property
    def boxes_lift(self) -> float:
        return self.boxes_hit / self.boxes_share if self.boxes_share else 0.0

    def as_dict(self) -> dict:
        return {"share_of_water": self.share, "held": self.held, "total": self.total, "days": self.days,
                "days_hit": self.days_hit, "hit": round(self.hit, 3), "lift": round(self.lift, 1),
                "boxes_held": self.boxes_held, "boxes_days_hit": self.boxes_days_hit,
                "boxes_share_of_water": round(self.boxes_share, 4), "boxes_hit": round(self.boxes_hit, 3),
                "boxes_lift": round(self.boxes_lift, 1)}


def rolling_check(dets: list[Detection], grid: Grid, since: date, until: date, share: float = 0.05, spread: int = 0,
                  water: np.ndarray | None = None, box_cells: int = 4, n_boxes: int = 3) -> Rolling:
    """For each radar day in [since, until), refit on everything before it, the same way as the map
    (`surface`), and count that day's dark targets in the fit's top `share` of the water and in the
    `n_boxes` patrol boxes that fit draws. It measures the method, not today's boxes."""
    h, w = grid.shape
    cells = []
    for d in dets:
        rc = grid.cell(d.lon, d.lat)
        if rc is not None:
            cells.append((d.day, rc[0], rc[1], d.n))
    cells.sort(key=lambda x: x[0])
    on_water = (lambda r, c: True) if water is None else (lambda r, c: bool(water[r, c]))
    test_days = sorted({day for day, r, c, _ in cells if since <= day < until and on_water(r, c)})
    n_water = int(water.sum()) if water is not None else h * w
    counts = np.zeros((h, w), dtype=np.float64)
    i = held = total = days_hit = boxes_held = boxes_days = 0
    box_shares = []
    for day in test_days:
        while i < len(cells) and cells[i][0] < day:
            _, r, c, n = cells[i]
            counts[r, c] += n
            i += 1
        score = _smooth(counts, spread, water)
        top = top_mask(score, share, water)
        in_boxes = np.zeros((h, w), dtype=bool)
        for b in patrol_boxes(score, grid, size=box_cells, k=n_boxes):
            r0, c0 = grid.cell(b.bounds[0] + grid.step / 2, b.bounds[1] + grid.step / 2)
            in_boxes[r0:r0 + box_cells, c0:c0 + box_cells] = True
        if water is not None:
            in_boxes &= water
        box_shares.append(float(in_boxes.sum()) / n_water if n_water else 0.0)
        today = np.zeros((h, w), dtype=np.float64)
        for d, r, c, n in cells:
            if d == day and on_water(r, c):
                today[r, c] += n
        k, kb = int(round(today[top].sum())), int(round(today[in_boxes].sum()))
        total += int(round(today.sum()))
        held += k
        boxes_held += kb
        days_hit += k > 0
        boxes_days += kb > 0
    return Rolling(share=share, held=held, total=total, days=len(test_days), days_hit=days_hit, boxes_held=boxes_held,
                   boxes_days_hit=boxes_days, boxes_share=float(np.mean(box_shares)) if box_shares else 0.0)


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
