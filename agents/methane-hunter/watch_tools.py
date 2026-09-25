"""Methane Watch tools: the baseline of sites, site history, TROPOMI tip, EMIT cue on recent passes.

Act 2 v2 (requirements 8-9). Data, all public except LP DAAC downloads (Earthdata token):
  - EMIT L2B CH4PLM plume complexes (NASA-outlined plumes, 2022-08 .. 2024; +1 in 2025) via CMR.
  - EMIT L2B CH4ENH raw enhancement scenes (+ CH4UNCERT), which continue through 2026, via CMR
    and LP DAAC: where the plume product stops, the agent reads the recent passes itself.
  - Sentinel-5P TROPOMI CH4 as Cloud-Optimized GeoTIFFs on the Registry of Open Data on AWS
    (s3://meeo-s5p/COGT/OFFL/L2__CH4___/, public, read over HTTPS): daily, global, ~4 km.

Security, as in methane_tools: every argument validated; every URL built here from validated
ids and dates (never taken from CMR, a listing value or the model); the token goes to LP DAAC
only; downloads capped and bounded; the browser only ever reads our bucket (composites and
windows are staged to session_data/, so the backend's S3 read allowlist is unchanged).
"""
from __future__ import annotations


import json
import logging
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

import _paths  # noqa: F401
import httpx
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from strands import tool

import config
import methane_tools as mt
from methane_tools import MethaneError, _finite, _int, parse_bbox, parse_day

logger = logging.getLogger("methane_tools")

# --- constants ------------------------------------------------------------------------------

ENH_SHORT_NAME = "EMITL2BCH4ENH"
ENH_PATH = "EMITL2BCH4ENH.002"
SCENE_RE = re.compile(r"^EMIT_L2B_CH4ENH_002_(\d{8}T\d{6})_(\d{7})_(\d{3})$")
EMIT_MAX_LAT = 52.0                   # the ISS orbit: EMIT never looks further north (or south)
SCENE_CAP_BYTES = 25_000_000          # raw scenes are 8-14 MB
SCENE_TIMEOUT_S = 45.0
MAX_SCENES = 12
WINDOW_KM = 6.0                        # site centres are approximate (footprint centroids)
CANDIDATE_PPM_M = 1000.0
CANDIDATE_MIN_PIXELS = 5
UNCERT_SIGMA = 3.0

TROPOMI_BUCKET_HOST = "meeo-s5p.s3.eu-central-1.amazonaws.com"
TROPOMI_PREFIX = "COGT/OFFL/L2__CH4___"
TROPOMI_QA_MIN = 50                   # qa_value is 0-100 in these COGs (ESA's 0.5)
TROPOMI_MAX_DAYS = 14
TROPOMI_LATENCY_DAYS = 2              # OFFL lags ~2 days
TROPOMI_MAX_AREA_DEG2 = 400.0         # e.g. 20 x 20 degrees
TROPOMI_ORBIT_RE = re.compile(r"^S5P_OFFL_L2__CH4____(\d{8}T\d{6})_(\d{8}T\d{6})_(\d{5})_\d{2}_\d{6}_\d{8}T\d{6}$")
HOTSPOT_MIN_DAYS = 3
HOTSPOT_SEPARATION_KM = 40.0
MAX_PARALLEL_READS = 8

SITE_KM = 3.0
# NASA's plume product is dense through 2024 (600 plumes) and nearly empty after (1 in 2025,
# 0 in 2026); recent passes are read from here on unless the caller says otherwise.
PLUME_PRODUCT_DENSE_END = date(2024, 12, 31)
SITES_CACHE_KEY = "methane/cache/sites_v002.geojson"
SITES_TTL_S = 7 * 24 * 3600

# Watch areas (w, s, e, n). The label is for the record, never drawn on the globe. North Korea
# is not a watch area (EMIT has never detected a plume there; an empty result is not evidence);
# neither is Xinjiang. `emit`: whether EMIT can look there at all (the ISS stays below ~52°N).
WATCH_AREAS: dict[str, dict] = {
    "permian basin": {"bbox": (-104.5, 30.5, -101.0, 33.5), "label": "Permian Basin", "emit": True},
    "south caspian": {"bbox": (52.0, 36.5, 62.5, 41.5), "label": "south Caspian (Turkmenistan)", "emit": True},
    "zagros foreland": {"bbox": (47.0, 29.0, 53.0, 33.5), "label": "Zagros foreland (south-west Iran)", "emit": True},
    "shanxi coal basin": {"bbox": (110.2, 34.5, 114.6, 40.8), "label": "Shanxi coal basin (China)", "emit": True},
    "orenburg and lower volga": {"bbox": (44.0, 45.5, 56.5, 52.0), "label": "Orenburg and lower Volga (southern Russia)", "emit": True},
    "west siberia and yamal": {"bbox": (65.0, 60.0, 80.0, 72.0), "label": "West Siberia and Yamal (Russia)", "emit": False},
    "hassi messaoud": {"bbox": (4.5, 30.5, 7.5, 33.0), "label": "Hassi Messaoud (Algeria)", "emit": True},
}

RENDER_SITES = {"kind": "points", "group": "watch", "property": "repeat_dates", "label": "repeat_dates", "units": "dates"}
RENDER_TROPOMI = {"kind": "raster", "colormap": "magma", "rescale": [0, 60], "units": "ppb", "group": "methane",
                  "legend": "CH4 anomaly"}
RENDER_PASS = {"kind": "raster", "colormap": "plasma", "rescale": [0, 1500], "units": "ppm·m", "group": "methane",
               "legend": "CH4 enhancement"}


# --- small helpers --------------------------------------------------------------------------

def resolve_watch_area(area: Any) -> tuple[str, dict]:
    key = area.lower().strip() if isinstance(area, str) else ""
    if key in WATCH_AREAS:
        return key, WATCH_AREAS[key]
    raise MethaneError(f"'{area}' is not a watch area ({', '.join(sorted(WATCH_AREAS))}). Pass bbox instead.")


def km_between(lat1, lon1, lat2, lon2) -> float:
    return math.hypot((lat1 - lat2) * 110.574, (lon1 - lon2) * 111.320 * math.cos(math.radians((lat1 + lat2) / 2)))


def box_around(lat: float, lon: float, km: float) -> tuple[float, float, float, float]:
    dlat = km / 110.574
    dlon = km / (111.320 * max(math.cos(math.radians(lat)), 0.05))
    return (max(lon - dlon, -180), max(lat - dlat, -90), min(lon + dlon, 180), min(lat + dlat, 90))


def parse_point(lat: Any, lon: Any) -> tuple[float, float]:
    return _finite(lat, "lat", -90, 90), _finite(lon, "lon", -180, 180)


def validate_scene_id(value: Any) -> str:
    if not isinstance(value, str) or not SCENE_RE.fullmatch(value):
        raise MethaneError("not an EMIT CH4ENH scene id")
    return value


def scene_url(scene_id: str, layer: str) -> str:
    """LP DAAC URL of a raw scene layer (CH4ENH | CH4UNCERT), built from a validated id."""
    sid = validate_scene_id(scene_id)
    if layer not in ("CH4ENH", "CH4UNCERT"):
        raise MethaneError("layer must be CH4ENH or CH4UNCERT")
    name = sid.replace("_CH4ENH_", f"_{layer}_")
    return f"https://{mt.LPDAAC_HOST}/lp-prod-protected/{ENH_PATH}/{sid}/{name}.tif"


def _cmr_entries(client: httpx.Client, params: dict, limit: int) -> tuple[list[dict], int]:
    out, page, hits = [], 1, 0
    while len(out) < limit:
        r = client.get(mt.CMR_URL, params={**params, "page_size": min(100, limit), "page_num": page})
        if r.status_code != 200:
            raise MethaneError(f"The NASA CMR catalogue answered HTTP {r.status_code}; try again shortly.")
        hits = int(r.headers.get("cmr-hits", "0") or 0)
        entries = r.json().get("feed", {}).get("entry", [])
        out.extend(entries)
        if len(entries) < min(100, limit) or page * 100 >= hits:
            break
        page += 1
    return out[:limit], hits


def _put_bytes(key: str, body: bytes, content_type: str) -> str:
    mt._s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=body, ContentType=content_type)
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


def _cog_bytes(array: np.ndarray, west: float, north: float, xres: float, yres: float, nodata: float = -9999.0) -> bytes:
    data = np.where(np.isfinite(array), array, nodata).astype(np.float32)
    with MemoryFile() as mem:
        with mem.open(driver="GTiff", width=data.shape[1], height=data.shape[0], count=1, dtype="float32",
                      crs="EPSG:4326", transform=from_origin(west, north, xres, yres), nodata=nodata,
                      tiled=True, blockxsize=256, blockysize=256, compress="deflate") as ds:
            ds.write(data, 1)
        return mem.read()


# --- baseline: every NASA plume, grouped into sites -----------------------------------------

def cluster_sites(points: list[tuple[float, float, str, str]], km: float = SITE_KM) -> list[dict]:
    """Greedy grouping of (lat, lon, date, granule_id) in date order: a point within `km` of a
    site's first point joins it. Deterministic for a given input."""
    sites: list[dict] = []
    for lat, lon, day, gid in sorted(points, key=lambda p: (p[2], p[3])):
        for s in sites:
            if km_between(s["lat"], s["lon"], lat, lon) < km:
                s["members"].append((day, gid))
                break
        else:
            sites.append({"lat": lat, "lon": lon, "members": [(day, gid)]})
    for s in sites:
        days = sorted({d for d, _ in s["members"]})
        s.update(repeat_dates=len(days), plumes=len(s["members"]), first=days[0], last=days[-1])
    return sites


def load_sites(client: httpx.Client, s3) -> tuple[dict, str]:
    """The global site baseline, from the shared cache when fresh, else rebuilt from CMR."""
    try:
        obj = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=SITES_CACHE_KEY)
        fc = json.loads(obj["Body"].read(mt.GEOJSON_READ_CAP_BYTES + 1))
        if time.time() - fc.get("built_at", 0) < SITES_TTL_S:
            return fc, "cache"
    except s3.exceptions.NoSuchKey:
        pass
    entries, _ = _cmr_entries(client, {"short_name": mt.SHORT_NAME, "sort_key": "start_date"}, 5000)
    points = []
    for e in entries:
        feat, _ = mt.entry_to_feature(e)
        if feat:
            p = feat["properties"]
            points.append((p["center_lat"], p["center_lon"], p["acquired"][:10], p["granule_id"]))
    sites = cluster_sites(points)
    features = [{"type": "Feature",
                 "geometry": {"type": "Point", "coordinates": [round(s["lon"], 5), round(s["lat"], 5)]},
                 "properties": {"repeat_dates": s["repeat_dates"], "plumes": s["plumes"], "first": s["first"],
                                "last": s["last"], "tier": "repeat" if s["repeat_dates"] >= 5 else "site"}}
                for s in sites]
    fc = {"type": "FeatureCollection", "features": features, "built_at": int(time.time()), "detections": len(points)}
    s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=SITES_CACHE_KEY, Body=json.dumps(fc).encode(),
                  ContentType="application/geo+json")
    return fc, "cmr"


@tool
async def watch_baseline(min_repeat_dates: int = 5) -> str:
    """The global baseline: every methane plume complex NASA EMIT outlined, grouped into sites.

    Args:
        min_repeat_dates: A site seen on at least this many separate dates is a repeat site (default 5).

    Returns: JSON with summary (detections, sites, repeat sites, plume product date range),
    repeat_sites[] (lat, lon, repeat_dates, first, last; no names), sites_geometry_s3_url (all
    sites for the globe), render (pass to display_visual unchanged), next_steps.
    """
    started = time.time()
    try:
        min_repeat_dates = _int(min_repeat_dates, "min_repeat_dates", 2, 20)
        with httpx.Client(timeout=mt.CMR_TIMEOUT_S) as client:
            fc, source = load_sites(client, mt._s3())
            latest = mt.archive_latest(client)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except httpx.HTTPError as e:
        return json.dumps({"error": f"The NASA CMR catalogue could not be reached ({type(e).__name__})."})
    feats = fc.get("features", [])
    for f in feats:
        f["properties"]["tier"] = "repeat" if f["properties"]["repeat_dates"] >= min_repeat_dates else "site"
    repeat = sorted((f for f in feats if f["properties"]["tier"] == "repeat"),
                    key=lambda f: (-f["properties"]["repeat_dates"], f["properties"]["first"]))
    url = mt._put_json(f"{mt.session_prefix()}watch_sites_v002.geojson", {"type": "FeatureCollection", "features": feats})
    firsts = [f["properties"]["first"] for f in feats]
    return json.dumps({
        "summary": {"detections": fc.get("detections"), "sites": len(feats), "repeat_sites": len(repeat),
                    "min_repeat_dates": min_repeat_dates, "site_radius_km": SITE_KM,
                    "plume_product_first": min(firsts) if firsts else None,
                    "plume_product_latest": latest.isoformat() if latest else None,
                    "source": source, "seconds": round(time.time() - started, 1)},
        "repeat_sites": [{"lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0],
                          **{k: f["properties"][k] for k in ("repeat_dates", "plumes", "first", "last")}}
                         for f in repeat[:25]],
        "sites_geometry_s3_url": url,
        "render": RENDER_SITES,
        "next_steps": ("display_visual(sites_geometry_s3_url, render=render). Say the counts. Never name a country "
                       "for a site; places are named only for the site you examine."),
    })


# --- site history ---------------------------------------------------------------------------

@tool
async def site_history(lat: float, lon: float, radius_km: float = 2.0) -> str:
    """How often EMIT looked at a place, and how often NASA outlined a methane plume there.

    Args:
        lat, lon: The site (e.g. a plume centre or a TROPOMI hotspot) in degrees.
        radius_km: Plumes whose centre lies within this distance count (default 2, max 10).

    Returns: JSON with looks (EMIT raw scenes covering the point: count, first, last), plumes[]
    (date, granule_id, peak ppm·m, NASA rate kg/h ± when published), plume_product_latest (after
    it NASA outlines no plumes), and the sentence to say.
    """
    try:
        lat, lon = parse_point(lat, lon)
        radius_km = _finite(radius_km, "radius_km", 0.2, 10)
        if abs(lat) > EMIT_MAX_LAT:
            return json.dumps({"looks": 0, "plumes": [], "say": f"EMIT cannot look at {lat:.2f}°: the ISS never flies there."})
        with httpx.Client(timeout=mt.CMR_TIMEOUT_S) as client:
            box = box_around(lat, lon, radius_km + 3)
            plm, _ = _cmr_entries(client, {"short_name": mt.SHORT_NAME,
                                           "bounding_box": ",".join(f"{v:.6f}" for v in box), "sort_key": "start_date"}, 200)
            point = f"{lon:.6f},{lat:.6f}"
            first, looks = _cmr_entries(client, {"short_name": ENH_SHORT_NAME, "point": point, "sort_key": "start_date"}, 1)
            last, _ = _cmr_entries(client, {"short_name": ENH_SHORT_NAME, "point": point, "sort_key": "-start_date"}, 1)
            latest = mt.archive_latest(client)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except httpx.HTTPError as e:
        return json.dumps({"error": f"The NASA CMR catalogue could not be reached ({type(e).__name__})."})
    nearby = []
    for e in plm:
        feat, _ = mt.entry_to_feature(e)
        if feat:
            p = feat["properties"]
            if km_between(lat, lon, p["center_lat"], p["center_lon"]) <= radius_km:
                nearby.append(p)
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    s3 = mt._s3()
    with ThreadPoolExecutor(max_workers=mt.MAX_PARALLEL) as pool:
        metas = list(pool.map(lambda p: mt.fetch_plume_meta(p["granule_id"], token, s3), nearby[:40]))
    plumes = [{"date": p["acquired"][:10], "granule_id": p["granule_id"], **{k: m.get(k) for k in
               ("max_ppm_m_nasa", "rate_kg_h", "rate_uncertainty_kg_h", "wind_m_s")}}
              for p, m in zip(nearby[:40], metas)]
    dates = sorted({p["date"] for p in plumes})
    f_look = first[0]["time_start"][:10] if first else None
    l_look = last[0]["time_start"][:10] if last else None
    say = (f"EMIT looked {looks} times ({f_look} to {l_look}) and NASA outlined methane here on {len(dates)} "
           f"separate dates" + (f", most recently {dates[-1]}" if dates else "") + ".")
    if l_look and l_look > PLUME_PRODUCT_DENSE_END.isoformat():
        say += (" NASA's plume product is nearly empty after 2024" +
                (f" (its last plume is {latest.isoformat()})" if latest else "") +
                ", so later passes have not been checked for plumes; no detection is not evidence of no emissions.")
    return json.dumps({"lat": lat, "lon": lon, "radius_km": radius_km,
                       "looks": looks, "first_look": f_look, "last_look": l_look,
                       "plume_dates": dates, "plumes": plumes,
                       "plume_product_latest": latest.isoformat() if latest else None, "say": say})


# --- TROPOMI tip ----------------------------------------------------------------------------

def tropomi_s3():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config
    return boto3.client("s3", region_name="eu-central-1", config=Config(signature_version=UNSIGNED))


def overpass_orbits(keys: list[str], day: date, lon_center: float) -> list[str]:
    """The orbit files of `day` that pass over longitude `lon_center` (TROPOMI crosses the
    equator at ~13:30 local solar time), from a listing of that day's prefix."""
    target = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(hours=13.5 - lon_center / 15)
    out = []
    for key in keys:
        name = key.rsplit("/", 1)[-1]
        if not name.endswith("_PRODUCT_methane_mixing_ratio_4326.tif"):
            continue
        stem = name[: -len("_PRODUCT_methane_mixing_ratio_4326.tif")]
        m = TROPOMI_ORBIT_RE.fullmatch(stem)
        if not m:
            continue
        a0 = datetime.strptime(m[1], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        a1 = datetime.strptime(m[2], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        if a0 - timedelta(minutes=50) <= target <= a1 + timedelta(minutes=50):
            out.append(f"{TROPOMI_PREFIX}/{day:%Y/%m/%d}/{stem}")
    return out


def read_tropomi_window(stem: str, bbox) -> tuple[np.ndarray, Any]:
    """CH4 (ppb) over bbox for one orbit, NaN where missing or qa < TROPOMI_QA_MIN."""
    base = f"https://{TROPOMI_BUCKET_HOST}/{stem}_PRODUCT_"
    with rasterio.open(base + "methane_mixing_ratio_4326.tif") as ds, rasterio.open(base + "qa_value_4326.tif") as qa:
        win = from_bounds(*bbox, ds.transform).round_offsets().round_lengths()
        ch4 = ds.read(1, window=win, boundless=True, fill_value=ds.nodata).astype(np.float64)
        q = qa.read(1, window=win, boundless=True, fill_value=0)
        transform = ds.window_transform(win)
        ch4[(ch4 == ds.nodata) | (q < TROPOMI_QA_MIN) | ~np.isfinite(ch4)] = np.nan
    return ch4, transform


def composite(stacks: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel median over days (NaN-aware) and the number of valid days."""
    cube = np.stack(stacks)
    days = np.isfinite(cube).sum(axis=0)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(cube, axis=0)
    return med, days


def find_hotspots(anomaly: np.ndarray, days: np.ndarray, transform, n: int = 5,
                  min_days: int = HOTSPOT_MIN_DAYS) -> list[dict]:
    """Strongest anomalies seen on at least `min_days` days, at least HOTSPOT_SEPARATION_KM apart."""
    a = np.where((days >= min_days) & np.isfinite(anomaly), anomaly, -np.inf)
    order = np.argsort(a, axis=None)[::-1]
    picked: list[dict] = []
    for idx in order[:5000]:
        r, c = np.unravel_index(idx, a.shape)
        if not np.isfinite(a[r, c]) or a[r, c] <= 0:
            break
        lon, lat = (float(v) for v in transform * (c + 0.5, r + 0.5))
        if all(km_between(lat, lon, p["lat"], p["lon"]) >= HOTSPOT_SEPARATION_KM for p in picked):
            picked.append({"lat": round(lat, 4), "lon": round(lon, 4), "anomaly_ppb": round(float(a[r, c]), 1),
                           "valid_days": int(days[r, c])})
        if len(picked) >= n:
            break
    for i, p in enumerate(picked, start=1):
        p["rank"] = i
        p["emit_can_look"] = bool(abs(p["lat"]) <= EMIT_MAX_LAT)
    return picked


@tool
async def scan_tropomi(area: str = None, bbox: list = None, days: int = 7, end_date: str = None) -> str:
    """Tip: scan an area with Sentinel-5P TROPOMI (daily, ~4 km) for methane above the area's background.

    Args:
        area: A watch area name (see the prompt), or pass bbox.
        bbox: [west, south, east, north] in degrees (at most ~20 x 20 degrees).
        days: How many recent days to composite (default 7, max 14).
        end_date: Optional YYYY-MM-DD; default the latest day TROPOMI has processed (~2 days ago).

    Returns: JSON with summary (days used, orbits read, background ppb), hotspots[] (rank, lat,
    lon, anomaly_ppb, valid_days, emit_can_look), anomaly_s3_url (the composite for the map),
    render (pass to display_visual unchanged), next_steps.
    """
    started = time.time()
    try:
        if bbox is not None:
            box, label, emit = parse_bbox(bbox), "custom area", None
        else:
            _, spec = resolve_watch_area(area)
            box, label, emit = spec["bbox"], spec["label"], spec["emit"]
        if (box[2] - box[0]) * (box[3] - box[1]) > TROPOMI_MAX_AREA_DEG2:
            raise MethaneError("the area is too large for a TROPOMI scan (keep it under ~20 x 20 degrees)")
        days = _int(days, "days", 1, TROPOMI_MAX_DAYS)
        today = datetime.now(timezone.utc).date()
        end = parse_day(end_date, "end_date") if end_date else today - timedelta(days=TROPOMI_LATENCY_DAYS)
        end = min(end, today)
    except MethaneError as e:
        return json.dumps({"error": str(e)})

    # A composite for (area, end day, days) never changes once TROPOMI has processed the days:
    # computed once into the shared cache, copied per session (the browser reads session copies).
    slug = mt._slugify(label) if bbox is None else "bbox_" + "_".join(f"{v:.2f}" for v in box).replace("-", "m")
    cache_base = f"methane/cache/tropomi_{slug}_{end.isoformat()}_{days}d"
    session_key = f"{mt.session_prefix()}tropomi_anomaly_{slug}_{end.isoformat()}_{days}d.tif"
    s3 = mt._s3()
    try:
        cached = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{cache_base}.json")["Body"].read(1_000_000))
        tif = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{cache_base}.tif")["Body"].read(50_000_000)
        url = _put_bytes(session_key, tif, "image/tiff")
        cached["summary"].update(source="cache", seconds=round(time.time() - started, 1))
        return json.dumps({**cached, "anomaly_s3_url": url})
    except s3.exceptions.NoSuchKey:
        pass

    lon_c = (box[0] + box[2]) / 2
    s3p = tropomi_s3()
    stems: list[str] = []
    day, looked = end, 0
    while len({s.split('/')[3] + s.split('/')[4] + s.split('/')[5] for s in stems}) < days and looked < days + 7:
        listing = s3p.list_objects_v2(Bucket="meeo-s5p", Prefix=f"{TROPOMI_PREFIX}/{day:%Y/%m/%d}/")
        stems += overpass_orbits([o["Key"] for o in listing.get("Contents", [])], day, lon_c)
        day -= timedelta(days=1)
        looked += 1
    if not stems:
        return json.dumps({"error": "No TROPOMI orbits were found for that window; try an earlier end_date."})

    def read(stem):
        try:
            return read_tropomi_window(stem, box)
        except Exception as e:  # one bad orbit never sinks the scan
            logger.warning("TROPOMI read failed for %s: %s", stem.rsplit('/', 1)[-1], type(e).__name__)
            return None

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_READS) as pool:
        results = [r for r in pool.map(read, stems) if r is not None]
    if not results:
        return json.dumps({"error": "TROPOMI could not be read for that window (all orbits failed)."})
    shape = results[0][0].shape
    stacks = [a for a, _ in results if a.shape == shape]
    transform = results[0][1]
    med, valid_days = composite(stacks)
    if not np.isfinite(med).any():
        return json.dumps({"summary": {"area": label, "orbits": len(stacks), "valid_pixels": 0},
                           "hotspots": [], "say": f"TROPOMI saw no cloud-free methane retrievals over {label} in that window."})
    background = float(np.nanmedian(med))
    anomaly = med - background
    # A hotspot must persist: seen on HOTSPOT_MIN_DAYS days, or on every day of a shorter scan.
    days_read = len({s.rsplit("/", 4)[1:4].__str__() for s in stems})
    hotspots = find_hotspots(anomaly, valid_days, transform, min_days=min(HOTSPOT_MIN_DAYS, max(days_read, 1)))
    cog = _cog_bytes(anomaly, transform.c, transform.f, transform.a, -transform.e)
    url = _put_bytes(session_key, cog, "image/tiff")
    first_day = min(s.split('/')[3] + '-' + s.split('/')[4] + '-' + s.split('/')[5] for s in stems)
    summary = {"area": label, "bbox": list(box), "start": first_day, "end": end.isoformat(),
               "days_requested": days, "orbits": len(stacks), "background_ppb": round(background, 1),
               "valid_pixel_fraction": round(float(np.isfinite(med).mean()), 3),
               "emit_can_look": emit, "seconds": round(time.time() - started, 1),
               "definitions": (f"anomaly_ppb: the {days}-day median column CH4 at a ~4 km pixel minus the area's "
                               f"median, quality ≥ {TROPOMI_QA_MIN}/100. A tip, not a detection: cue EMIT.")}
    logger.info("TROPOMI: %s %d orbits → %d hotspots in %.1fs", label, len(stacks), len(hotspots), summary["seconds"])
    result = {
        "summary": {**summary, "source": "meeo-s5p"}, "hotspots": hotspots,
        "render": {**RENDER_TROPOMI, "bounds": [round(v, 4) for v in box]},
        "next_steps": ("display_visual(anomaly_s3_url, render=render); then cue EMIT on the strongest hotspot with "
                       "emit_can_look: check_recent_passes(lat, lon). If EMIT cannot look, say so: confidence stays low."),
    }
    if end <= today - timedelta(days=TROPOMI_LATENCY_DAYS):   # only complete days are cached
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=f"{cache_base}.tif", Body=cog, ContentType="image/tiff")
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=f"{cache_base}.json", Body=json.dumps(result).encode(),
                      ContentType="application/json")
    return json.dumps({**result, "anomaly_s3_url": url})


# --- EMIT cue: recent raw passes -------------------------------------------------------------

def download_scene_layer(scene_id: str, layer: str, token: str) -> bytes:
    return mt.download_url(scene_url(scene_id, layer), token, SCENE_TIMEOUT_S, SCENE_CAP_BYTES)


def window_stats(enh_bytes: bytes, unc_bytes: bytes, lat: float, lon: float, km: float = WINDOW_KM) -> dict:
    """Enhancement and uncertainty in a km x km window around the point, plus the verdict."""
    box = box_around(lat, lon, km / 2)
    with MemoryFile(enh_bytes) as m1, m1.open() as e, MemoryFile(unc_bytes) as m2, m2.open() as u:
        win = from_bounds(*box, e.transform).round_offsets().round_lengths()
        enh = e.read(1, window=win, boundless=True, fill_value=e.nodata if e.nodata is not None else -9999).astype(np.float64)
        unc = u.read(1, window=from_bounds(*box, u.transform).round_offsets().round_lengths(), boundless=True,
                     fill_value=u.nodata if u.nodata is not None else -9999).astype(np.float64)
        nod = e.nodata if e.nodata is not None else -9999
        transform = e.window_transform(win)
        xres, yres = abs(e.transform.a), abs(e.transform.e)
    enh[(enh == nod) | ~np.isfinite(enh)] = np.nan
    if unc.shape != enh.shape:
        unc = np.full(enh.shape, np.nan)
    unc[(unc <= 0) | ~np.isfinite(unc)] = np.nan
    valid = int(np.isfinite(enh).sum())
    strong = int(np.nansum(enh >= CANDIDATE_PPM_M))
    with np.errstate(invalid="ignore"):
        significant = int(np.nansum((enh >= 500) & (enh > UNCERT_SIGMA * unc)))
    peak = float(np.nanmax(enh)) if valid else None
    if valid == 0:
        verdict, reason = "rejected", "no valid pixels at the site (cloud, water or outside the swath)"
    elif strong < CANDIDATE_MIN_PIXELS:
        verdict, reason = "rejected", f"only {strong} pixels ≥ {CANDIDATE_PPM_M:g} ppm·m (need {CANDIDATE_MIN_PIXELS})"
    elif significant < CANDIDATE_MIN_PIXELS:
        verdict, reason = "rejected", f"only {significant} pixels above {UNCERT_SIGMA:g}× their uncertainty"
    else:
        verdict, reason = "candidate", f"{strong} pixels ≥ {CANDIDATE_PPM_M:g} ppm·m, {significant} above {UNCERT_SIGMA:g}× uncertainty"
    return {"valid_pixels": valid, "peak_ppm_m": round(peak, 1) if peak is not None else None,
            "pixels_ge_1000": strong, "pixels_significant": significant, "verdict": verdict, "reason": reason,
            "_window": enh, "_transform": transform, "_res": (xres, yres)}


def pass_cache_base(scene_id: str, lat: float, lon: float) -> str:
    """Shared across sessions: a scene never changes, so its verdict at a site is computed once
    (the scenes are 8-14 MB each; rehearsals and the stage then run warm)."""
    return f"methane/cache/passwin_{validate_scene_id(scene_id)}_{lat:.4f}_{lon:.4f}_{WINDOW_KM:g}km"


def check_one_pass(scene_id: str, lat: float, lon: float, token: str, s3) -> dict:
    base = pass_cache_base(scene_id, lat, lon)
    session_key = f"{mt.session_prefix()}pass_{scene_id}.tif"
    try:
        stats = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{base}.json")["Body"].read(100_000))
        window = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{base}.tif")["Body"].read(SCENE_CAP_BYTES) \
            if stats.get("valid_pixels") else None
        source = "cache"
    except s3.exceptions.NoSuchKey:
        enh = download_scene_layer(scene_id, "CH4ENH", token)
        unc = download_scene_layer(scene_id, "CH4UNCERT", token)
        stats = window_stats(enh, unc, lat, lon)
        win, tr, (xres, yres) = stats.pop("_window"), stats.pop("_transform"), stats.pop("_res")
        window = _cog_bytes(win, tr.c, tr.f, xres, yres) if stats["valid_pixels"] else None
        if window:
            s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=f"{base}.tif", Body=window, ContentType="image/tiff")
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=f"{base}.json", Body=json.dumps(stats).encode(),
                      ContentType="application/json")
        source = "lpdaac"
    # The browser reads session copies only (the backend's S3 allowlist is unchanged).
    url = _put_bytes(session_key, window, "image/tiff") if window else None
    m = SCENE_RE.fullmatch(scene_id)
    return {"scene_id": scene_id, "date": f"{m[1][:4]}-{m[1][4:6]}-{m[1][6:8]}", **stats,
            "window_s3_url": url, "source": source}


@tool
async def check_recent_passes(lat: float, lon: float, since: str = None, max_scenes: int = 8) -> str:
    """Cue: read EMIT's recent raw methane scenes over a site, where NASA outlines no plumes yet.

    Each pass is judged in a 6 km window: a candidate needs ≥ 5 pixels ≥ 1,000 ppm·m AND ≥ 5 pixels
    whose enhancement exceeds 3× the scene's own per-pixel uncertainty; otherwise it is rejected
    with the reason. Candidates are candidates, never confirmed plumes.

    Args:
        lat, lon: The site in degrees (EMIT only sees between ~52°S and ~52°N).
        since: Optional YYYY-MM-DD; default 2025-01-01 (NASA's plume product is dense through 2024
            and nearly empty after).
        max_scenes: Newest passes to read (default 8, max 12).

    Returns: JSON with summary (looks found, read, candidates, rejected), passes[] (date,
    peak_ppm_m, pixels_ge_1000, pixels_significant, verdict, reason, window_s3_url), render,
    next_steps.
    """
    started = time.time()
    try:
        lat, lon = parse_point(lat, lon)
        max_scenes = _int(max_scenes, "max_scenes", 1, MAX_SCENES)
        if abs(lat) > EMIT_MAX_LAT:
            return json.dumps({"summary": {"looks": 0, "read": 0, "candidates": 0},
                               "passes": [], "reason": "outside EMIT coverage",
                               "say": (f"EMIT cannot look at {lat:.2f}°N: the ISS never flies that far north, so "
                                       "only TROPOMI sees this site and confidence stays low.")})
        with httpx.Client(timeout=mt.CMR_TIMEOUT_S) as client:
            latest = mt.archive_latest(client)
            since_d = parse_day(since, "since") if since else PLUME_PRODUCT_DENSE_END + timedelta(days=1)
            entries, looks = _cmr_entries(client, {
                "short_name": ENH_SHORT_NAME, "point": f"{lon:.6f},{lat:.6f}", "sort_key": "-start_date",
                "temporal": f"{since_d.isoformat()}T00:00:00Z,{datetime.now(timezone.utc).date().isoformat()}T23:59:59Z",
            }, max_scenes)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except httpx.HTTPError as e:
        return json.dumps({"error": f"The NASA CMR catalogue could not be reached ({type(e).__name__})."})
    scene_ids = [e.get("title") for e in entries if isinstance(e.get("title"), str) and SCENE_RE.fullmatch(e["title"])]
    if not scene_ids:
        return json.dumps({"summary": {"looks": looks, "read": 0, "candidates": 0, "since": since_d.isoformat()},
                           "passes": [], "say": f"EMIT has not looked at this site since {since_d.isoformat()}."})
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    s3 = mt._s3()

    def one(sid):
        try:
            return check_one_pass(sid, lat, lon, token, s3)
        except mt.PlumeFetchError as e:
            return {"scene_id": sid, "verdict": "error", "reason": e.reason}
        except Exception as e:
            return {"scene_id": sid, "verdict": "error", "reason": type(e).__name__}

    with ThreadPoolExecutor(max_workers=min(mt.MAX_PARALLEL, len(scene_ids))) as pool:
        passes = list(pool.map(one, scene_ids))
    if passes and all(p.get("reason") in ("token_missing", "token_rejected") for p in passes):
        return json.dumps({"error": "The Earthdata token is missing or expired, so EMIT's recent scenes cannot be read."})
    cands = [p for p in passes if p["verdict"] == "candidate"]
    best = max(cands, key=lambda p: p["peak_ppm_m"] or 0, default=None)
    summary = {"lat": lat, "lon": lon, "since": since_d.isoformat(), "looks": looks, "read": len(passes),
               "candidates": len(cands), "rejected": sum(p["verdict"] == "rejected" for p in passes),
               "errors": sum(p["verdict"] == "error" for p in passes),
               "from_cache": sum(p.get("source") == "cache" for p in passes),
               "plume_product_latest": latest.isoformat() if latest else None,
               "rule": (f"candidate: ≥ {CANDIDATE_MIN_PIXELS} pixels ≥ {CANDIDATE_PPM_M:g} ppm·m and ≥ "
                        f"{CANDIDATE_MIN_PIXELS} above {UNCERT_SIGMA:g}× uncertainty in a {WINDOW_KM:g} km window"),
               "seconds": round(time.time() - started, 1)}
    logger.info("PASSES: %.3f,%.3f %d read, %d candidates in %.1fs", lat, lon, len(passes), len(cands), summary["seconds"])
    return json.dumps({
        "summary": summary, "passes": passes,
        "strongest_candidate": best and {k: best[k] for k in ("scene_id", "date", "peak_ppm_m", "pixels_ge_1000", "window_s3_url")},
        "render": {**RENDER_PASS, "bounds": [round(v, 5) for v in box_around(lat, lon, WINDOW_KM / 2)]},
        "next_steps": ("Say how many passes were candidates and which were rejected and why. inspect_image the "
                       "strongest candidate's window_s3_url, then display_visual it with render=render."),
    })
