#!/usr/bin/env python3
"""Pre-render each catalogue site's terrain from USGS 3DEP 1 m LiDAR into the project bucket.

    AWS_PROFILE=main .venv/bin/python scripts/build_site_catalogue.py --dry-run      # coverage only
    AWS_PROFILE=main .venv/bin/python scripts/build_site_catalogue.py                # every site
    AWS_PROFILE=main .venv/bin/python scripts/build_site_catalogue.py --site newark-great-circle

Per site (agents/ai-archaeologist/data/sites_v1.json): the TNM Access API names the 1 m DEM tiles
over the site frame; each tile (a public COG on prd-tnm S3) is read in place for that window only,
reprojected to the site's UTM zone at 1 m, newest project first and older ones filling its gaps.
Three products are written as COGs to s3://<bucket>/archaeology/cache/v1/:

    <id>_dem.tif         float32 metres, nodata -9999
    <id>_hillshade.tif   uint8, Horn's method, sun azimuth 315, altitude 45 (0 = nodata)
    <id>_lrm.tif         float32 metres: the DEM minus its 21 x 21 m mean (the spike's 20 m
                         low-pass), the bank-and-ditch signature at the scale of earthworks

plus manifest.json (tiles used, bounds, nodata share, LRM percentiles, seconds, bytes) and local
previews under /tmp/arch_preview/ for verifying centres and transects by eye. Nothing here runs on
stage: the agent only copies these files into a session (design decision 3).
"""
import argparse
import json
import math
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
import numpy as np
import rasterio
import rasterio.errors
import requests
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform as warp_transform, transform_bounds
from rasterio.windows import Window, from_bounds

REPO = Path(__file__).resolve().parents[1]
CATALOGUE = REPO / "agents" / "ai-archaeologist" / "data" / "sites_v1.json"
CACHE_PREFIX = "archaeology/cache/v1"
TNM = "https://tnmaccess.nationalmap.gov/api/v1/products"
DATASET = "Digital Elevation Model (DEM) 1 meter"
NODATA = -9999.0
LOWPASS_M = 21              # odd box size in metres (1 m pixels): the spike's 20 m average
PREVIEW = Path("/tmp/arch_preview")
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE")


def utm_epsg(lat: float, lon: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def site_grid(site: dict):
    """The site's 1 m grid in its UTM zone, centred on the catalogue centre."""
    lat, lon = site["centre"]["lat"], site["centre"]["lon"]
    half = int(site.get("frame_half_m", 1250))
    epsg = utm_epsg(lat, lon)
    xs, ys = warp_transform("EPSG:4326", f"EPSG:{epsg}", [lon], [lat])
    x0, y0 = round(xs[0]) - half, round(ys[0]) + half
    return epsg, from_origin(x0, y0, 1.0, 1.0), 2 * half, 2 * half


def tiles_for(bounds_ll) -> list[dict]:
    w, s, e, n = bounds_ll
    r = requests.get(TNM, params={"datasets": DATASET, "bbox": f"{w},{s},{e},{n}", "max": 50}, timeout=60)
    r.raise_for_status()
    items = [i for i in r.json().get("items", []) if str(i.get("downloadURL", "")).lower().endswith(".tif")]
    # Newest project first: a later flight fills nothing an earlier one already covers better.
    return sorted(items, key=lambda i: i.get("publicationDate") or "", reverse=True)


def read_into(dst: np.ndarray, epsg: int, dst_transform, url: str) -> int:
    """Read the tile's window over the site grid and fill dst's empty pixels; returns pixels filled."""
    h, w = dst.shape
    left, top = dst_transform.c, dst_transform.f
    bounds = (left, top - h, left + w, top)
    with rasterio.Env(**GDAL_ENV), rasterio.open("/vsicurl/" + url) as src:
        sb = transform_bounds(f"EPSG:{epsg}", src.crs, *bounds, densify_pts=21)
        win = from_bounds(*sb, transform=src.transform).round_offsets().round_lengths()
        try:
            win = win.intersection(Window(0, 0, src.width, src.height))
        except rasterio.errors.WindowError:   # TNM lists a tile whose footprint only grazes the frame
            return 0
        pad = 4
        win = Window(max(0, win.col_off - pad), max(0, win.row_off - pad),
                     min(src.width - max(0, win.col_off - pad), win.width + 2 * pad),
                     min(src.height - max(0, win.row_off - pad), win.height + 2 * pad))
        data = src.read(1, window=win).astype("float32")
        src_nodata = src.nodata if src.nodata is not None else NODATA
        data[(data == src_nodata) | ~np.isfinite(data)] = NODATA
        part = np.full(dst.shape, NODATA, dtype="float32")
        reproject(data, part, src_transform=src.window_transform(win), src_crs=src.crs, src_nodata=NODATA,
                  dst_transform=dst_transform, dst_crs=f"EPSG:{epsg}", dst_nodata=NODATA,
                  resampling=Resampling.bilinear)
    fill = (dst == NODATA) & (part != NODATA)
    dst[fill] = part[fill]
    return int(fill.sum())


def hillshade(dem: np.ndarray, azimuth: float = 315.0, altitude: float = 45.0) -> np.ndarray:
    """Horn's method on a 1 m grid; uint8 1..255, 0 where the DEM or a neighbour is nodata."""
    valid = dem != NODATA
    z = np.where(valid, dem, np.nan).astype("float64")
    p = np.pad(z, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / 8.0
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / 8.0
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    zen, az = math.radians(90.0 - altitude), math.radians((360.0 - azimuth + 90.0) % 360.0)
    shade = np.cos(zen) * np.cos(slope) + np.sin(zen) * np.sin(slope) * np.cos(az - aspect)
    out = np.clip(1 + 254 * np.clip(shade, 0, 1), 1, 255)
    out[~np.isfinite(out)] = 0
    return out.astype("uint8")


def box_mean(dem: np.ndarray, size: int) -> np.ndarray:
    """Mean of the valid pixels in a size x size box (integral images; nodata ignored)."""
    valid = (dem != NODATA).astype("float64")
    vals = np.where(dem != NODATA, dem, 0).astype("float64")
    r = size // 2

    def boxsum(arr):
        s = np.pad(arr, ((r + 1, r), (r + 1, r)), mode="constant").cumsum(0).cumsum(1)
        return s[size:, size:] - s[:-size, size:] - s[size:, :-size] + s[:-size, :-size]

    total, count = boxsum(vals), boxsum(valid)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def lrm(dem: np.ndarray) -> np.ndarray:
    low = box_mean(dem, LOWPASS_M)
    out = (dem - low).astype("float32")
    out[(dem == NODATA) | ~np.isfinite(out)] = NODATA
    return out


def write_cog(path: Path, arr: np.ndarray, epsg: int, transform, nodata, resampling: str) -> int:
    profile = dict(driver="COG", width=arr.shape[1], height=arr.shape[0], count=1, dtype=arr.dtype.name,
                   crs=f"EPSG:{epsg}", transform=transform, nodata=nodata, compress="DEFLATE",
                   blocksize=512, overview_resampling=resampling, BIGTIFF="IF_SAFER")
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(arr, 1)
    return path.stat().st_size


def preview_png(path: Path, arr: np.ndarray, kind: str, step: int) -> None:
    """A small PNG to verify the frame by eye (not shipped)."""
    from PIL import Image
    a = arr[::step, ::step]
    if kind == "hillshade":
        img = Image.fromarray(a)
    else:  # LRM on TiTiler's rdbu_r, pinned at +-1 m like the map
        anchors = np.array([[5, 48, 97], [107, 172, 208], [247, 246, 246], [229, 131, 104], [103, 0, 31]], "float64")
        t = np.clip((np.where(a == NODATA, 0, a) + 1.0) / 2.0, 0, 1) * 4
        lo = np.floor(t).astype(int).clip(0, 3)
        frac = (t - lo)[..., None]
        rgb = anchors[lo] * (1 - frac) + anchors[lo + 1] * frac
        rgb[a == NODATA] = 40
        img = Image.fromarray(rgb.astype("uint8"))
    img.save(path)


def build(site: dict, bucket: str, dry: bool) -> dict:
    started = time.time()
    epsg, transform, w, h = site_grid(site)
    left, top = transform.c, transform.f
    bounds_ll = transform_bounds(f"EPSG:{epsg}", "EPSG:4326", left, top - h, left + w, top, densify_pts=21)
    tiles = tiles_for(bounds_ll)
    rec = {"id": site["id"], "epsg": epsg, "bounds": [round(v, 6) for v in bounds_ll], "size": [w, h],
           "tiles_found": [t.get("title") for t in tiles]}
    if not tiles:
        return {**rec, "status": "no_1m_coverage", "seconds": round(time.time() - started, 1)}
    if dry:
        return {**rec, "status": "dry_run", "seconds": round(time.time() - started, 1)}
    dem = np.full((h, w), NODATA, dtype="float32")
    used = []
    for t in tiles:
        filled = read_into(dem, epsg, transform, t["downloadURL"])
        if filled:
            used.append({"title": t.get("title"), "publication_date": t.get("publicationDate"),
                         "url": t["downloadURL"], "pixels": filled})
        if not (dem == NODATA).any():
            break
    nodata_pct = round(100 * float((dem == NODATA).mean()), 2)
    if nodata_pct >= 99:
        return {**rec, "status": "no_1m_data_in_frame", "seconds": round(time.time() - started, 1)}
    shade, relief = hillshade(dem), lrm(dem)
    rv = relief[relief != NODATA]
    out = {**rec, "status": "built", "tiles": used, "nodata_pct": nodata_pct,
           "dem_range_m": [round(float(dem[dem != NODATA].min()), 2), round(float(dem[dem != NODATA].max()), 2)],
           "lrm_p01_p99_m": [round(float(np.percentile(rv, 1)), 2), round(float(np.percentile(rv, 99)), 2)],
           "products": {}}
    s3 = boto3.client("s3")
    PREVIEW.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for product, arr, nod, res in (("dem", dem, NODATA, "AVERAGE"), ("hillshade", shade, 0, "AVERAGE"),
                                        ("lrm", relief, NODATA, "AVERAGE")):
            path = Path(tmp) / f"{site['id']}_{product}.tif"
            size = write_cog(path, arr, epsg, transform, nod, res)
            key = f"{CACHE_PREFIX}/{site['id']}_{product}.tif"
            s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": "image/tiff"})
            out["products"][product] = {"key": key, "bytes": size}
    step = max(1, max(w, h) // 1000)
    preview_png(PREVIEW / f"{site['id']}_hillshade.png", shade, "hillshade", step)
    preview_png(PREVIEW / f"{site['id']}_lrm.png", relief, "lrm", step)
    out["seconds"] = round(time.time() - started, 1)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--site", action="append", help="build only these site ids (repeatable)")
    ap.add_argument("--dry-run", action="store_true", help="query 1 m coverage only; read and write nothing")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--bucket", help="defaults to S3_BUCKET_NAME from agents/methane-hunter/.env.dev")
    args = ap.parse_args()

    sites = json.loads(CATALOGUE.read_text())["sites"]
    if args.site:
        unknown = set(args.site) - {s["id"] for s in sites}
        if unknown:
            raise SystemExit(f"unknown site ids: {sorted(unknown)}")
        sites = [s for s in sites if s["id"] in args.site]
    bucket = args.bucket
    if not bucket:
        for line in (REPO / "agents" / "methane-hunter" / ".env.dev").read_text().splitlines():
            if line.strip().lstrip("\ufeff").startswith("S3_BUCKET_NAME="):
                bucket = line.split("=", 1)[1].strip().strip('"\'')
    if not bucket:
        raise SystemExit("no bucket (pass --bucket)")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for rec in pool.map(lambda s: _safe(build, s, bucket, args.dry_run), sites):
            results.append(rec)
            extra = (f"{rec.get('nodata_pct')}% empty, LRM p1/p99 {rec.get('lrm_p01_p99_m')}, "
                     f"{len(rec.get('tiles', []))} tile(s)" if rec.get("status") == "built"
                     else f"{len(rec.get('tiles_found', []))} tile(s) found")
            print(f"{rec['id']:32s} {rec.get('status'):20s} {rec.get('seconds', 0):6.1f}s  {extra}", flush=True)

    if not args.dry_run:
        s3 = boto3.client("s3")
        key = f"{CACHE_PREFIX}/manifest.json"
        try:
            manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
        except s3.exceptions.NoSuchKey:
            manifest = {"version": "v1", "sites": {}}
        for rec in results:
            if rec.get("status") == "built":
                manifest["sites"][rec["id"]] = {**rec, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(manifest, indent=1).encode(),
                      ContentType="application/json")
        print(f"manifest: s3://{bucket}/{key} ({len(manifest['sites'])} sites)")
    return 0 if all(r.get("status") in ("built", "dry_run") for r in results) else 1


def _safe(fn, site, bucket, dry):
    try:
        return fn(site, bucket, dry)
    except Exception as e:  # one site's failure is reported, never fatal to the rest
        print(f"  {site['id']}: {type(e).__name__}: {str(e)[:200]}", flush=True)
        return {"id": site["id"], "status": f"error:{type(e).__name__}", "detail": str(e)[:200]}


if __name__ == "__main__":
    sys.exit(main())
