#!/usr/bin/env python3
"""Act 3 cache build (task 2.1): the passes on file and the predictions' history, into the project
bucket under vessels/cache/v1/. Nothing here runs on stage; the agent only reads these files.

    AWS_PROFILE=main .venv/bin/python scripts/build_vessel_cache.py --dry-run              # build locally, upload nothing
    AWS_PROFILE=main .venv/bin/python scripts/build_vessel_cache.py                        # every pass on file
    AWS_PROFILE=main .venv/bin/python scripts/build_vessel_cache.py --pass s1d-20261012t0018
    AWS_PROFILE=main .venv/bin/python scripts/build_vessel_cache.py --history              # history and fleet only
    ... --update-passes     # write the build's counts (both detectors) back into data/passes_v1.json
    ... --imaged [--dry-run]            # each pass's imaged cells and metadata into the manifest, from
                                        # its display in the bucket (no radar read, no GFW call)
    ... --backup 2026-11-05 [--dry-run] # the manifest, history, fleet and rest to <prefix>/backup-<date>/
    ... --restore 2026-11-05            # and back (server-side copies; nothing is ever deleted)
    ... --prefix vessels/cache/v1r --seed-from vessels/cache/v1   # task 9a: the rehearsal's manifest
    ... --prefix vessels/cache/v1r ...  # every write to the rehearsal prefix (task 9a only)

Per pass (agents/dark-vessels/data/passes_v1.json, the star, the alternates and the silent vessel):

    <pass>_vv.tif         Sentinel-1 VV in centi-dB (uncalibrated, contrast only), int16, EPSG:4326 at
                          0.0004 deg (about 44 m), nodata -32768: the pass's frames over the radar box
    <pass>_display.tif    the same as uint8 1..255 on one stretch for the whole pass, land and
                          nodata 0 (TiTiler draws it `gray`, rescale 1..255)
    <pass>_targets.json   our CA-CFAR targets (cfar.py on each frame in its own geometry at 20 m, land
                          and 500 m round it masked) with GFW's detections that day (matched or not),
                          each paired one-to-one within 1 km
    <pass>_presence.json  AIS presence in the three hours either side of the pass: one keyless fix
                          per vessel per hour (ais_coverage.py's input)
    <pass>_replay.json    the 72 hours of AIS to the pass as tracks, each under a number given in this
                          build and this pass only (never derived from a vessel id), type only

History (`--history`, and on a full build):

    history_v1.json       GFW's radar detections with no AIS inside the reserve, daily from 2023, and
                          the AIS-off events near it from 2023 (start, end, where it went off and on,
                          hours, km, the implied speed, type)
    fleet_v1.json         squid-jigger fishing hours by month and 0.1 deg cell, 2017 to now

Every file is written from whitelisted fields only, and the scan (vessels_gfw.scan_identity) runs on
every file before anything is uploaded: one finding fails the build. manifest.json is read, merged
and written last. Needs the builder's GFW token (agents/dark-vessels/.env) and the bucket name
(--bucket, or S3_BUCKET_NAME in agents/methane-hunter/.env.dev, the project bucket).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio import features
from rasterio.control import GroundControlPoint
from rasterio.transform import GCPTransformer, from_origin
from rasterio.warp import Resampling, reproject
from rasterio.windows import Window
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform as shp_transform, unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agents" / "dark-vessels"
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(AGENT))
import cfar  # noqa: E402
import ais_coverage as cv  # noqa: E402
import vessels_gfw as gfw  # noqa: E402
from list_vessel_passes import km, parse_hour  # noqa: E402
from predict import Grid  # noqa: E402

PASSES = AGENT / "data" / "passes_v1.json"
RECORDS = AGENT / "data" / "reserve_v1.geojson"
PREFIX = "vessels/cache/v1"                 # every write goes here; --prefix moves it (task 9a only)
PREFIX_RE = re.compile(r"^vessels/cache/v1[a-z0-9-]*$")       # the runtime's VESSEL_CACHE_PREFIX rule
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")  # the stage's rule for the rest file's bucket
BACKUP_FILES = ("manifest.json", "history_v1.json", "fleet_v1.json", "rest_v1.json")
CELL_DEG = 0.05                             # the reserve's grid (decision 3): heard, imaged, checkable
LOCAL = Path("/tmp/vessels_cache/v1")
RECORDS_OUT = LOCAL.parent / "records_v1.json"      # the last build's manifest records, beside (not in) the upload
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-grd"
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
                GDAL_HTTP_MULTIPLEX="YES", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE")

RADAR_BOX = (-94.0, -2.5, -88.0, 2.5)      # what Sentinel-1 frames reach round the reserve (the spike)
STEP = 0.0004                               # the mosaic's degrees, about 44 m at the equator
FACTOR = 2                                  # the GRD's 10 m pixels read from its 2x overview (20 m)
NODATA_CDB = -32768                         # the vv product: int16 centi-dB
LAND_BUFFER_DEG = 500 / 111_320             # the detector's mask: land and 500 m round it
DISPLAY_LAND_DEG = 250 / 111_320            # the display hides the land itself (the stage draws the islands)
# The detector runs in the radar's own geometry at 20 m, not on the 44 m mosaic (Oct 16, the star
# pass): on the mosaic it paired 5 of GFW's 12 detections; at 20 m with k = 6 it pairs 6 and finds 18
# targets (k = 5 pairs 7 but finds 87, mostly speckle). GFW's misses peak 7.6 to 10.5 dB over the
# local median even at 10 m, which a CFAR cannot tell from speckle.
CFAR = dict(train=41, guard=15, k=6.0, floor_db=8.0, single_db=10.0, max_px=800)
SAME_TARGET_KM = 0.2                        # one vessel seen in two overlapping frames
PAIR_KM = 1.0
PORT_KM = 10.0
REPLAY_H = 72
SAR = "public-global-sar-presence:latest"
PRESENCE = "public-global-presence:latest"
GAPS = "public-global-gaps-events:latest"
EFFORT = "public-global-fishing-effort:latest"
GAPS_BOX = (-95.5, -4.5, -86.5, 4.0)        # the spike's box for AIS-off events near the reserve
FLEET_BOX = (-100.0, -45.0, -70.0, 5.0)     # the south-east Pacific: the Galápagos, Peru and Chile
HISTORY_FROM = date(2023, 1, 1)
FLEET_FROM = date(2017, 1, 1)


# --- small helpers -------------------------------------------------------------------------------

def fc_box(b) -> dict:
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": mapping(box(*b))}]}


def rows_of(report: dict):
    for ent in report.get("entries", []):
        for _, rs in ent.items():
            yield from (rs or [])
    if report.get("nextOffset"):
        raise SystemExit("a GFW report came back paged (nextOffset): page it before trusting it")


def windows(a: date, b: date, days: int = 365):
    while a < b:
        c = min(b, a + timedelta(days=days))
        yield a, c
        a = c


def write_json(path: Path, body) -> int:
    path.write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")))
    return path.stat().st_size


def write_cog(path: Path, arr: np.ndarray, transform, nodata, tags: dict, predictor: int | None = None) -> int:
    profile = dict(driver="COG", width=arr.shape[1], height=arr.shape[0], count=1, dtype=arr.dtype.name,
                   crs="EPSG:4326", transform=transform, nodata=nodata, compress="DEFLATE", blocksize=512,
                   overview_resampling="AVERAGE", BIGTIFF="IF_SAFER", **({"predictor": predictor} if predictor else {}))
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(arr, 1)
        ds.update_tags(**tags)
    return path.stat().st_size


def records():
    rec = json.loads(RECORDS.read_text())
    reserve = shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))
    ports = [f["geometry"]["coordinates"] for f in rec["features"] if f["properties"]["kind"] == "port"]
    land = unary_union([shape(f["geometry"]) for f in rec["features"] if f["properties"]["kind"] == "land"])
    return reserve, ports, land


def reserve_grid(reserve) -> tuple[Grid, np.ndarray]:
    """The reserve's 0.05 deg grid and its water cells (cell centre in the reserve), as the runtime's."""
    rp = prep(reserve)
    rw, rs, re_, rn = reserve.bounds
    grid = Grid(round(math.floor(rw / CELL_DEG) * CELL_DEG, 2), round(math.floor(rs / CELL_DEG) * CELL_DEG, 2),
                round(math.ceil(re_ / CELL_DEG) * CELL_DEG, 2), round(math.ceil(rn / CELL_DEG) * CELL_DEG, 2), CELL_DEG)
    hh, ww = grid.shape
    water = np.array([[rp.contains(Point(grid.west + (c + .5) * CELL_DEG, grid.south + (r + .5) * CELL_DEG))
                       for c in range(ww)] for r in range(hh)])
    return grid, water


def imaged_mask(disp: np.ndarray, transform, grid: Grid, water: np.ndarray) -> np.ndarray:
    """The water cells the pass imaged: its display is > 0 at the cell's centre (the design notes'
    method). A centre off the raster, on land or in its 250 m margin reads 0, so it is not imaged."""
    hh, ww = grid.shape
    rows, cols = np.mgrid[0:hh, 0:ww]
    lon = grid.west + (cols + 0.5) * grid.step
    lat = grid.south + (rows + 0.5) * grid.step
    inv = ~transform
    px = np.floor(inv.a * lon + inv.b * lat + inv.c).astype(int)
    py = np.floor(inv.d * lon + inv.e * lat + inv.f).astype(int)
    inside = (px >= 0) & (px < disp.shape[1]) & (py >= 0) & (py < disp.shape[0])
    out = np.zeros(grid.shape, dtype=bool)
    out[inside] = disp[py[inside], px[inside]] > 0
    return out & water


def imaged_fields(imaged: np.ndarray, grid: Grid, water: np.ndarray) -> dict:
    """A record's imaged share and cells (runs per grid row, row 0 at the south, as cv.cell_runs)."""
    n = int(water.sum())
    return {"imaged_share": round(float(imaged.sum()) / n, 3) if n else 0.0,
            "imaged_cells": cv.cell_runs(imaged),
            "imaged_grid": [grid.west, grid.south, grid.east, grid.north, grid.step]}


def pass_meta(entry: dict) -> dict:
    """The pass's metadata from its entry on file, for the manifest record."""
    return {"satellite": entry.get("satellite"), "orbit_state": entry.get("orbit_state"),
            "relative_orbit": entry.get("relative_orbit")}


# --- the radar -----------------------------------------------------------------------------------

def stac_scenes(ids: list[str]) -> list[dict]:
    body = {"collections": ["sentinel-1-grd"], "ids": ids, "limit": len(ids)}
    req = urllib.request.Request(STAC, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    items = json.load(urllib.request.urlopen(req, timeout=120))["features"]
    if {i["id"] for i in items} != set(ids):
        raise SystemExit(f"Planetary Computer is missing scenes: {sorted(set(ids) - {i['id'] for i in items})}")
    return items


def _rasterize(geom, out_shape, transform) -> np.ndarray:
    parts = [mapping(p) for p in getattr(geom, "geoms", [geom]) if not p.is_empty]
    if not parts:
        return np.zeros(out_shape, dtype=bool)
    return features.rasterize(parts, out_shape=out_shape, transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)


def radar(entry: dict, land) -> dict:
    """The pass's frames: our detector on each frame in its own geometry at 20 m (land masked through
    the frame's ground control points), and one dB mosaic of them on a lon/lat grid for the stage."""
    items = stac_scenes(entry["scenes"])
    foot = unary_union([shape(i["geometry"]) for i in items]).intersection(box(*RADAR_BOX))
    w, s, e, n = foot.bounds
    w, s = math.floor(w / STEP) * STEP, math.floor(s / STEP) * STEP
    e, n = math.ceil(e / STEP) * STEP, math.ceil(n / STEP) * STEP
    width, height = int(round((e - w) / STEP)), int(round((n - s) / STEP))
    transform = from_origin(w, n, STEP, STEP)
    amp = np.zeros((height, width), dtype=np.float32)
    token = json.load(urllib.request.urlopen(SAS, timeout=30))["token"]
    hits = []
    for it in items:
        t0 = time.time()
        with rasterio.Env(**GDAL_ENV), rasterio.open("/vsicurl/" + it["assets"]["vv"]["href"] + "?" + token) as ds:
            src = ds.read(1, out_shape=(ds.height // FACTOR, ds.width // FACTOR), resampling=Resampling.average).astype(np.float32)
            gcps, crs = ds.gcps
        sg = [GroundControlPoint(row=p.row / FACTOR, col=p.col / FACTOR, x=p.x, y=p.y) for p in gcps]
        tr = GCPTransformer(sg)
        t1 = time.time()

        def to_px(x, y, z=None):
            rows, cols = tr.rowcol(np.atleast_1d(x), np.atleast_1d(y), op=lambda v: v)
            return np.asarray(cols, dtype=float), np.asarray(rows, dtype=float)

        frame_land = land.intersection(shape(it["geometry"]).buffer(0.05)).buffer(LAND_BUFFER_DEG)
        mask = _rasterize(shp_transform(to_px, frame_land), src.shape, Affine.identity()) if not frame_land.is_empty else np.zeros(src.shape, bool)
        valid = (src > 0) & ~mask
        found = cfar.detect(np.where(valid, cfar.to_db(src), np.nan), valid, **CFAR)
        if found:
            xs, ys = tr.xy([t.row for t in found], [t.col for t in found], offset="center")
            hits += [(float(x), float(y), t) for x, y, t in zip(xs, ys, found)]
        t2 = time.time()
        part = np.zeros_like(amp)
        reproject(src, part, gcps=sg, src_crs=crs, dst_transform=transform, dst_crs="EPSG:4326",
                  resampling=Resampling.average, src_nodata=0, dst_nodata=0)
        fill = (amp == 0) & (part > 0)
        amp[fill] = part[fill]
        print(f"    {it['id'][:48]}: {src.shape[1]}x{src.shape[0]} at 20 m read {t1 - t0:.0f}s, "
              f"{len(found)} targets in {t2 - t1:.0f}s, warped {time.time() - t2:.0f}s", flush=True)
        del src, part, mask, valid
    # A vessel in the overlap of two frames is one target (the brighter reading).
    hits.sort(key=lambda h: -h[2].peak_db)
    kept = []
    for x, y, t in hits:
        if all(km((x, y), (kx, ky)) > SAME_TARGET_KM for kx, ky, _ in kept):
            kept.append((x, y, t))
    have = amp > 0
    db = np.where(have, cfar.to_db(amp), np.nan).astype(np.float32)
    del amp
    land_here = land.intersection(box(w, s, e, n).buffer(0.1))
    shown = _rasterize(land_here.buffer(DISPLAY_LAND_DEG), db.shape, transform)
    return {"db": db, "have": have, "sea_shown": have & ~shown, "transform": transform, "targets": kept,
            "bounds": [round(w, 6), round(s, 6), round(e, 6), round(n, 6)], "footprint": foot,
            "frames": [{"id": i["id"], "sensed": i["properties"]["datetime"]} for i in items]}


def display(db: np.ndarray, shown: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """One stretch for the whole pass (2nd to 99.7th percentile of the open sea), to 1..255."""
    sample = db[shown][:: max(1, int(shown.sum() // 2_000_000))]
    lo, hi = (float(v) for v in np.percentile(sample, [2, 99.7]))
    out = np.zeros(db.shape, dtype=np.uint8)
    out[shown] = (1 + np.clip((db[shown] - lo) / (hi - lo), 0, 1) * 254).astype(np.uint8)
    return out, [round(lo, 2), round(hi, 2)]


# The stage's radar (Oct 19, the Act 3 critique): on one stretch the near range burned (the column
# medians ran 220 to 30 across the Oct 12 swath), so the brightest thing on the stage was empty sea.
# The display is now the radar over its local sea: dB minus a smooth background (the median of the
# open sea in blocks of about 17 km, filled and smoothed, then bilinear), so the sea sits in one low
# band at every range and only what stands above it (vessels, rocks, the odd breaking wave) goes bright.
FLAT_BLOCK_PX = 375                 # 0.15 deg at 0.0004 deg
FLAT_RANGE_DB = (-4.0, 12.0)        # over the local sea, to 1..255
FLAT_GAMMA = 0.9


def _nan_fill(a: np.ndarray, passes: int = 40) -> np.ndarray:
    """Fill NaN cells with the mean of their filled neighbours, outward, until none are left."""
    a = a.copy()
    for _ in range(passes):
        holes = np.isnan(a)
        if not holes.any():
            break
        p = np.pad(a, 1, constant_values=np.nan)
        stack = np.stack([p[1 + dy:1 + dy + a.shape[0], 1 + dx:1 + dx + a.shape[1]]
                          for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(stack, axis=0)
        a[holes] = mean[holes]
    return np.where(np.isnan(a), np.nanmedian(a), a)


def _upsample(coarse: np.ndarray, shape: tuple[int, int], block: int) -> np.ndarray:
    """Bilinear from block centres to every pixel, one axis at a time (numpy only)."""
    cy = (np.arange(coarse.shape[0]) + 0.5) * block
    cx = (np.arange(coarse.shape[1]) + 0.5) * block
    xs = np.arange(shape[1]) + 0.5
    rows = np.stack([np.interp(xs, cx, coarse[r]) for r in range(coarse.shape[0])])
    ys = np.arange(shape[0]) + 0.5
    out = np.empty(shape, dtype=np.float32)
    for c0 in range(0, shape[1], 1024):
        sl = rows[:, c0:c0 + 1024]
        out[:, c0:c0 + 1024] = np.stack([np.interp(ys, cy, sl[:, j]) for j in range(sl.shape[1])], axis=1)
    return out


def flat_display(db: np.ndarray, shown: np.ndarray, block: int = FLAT_BLOCK_PX) -> tuple[np.ndarray, list[float]]:
    """The radar over its local sea, to 1..255 (0 where nothing is shown)."""
    h, w = db.shape
    ny, nx = -(-h // block), -(-w // block)
    coarse = np.full((ny, nx), np.nan, dtype=np.float32)
    for j in range(ny):
        for i in range(nx):
            sl = (slice(j * block, (j + 1) * block), slice(i * block, (i + 1) * block))
            vals = db[sl][shown[sl]]
            if vals.size > 0.05 * block * block:
                coarse[j, i] = np.median(vals[:: max(1, vals.size // 20_000)])
    coarse = _nan_fill(coarse)
    p = np.pad(coarse, 1, mode="edge")
    coarse = sum(p[1 + dy:1 + dy + ny, 1 + dx:1 + dx + nx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9.0
    bg = _upsample(coarse, (h, w), block)
    lo, hi = FLAT_RANGE_DB
    out = np.zeros((h, w), dtype=np.uint8)
    g = np.clip((db[shown] - bg[shown] - lo) / (hi - lo), 0, 1) ** FLAT_GAMMA
    out[shown] = (1 + g * 254).astype(np.uint8)
    return out, [lo, hi]


def rebuild_displays(out: Path) -> dict[str, int]:
    """Every pass's display again from its own vv (no radar read): the radar over its local sea."""
    sizes = {}
    for vv_path in sorted(out.glob("*_vv.tif")):
        pid = vv_path.name[: -len("_vv.tif")]
        disp_path = out / f"{pid}_display.tif"
        t0 = time.time()
        with rasterio.open(vv_path) as v:
            raw = v.read(1)
            transform, tags = v.transform, v.tags()
        with rasterio.open(disp_path) as d:
            shown = d.read(1) > 0          # the old display's mask: open sea, land and its 250 m buffer left out
        db = np.where(raw != -32768, raw.astype(np.float32) / 100.0, np.nan)
        del raw
        disp, stretch = flat_display(db, shown & np.isfinite(db))
        del db
        tags = {k: tags[k] for k in ("PASS", "SENSED", "SOURCE") if k in tags}
        sizes[pid] = write_cog(disp_path, disp, transform, 0, {
            **tags, "NOTE": "VV over its local sea (dB minus the open sea's median in 17 km blocks), contrast only",
            "STRETCH_DB": json.dumps(stretch)})
        print(f"  {pid}: display over the local sea, {sizes[pid] / 1e6:.1f} MB in {time.time() - t0:.0f}s", flush=True)
    return sizes


# --- GFW ------------------------------------------------------------------------------------------

def gfw_detections(day: date, area: tuple, reserve, ports) -> list[dict]:
    rp = prep(reserve)
    out = []
    for matched in (True, False):
        rep = gfw.report(SAR, fc_box(area), f"{day},{day + timedelta(days=1)}", "DAILY", "HIGH", group_by="GEARTYPE",
                         filters=f"matched='{str(matched).lower()}'")
        for r in rows_of(rep):
            lon, lat = round(float(r["lon"]), 5), round(float(r["lat"]), 5)
            out.append({"lon": lon, "lat": lat, "n": int(r.get("detections", 1)), "matched": matched,
                        "in_reserve": rp.contains(Point(lon, lat)),
                        "port_km": round(min(km((lon, lat), p) for p in ports), 1)})
        time.sleep(1)
    return out


def presence_rows(t_from: datetime, t_to: datetime, area: tuple) -> list[tuple]:
    """(number, hour, lon, lat, type) for every vessel-hour in the window; ids never leave the client."""
    rep = gfw.report(PRESENCE, fc_box(area), f"{t_from.date()},{t_to.date() + timedelta(days=1)}", "HOURLY", "HIGH",
                     group_by="VESSEL_ID", keys=True)
    rows = []
    for r in rows_of(rep):
        if "k" not in r:
            continue
        t = parse_hour(r["date"])
        if t_from <= t <= t_to:
            typ = str(r.get("vesselType") or r.get("geartype") or "unknown").lower()
            rows.append((r["k"], t, round(float(r["lon"]), 4), round(float(r["lat"]), 4), typ))
    return rows


def replay(rows: list[tuple], start: datetime, end: datetime) -> dict:
    """Tracks for the stage's replay: renumbered 1..N for this pass only, positions in time order."""
    by: dict = {}
    for k, t, lon, lat, typ in sorted(rows, key=lambda r: r[1]):
        tr = by.setdefault(k, {"type": typ, "t": [], "c": []})
        hour = t.strftime("%Y-%m-%dT%H:%MZ")
        if tr["t"] and tr["t"][-1] == hour:
            continue                                  # one position per vessel per hour
        tr["t"].append(hour)
        tr["c"].append([round(lon, 3), round(lat, 3)])
    tracks = [{"n": i, **tr} for i, tr in enumerate(by.values(), 1)]
    return {"start": start.strftime("%Y-%m-%dT%H:%MZ"), "end": end.strftime("%Y-%m-%dT%H:%MZ"),
            "note": "one position per vessel per hour (GFW AIS presence, 0.01 deg); numbers are this pass's only",
            "tracks": tracks}


# --- one pass -------------------------------------------------------------------------------------

def build_pass(entry: dict, out: Path, reserve, ports, land) -> dict:
    started = time.time()
    pid = entry["pass_id"]
    sensed = datetime.fromisoformat(entry["sensed"].replace("Z", "+00:00"))
    print(f"  {pid} ({entry['role']}), sensed {entry['sensed']}", flush=True)
    rad = radar(entry, land)
    products = {}
    tags = {"SOURCE": "Copernicus Sentinel data (ESA), via Microsoft Planetary Computer", "PASS": pid,
            "SENSED": entry["sensed"], "NOTE": "VV, uncalibrated dB (contrast only)"}
    cdb = np.where(np.isfinite(rad["db"]), np.round(rad["db"] * 100), NODATA_CDB).astype(np.int16)
    products["vv"] = write_cog(out / f"{pid}_vv.tif", cdb, rad["transform"], NODATA_CDB, {**tags, "SCALE": "0.01 (centi-dB)"},
                               predictor=2)
    del cdb
    disp, stretch = display(rad["db"], rad["sea_shown"])
    products["display"] = write_cog(out / f"{pid}_display.tif", disp, rad["transform"], 0, {**tags, "STRETCH_DB": json.dumps(stretch)})
    imaged = imaged_mask(disp, rad["transform"], *reserve_grid(reserve))
    del disp
    rp = prep(reserve)
    pixel_m = 10 * FACTOR
    targets = []
    for i, (lon, lat, t) in enumerate(rad["targets"], 1):
        targets.append({"id": f"R{i:03d}", "lon": round(lon, 5), "lat": round(lat, 5), "px": t.px, "peak_db": t.peak_db,
                        "area_m2": t.px * pixel_m * pixel_m, "in_reserve": rp.contains(Point(lon, lat)),
                        "port_km": round(min(km((lon, lat), p) for p in ports), 1)})
    area = tuple(rad["bounds"])
    theirs = gfw_detections(sensed.date(), area, reserve, ports)
    foot = prep(rad["footprint"].buffer(0.02))
    theirs = [d for d in theirs if foot.contains(Point(d["lon"], d["lat"]))]
    # Pair each of GFW's detections with our nearest target within 1 km (one-to-one, nearest first).
    pairs = sorted(((km((g["lon"], g["lat"]), (o["lon"], o["lat"])), gi, oi)
                    for gi, g in enumerate(theirs) for oi, o in enumerate(targets)), key=lambda x: x[0])
    used_g, used_o = set(), set()
    for d, gi, oi in pairs:
        if d > PAIR_KM:
            break
        if gi in used_g or oi in used_o:
            continue
        used_g.add(gi); used_o.add(oi)
        theirs[gi]["ours"] = targets[oi]["id"]; theirs[gi]["pair_km"] = round(d, 2)
        targets[oi]["gfw"] = gi; targets[oi]["pair_km"] = round(d, 2)
    for gi, g in enumerate(theirs):
        g["id"] = f"G{gi + 1:03d}"
    for o in targets:
        if "gfw" in o:
            o["gfw"] = theirs[o["gfw"]]["id"]
    products["targets"] = write_json(out / f"{pid}_targets.json", {
        "pass_id": pid, "sensed": entry["sensed"], "bounds": rad["bounds"], "step_deg": STEP,
        # Never a key called "name" anywhere in the cache: the identity scan fails on it (vessel names).
        "detector": {"method": "two-parameter CA-CFAR (cfar.py), in each frame's own geometry", "pixel_m": 10 * FACTOR,
                     **CFAR, "land_buffer_m": 500},
        "ours": targets, "gfw": theirs,
        "notes": ["GFW's detections are its public SAR vessel detections (larger vessels); matched means GFW matched it to AIS",
                  "pairs are one-to-one within 1 km, nearest first"]})

    # AIS around the pass: presence for the coverage rule (over the whole reserve, so its heard share
    # is the reserve's, and 30 km round it), and the replay's three days over the same box.
    rw0, rs0, re0, rn0 = reserve.bounds
    margin = (min(area[0], rw0) - 0.3, min(area[1], rs0) - 0.3, max(area[2], re0) + 0.3, max(area[3], rn0) + 0.3)
    rows = presence_rows(sensed - timedelta(hours=REPLAY_H), sensed + cv.WINDOW, margin)
    fixes = cv.fixes_from_tracks([(k, t, lon, lat) for k, t, lon, lat, _ in rows], sensed)
    products["presence"] = write_json(out / f"{pid}_presence.json", {
        "pass_id": pid, "sensed": entry["sensed"], "window_h": cv.WINDOW.total_seconds() / 3600,
        "note": "one position per vessel per hour, no key: two fixes in one hour are two vessels",
        "fixes": [[f.lon, f.lat, f.hour.strftime("%Y-%m-%dT%H:%MZ")] for f in fixes]})
    rp_rows = [r for r in rows if r[1] <= sensed + timedelta(hours=1)]
    products["replay"] = write_json(out / f"{pid}_replay.json", replay(rp_rows, sensed - timedelta(hours=REPLAY_H), sensed))
    rec = summarise(entry, rad["bounds"], rad["frames"], stretch, targets, theirs, fixes,
                    len({r[0] for r in rp_rows}), products, reserve, round(time.time() - started, 1), imaged)
    return rec


def summarise(entry: dict, bounds, frames, stretch, targets, theirs, fixes, n_tracks: int, products: dict, reserve,
              seconds, imaged: np.ndarray) -> dict:
    """A pass's manifest record: the counts the star rule needs, now with both detectors, and the
    pass's metadata and imaged cells (the open question's coverage, R7.1)."""
    pid = entry["pass_id"]
    sensed = datetime.fromisoformat(entry["sensed"].replace("Z", "+00:00"))
    grid, water = reserve_grid(reserve)
    heard = cv.heard_cells(fixes, grid, sensed, water=water)
    away = [g for g in theirs if not g["matched"] and g["in_reserve"] and g["port_km"] >= PORT_KM]
    in_heard = [g for g in away if cv.is_heard(heard, grid, g["lon"], g["lat"])]
    counts = {"ours": len(targets), "ours_in_reserve": sum(o["in_reserve"] for o in targets),
              "gfw": len(theirs), "both": sum("ours" in g for g in theirs), "gfw_unmatched_away": sum(g["n"] for g in away),
              "heard_share": round(cv.heard_share(heard, water), 3),
              "candidates_gfw_only": sum(g["n"] for g in in_heard),
              "candidates_both": sum(g["n"] for g in in_heard if "ours" in g),
              "seen_once": sum(g["n"] for g in in_heard if "ours" not in g)}
    pair_km = [g["pair_km"] for g in theirs if "pair_km" in g]
    rec = {"pass_id": pid, "role": entry["role"], "sensed": entry["sensed"], **pass_meta(entry),
           **imaged_fields(imaged, grid, water), "bounds": bounds,
           "frames": frames, "stretch_db": stretch, "counts": counts,
           "pair_km_median": round(float(np.median(pair_km)), 2) if pair_km else None,
           "fixes": len(fixes), "replay_tracks": n_tracks,
           "products": {k: {"key": f"{PREFIX}/{pid}_{k}.{'tif' if k in ('vv', 'display') else 'json'}", "bytes": b}
                        for k, b in products.items()},
           "seconds": seconds}
    print(f"    ours {counts['ours']} ({counts['ours_in_reserve']} in the reserve), GFW {counts['gfw']}, both {counts['both']} "
          f"(median {rec['pair_km_median']} km); imaged {rec['imaged_share']:.1%}, heard {counts['heard_share']:.1%}; "
          f"candidates {counts['candidates_both']} "
          f"with both detectors, {counts['seen_once']} seen once; {seconds}s, "
          f"{sum(products.values()) / 1e6:.1f} MB", flush=True)
    return rec


def records_from_local(out: Path, entries: list[dict], reserve, until: date) -> dict:
    """The manifest records rebuilt from the files of the last build (no radar read, no GFW call)."""
    built = {}
    for entry in entries:
        pid = entry["pass_id"]
        if not (out / f"{pid}_targets.json").exists():
            continue
        doc = json.loads((out / f"{pid}_targets.json").read_text())
        presence = json.loads((out / f"{pid}_presence.json").read_text())
        fixes = [cv.Fix(lon, lat, datetime.fromisoformat(h.replace("Z", "+00:00"))) for lon, lat, h in presence["fixes"]]
        n_tracks = len(json.loads((out / f"{pid}_replay.json").read_text())["tracks"])
        with rasterio.open(out / f"{pid}_display.tif") as ds:
            stretch = json.loads(ds.tags().get("STRETCH_DB", "null"))
            imaged = imaged_mask(ds.read(1), ds.transform, *reserve_grid(reserve))
        products = {k: (out / f"{pid}_{k}.{'tif' if k in ('vv', 'display') else 'json'}").stat().st_size
                    for k in ("vv", "display", "targets", "presence", "replay")}
        frames = [{"id": s, "sensed": entry["sensed"]} for s in entry["scenes"]]
        print(f"  {pid} ({entry['role']}), from {out}", flush=True)
        built[pid] = summarise(entry, doc["bounds"], frames, stretch, doc["ours"], doc["gfw"], fixes, n_tracks, products,
                               reserve, None, imaged)
    history = fleet = None
    if (out / "history_v1.json").exists():
        h = json.loads((out / "history_v1.json").read_text())
        history = {"key": f"{PREFIX}/history_v1.json", "bytes": (out / "history_v1.json").stat().st_size,
                   "dark_cells": len(h["dark"]["rows"]), "gaps": len(h["gaps"]["rows"]), "seconds": None}
    if (out / "fleet_v1.json").exists():
        f = json.loads((out / "fleet_v1.json").read_text())
        fleet = {"key": f"{PREFIX}/fleet_v1.json", "bytes": (out / "fleet_v1.json").stat().st_size,
                 "cells": len(f["rows"]), "seconds": None}
    return {"built": built, "history": history, "fleet": fleet}


# --- evidence chips -------------------------------------------------------------------------------

CHIP_HALF_DEG = 0.006        # 1.3 km across
CHIP_STEP = 0.0001           # about 11 m, close to the GRD's 10 m


def cut_chips(rec: dict, out: Path) -> dict:
    """A north-up chip at 10 m round each of our targets inside the reserve, for inspect_image and the
    evidence gallery: <pass>_chip_<id>.tif, uint8 1..255 stretched on the chip's own sea."""
    pid = rec["pass_id"]
    data = json.loads((out / f"{pid}_targets.json").read_text())
    wanted = [o for o in data["ours"] if o["in_reserve"]]
    if not wanted:
        return {}
    items = {i["id"]: i for i in stac_scenes([f["id"] for f in rec["frames"]])}
    token = json.load(urllib.request.urlopen(SAS, timeout=30))["token"]
    chips = {}
    opened = {}
    env = rasterio.Env(**GDAL_ENV)
    env.__enter__()
    try:
        for o in wanted:
            it = next((i for i in items.values() if shape(i["geometry"]).contains(Point(o["lon"], o["lat"]))), None)
            if it is None:
                continue
            if it["id"] not in opened:
                ds = rasterio.open("/vsicurl/" + it["assets"]["vv"]["href"] + "?" + token)
                opened[it["id"]] = (ds, GCPTransformer(ds.gcps[0]), ds.gcps)
            ds, tr, (gcps, crs) = opened[it["id"]]
            r, c = tr.rowcol(o["lon"], o["lat"])
            half = 90
            r0, c0 = max(0, r - half), max(0, c - half)
            win = Window(c0, r0, min(2 * half, ds.width - c0), min(2 * half, ds.height - r0))
            src = ds.read(1, window=win).astype(np.float32)
            sg = [GroundControlPoint(row=p.row - r0, col=p.col - c0, x=p.x, y=p.y) for p in gcps]
            n_px = int(round(2 * CHIP_HALF_DEG / CHIP_STEP))
            transform = from_origin(o["lon"] - CHIP_HALF_DEG, o["lat"] + CHIP_HALF_DEG, CHIP_STEP, CHIP_STEP)
            dst = np.zeros((n_px, n_px), dtype=np.float32)
            reproject(src, dst, gcps=sg, src_crs=crs, dst_transform=transform, dst_crs="EPSG:4326",
                      resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
            have = dst > 0
            if have.mean() < 0.5:
                continue
            db = cfar.to_db(np.where(have, dst, 1.0))
            lo, hi = np.percentile(db[have], [2, 99.5])
            chip = np.zeros(dst.shape, dtype=np.uint8)
            chip[have] = (1 + np.clip((db[have] - lo) / max(hi - lo, 1e-6), 0, 1) * 254).astype(np.uint8)
            path = out / f"{pid}_chip_{o['id']}.tif"
            with rasterio.open(path, "w", driver="GTiff", width=n_px, height=n_px, count=1, dtype="uint8", crs="EPSG:4326",
                               transform=transform, nodata=0, compress="DEFLATE") as w:
                w.write(chip, 1)
                w.update_tags(SOURCE="Copernicus Sentinel data (ESA), via Microsoft Planetary Computer", PASS=pid,
                              TARGET=o["id"], NOTE="VV at 10 m, north up, stretched on the chip")
            chips[o["id"]] = f"{PREFIX}/{path.name}"
    finally:
        for ds, _, _ in opened.values():
            ds.close()
        env.__exit__(None, None, None)
    print(f"  {pid}: {len(chips)} chips", flush=True)
    return chips


# --- history --------------------------------------------------------------------------------------

def _positive(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


def _instant(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def gap_row(e: dict, rp) -> dict | None:
    """One AIS-off event as a history row (type only, no identity), or None when its off position or
    start cannot be read. Hours, km and knots are GFW's own when it gives them; GFW's gaps events have
    carried them as null since at least Oct 21 2026 (task 10's finding: v1r's rebuild had 0 on every
    row), so each falls back to what the event itself records: hours from start to end, km between the
    off and on positions (great circle), knots from the two. v1's rows, from Oct 16, match that within
    0.07 h and 0.06 km."""
    g = e.get("gap") or {}
    off, on = g.get("offPosition") or {}, g.get("onPosition") or {}
    try:
        off_pt = (float(off["lon"]), float(off["lat"]))
        on_pt = (float(on["lon"]), float(on["lat"])) if on.get("lon") not in (None, "") else None
        start = _instant(e["start"])
        end = _instant(e["end"]) if e.get("end") else None
    except (KeyError, TypeError, ValueError):
        return None
    hours = _positive(g.get("durationHours")) or (max(0.0, (end - start).total_seconds() / 3600) if end else 0.0)
    dist = _positive(g.get("distanceKm")) or (km(off_pt, on_pt) if on_pt else 0.0)
    kn = _positive(g.get("impliedSpeedKnots")) or (dist / hours / 1.852 if hours > 0 and dist > 0 else 0.0)
    return {"start": e["start"][:16] + "Z", "end": (e.get("end") or "")[:16] + ("Z" if e.get("end") else ""),
            "type": str((e.get("vessel") or {}).get("type") or "unknown").lower(),
            "off": [round(off_pt[0], 4), round(off_pt[1], 4)],
            "on": [round(on_pt[0], 4), round(on_pt[1], 4)] if on_pt else None,
            "hours": round(hours, 1), "km": round(dist, 1), "kn": round(kn, 1),
            "intentional": bool(g.get("intentionalDisabling")),
            "starts_in_reserve": rp.contains(Point(*off_pt))}


def build_history(out: Path, until: date, reserve, ports) -> dict:
    started = time.time()
    rp = prep(reserve)
    dark = []
    for a, b in windows(HISTORY_FROM, until):
        rep = gfw.report(SAR, {"dataset": "public-mpa-all", "id": 11753}, f"{a},{b}", "DAILY", "HIGH",
                         group_by="GEARTYPE", filters="matched='false'")
        for r in rows_of(rep):
            lon, lat = round(float(r["lon"]), 5), round(float(r["lat"]), 5)
            dark.append([r["date"][:10], lon, lat, int(r.get("detections", 1)), round(min(km((lon, lat), p) for p in ports), 1)])
        time.sleep(1)
    print(f"  history: {len(dark)} dark detection cells in the reserve since {HISTORY_FROM}", flush=True)
    gaps = []
    geom = mapping(box(*GAPS_BOX))
    for a, b in windows(HISTORY_FROM, until):
        for e in gfw.events(GAPS, geom, a.isoformat(), b.isoformat()):
            rec = gap_row(e, rp)
            if rec:
                gaps.append(rec)
        time.sleep(1)
    print(f"  history: {len(gaps)} AIS-off events near the reserve since {HISTORY_FROM} "
          f"({sum(g['intentional'] for g in gaps)} intentional)", flush=True)
    size = write_json(out / "history_v1.json", {
        "built": date.today().isoformat(), "until": until.isoformat(),
        "dark": {"fields": ["day", "lon", "lat", "n", "port_km"], "rows": dark,
                 "note": "GFW SAR detections with no AIS match inside the reserve (region public-mpa-all 11753), 0.01 deg"},
        "gaps": {"rows": gaps, "box": list(GAPS_BOX),
                 "note": "GFW AIS-off (gap) events: where AIS went off and came back on; type only"}})
    return {"key": f"{PREFIX}/history_v1.json", "bytes": size, "dark_cells": len(dark), "gaps": len(gaps),
            "seconds": round(time.time() - started, 1)}


def build_fleet(out: Path, until: date) -> dict:
    started = time.time()
    cells = []
    for a, b in windows(FLEET_FROM, until):
        rep = gfw.report(EFFORT, fc_box(FLEET_BOX), f"{a},{b}", "MONTHLY", "LOW", group_by="GEARTYPE",
                         filters="geartype in ('squid_jigger')")
        for r in rows_of(rep):
            h = float(r.get("hours") or 0)
            if h > 0:
                cells.append([r["date"][:7], round(float(r["lon"]), 2), round(float(r["lat"]), 2), round(h, 1)])
        time.sleep(1)
    print(f"  fleet: {len(cells)} squid-jigger month-cells since {FLEET_FROM}", flush=True)
    size = write_json(out / "fleet_v1.json", {
        "built": date.today().isoformat(), "until": until.isoformat(), "box": list(FLEET_BOX),
        "fields": ["month", "lon", "lat", "hours"], "rows": cells,
        "note": "GFW apparent fishing effort, squid jiggers, 0.1 deg cells by month"})
    return {"key": f"{PREFIX}/fleet_v1.json", "bytes": size, "cells": len(cells), "seconds": round(time.time() - started, 1)}


# --- the scan, the upload, the manifest ----------------------------------------------------------

def scan(out: Path) -> list[str]:
    problems = []
    for p in sorted(out.iterdir()):
        if p.suffix == ".json":
            text = p.read_text()
        elif p.suffix == ".tif":
            with rasterio.open(p) as ds:
                text = json.dumps(ds.tags())
        else:
            continue
        problems += [f"{p.name}: {f}" for f in gfw.scan_identity(text)]
    return problems


def update_passes(on_file: dict, built: dict) -> None:
    """The build's counts (both detectors) back into data/passes_v1.json; provisional no more."""
    for e in on_file["passes"] + [on_file["silent_vessel"]]:
        b = built.get(e["pass_id"])
        if b:
            e["build"] = {"counts": b["counts"], "pair_km_median": b["pair_km_median"], "built": date.today().isoformat()}
            e["provisional"] = False
    PASSES.write_text(json.dumps(on_file, ensure_ascii=False, indent=1) + "\n")
    print(f"updated {PASSES.relative_to(ROOT)}")


def bucket_name(arg: str | None) -> str:
    if arg:
        return arg
    for line in (ROOT / "agents" / "methane-hunter" / ".env.dev").read_text().splitlines():
        if line.strip().lstrip("\ufeff").startswith("S3_BUCKET_NAME="):
            return line.split("=", 1)[1].strip().strip('"\'')
    raise SystemExit("no bucket (pass --bucket)")


def _s3():
    import boto3
    return boto3.client("s3")


def valid_prefix(prefix: str) -> str:
    if not isinstance(prefix, str) or not PREFIX_RE.fullmatch(prefix):
        raise SystemExit(f"not a vessel cache prefix: {prefix!r} (must match {PREFIX_RE.pattern})")
    return prefix


def _backup_folder(day: str) -> str:
    try:
        ok = re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) and date.fromisoformat(day)
    except ValueError:
        ok = False
    if not ok:
        raise SystemExit(f"not a date: {day!r} (YYYY-MM-DD)")
    return f"{PREFIX}/backup-{day}"


def _has(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def _copy(s3, bucket: str, src: str, dst: str, dry: bool) -> None:
    print(f"  {'[dry-run] ' if dry else ''}copy s3://{bucket}/{src} -> {dst}", flush=True)
    if not dry:
        s3.copy_object(Bucket=bucket, Key=dst, CopySource={"Bucket": bucket, "Key": src})


def backup(bucket: str, day: str, dry: bool) -> int:
    """The manifest, history, fleet and rest copied server-side into <prefix>/backup-<date>/. Refuses a
    folder that already holds anything, so a backup is never written over."""
    s3 = _s3()
    folder = _backup_folder(day)
    if s3.list_objects_v2(Bucket=bucket, Prefix=f"{folder}/", MaxKeys=1).get("Contents"):
        raise SystemExit(f"s3://{bucket}/{folder}/ already exists: a backup is never written over (pick another date)")
    if not _has(s3, bucket, f"{PREFIX}/manifest.json"):
        raise SystemExit(f"no manifest at s3://{bucket}/{PREFIX}/: nothing to back up")
    copied = 0
    for name in BACKUP_FILES:
        if _has(s3, bucket, f"{PREFIX}/{name}"):
            _copy(s3, bucket, f"{PREFIX}/{name}", f"{folder}/{name}", dry)
            copied += 1
        else:
            print(f"  {name}: not under {PREFIX}/; not backed up", flush=True)
    print(f"{'[dry-run] ' if dry else ''}backed up {copied} files to s3://{bucket}/{folder}/")
    return 0


def restore(bucket: str, day: str, dry: bool) -> int:
    """A backup's files copied back over the live ones (the rerun's no-go). Nothing is deleted: a new
    pass's products stay in the bucket, unlisted by the restored manifest."""
    s3 = _s3()
    folder = _backup_folder(day)
    if not _has(s3, bucket, f"{folder}/manifest.json"):
        raise SystemExit(f"no backup at s3://{bucket}/{folder}/")
    for name in BACKUP_FILES:
        if _has(s3, bucket, f"{folder}/{name}"):
            _copy(s3, bucket, f"{folder}/{name}", f"{PREFIX}/{name}", dry)
    print(f"{'[dry-run] ' if dry else ''}restored s3://{bucket}/{PREFIX}/ from {folder}/")
    return 0


def seed(bucket: str, seed_from: str, dry: bool) -> int:
    """Task 9a: the rehearsal prefix starts from another prefix's manifest, and only that. Its records
    keep pointing at that prefix's objects, which nothing here writes."""
    s3 = _s3()
    seed_from = valid_prefix(seed_from)
    if seed_from == PREFIX:
        raise SystemExit("--seed-from names the prefix being written: pass --prefix")
    if _has(s3, bucket, f"{PREFIX}/manifest.json"):
        raise SystemExit(f"s3://{bucket}/{PREFIX}/manifest.json already exists: a seed never writes over a manifest")
    if not _has(s3, bucket, f"{seed_from}/manifest.json"):
        raise SystemExit(f"no manifest at s3://{bucket}/{seed_from}/")
    _copy(s3, bucket, f"{seed_from}/manifest.json", f"{PREFIX}/manifest.json", dry)
    return 0


def backfill_imaged(bucket: str, entries: list[dict], reserve, dry: bool) -> int:
    """Every built pass's metadata and imaged cells into the manifest, from its display in the bucket
    (so it does not rely on /tmp/vessels_cache/v1/ surviving). Adds fields; changes no other."""
    from rasterio.io import MemoryFile
    s3 = _s3()
    key = f"{PREFIX}/manifest.json"
    manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    grid, water = reserve_grid(reserve)
    on_file = {e["pass_id"]: e for e in entries}
    for pid, rec in manifest["passes"].items():
        t0 = time.time()
        body = s3.get_object(Bucket=bucket, Key=rec["products"]["display"]["key"])["Body"].read()
        with MemoryFile(body) as mf, mf.open() as ds:
            imaged = imaged_mask(ds.read(1), ds.transform, grid, water)
        rec.update(**(pass_meta(on_file[pid]) if pid in on_file else {}), **imaged_fields(imaged, grid, water))
        print(f"  {pid}: imaged {rec['imaged_share']:.1%} of the reserve ({int(imaged.sum())} cells, "
              f"{len(rec['imaged_cells'])} runs){'' if pid in on_file else '; not on file, no metadata'} "
              f"({time.time() - t0:.0f}s)", flush=True)
    body = json.dumps(manifest, indent=1)
    if gfw.scan_identity(body):
        raise SystemExit("the manifest failed the identity scan")
    if dry:
        print(f"[dry-run] manifest not written ({len(body) / 1e3:.0f} kB)")
        return 0
    s3.put_object(Bucket=bucket, Key=key, Body=body.encode(), ContentType="application/json")
    print(f"wrote s3://{bucket}/{key}: {len(manifest['passes'])} passes with their imaged cells")
    return 0


def main(argv: list[str] | None = None) -> int:
    global PREFIX
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pass", dest="passes", action="append", help="build only these pass ids (repeatable)")
    ap.add_argument("--history", action="store_true", help="build the history and the fleet only")
    ap.add_argument("--dry-run", action="store_true", help=f"build into {LOCAL} and upload nothing")
    ap.add_argument("--update-passes", action="store_true", help="write the build's counts back into data/passes_v1.json")
    ap.add_argument("--until", default="2026-10-13", help="the newest day on file, exclusive (default 2026-10-13)")
    ap.add_argument("--upload-local", action="store_true", help=f"upload the last --dry-run's files from {LOCAL} (scanned again)")
    ap.add_argument("--chips", action="store_true", help=f"cut the evidence chips for the passes of the last build in {LOCAL}")
    ap.add_argument("--records-from-local", action="store_true",
                    help=f"rebuild the manifest records (and --update-passes) from the files in {LOCAL}, reading nothing remote")
    ap.add_argument("--display", action="store_true",
                    help=f"rebuild every pass's display from its vv in {LOCAL} (the radar over its local sea) and upload only those")
    ap.add_argument("--imaged", action="store_true",
                    help="each built pass's metadata and imaged cells into the manifest, from its display in the bucket")
    ap.add_argument("--backup", metavar="DATE", help="copy the manifest, history, fleet and rest to <prefix>/backup-DATE/")
    ap.add_argument("--restore", metavar="DATE", help="copy them back from <prefix>/backup-DATE/ (nothing is deleted)")
    ap.add_argument("--prefix", default=PREFIX, help=f"where every write goes (default {PREFIX}; task 9a: vessels/cache/v1r)")
    ap.add_argument("--seed-from", metavar="PREFIX", help="start --prefix from this prefix's manifest only (task 9a)")
    ap.add_argument("--bucket")
    args = ap.parse_args(argv)
    PREFIX = valid_prefix(args.prefix)
    actions = [a for a in ("backup", "restore", "seed_from", "imaged") if getattr(args, a)]
    if len(actions) > 1:
        raise SystemExit(f"one of --backup, --restore, --seed-from and --imaged at a time (got {', '.join(actions)})")
    if args.backup:
        return backup(bucket_name(args.bucket), args.backup, args.dry_run)
    if args.restore:
        return restore(bucket_name(args.bucket), args.restore, args.dry_run)
    if args.seed_from:
        return seed(bucket_name(args.bucket), args.seed_from, args.dry_run)
    if args.imaged:
        on_file = json.loads(PASSES.read_text())
        reserve, _, _ = records()
        return backfill_imaged(bucket_name(args.bucket), on_file["passes"] + [on_file["silent_vessel"]], reserve, args.dry_run)
    if args.display:
        sizes = rebuild_displays(LOCAL)
        problems = scan(LOCAL)
        if problems:
            raise SystemExit(f"the identity scan found {len(problems)} problem(s): nothing uploaded")
        if args.dry_run:
            return 0
        return upload_displays(LOCAL, bucket_name(args.bucket), sizes)
    if args.records_from_local:
        on_file = json.loads(PASSES.read_text())
        reserve, _, _ = records()
        rec = records_from_local(LOCAL, on_file["passes"] + [on_file["silent_vessel"]], reserve, date.fromisoformat(args.until))
        RECORDS_OUT.write_text(json.dumps(rec, indent=1))
        if args.update_passes:
            update_passes(on_file, rec["built"])
        return 0
    if args.chips:
        rec = json.loads(RECORDS_OUT.read_text())
        for pid, b in rec["built"].items():
            b["chips"] = cut_chips(b, LOCAL)
        RECORDS_OUT.write_text(json.dumps(rec, indent=1))
        problems = scan(LOCAL)
        if problems:
            raise SystemExit(f"the identity scan found {len(problems)} problem(s)")
        return 0
    if args.upload_local:
        rec = json.loads(RECORDS_OUT.read_text())
        problems = scan(LOCAL)
        if problems:
            raise SystemExit(f"the identity scan found {len(problems)} problem(s): nothing uploaded")
        return upload(LOCAL, bucket_name(args.bucket), rec["built"], rec.get("history"), rec.get("fleet"))

    until = date.fromisoformat(args.until)
    on_file = json.loads(PASSES.read_text())
    entries = on_file["passes"] + [on_file["silent_vessel"]]
    if args.passes:
        unknown = set(args.passes) - {e["pass_id"] for e in entries}
        if unknown:
            raise SystemExit(f"not on file: {sorted(unknown)}")
        entries = [e for e in entries if e["pass_id"] in args.passes]
    if args.history:
        entries = []
    bucket = None if args.dry_run else bucket_name(args.bucket)
    reserve, ports, land = records()
    out = LOCAL
    out.mkdir(parents=True, exist_ok=True)
    for p in out.iterdir():
        p.unlink()

    built, failed = {}, []
    for entry in entries:
        try:
            built[entry["pass_id"]] = build_pass(entry, out, reserve, ports, land)
        except (Exception, SystemExit) as e:  # one pass's failure is reported, never fatal to the rest
            print(f"    {entry['pass_id']}: {type(e).__name__}: {str(e)[:300]}", flush=True)
            failed.append(entry["pass_id"])
    history = fleet = None
    if args.history or not args.passes:
        history = build_history(out, until, reserve, ports)
        fleet = build_fleet(out, until)

    problems = scan(out)
    if problems:
        for p in problems:
            print("  IDENTITY:", p)
        raise SystemExit(f"the identity scan found {len(problems)} problem(s): nothing uploaded")
    total = sum(p.stat().st_size for p in out.iterdir())
    print(f"scan clean: {len(list(out.iterdir()))} files, {total / 1e6:.1f} MB in {out}")

    if args.update_passes and built:
        update_passes(on_file, built)

    RECORDS_OUT.write_text(json.dumps({"built": built, "history": history, "fleet": fleet}, indent=1))
    if args.dry_run:
        return 1 if failed else 0
    return upload(out, bucket, built, history, fleet) or (1 if failed else 0)


def stray_keys(built: dict, history: dict | None, fleet: dict | None) -> list[str]:
    """Record keys outside the prefix being written: records built for another prefix (a --dry-run
    with one --prefix, then --upload-local with another) would point the manifest at files not there."""
    keys = [p["key"] for rec in built.values() for p in rec["products"].values()]
    keys += [k for rec in built.values() for k in (rec.get("chips") or {}).values()]
    keys += [r["key"] for r in (history, fleet) if r]
    return [k for k in keys if k.rsplit("/", 1)[0] != PREFIX]


def upload(out: Path, bucket: str, built: dict, history: dict | None, fleet: dict | None) -> int:
    stray = stray_keys(built, history, fleet)
    if stray:
        raise SystemExit(f"{len(stray)} record key(s) are not under {PREFIX}/ (e.g. {stray[0]}): rebuild with this "
                         f"--prefix; nothing uploaded")
    s3 = _s3()
    for p in sorted(out.iterdir()):
        ctype = "image/tiff" if p.suffix == ".tif" else "application/json"
        s3.upload_file(str(p), bucket, f"{PREFIX}/{p.name}", ExtraArgs={"ContentType": ctype})
    key = f"{PREFIX}/manifest.json"
    try:
        manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    except s3.exceptions.NoSuchKey:
        manifest = {"version": "v1", "passes": {}}
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for pid, rec in built.items():
        manifest["passes"][pid] = {**rec, "built_at": stamp}
    if history:
        manifest["history"] = {**history, "built_at": stamp}
    if fleet:
        manifest["fleet"] = {**fleet, "built_at": stamp}
    body = json.dumps(manifest, indent=1)
    if gfw.scan_identity(body):
        raise SystemExit("the manifest failed the identity scan")
    s3.put_object(Bucket=bucket, Key=key, Body=body.encode(), ContentType="application/json")
    print(f"uploaded {len(list(out.iterdir()))} files to s3://{bucket}/{PREFIX}/; manifest: {len(manifest['passes'])} passes")
    return 0


def upload_displays(out: Path, bucket: str, sizes: dict[str, int]) -> int:
    """Only the rebuilt displays, and their sizes and stretch in the manifest."""
    s3 = _s3()
    key = f"{PREFIX}/manifest.json"
    manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    for pid, size in sizes.items():
        rec = manifest["passes"].get(pid)
        if not rec:
            print(f"  {pid}: not in the manifest; skipped")
            continue
        s3.upload_file(str(out / f"{pid}_display.tif"), bucket, f"{PREFIX}/{pid}_display.tif", ExtraArgs={"ContentType": "image/tiff"})
        rec["products"]["display"]["bytes"] = size
        rec["display"] = {"over_local_sea_db": list(FLAT_RANGE_DB), "block_km": 17}
    body = json.dumps(manifest, indent=1)
    if gfw.scan_identity(body):
        raise SystemExit("the manifest failed the identity scan")
    s3.put_object(Bucket=bucket, Key=key, Body=body.encode(), ContentType="application/json")
    print(f"uploaded {len(sizes)} displays to s3://{bucket}/{PREFIX}/ and the manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
