"""Vessel-sized targets on a Sentinel-1 backscatter image: a two-parameter cell-averaging CFAR.

Each pixel is compared with the sea around it: the mean and spread of a square ring (a training box
with a guard box cut out of its middle, so the target's own energy is not in its background). A
pixel is a hit when it stands above that local sea by `k` spreads and by at least `floor_db`;
adjacent hits are one target. Single-pixel targets must stand `single_db` above (speckle makes
lone bright pixels). Clusters larger than `max_px` are not vessels (shorelines, rain cells, the
edge of the swath). A faint target close to one much brighter is that target's sidelobe (Platform
Gail's ghost in the spike) and is merged into it.

Pure numpy (the runtime image has scipy; the tests and the laptop build need not). Large images run
in tiles with an overlap wide enough for the training box, and a target belongs to the tile whose
core holds its centre, so a target on a seam is found once. Parameters are in pixels: the build
picks them for the image's spacing (the spike: 61 / 31 at 10 m; 31 / 11 at 40 m).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

MAX_HITS = 200_000          # more hits than this is not open water (a missing land mask): refuse


@dataclass(frozen=True)
class Target:
    row: float              # centre, in pixels of the image passed in
    col: float
    px: int                 # cluster size in pixels
    peak_db: float          # the brightest pixel above its local sea, dB

    def as_dict(self) -> dict:
        return asdict(self)


def to_db(amplitude: np.ndarray) -> np.ndarray:
    """GRD amplitude digital numbers to relative power in dB (uncalibrated: only contrast matters)."""
    a = np.asarray(amplitude, dtype=np.float64)
    return 20.0 * np.log10(np.maximum(a, 1.0))


def box_sum(x: np.ndarray, k: int) -> np.ndarray:
    """Sum of `x` over the k × k box centred on each pixel (clipped at the edges), by integral image."""
    if k < 1 or k % 2 == 0:
        raise ValueError("box size must be a positive odd number")
    ii = np.pad(np.asarray(x, dtype=np.float64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    r = k // 2
    h, w = x.shape
    y0 = np.clip(np.arange(h) - r, 0, h)
    y1 = np.clip(np.arange(h) + r + 1, 0, h)
    x0 = np.clip(np.arange(w) - r, 0, w)
    x1 = np.clip(np.arange(w) + r + 1, 0, w)
    return ii[np.ix_(y1, x1)] - ii[np.ix_(y0, x1)] - ii[np.ix_(y1, x0)] + ii[np.ix_(y0, x0)]


def _clusters(hit: np.ndarray) -> list[list[tuple[int, int]]]:
    """8-connected clusters of the (sparse) hit pixels."""
    pts = set(zip(*np.nonzero(hit)))
    if len(pts) > MAX_HITS:
        raise ValueError(f"{len(pts)} hits: this is not open water (is the land mask applied?)")
    out = []
    while pts:
        stack = [pts.pop()]
        comp = []
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (y + dy, x + dx)
                    if q in pts:
                        pts.remove(q)
                        stack.append(q)
        out.append(comp)
    return out


def _detect_tile(db: np.ndarray, valid: np.ndarray, train: int, guard: int, k: float,
                 floor_db: float, single_db: float, max_px: int) -> list[Target]:
    v = np.where(valid, db, 0.0)
    n = valid.astype(np.float64)
    s1 = box_sum(v, train) - box_sum(v, guard)
    s2 = box_sum(v * v, train) - box_sum(v * v, guard)
    cnt = box_sum(n, train) - box_sum(n, guard)
    # A ring with little open water around it (a pixel next to the mask) has no sea to compare with.
    enough = cnt >= 0.5 * (train * train - guard * guard)
    cnt = np.maximum(cnt, 1.0)
    mu = s1 / cnt
    sd = np.sqrt(np.maximum(s2 / cnt - mu * mu, 1e-9))
    excess = db - mu
    hit = valid & enough & (excess > np.maximum(k * sd, floor_db))
    targets = []
    for comp in _clusters(hit):
        ys = np.fromiter((p[0] for p in comp), dtype=np.int64, count=len(comp))
        xs = np.fromiter((p[1] for p in comp), dtype=np.int64, count=len(comp))
        peak = float(excess[ys, xs].max())
        if len(comp) > max_px or (len(comp) == 1 and peak < single_db):
            continue
        targets.append(Target(row=float(ys.mean()), col=float(xs.mean()), px=len(comp), peak_db=round(peak, 2)))
    return targets


def merge_sidelobes(targets: list[Target], radius_px: float, contrast_db: float = 10.0) -> list[Target]:
    """Drop a target within `radius_px` of one at least `contrast_db` brighter (its sidelobe)."""
    keep = []
    for t in targets:
        ghost = any(o is not t and o.peak_db - t.peak_db >= contrast_db
                    and (o.row - t.row) ** 2 + (o.col - t.col) ** 2 <= radius_px ** 2 for o in targets)
        if not ghost:
            keep.append(t)
    return keep


def detect(db: np.ndarray, valid: np.ndarray | None = None, *, train: int = 31, guard: int = 11,
           k: float = 5.0, floor_db: float = 6.0, single_db: float = 8.0, max_px: int = 200,
           tile: int = 2048, sidelobe_px: float | None = None) -> list[Target]:
    """Every vessel-sized target on `db` (dB) where `valid` is true (open water), strongest first.

    `valid` should already exclude land and a buffer round it; nodata is excluded wherever it is.
    `sidelobe_px` defaults to the guard box's half-width.
    """
    db = np.asarray(db, dtype=np.float64)
    if db.ndim != 2:
        raise ValueError("expected one band")
    valid = np.isfinite(db) if valid is None else (np.asarray(valid, dtype=bool) & np.isfinite(db))
    if guard >= train:
        raise ValueError("the guard box must be smaller than the training box")
    db = np.where(np.isfinite(db), db, 0.0)
    h, w = db.shape
    pad = train // 2 + 1
    found: list[Target] = []
    for r0 in range(0, h, tile):
        for c0 in range(0, w, tile):
            r1, c1 = min(h, r0 + tile), min(w, c0 + tile)
            a0, b0 = max(0, r0 - pad), max(0, c0 - pad)
            a1, b1 = min(h, r1 + pad), min(w, c1 + pad)
            for t in _detect_tile(db[a0:a1, b0:b1], valid[a0:a1, b0:b1], train, guard, k, floor_db, single_db, max_px):
                row, col = t.row + a0, t.col + b0
                if r0 <= row < r1 and c0 <= col < c1:      # this tile's core owns it
                    found.append(Target(row=row, col=col, px=t.px, peak_db=t.peak_db))
    found = merge_sidelobes(found, guard / 2 if sidelobe_px is None else sidelobe_px)
    return sorted(found, key=lambda t: -t.peak_db)
