"""Elevation profiles across earthworks: sample a DEM along a transect, find banks and ditches.

Pure functions (numpy only) so the catalogue build, the checks and the `measure_profile` tool share
one measurement. Distances in metres along the transect, elevations in metres; offsets are
relative to the transect's median elevation (the spike's baseline, docs/spikes/lidar.md).
"""
from __future__ import annotations

import math

import numpy as np

NODATA = -9999.0
SMOOTH_M = 3            # moving average before picking extrema (1 m DEM noise is ~0.1-0.2 m)
WINDOW_M = 10           # a crest or a ditch is the extreme within +- this many metres
MIN_OFFSET_M = 0.5      # below this a bump is not a bank (nor a dip a ditch)


def sample(dem: np.ndarray, transform, start_xy, end_xy, step: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Bilinear samples every `step` metres from start to end (map coordinates of `transform`).
    Returns (distance_m, elevation_m); nodata samples are NaN."""
    (x0, y0), (x1, y1) = start_xy, end_xy
    length = math.hypot(x1 - x0, y1 - y0)
    n = max(2, int(length // step) + 1)
    t = np.linspace(0.0, 1.0, n)
    xs, ys = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    inv = ~transform
    cols, rows = inv * (xs, ys)
    cols, rows = np.asarray(cols) - 0.5, np.asarray(rows) - 0.5   # pixel centres
    c0, r0 = np.floor(cols).astype(int), np.floor(rows).astype(int)
    fc, fr = cols - c0, rows - r0
    h, w = dem.shape
    z = np.full(n, np.nan)
    ok = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < w) & (r0 + 1 < h)
    if ok.any():
        a = dem[r0[ok], c0[ok]]
        b = dem[r0[ok], c0[ok] + 1]
        c = dem[r0[ok] + 1, c0[ok]]
        d = dem[r0[ok] + 1, c0[ok] + 1]
        quad = np.stack([a, b, c, d])
        good = (quad != NODATA).all(axis=0) & np.isfinite(quad).all(axis=0)
        val = (a * (1 - fc[ok]) * (1 - fr[ok]) + b * fc[ok] * (1 - fr[ok])
               + c * (1 - fc[ok]) * fr[ok] + d * fc[ok] * fr[ok])
        zz = np.where(good, val, np.nan)
        z[ok] = zz
    return t * length, z


def _smooth(z: np.ndarray, size: int) -> np.ndarray:
    if size <= 1:
        return z.copy()
    k = np.ones(size) / size
    zf = np.where(np.isfinite(z), z, 0.0)
    wf = np.isfinite(z).astype(float)
    num, den = np.convolve(zf, k, mode="same"), np.convolve(wf, k, mode="same")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0.5, num / np.maximum(den, 1e-9), np.nan)


def analyse(distance: np.ndarray, z: np.ndarray, step: float = 1.0) -> dict:
    """Banks (crests) and ditches along a profile, the span between the outermost banks."""
    valid = np.isfinite(z)
    if valid.sum() < 50:
        raise ValueError("the transect has fewer than 50 m of LiDAR")
    baseline = float(np.median(z[valid]))
    zs = _smooth(z, max(1, int(round(SMOOTH_M / step))))
    half = max(1, int(round(WINDOW_M / step)))
    features = []
    for i in range(len(zs)):
        if not np.isfinite(zs[i]):
            continue
        lo, hi = max(0, i - half), min(len(zs), i + half + 1)
        seg = zs[lo:hi]
        if not np.isfinite(seg).all():
            continue
        off = zs[i] - baseline
        if off >= MIN_OFFSET_M and zs[i] == seg.max():
            features.append(("bank", i, off))
        elif off <= -MIN_OFFSET_M and zs[i] == seg.min():
            features.append(("ditch", i, off))
    # Plateaus repeat the same extreme: keep the first index of each run.
    kept, last = [], None
    for kind, i, off in features:
        if last and last[0] == kind and i - last[1] <= half:
            continue
        kept.append((kind, i, off))
        last = (kind, i)
    out = [{"kind": k, "at_m": round(float(distance[i]), 1), "elevation_m": round(float(z[i]), 2),
            "offset_m": round(float(z[i] - baseline), 2)} for k, i, _ in kept if np.isfinite(z[i])]
    banks = [f for f in out if f["kind"] == "bank"]
    span = round(banks[-1]["at_m"] - banks[0]["at_m"], 1) if len(banks) >= 2 else None
    return {"baseline_m": round(baseline, 2), "length_m": round(float(distance[-1]), 1),
            "features": out, "outer_banks_span_m": span,
            "max_relief_m": round(float(np.nanmax(z) - np.nanmin(z)), 2)}
