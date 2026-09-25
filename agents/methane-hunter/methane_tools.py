"""The Methane Hunter's tools: find EMIT methane plumes, triage them, show the strongest.

Data: NASA EMIT L2B CH4 plume complexes (collection EMITL2BCH4PLM.002). Each granule is one
plume complex: a footprint polygon in the public CMR catalogue and a small Cloud-Optimized
GeoTIFF of CH4 enhancement (ppm·m, nodata -9999) behind an Earthdata bearer token on LP DAAC.
See docs/spikes/emit.md.

Security (design.md "Security"):
  - Every model-supplied argument is validated before it becomes a query, a URL or an S3 key.
  - Plume download URLs are built from a regex-validated granule id, never taken from CMR or
    from a file, so a crafted value cannot redirect the token to another host.
  - EARTHDATA_TOKEN is read from the environment, sent only to LP DAAC over HTTPS (httpx drops
    the Authorization header when a redirect leaves the origin), and never logged or returned.
  - Downloads are streamed with a byte cap and a timeout, bounded in concurrency and count, and
    opened in memory with rasterio.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

import _paths  # noqa: F401  (shared platform code on sys.path)
import boto3
import httpx
import numpy as np
import rasterio
from rasterio.errors import RasterioIOError
from rasterio.io import MemoryFile
from strands import tool

import config  # the platform's config: S3 bucket, session defaults
from utils.aws_utils import download_geometry_from_s3
from utils.tools import _slugify

logger = logging.getLogger("methane_tools")

# --- constants ------------------------------------------------------------------------------

CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
SHORT_NAME = "EMITL2BCH4PLM"
COLLECTION_PATH = "EMITL2BCH4PLM.002"
LPDAAC_HOST = "data.lpdaac.earthdatacloud.nasa.gov"
GRANULE_RE = re.compile(r"^EMIT_L2B_CH4PLM_(\d{3})_(\d{8}T\d{6})_(\d{6})$")

MISSION_START = date(2022, 8, 1)       # first plume granule: 2022-08-10
DEFAULT_WINDOW_DAYS = 365
MAX_RESULTS_CAP = 200
MAX_TRIAGE = 200
MAX_PARALLEL = 8
DOWNLOAD_TIMEOUT_S = 20.0
DOWNLOAD_CAP_BYTES = 5_000_000          # real plume COGs are ~20 KB
GEOJSON_READ_CAP_BYTES = 5_000_000
CMR_TIMEOUT_S = 15.0
CMR_PAGE_SIZE = 100
TOP_N_CAP = 50
# A plume complex raster also carries background noise around the plume (negative and small
# values; one Permian granule has 168k valid pixels with a median of 120 ppm·m). Area and mean
# are therefore reported over pixels at or above this enhancement, not over every valid pixel.
ENHANCED_PPM_M = 500.0
ARCHIVE_LATEST_TTL_S = 6 * 3600

# Named regions the demo uses (w, s, e, n). Anything else: geocode it and pass geometry_s3_url.
BASINS: dict[str, tuple[float, float, float, float]] = {
    "permian basin": (-104.5, 30.5, -101.0, 33.5),
    "san joaquin valley": (-121.6, 34.8, -118.6, 37.8),
    "four corners": (-109.5, 35.9, -107.0, 37.6),
    "marcellus": (-81.0, 39.0, -75.0, 42.5),
    "turkmenistan": (52.0, 36.5, 66.8, 42.8),
}

RENDER_RASTER = {
    "kind": "raster", "colormap": "plasma", "rescale": [0, 1500],
    "units": "ppm·m", "group": "methane", "legend": "CH4 enhancement",
}
RENDER_VECTOR = {
    "kind": "vector", "property": "max_ppm_m", "ramp": "plasma", "rescale": [0, 1500],
    "units": "ppm·m", "group": "methane", "label": "rank",
}


class MethaneError(ValueError):
    """A user-facing problem; the tool turns it into a JSON error and the turn continues."""


# --- validation -----------------------------------------------------------------------------

def _int(value: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise MethaneError(f"{name} must be an integer")
    if not lo <= value <= hi:
        raise MethaneError(f"{name} must be between {lo} and {hi}")
    return value


def _finite(value: Any, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MethaneError(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not lo <= value <= hi:
        raise MethaneError(f"{name} must be a finite number between {lo} and {hi}")
    return value


def parse_bbox(raw: Any) -> tuple[float, float, float, float]:
    if isinstance(raw, str):
        try:
            raw = [float(x) for x in raw.strip("[]() ").split(",")]
        except ValueError:
            raise MethaneError("bbox must be [west, south, east, north] in degrees")
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        raise MethaneError("bbox must be [west, south, east, north] in degrees")
    w = _finite(raw[0], "bbox.west", -180, 180)
    s = _finite(raw[1], "bbox.south", -90, 90)
    e = _finite(raw[2], "bbox.east", -180, 180)
    n = _finite(raw[3], "bbox.north", -90, 90)
    if not (w < e and s < n):
        raise MethaneError("bbox must have west < east and south < north")
    return w, s, e, n


def parse_day(value: Any, name: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        raise MethaneError(f"{name} must be a date as YYYY-MM-DD")
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise MethaneError(f"{name} is not a valid date")


def validate_granule_id(value: Any) -> str:
    if not isinstance(value, str) or not GRANULE_RE.fullmatch(value.strip()):
        raise MethaneError("granule_id must look like EMIT_L2B_CH4PLM_002_20240812T190223_002202")
    return value.strip()


def tif_url(granule_id: str) -> str:
    """The LP DAAC download URL, built from a validated id (never taken from input)."""
    gid = validate_granule_id(granule_id)
    return f"https://{LPDAAC_HOST}/lp-prod-protected/{COLLECTION_PATH}/{gid}/{gid}.tif"


def acquired_from_id(granule_id: str) -> str:
    stamp = GRANULE_RE.fullmatch(granule_id).group(2)
    return datetime.strptime(stamp, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


# --- session and cache keys ------------------------------------------------------------------

def _session_id() -> str:
    return os.environ.get("AGENT_SESSION_ID", config.DEFAULT_SESSION_ID)


def session_prefix() -> str:
    return f"session_data/{_session_id()}/methane/"


def cache_key(granule_id: str) -> str:
    """Shared across sessions: a plume COG never changes, and rehearsals should not re-download."""
    return f"methane/cache/ch4plm_{validate_granule_id(granule_id)}.tif"


def _s3():
    return boto3.client("s3")


def _require_session_url(url: Any, name: str, stem: str) -> str:
    """An s3:// URL this session's methane tools wrote (no traversal, right prefix, .geojson)."""
    expected = f"s3://{config.S3_BUCKET_NAME}/{session_prefix()}{stem}"
    if (not isinstance(url, str) or not url.startswith(expected) or not url.endswith(".geojson")
            or ".." in url or "//" in url[len("s3://"):]):
        raise MethaneError(f"{name} must be the {stem}….geojson URL returned earlier in this session")
    return url


def _put_json(key: str, body: dict) -> str:
    _s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=json.dumps(body).encode("utf-8"),
                     ContentType="application/geo+json")
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


def _get_json(url: str) -> dict:
    key = url[len(f"s3://{config.S3_BUCKET_NAME}/"):]
    obj = _s3().get_object(Bucket=config.S3_BUCKET_NAME, Key=key)
    if int(obj.get("ContentLength", 0)) > GEOJSON_READ_CAP_BYTES:
        raise MethaneError("footprint file is unexpectedly large")
    return json.loads(obj["Body"].read(GEOJSON_READ_CAP_BYTES + 1))


# --- extent and window ------------------------------------------------------------------------

def resolve_extent(region: Any, bbox: Any, geometry_s3_url: Any) -> tuple[tuple[float, float, float, float], str]:
    label = region.strip() if isinstance(region, str) and region.strip() else "custom area"
    if bbox is not None:
        return parse_bbox(bbox), label
    if geometry_s3_url is not None:
        if not isinstance(geometry_s3_url, str) or not geometry_s3_url.startswith(f"s3://{config.S3_BUCKET_NAME}/"):
            raise MethaneError("geometry_s3_url must be an s3:// URL from find_location_boundary")
        gdf = download_geometry_from_s3(geometry_s3_url).to_crs("EPSG:4326")
        return parse_bbox([float(v) for v in gdf.total_bounds]), label
    key = (region or "").lower().strip() if isinstance(region, str) else ""
    if key in BASINS:
        return BASINS[key], label
    raise MethaneError(
        f"'{region}' is not a region I know by name ({', '.join(sorted(BASINS))}). Geocode it with "
        f"find_location_boundary and pass geometry_s3_url, or pass bbox=[west, south, east, north]."
    )


_archive_latest_cache: dict[str, Any] = {}


def archive_latest(client: httpx.Client) -> date | None:
    """Date of the collection's most recent plume (cached). None if CMR cannot say."""
    cached = _archive_latest_cache.get("value")
    if cached and time.time() - _archive_latest_cache.get("at", 0) < ARCHIVE_LATEST_TTL_S:
        return cached
    try:
        r = client.get(CMR_URL, params={"short_name": SHORT_NAME, "page_size": 1, "sort_key": "-start_date"})
        if r.status_code != 200:
            return None
        entries = r.json().get("feed", {}).get("entry", [])
        if not entries:
            return None
        latest = datetime.fromisoformat(entries[0]["time_start"].replace("Z", "+00:00")).date()
        _archive_latest_cache.update(value=latest, at=time.time())
        return latest
    except Exception:  # the window then ends today, which CMR answers correctly anyway
        return None


def resolve_window(start: Any, end: Any, latest: date | None, today: date | None = None) -> tuple[date, date, str]:
    today = today or datetime.now(timezone.utc).date()
    if start is None and end is None:
        end_d = min(latest or today, today)
        start_d = max(MISSION_START, end_d - timedelta(days=DEFAULT_WINDOW_DAYS))
        note = (f"the last 12 months of EMIT plume data (the collection's most recent plume is "
                f"{end_d.isoformat()})" if latest else "the last 12 months")
        return start_d, end_d, note
    end_d = parse_day(end, "end_date") if end is not None else min(latest or today, today)
    start_d = parse_day(start, "start_date") if start is not None else max(MISSION_START, end_d - timedelta(days=DEFAULT_WINDOW_DAYS))
    if start_d < MISSION_START:
        start_d = MISSION_START
    if end_d > today:
        end_d = today
    if start_d > end_d:
        raise MethaneError("start_date must be on or before end_date")
    return start_d, end_d, f"{start_d.isoformat()} to {end_d.isoformat()}"


# --- CMR parsing ----------------------------------------------------------------------------

def parse_ring(polygon_str: str) -> list[list[float]] | None:
    """CMR's 'lat lon lat lon …' ring string → a closed GeoJSON [lon, lat] ring, or None."""
    parts = polygon_str.split()
    if len(parts) < 8 or len(parts) % 2:
        return None
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    ring = []
    for lat, lon in zip(nums[0::2], nums[1::2]):
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        ring.append([lon, lat])
    if ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring if len(ring) >= 4 else None


def entry_to_feature(entry: dict) -> tuple[dict | None, str | None]:
    """A CMR entry → (footprint Feature, None) or (None, skip reason)."""
    gid = entry.get("title", "")
    if not isinstance(gid, str) or not GRANULE_RE.fullmatch(gid):
        return None, "invalid_id"
    try:
        acquired = acquired_from_id(gid)
    except ValueError:  # matches the pattern but is not a real timestamp
        return None, "invalid_id"
    expected_tif = tif_url(gid)
    links = entry.get("links") or []
    if not any(isinstance(l, dict) and l.get("href") == expected_tif for l in links):
        return None, "no_asset"
    polygons = entry.get("polygons") or []
    ring = None
    for poly in polygons:
        if isinstance(poly, list) and poly and isinstance(poly[0], str):
            ring = parse_ring(poly[0])
            if ring:
                break
    if not ring:
        return None, "no_polygon"
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    center_lon = round(sum(lons[:-1]) / (len(lons) - 1), 5)
    center_lat = round(sum(lats[:-1]) / (len(lats) - 1), 5)
    return {
        "type": "Feature",
        "properties": {
            "granule_id": gid,
            "acquired": acquired,
            "tier": "detected",
            "center_lat": center_lat,
            "center_lon": center_lon,
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "bbox": [min(lons), min(lats), max(lons), max(lats)],
    }, None


def search_cmr(client: httpx.Client, bbox, start_d: date, end_d: date, max_results: int) -> tuple[list[dict], int, dict]:
    """All footprints in the extent and window (newest first), CMR hit count, skip counts."""
    features: list[dict] = []
    skipped: dict[str, int] = {}
    hits = 0
    page = 1
    page_size = min(CMR_PAGE_SIZE, max_results)
    while len(features) < max_results:
        r = client.get(CMR_URL, params={
            "short_name": SHORT_NAME,
            "bounding_box": ",".join(repr(round(v, 6)) for v in bbox),
            "temporal": f"{start_d.isoformat()}T00:00:00Z,{end_d.isoformat()}T23:59:59Z",
            "page_size": page_size,
            "page_num": page,
            "sort_key": "-start_date",
        })
        if r.status_code != 200:
            raise MethaneError(f"The NASA CMR catalogue answered HTTP {r.status_code}; try again shortly.")
        hits = int(r.headers.get("cmr-hits", "0") or 0)
        entries = r.json().get("feed", {}).get("entry", [])
        for e in entries:
            feat, reason = entry_to_feature(e)
            if feat:
                features.append(feat)
                if len(features) >= max_results:
                    break
            else:
                skipped[reason] = skipped.get(reason, 0) + 1
        if len(entries) < page_size or page * page_size >= hits:
            break
        page += 1
    return features, hits, skipped


# --- plume download and stats ---------------------------------------------------------------

class PlumeFetchError(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def download_plume(granule_id: str, token: str, timeout_s: float = DOWNLOAD_TIMEOUT_S,
                   cap_bytes: int = DOWNLOAD_CAP_BYTES) -> bytes:
    """Stream one plume GeoTIFF from LP DAAC with the bearer token. Raises PlumeFetchError."""
    if not token:
        raise PlumeFetchError("token_missing")
    url = tif_url(granule_id)
    # follow_redirects: LP DAAC answers with a redirect to a signed CloudFront URL; httpx removes
    # the Authorization header when the redirect changes origin, so the token stays with LP DAAC.
    with httpx.Client(timeout=timeout_s, follow_redirects=True, max_redirects=5) as client:
        with client.stream("GET", url, headers={"Authorization": f"Bearer {token}"}) as r:
            if r.status_code in (401, 403):
                raise PlumeFetchError("token_rejected")
            if r.status_code == 404:
                raise PlumeFetchError("not_found")
            if r.status_code != 200:
                raise PlumeFetchError(f"http_{r.status_code}")
            if r.url.scheme != "https":
                raise PlumeFetchError("insecure_redirect")
            chunks, total = [], 0
            for chunk in r.iter_bytes():
                total += len(chunk)
                if total > cap_bytes:
                    raise PlumeFetchError("size_cap")
                chunks.append(chunk)
    return b"".join(chunks)


def plume_stats(data: bytes, center_lat: float | None = None) -> dict:
    """Enhancement stats over the valid pixels of a plume GeoTIFF held in memory."""
    try:
        with MemoryFile(data) as mem, mem.open() as ds:
            if ds.driver != "GTiff" or ds.count < 1:
                raise PlumeFetchError("not_a_geotiff")
            band = ds.read(1, masked=True)
            valid = band.compressed().astype(np.float64)
            valid = valid[np.isfinite(valid)]
            if valid.size == 0:
                raise PlumeFetchError("no_valid_pixels")
            enhanced = valid[valid >= ENHANCED_PPM_M]
            xres, yres = abs(ds.transform.a), abs(ds.transform.e)
            if ds.crs is not None and ds.crs.is_geographic:
                lat = center_lat if center_lat is not None else (ds.bounds.bottom + ds.bounds.top) / 2
                px_km2 = (xres * 111.320 * math.cos(math.radians(lat))) * (yres * 110.574)
            else:
                px_km2 = xres * yres / 1e6
            return {
                "max_ppm_m": round(float(valid.max()), 1),
                "mean_ppm_m": round(float(enhanced.mean()), 1) if enhanced.size else None,
                "plume_pixels": int(enhanced.size),
                "plume_area_km2": round(float(enhanced.size * px_km2), 2),
                "valid_pixels": int(valid.size),
                "enhanced_threshold_ppm_m": ENHANCED_PPM_M,
                "bounds": [round(v, 5) for v in (ds.bounds.left, ds.bounds.bottom, ds.bounds.right, ds.bounds.top)],
            }
    except RasterioIOError:
        raise PlumeFetchError("not_a_geotiff")


def fetch_plume(granule_id: str, token: str, s3, center_lat: float | None = None) -> dict:
    """Stats for one plume, from the shared S3 cache when present, else LP DAAC (then cached)."""
    key = cache_key(granule_id)
    source = "cache"
    try:
        obj = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=key)
        data = obj["Body"].read(DOWNLOAD_CAP_BYTES + 1)
    except s3.exceptions.NoSuchKey:
        data = download_plume(granule_id, token)
        source = "lpdaac"
    stats = plume_stats(data, center_lat)
    if source == "lpdaac":
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=data, ContentType="image/tiff")
    stats["source"] = source
    stats["plume_s3_url"] = f"s3://{config.S3_BUCKET_NAME}/{key}"
    return stats


def rank_key(p: dict):
    return (-p["max_ppm_m"], -p["plume_pixels"], p["granule_id"])


# --- tools ----------------------------------------------------------------------------------

@tool
async def search_methane_plumes(region: str, start_date: str = None, end_date: str = None,
                                bbox: list = None, geometry_s3_url: str = None,
                                max_results: int = 50) -> str:
    """Find methane plume complexes NASA EMIT detected over a region and time window.

    Args:
        region: Region name, e.g. "Permian Basin". Known by name: Permian Basin, San Joaquin
            Valley, Four Corners, Marcellus, Turkmenistan. For any other place, geocode it with
            find_location_boundary and pass geometry_s3_url (or pass bbox).
        start_date: Optional YYYY-MM-DD. Default: 12 months before end_date.
        end_date: Optional YYYY-MM-DD. Default: the date of EMIT's most recent plume.
        bbox: Optional [west, south, east, north] in degrees; overrides the region's extent.
        geometry_s3_url: Optional boundary from find_location_boundary; its bounds are the extent.
        max_results: How many plumes to list (default 50, max 200), newest first.

    Returns: JSON with summary (count, window, CMR hits, archive date), plumes[] (granule_id,
    acquired, center_lat/lon), plumes_geometry_s3_url (footprints for the map), render (pass it
    to display_visual unchanged), next_steps.
    """
    started = time.time()
    try:
        max_results = _int(max_results, "max_results", 1, MAX_RESULTS_CAP)
        extent, label = resolve_extent(region, bbox, geometry_s3_url)
        with httpx.Client(timeout=CMR_TIMEOUT_S) as client:
            latest = archive_latest(client)
            start_d, end_d, window_note = resolve_window(start_date, end_date, latest)
            features, hits, skipped = search_cmr(client, extent, start_d, end_d, max_results)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except httpx.HTTPError as e:
        return json.dumps({"error": f"The NASA CMR catalogue could not be reached ({type(e).__name__}); try again shortly."})

    slug = f"{_slugify(label)}_{start_d.isoformat()}_{end_d.isoformat()}"
    fc = {"type": "FeatureCollection", "features": features}
    url = _put_json(f"{session_prefix()}plumes_{slug}.geojson", fc)
    n = len(features)
    summary = {
        "region": label, "bbox": list(extent), "start": start_d.isoformat(), "end": end_d.isoformat(),
        "window": window_note, "archive_latest": latest.isoformat() if latest else None,
        "count": n, "cmr_hits": hits, "skipped": skipped, "seconds": round(time.time() - started, 1),
    }
    out = {
        "summary": summary,
        "plumes": [{"granule_id": f["properties"]["granule_id"], "acquired": f["properties"]["acquired"],
                    "center_lat": f["properties"]["center_lat"], "center_lon": f["properties"]["center_lon"]}
                   for f in features],
        "plumes_geometry_s3_url": url,
        "render": RENDER_VECTOR,
        "next_steps": ("display_visual(plumes_geometry_s3_url, title, description, render=render), then report the "
                       "count and window. Call triage_plumes ONLY if the user asked to rank, triage or find the "
                       "strongest; otherwise stop and offer it."),
    }
    if n == 0:
        out["say"] = (f"EMIT recorded no methane plume complexes over {label} between "
                      f"{start_d.isoformat()} and {end_d.isoformat()}.")
    if hits > n:
        out["note"] = f"{hits} plumes match; the {n} most recent are listed (max_results={max_results})."
    logger.info("SEARCH: %s %s..%s → %d plumes (%d hits) in %.1fs", label, start_d, end_d, n, hits, summary["seconds"])
    return json.dumps(out)


@tool
async def triage_plumes(plumes_geometry_s3_url: str, top_n: int = 10) -> str:
    """Rank the plumes from search_methane_plumes by how much methane they carry.

    Reads every plume's CH4 enhancement raster (ppm·m), computes the max enhancement and the area
    and mean over pixels at or above 500 ppm·m, and ranks by max enhancement (ties: larger
    enhanced area, then granule id).

    Args:
        plumes_geometry_s3_url: The plumes_geometry_s3_url returned by search_methane_plumes.
        top_n: How many plumes to return ranked (default 10, max 50). All are measured.

    Returns: JSON with summary (triaged, failed, errors[], seconds), ranked[] (rank, granule_id,
    acquired, max_ppm_m, mean_ppm_m, plume_pixels, plume_area_km2, center_lat/lon, bbox,
    plume_s3_url), ranked_geometry_s3_url, render_vector (for the footprints), render_raster
    (for a plume raster), next_steps.
    """
    started = time.time()
    try:
        top_n = _int(top_n, "top_n", 1, TOP_N_CAP)
        url = _require_session_url(plumes_geometry_s3_url, "plumes_geometry_s3_url", "plumes_")
        fc = _get_json(url)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except Exception as e:
        return json.dumps({"error": f"Could not read the plume list ({type(e).__name__}). Run search_methane_plumes again."})

    features = [f for f in fc.get("features", []) if isinstance(f, dict)]
    seen, work = set(), []
    for f in features:
        props = f.get("properties") or {}
        gid = props.get("granule_id")
        if isinstance(gid, str) and GRANULE_RE.fullmatch(gid) and gid not in seen:
            seen.add(gid)
            work.append((gid, props))
    if not work:
        return json.dumps({"error": "The plume list is empty; there is nothing to triage."})
    truncated = len(work) > MAX_TRIAGE
    work = work[:MAX_TRIAGE]

    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    s3 = _s3()
    measured: dict[str, dict] = {}
    errors: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(work))) as pool:
        futures = {pool.submit(fetch_plume, gid, token, s3, props.get("center_lat")): (gid, props) for gid, props in work}
        for fut in as_completed(futures):
            gid, props = futures[fut]
            try:
                measured[gid] = {**fut.result(), "granule_id": gid, "acquired": props.get("acquired"),
                                 "center_lat": props.get("center_lat"), "center_lon": props.get("center_lon")}
            except PlumeFetchError as e:
                errors.append({"granule_id": gid, "reason": e.reason})
            except Exception as e:  # never let one plume sink the triage; never echo headers
                errors.append({"granule_id": gid, "reason": type(e).__name__})

    if not measured:
        reasons = {e["reason"] for e in errors}
        if reasons <= {"token_missing", "token_rejected"}:
            return json.dumps({"error": ("The Earthdata token is missing or expired, so the plume concentrations "
                                         "cannot be read. The plume list is still valid; refresh EARTHDATA_TOKEN on the runtime.")})
        return json.dumps({"error": f"No plume could be read ({', '.join(sorted(reasons))}).", "errors": errors[:20]})

    ordered = sorted(measured.values(), key=rank_key)
    for i, p in enumerate(ordered, start=1):
        p["rank"] = i
    by_gid = {p["granule_id"]: p for p in ordered}
    for f in features:
        props = f.get("properties") or {}
        p = by_gid.get(props.get("granule_id"))
        if p:
            props.update(rank=p["rank"], max_ppm_m=p["max_ppm_m"], plume_area_km2=p["plume_area_km2"],
                         tier="ranked" if p["rank"] <= top_n else "detected")
        f["properties"] = props

    ranked_url = _put_json(f"{session_prefix()}plumes_ranked_{url.rsplit('/plumes_', 1)[1]}", fc)
    top = [{k: p[k] for k in ("rank", "granule_id", "acquired", "max_ppm_m", "mean_ppm_m", "plume_pixels",
                              "plume_area_km2", "valid_pixels", "center_lat", "center_lon", "plume_s3_url")}
           | {"bbox": p["bounds"]} for p in ordered[:top_n]]
    summary = {
        "plumes_in": len(features), "triaged": len(measured), "failed": len(errors),
        "from_cache": sum(1 for p in measured.values() if p["source"] == "cache"),
        "downloaded": sum(1 for p in measured.values() if p["source"] == "lpdaac"),
        "truncated_to": MAX_TRIAGE if truncated else None,
        "errors": sorted(errors, key=lambda e: e["granule_id"])[:20],
        "top_n": top_n, "seconds": round(time.time() - started, 1),
        "definitions": (f"max_ppm_m: highest CH4 enhancement in the plume complex. plume_area_km2 and "
                        f"mean_ppm_m: over pixels at or above {ENHANCED_PPM_M:g} ppm·m (the rest is background)."),
    }
    logger.info("TRIAGE: %d measured (%d cached, %d downloaded), %d failed in %.1fs",
                summary["triaged"], summary["from_cache"], summary["downloaded"], summary["failed"], summary["seconds"])
    return json.dumps({
        "summary": summary,
        "ranked": top,
        "ranked_geometry_s3_url": ranked_url,
        "render_vector": RENDER_VECTOR,
        "render_raster": RENDER_RASTER,
        "next_steps": ("display_visual(ranked_geometry_s3_url, title, description, render=render_vector) together "
                       "with reverse_geocode of the top 3 centres, then report. Call show_plume ONLY if the user asked "
                       "to see a plume or the ground beneath it; otherwise stop and offer it."),
    })


@tool
async def show_plume(granule_id: str) -> str:
    """Get the raster of one plume that triage_plumes measured this session, ready for the map.

    Args:
        granule_id: e.g. the granule_id of rank 1 from triage_plumes.

    Returns: JSON with plume_s3_url, acquired, stats (max/mean ppm·m, pixels, area km²),
    center_lat/lon, bbox, and render (pass it to display_visual unchanged). Then inspect_image
    the plume_s3_url and look at the ground with create_bbox_from_coordinates + get_rasters.
    """
    try:
        gid = validate_granule_id(granule_id)
        s3 = _s3()
        prefix = f"{session_prefix()}plumes_ranked_"
        listing = s3.list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=prefix)
        objects = sorted(listing.get("Contents", []), key=lambda o: o["LastModified"], reverse=True)
        for obj in objects[:10]:
            fc = _get_json(f"s3://{config.S3_BUCKET_NAME}/{obj['Key']}")
            for f in fc.get("features", []):
                props = f.get("properties") or {}
                if props.get("granule_id") == gid and "rank" in props:
                    ring = f["geometry"]["coordinates"][0]
                    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
                    return json.dumps({
                        "granule_id": gid,
                        "rank": props["rank"],
                        "acquired": props.get("acquired"),
                        "acquired_date": (props.get("acquired") or "")[:10],
                        "max_ppm_m": props.get("max_ppm_m"),
                        "plume_area_km2": props.get("plume_area_km2"),
                        "center_lat": props.get("center_lat"),
                        "center_lon": props.get("center_lon"),
                        "bbox": [min(lons), min(lats), max(lons), max(lats)],
                        "plume_s3_url": f"s3://{config.S3_BUCKET_NAME}/{cache_key(gid)}",
                        "render": RENDER_RASTER,
                        "next_steps": ("inspect_image(plume_s3_url); then display_visual(plume_s3_url, render=render) "
                                       "with create_bbox_from_coordinates at the centre (radius_meters=3000) → "
                                       "get_rasters(current_date_str=acquired_date) → inspect_image(tci)."),
                    })
        return json.dumps({"error": f"{gid} has not been triaged in this session; run triage_plumes first."})
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    except Exception as e:
        return json.dumps({"error": f"Could not look up the plume ({type(e).__name__})."})
