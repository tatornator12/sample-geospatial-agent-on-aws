"""Carbon Mapper's public plume catalogue: independent methane detections near a Methane Watch site.

carbon_mapper_plumes   The CH4 plumes Carbon Mapper has published within R km of the site since
                       2025-01-01, newest first: seen by the Tanager-1 satellite, by EMIT (Carbon
                       Mapper's own processing of NASA's scenes) or by aircraft, each with Carbon
                       Mapper's emission estimate in kg/h. A second, independent look at a cued
                       site, with dates: the follow rule (methane_config W4) compares the newest of
                       these with the newest EMIT candidate pass.

Source: https://api.carbonmapper.org/api/v1/catalog/plumes/annotated (public, no key). Carbon
Mapper publishes a plume about 30 days after it is detected. Licence (https://carbonmapper.org/terms,
Jan 2026): non-commercial use, attribution "Source: Carbon Mapper (data.carbonmapper.org)",
share-alike. The user cleared its use for this demo on 2026-10-22 (.kiro/specs/methane-hunter).

Security, as in the other methane tools: the URL is built here from validated numbers only; one
host, a timeout, a size cap enforced while the body streams, at most a few pages; every field is
validated and mapped to a fixed vocabulary (dates, numbers, instrument and sector codes), so no free
text from the catalogue reaches the model, the brief or the stage. Read-through cache in the bucket
(methane/cache/), with the cached record as the fallback when the API is down.

The plume image (approved 2026-10-23): the newest plume within 7 km is drawn as 3D columns from
Carbon Mapper's own concentration raster (`con_tif`: one float32 band, 30 m, UTM, NaN outside their
analyst's mask, ppm·m). Its URL is a signed CloudFront link that expires 60 minutes after the API
answer, so it is fetched in the same call and never logged, returned or stored: https only, host
catalog.carbonmapper.org, a path naming that plume id, no redirects, streamed with a 2 MB cap, one
float32 band of at most 1,000 x 1,000 pixels, each pixel at 500 ppm·m or more reprojected cell by
cell to WGS84; the GeoJSON carries numbers only and is cached by plume id
(methane/cache/cmimage_v1_<plume_id>.geojson), so an outage still draws a plume already seen.
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import _paths  # noqa: F401
import httpx
import numpy as np
from strands import tool

import config
import methane_tools as mt
from methane_tools import MethaneError, _finite
from watch_tools import box_around, parse_point

logger = logging.getLogger("methane_tools")

CM_HOST = "api.carbonmapper.org"
CM_PATH = "/api/v1/catalog/plumes/annotated"
CM_TIMEOUT_S = 15.0
CM_PAGE_LIMIT = 1000
CM_MAX_PAGES = 3                      # a 5 km box holds tens of plumes; three pages is a hard stop
CM_CAP_BYTES = 6_000_000              # one page of 1,000 items is ~4.5 MB
# An honest agent: checked 2026-10-23, the catalogue and its image host answer the same 200 to this,
# to no User-Agent and to a browser's, so the browser string the first build sent is not needed.
CM_USER_AGENT = "agentic-earth-methane-watch/1.0 (+https://github.com/aws-samples/sample-geospatial-agent-on-aws)"
CM_SINCE = date(2025, 1, 1)
# One native TROPOMI footprint (5.5 x 7 km), measured from the hotspot cell's centre, the same for every
# site: the tip cannot place methane better than that. Approved 2026-10-23, chosen after seeing the
# Shanxi case (a recurring coal source 5.1 km from the site point, in the diagonal neighbour cell),
# so it is said as such in the spec. The record and the follow rule (methane_config W4b) both use it.
CM_RADIUS_KM = 7.0
CM_MAX_RADIUS_KM = 10.0
CM_LIST_MAX = 10                      # plumes returned to the model
CM_MAP_MAX = 200                      # plumes on the map layer
CM_DATES_MAX = 60                     # plumes on the stage's record timeline (numbers and codes only)
CM_CACHE_TTL_S = 12 * 3600
# v1 keys (5 km) belong to the stable runtime and v2 to the Oct 23 build (sector words): read by them,
# never written here. v3 rows carry sector codes and whether the plume has an image.
CM_CACHE_VERSION = "v3"
CM_LAG_DAYS = 30
EMIT_SITE_KM = 2.0                    # the session's pass record for this site: the nearest within 2 km

ATTRIBUTION = "Source: Carbon Mapper (data.carbonmapper.org)"

# Instrument codes in the catalogue -> the stage's codes; anything else that looks like a code is
# "other". The words are ours.
INSTRUMENT_CODES = {"tan": "tanager", "emi": "emit", "av3": "airborne", "ang": "airborne", "gao": "airborne",
                    "avn": "airborne"}
INSTRUMENT_WORDS = {"tanager": "Tanager-1", "emit": "EMIT", "airborne": "airborne", "other": "another instrument"}
# IPCC sector codes as Carbon Mapper labels them -> our fixed codes (the model sees a code, never the
# catalogue's text). A label, not a cause: the prompt says so.
SECTOR_CODES = {"1B1a": "coal_mining", "1B2": "oil_gas", "6A": "solid_waste", "6B": "wastewater",
                "4B": "manure", "4A": "livestock", "1A1": "power", "3C": "agriculture"}
# The words cached v2 rows carry, mapped to the same codes.
_LEGACY_SECTOR = {"coal mining": "coal_mining", "oil and gas": "oil_gas", "solid waste": "solid_waste",
                  "wastewater": "wastewater", "manure management": "manure", "livestock": "livestock",
                  "power generation": "power", "agriculture": "agriculture", "other": "other"}

# The plume image: Carbon Mapper's own concentration raster, drawn as 3D columns.
CM_IMAGE_HOST = "catalog.carbonmapper.org"
CM_IMAGE_CAP_BYTES = 2_000_000        # the ones seen are 10 to 60 KB
CM_IMAGE_MAX_PX = 1000
CM_IMAGE_TIMEOUT_S = 20.0
CM_IMAGE_FLOOR_PPM_M = 500.0          # the same floor as EMIT's display window and columns
CM_IMAGE_CELLS_MAX = 3000
CM_IMAGE_NEAR_KM = 20.0               # the image's pixels must lie near the plume Carbon Mapper placed
CM_IMAGE_CACHE_VERSION = "v1"
RENDER_IMAGE = {"kind": "columns", "property": "ppm_m", "ramp": "plasma", "rescale": [0, 1500], "units": "ppm·m",
                "group": "methane", "legend": "Carbon Mapper plume"}

RENDER_DETECTIONS = {"kind": "detections", "group": "methane", "property": "rate_kg_h", "units": "kg/h",
                     "legend": "Carbon Mapper plumes"}

_PLUME_ID = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
_CODE = re.compile(r"^[a-z0-9]{2,6}$")
_SECTOR = re.compile(r"^[0-9][A-Za-z0-9]{1,5}$")
_TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PASSES_KEY = re.compile(r"^passes_(-?\d+\.\d{4})_(-?\d+\.\d{4})\.json$")


class CatalogueError(RuntimeError):
    """The catalogue could not be read; the message is our own short code, never a URL or a body."""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _number(value: Any, lo: float, hi: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return v if math.isfinite(v) and lo <= v <= hi else None


def _rate(value: Any) -> float | None:
    """An emission estimate in kg/h: finite, 0 to 1,000,000."""
    return _number(value, 0, 1_000_000)


def parse_item(item: Any, lat: float, lon: float, radius_km: float, since: date, today: date) -> dict | None:
    """One catalogue item as a validated plume near the site, or None (not CH4, not published, outside
    the radius or the window, or any field malformed). Only dates, numbers and fixed words come out."""
    if not isinstance(item, dict) or item.get("gas") != "CH4" or item.get("status") != "published":
        return None
    pid = item.get("plume_id")
    if not isinstance(pid, str) or not _PLUME_ID.fullmatch(pid):
        return None
    geom = item.get("geometry_json")
    if not isinstance(geom, dict) or geom.get("type") != "Point":
        return None
    coords = geom.get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    plon, plat = _number(coords[0], -180, 180), _number(coords[1], -90, 90)
    if plon is None or plat is None:
        return None
    stamp = item.get("scene_timestamp")
    m = _TIMESTAMP.fullmatch(stamp) if isinstance(stamp, str) else None
    if not m:
        return None
    try:
        day = date.fromisoformat(m[1])
    except ValueError:
        return None
    if day < since or day > today + timedelta(days=1):
        return None
    dist = haversine_km(lat, lon, plat, plon)
    if dist > radius_km:
        return None
    code = item.get("instrument")
    if not isinstance(code, str) or not _CODE.fullmatch(code):
        return None
    instrument = INSTRUMENT_CODES.get(code, "other")
    # Carbon Mapper withholds some estimates (hide_emission): then there is no rate to show.
    rate = None if item.get("hide_emission") is True else _rate(item.get("emission_auto"))
    unc = _rate(item.get("emission_uncertainty_auto")) if rate is not None else None
    sector = item.get("sector")
    sector_code = (SECTOR_CODES.get(sector, "other") if isinstance(sector, str) and _SECTOR.fullmatch(sector) else None)
    return {"id": pid, "date": day.isoformat(), "lat": round(plat, 5), "lon": round(plon, 5),
            "distance_km": round(dist, 2), "instrument": instrument,
            "rate_kg_h": round(rate, 1) if rate is not None else None,
            "uncertainty_kg_h": round(unc, 1) if unc is not None else None,
            "sector": sector_code, "has_image": image_url_ok(item.get("con_tif"), pid)}


def catalogue_url(box: tuple[float, float, float, float], offset: int) -> tuple[str, list[tuple[str, str]]]:
    """The request, from validated numbers only."""
    w, s, e, n = box
    params = [("bbox", f"{w:.5f}"), ("bbox", f"{s:.5f}"), ("bbox", f"{e:.5f}"), ("bbox", f"{n:.5f}"),
              ("limit", str(CM_PAGE_LIMIT)), ("offset", str(int(offset)))]
    return f"https://{CM_HOST}{CM_PATH}", params


def read_capped(r: httpx.Response, cap: int, code: str) -> bytes:
    """A streamed body, read only up to `cap` bytes (a longer one is refused, not downloaded)."""
    length = r.headers.get("content-length")
    if length and length.isdigit() and int(length) > cap:
        raise CatalogueError(code)
    buf = bytearray()
    for chunk in r.iter_bytes():
        buf += chunk
        if len(buf) > cap:
            raise CatalogueError(code)
    return bytes(buf)


def fetch_page(client: httpx.Client, box, offset: int) -> dict:
    url, params = catalogue_url(box, offset)
    with client.stream("GET", url, params=params,
                       headers={"User-Agent": CM_USER_AGENT, "Accept": "application/json"}) as r:
        if r.status_code != 200:
            raise CatalogueError(f"carbon_mapper_http_{r.status_code}")
        raw = read_capped(r, CM_CAP_BYTES, "carbon_mapper_too_large")
    try:
        body = json.loads(raw)
    except ValueError:
        raise CatalogueError("carbon_mapper_not_json")
    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise CatalogueError("carbon_mapper_bad_shape")
    return body


def fetch_plumes(lat: float, lon: float, radius_km: float, since: date, today: date) -> tuple[list[dict], dict[str, str]]:
    """Every validated CH4 plume within the radius since `since`, from one to CM_MAX_PAGES pages, and
    the allowlisted image URL of each plume that has one (held in memory for this call only)."""
    box = box_around(lat, lon, radius_km)
    out: dict[str, dict] = {}
    urls: dict[str, str] = {}
    with httpx.Client(timeout=CM_TIMEOUT_S, follow_redirects=False) as client:
        offset = 0
        for _ in range(CM_MAX_PAGES):
            body = fetch_page(client, box, offset)
            items = body["items"]
            for item in items:
                p = parse_item(item, lat, lon, radius_km, since, today)
                if p and p["id"] not in out:
                    out[p["id"]] = p
                    if p["has_image"]:
                        urls[p["id"]] = item["con_tif"]
            total = body.get("bbox_count")
            offset += CM_PAGE_LIMIT
            if len(items) < CM_PAGE_LIMIT or not isinstance(total, int) or offset >= total:
                break
    return newest_first(list(out.values())), urls


def newest_first(plumes: list[dict]) -> list[dict]:
    """Newest date first; within a date the plume nearest the site first."""
    return sorted(plumes, key=lambda p: (-date.fromisoformat(p["date"]).toordinal(), p["distance_km"]))


def cache_key(lat: float, lon: float, radius_km: float) -> str:
    return f"methane/cache/carbonmapper_{CM_CACHE_VERSION}_{lat:.4f}_{lon:.4f}_{radius_km:g}km.json"


def load_plumes(lat: float, lon: float, radius_km: float, since: date, s3,
                now: datetime | None = None) -> tuple[list[dict], str, str, dict[str, str]]:
    """(plumes, source, fetched day, image URLs): the shared cache when fresh, else the catalogue, else
    the cached record however old (the API is down). Raises CatalogueError when there is neither. The
    image URLs come only from a fresh answer (they are never cached)."""
    now = now or datetime.now(timezone.utc)
    key = cache_key(lat, lon, radius_km)
    cached = None
    try:
        cached = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=key)["Body"].read(2_000_000))
        fetched = datetime.fromisoformat(cached["fetched_at"])
        if not isinstance(cached.get("plumes"), list) or cached.get("since") != since.isoformat():
            cached = None
        elif (now - fetched).total_seconds() < CM_CACHE_TTL_S:
            return (revalidate(cached["plumes"], lat, lon, radius_km, since, now.date()), "cache",
                    fetched.date().isoformat(), {})
    except s3.exceptions.NoSuchKey:
        cached = None
    except Exception as e:  # a malformed cache entry is ignored and refetched
        logger.warning("carbon mapper cache unreadable: %s", type(e).__name__)
        cached = None
    try:
        plumes, urls = fetch_plumes(lat, lon, radius_km, since, now.date())
    except (httpx.HTTPError, CatalogueError) as e:
        code = str(e) if isinstance(e, CatalogueError) else type(e).__name__
        logger.warning("CARBON MAPPER: %.3f,%.3f catalogue unavailable (%s)", lat, lon, code)
        if cached is not None:
            return (revalidate(cached["plumes"], lat, lon, radius_km, since, now.date()), "stale cache",
                    datetime.fromisoformat(cached["fetched_at"]).date().isoformat(), {})
        raise CatalogueError(code)
    try:
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=key, ContentType="application/json",
                      Body=json.dumps({"fetched_at": now.isoformat(), "since": since.isoformat(),
                                       "radius_km": radius_km, "plumes": plumes}).encode())
    except Exception as e:  # the cache is an optimisation: never fail the check for it
        logger.warning("carbon mapper cache write failed: %s", type(e).__name__)
    return plumes, "carbon-mapper", now.date().isoformat(), urls


_SECTOR_VALUES = set(SECTOR_CODES.values()) | {"other"}


def revalidate(rows: list, lat: float, lon: float, radius_km: float, since: date, today: date) -> list[dict]:
    """Cached rows pass the same checks again, field by field (the cache is ours, but S3 is not the code)."""
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        pid, day = r.get("id"), r.get("date")
        plat, plon = _number(r.get("lat"), -90, 90), _number(r.get("lon"), -180, 180)
        if not (isinstance(pid, str) and _PLUME_ID.fullmatch(pid) and isinstance(day, str) and _DAY.fullmatch(day)):
            continue
        try:
            d = date.fromisoformat(day)
        except ValueError:
            continue
        if plat is None or plon is None or d < since or d > today + timedelta(days=1):
            continue
        dist = haversine_km(lat, lon, plat, plon)
        if dist > radius_km or r.get("instrument") not in INSTRUMENT_WORDS:
            continue
        rate = _rate(r.get("rate_kg_h"))
        unc = _rate(r.get("uncertainty_kg_h")) if rate is not None else None
        sector = r.get("sector") if r.get("sector") in _SECTOR_VALUES else _LEGACY_SECTOR.get(r.get("sector"))
        out.append({"id": pid, "date": day, "lat": plat, "lon": plon, "distance_km": round(dist, 2),
                    "instrument": r["instrument"], "rate_kg_h": rate, "uncertainty_kg_h": unc, "sector": sector,
                    "has_image": r.get("has_image") is True})
    return newest_first(out)


def latest_plume(plumes: list[dict]) -> dict | None:
    """The newest plume: on the newest date, the nearest one that carries a rate (else the nearest)."""
    if not plumes:
        return None
    day = plumes[0]["date"]
    same = [p for p in plumes if p["date"] == day]
    with_rate = [p for p in same if p["rate_kg_h"] is not None]
    return min(with_rate or same, key=lambda p: p["distance_km"])


def emit_record(lat: float, lon: float, s3) -> dict | None:
    """The session's EMIT pass record for this site (check_recent_passes' manifest, nearest within 2
    km): its candidate count and the newest candidate's date. None when the passes were not read."""
    try:
        listing = s3.list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=f"{mt.session_prefix()}passes_")
        best = None
        for obj in listing.get("Contents", []):
            m = _PASSES_KEY.fullmatch(obj["Key"].rsplit("/", 1)[-1])
            if not m:
                continue
            d = haversine_km(lat, lon, float(m[1]), float(m[2]))
            if d <= EMIT_SITE_KM and (best is None or d < best[0]):
                best = (d, obj["Key"])
        if best is None:
            return None
        body = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=best[1])["Body"].read(500_000))
        passes = [p for p in body.get("passes") or [] if isinstance(p, dict)]
        cands = [p for p in passes if p.get("verdict") == "candidate"
                 and isinstance(p.get("date"), str) and _DAY.fullmatch(p["date"])]
        peaks = [p.get("peak_ppm_m") for p in cands if isinstance(p.get("peak_ppm_m"), (int, float))]
        return {"read": len(passes), "candidates": len(cands),
                "latest_candidate": max((p["date"] for p in cands), default=None),
                "peak_ppm_m": max(peaks) if peaks else None}
    except Exception as e:  # an addition to the answer, never a reason to fail it
        logger.warning("emit record lookup failed: %s", type(e).__name__)
        return None


CONFIRMED_WORDS = {"emit": "an EMIT candidate pass", "carbon_mapper": "a Carbon Mapper plume",
                   "both": "an EMIT candidate pass and a Carbon Mapper plume"}


def latest_confirmed_code(emit_latest: str | None, cm_latest: str | None) -> dict | None:
    """The site's newest confirmed detection as data: {date, by: emit | carbon_mapper | both}."""
    if not emit_latest and not cm_latest:
        return None
    if emit_latest and cm_latest and emit_latest == cm_latest:
        return {"date": emit_latest, "by": "both"}
    if emit_latest and (not cm_latest or emit_latest > cm_latest):
        return {"date": emit_latest, "by": "emit"}
    return {"date": cm_latest, "by": "carbon_mapper"}


def tip_start_at(lat: float, lon: float, s3) -> str | None:
    """The first day of this session's TROPOMI window over the watch area holding the point (tip_<area>.json)."""
    from watch_tools import WATCH_AREAS
    for key, spec in WATCH_AREAS.items():
        w, s_, e, n = spec["bbox"]
        if not (w <= lon <= e and s_ <= lat <= n):
            continue
        try:
            tip = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME,
                                           Key=f"{mt.session_prefix()}tip_{key.replace(' ', '_')}.json")["Body"].read(50_000))
        except Exception:
            continue
        start = tip.get("start") if isinstance(tip, dict) else None
        if isinstance(start, str) and _DAY.fullmatch(start):
            return start
    return None


def with_gap(found: dict | None, tip_start: str | None) -> dict | None:
    """The latest confirmation with its distance before the tip window (the follow rule's 90 days)."""
    if not found or not tip_start:
        return found
    days = (date.fromisoformat(tip_start) - date.fromisoformat(found["date"])).days
    return {**found, "days_before_tip": days, "within_90_days": days <= FOLLOW_GAP_DAYS}


FOLLOW_GAP_DAYS = 90                  # the follow rule's step 2 and draft_brief's threshold


def latest_confirmed(emit: dict | None, cm_latest: str | None) -> dict | None:
    """The site's newest confirmed detection: an EMIT candidate pass or a Carbon Mapper plume (in words)."""
    found = latest_confirmed_code((emit or {}).get("latest_candidate"), cm_latest)
    return found and {"date": found["date"], "by": CONFIRMED_WORDS[found["by"]]}


def record_dates(plumes: list[dict]) -> list[dict]:
    """The record timeline's plumes: date, instrument code, rate and distance, newest first, at most
    CM_DATES_MAX. Numbers and fixed codes only (the same posture as the rest of the record)."""
    return [{"date": p["date"], "instrument": p["instrument"], "rate_kg_h": p["rate_kg_h"],
             "distance_km": p["distance_km"]} for p in plumes[:CM_DATES_MAX]]


def about(value: float | None) -> int | None:
    """A rate as the room hears it: to the nearest 10 kg/h."""
    # Half up, as the stage rounds (JS Math.round): 265 is 270 on the board and in the brief alike.
    return None if value is None else int(math.floor(value / 10.0 + 0.5) * 10)


def say_line(count: int, radius_km: float, since: str, latest: dict | None) -> str:
    """One sentence, written by code from the numbers."""
    where = f"within {radius_km:g} km since {since}"
    if count == 0:
        return (f"Carbon Mapper lists no methane plume {where} (it publishes about {CM_LAG_DAYS} days after a "
                f"detection).")
    noun = "plume" if count == 1 else "plumes"
    rate = ""
    if latest and latest.get("rate_kg_h") is not None:
        unc = f" ± {about(latest['uncertainty_kg_h']):,}" if latest.get("uncertainty_kg_h") is not None else ""
        rate = f", about {about(latest['rate_kg_h']):,}{unc} kg/h"
    return (f"Carbon Mapper lists {count} methane {noun} {where}; the latest on {latest['date']} "
            f"({INSTRUMENT_WORDS[latest['instrument']]}{rate}).")


# --- the plume image as 3D columns ---------------------------------------------------------------

_IMAGE_PATH = r"^/([a-z0-9][a-z0-9-]{{0,39}})/\d{{4}}/\d{{2}}/\d{{2}}/{pid}/{pid}_\1_(?:ime-cmf-)?concentrations\.tif$"


def image_url_ok(url: Any, plume_id: str) -> bool:
    """Whether a catalogue image URL is one we fetch: https, Carbon Mapper's image host on the default
    port, no credentials in it, and a path naming this plume id (as the catalogue builds them, e.g.
    /l3a-ime-ch4-mfa-v3d/2026/06/20/<id>/<id>_l3a-ime-ch4-mfa-v3d_ime-cmf-concentrations.tif). The
    signed query is kept for the request and never logged."""
    if not isinstance(url, str) or len(url) > 4000 or not isinstance(plume_id, str) or not _PLUME_ID.fullmatch(plume_id):
        return False
    try:
        u = httpx.URL(url)
    except Exception:
        return False
    if u.scheme != "https" or u.host != CM_IMAGE_HOST or u.port not in (None, 443) or u.userinfo:
        return False
    return re.fullmatch(_IMAGE_PATH.format(pid=re.escape(plume_id)), u.path) is not None


def fetch_image(url: str, plume_id: str) -> bytes:
    """The plume's concentration raster: allowlisted, no redirects, streamed with the size cap.
    Errors are our own short codes (an expired link answers 403); the URL never reaches a log."""
    if not image_url_ok(url, plume_id):
        raise CatalogueError("cm_image_url_not_allowed")
    try:
        with httpx.Client(timeout=CM_IMAGE_TIMEOUT_S, follow_redirects=False) as client:
            with client.stream("GET", url, headers={"User-Agent": CM_USER_AGENT}) as r:
                if r.status_code != 200:
                    raise CatalogueError(f"cm_image_http_{r.status_code}")
                return read_capped(r, CM_IMAGE_CAP_BYTES, "cm_image_too_large")
    except httpx.HTTPError as e:
        raise CatalogueError(f"cm_image_{type(e).__name__}")


def image_columns(data: bytes, plat: float, plon: float) -> dict:
    """The raster's pixels at or above the floor as WGS84 cells with their ppm·m, strongest first: each
    pixel's four corners reprojected from the image's own grid (UTM), numbers only."""
    from rasterio.errors import RasterioIOError
    from rasterio.io import MemoryFile
    from rasterio.warp import transform as reproject_points
    try:
        with MemoryFile(data) as mem, mem.open() as ds:
            if ds.count != 1 or ds.dtypes[0] != "float32":
                raise CatalogueError("cm_image_not_one_float32_band")
            if not (1 <= ds.width <= CM_IMAGE_MAX_PX and 1 <= ds.height <= CM_IMAGE_MAX_PX):
                raise CatalogueError("cm_image_too_many_pixels")
            if ds.crs is None or not ds.crs.is_projected:
                raise CatalogueError("cm_image_not_projected")
            a = ds.read(1).astype(np.float64)
            if ds.nodata is not None:
                a[a == ds.nodata] = np.nan
            tr, crs = ds.transform, ds.crs
    except (RasterioIOError, ValueError):
        raise CatalogueError("cm_image_unreadable")
    rows, cols = np.where(np.isfinite(a) & (a >= CM_IMAGE_FLOOR_PPM_M))
    order = np.argsort(-a[rows, cols])[:CM_IMAGE_CELLS_MAX]
    rows, cols = rows[order], cols[order]
    if rows.size == 0:
        return {"type": "FeatureCollection", "features": []}
    corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
    xs, ys = [], []
    for r, c in zip(rows, cols):
        for dc, dr in corners:
            x, y = tr * (int(c) + dc, int(r) + dr)
            xs.append(x)
            ys.append(y)
    lons, lats = reproject_points(crs, "EPSG:4326", xs, ys)
    lons, lats = np.asarray(lons), np.asarray(lats)
    if not (np.isfinite(lons).all() and np.isfinite(lats).all()):
        raise CatalogueError("cm_image_not_projected")
    if haversine_km(plat, plon, float(np.mean(lats)), float(np.mean(lons))) > CM_IMAGE_NEAR_KM:
        raise CatalogueError("cm_image_misplaced")
    feats = []
    for i, (r, c) in enumerate(zip(rows, cols)):
        ring = [[round(float(lons[4 * i + k]), 6), round(float(lats[4 * i + k]), 6)] for k in (0, 1, 2, 3, 0)]
        feats.append({"type": "Feature", "properties": {"ppm_m": round(float(a[r, c]), 1)},
                      "geometry": {"type": "Polygon", "coordinates": [ring]}})
    return {"type": "FeatureCollection", "features": feats}


def clean_columns(fc: Any) -> dict:
    """A cached image collection again, field by field: polygons of finite numbers and `ppm_m` only."""
    feats = fc.get("features") if isinstance(fc, dict) else None
    out = []
    for f in feats[:CM_IMAGE_CELLS_MAX] if isinstance(feats, list) else []:
        try:
            ring, v = f["geometry"]["coordinates"][0], f["properties"]["ppm_m"]
        except (KeyError, IndexError, TypeError):
            continue
        if _number(v, 0, 1_000_000) is None or not isinstance(ring, list) or len(ring) != 5:
            continue
        if not all(isinstance(pt, list) and len(pt) == 2 for pt in ring):
            continue
        pts = [[_number(x, -180, 180), _number(y, -90, 90)] for x, y in ring]
        if all(x is not None and y is not None for x, y in pts):
            out.append({"type": "Feature", "properties": {"ppm_m": float(v)},
                        "geometry": {"type": "Polygon", "coordinates": [pts]}})
    return {"type": "FeatureCollection", "features": out}


def image_cache_key(plume_id: str) -> str:
    return f"methane/cache/cmimage_{CM_IMAGE_CACHE_VERSION}_{plume_id}.geojson"


def image_plume(plumes: list[dict]) -> dict | None:
    """The plume to draw: the newest within the follow radius (one TROPOMI footprint), the nearest on that day."""
    near = [p for p in plumes if p["distance_km"] <= CM_RADIUS_KM]
    if not near:
        return None
    day = max(p["date"] for p in near)
    return min((p for p in near if p["date"] == day), key=lambda p: p["distance_km"])


def plume_image(target: dict, urls: dict[str, str], refetch, s3) -> dict:
    """The newest plume's columns in this session (cmcolumns_<plume_id>.geojson), from the shared cache
    or fetched now, as a record entry: numbers, a date, a code and the file name; or why not."""
    pid = target["id"]
    base = {"plume_id": pid, "date": target["date"], "distance_km": target["distance_km"],
            "instrument": target["instrument"]}
    fc = None
    try:
        fc = clean_columns(json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=image_cache_key(pid))["Body"]
                                      .read(CM_IMAGE_CAP_BYTES * 4)))
    except s3.exceptions.NoSuchKey:
        fc = None
    except Exception as e:
        logger.warning("carbon mapper image cache unreadable: %s", type(e).__name__)
        fc = None
    if fc is None:
        url = urls.get(pid)
        if url is None and target.get("has_image"):
            try:   # the plume list came from the cache: a fresh answer carries a fresh link
                url = refetch().get(pid)
            except (httpx.HTTPError, CatalogueError) as e:
                logger.warning("CARBON MAPPER image link unavailable (%s)", type(e).__name__)
        if url is None:
            return {**base, "status": "unavailable", "code": "cm_image_no_link"}
        try:
            fc = image_columns(fetch_image(url, pid), target["lat"], target["lon"])
        except CatalogueError as e:
            logger.warning("CARBON MAPPER image %s: %s", pid, e)
            return {**base, "status": "unavailable", "code": str(e)}
        try:
            mt._put_json(image_cache_key(pid), fc)
        except Exception as e:  # the cache is an optimisation
            logger.warning("carbon mapper image cache write failed: %s", type(e).__name__)
    if not fc["features"]:
        return {**base, "status": "unavailable", "code": "cm_image_below_floor"}
    name = f"cmcolumns_{pid}.geojson"
    mt._put_json(f"{mt.session_prefix()}{name}", fc)
    peak = max(f["properties"]["ppm_m"] for f in fc["features"])
    return {**base, "status": "ok", "pixels": len(fc["features"]), "peak_ppm_m": round(peak, 1), "file": name}


def stage_key(lat: float, lon: float, ext: str) -> str:
    return f"{mt.session_prefix()}cmplumes_{lat:.4f}_{lon:.4f}.{ext}"


@tool
@mt.offload
async def carbon_mapper_plumes(lat: float, lon: float, radius_km: float = CM_RADIUS_KM) -> str:
    """Independent check: the methane plumes Carbon Mapper has published near a site since 2025-01-01.

    Carbon Mapper's public catalogue lists plumes seen by the Tanager-1 satellite, by EMIT and by
    aircraft, each with its own emission estimate (kg/h). It publishes about 30 days after a
    detection. Use the same lat/lon you passed to check_recent_passes for the site.

    Args:
        lat, lon: The cued site in degrees (the TROPOMI hotspot EMIT was cued on).
        radius_km: Search radius (default 7 km, one TROPOMI footprint; max 10). Leave it at the default.

    Returns: JSON with summary (count, latest_date, latest_rate_kg_h, latest_uncertainty_kg_h,
    latest_instrument, radius_km, since, source), plumes[] (newest first, at most 10: date,
    instrument, rate_kg_h, uncertainty_kg_h, distance_km, sector), emit (this site's EMIT candidate
    passes from check_recent_passes: candidates, latest_candidate), latest_confirmed (date, by: the
    newer of the two), say (one sentence), plumes_geometry_s3_url + render (the plume points for the
    map), attribution, next_steps.
    """
    started = time.time()
    try:
        lat, lon = parse_point(lat, lon)
        radius_km = _finite(radius_km, "radius_km", 0.5, CM_MAX_RADIUS_KM)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    s3 = mt._s3()
    since = CM_SINCE
    try:
        plumes, source, fetched, urls = load_plumes(lat, lon, radius_km, since, s3)
    except CatalogueError:
        emit = emit_record(lat, lon, s3)
        try:   # the board says the check could not be made, rather than going quiet
            mt._put_json(stage_key(lat, lon, "json"), {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km,
                                                        "since": since.isoformat(), "status": "unavailable"})
        except Exception as e:
            logger.warning("carbon mapper record failed: %s", type(e).__name__)
        return json.dumps({
            "error": "Carbon Mapper's catalogue could not be reached and nothing is cached for this site; the "
                     "independent check is unavailable, so the choice rests on EMIT's passes alone.",
            "emit": emit, "latest_confirmed": latest_confirmed(emit, None)})
    latest = latest_plume(plumes)
    words = {"tanager": 0, "emit": 0, "airborne": 0, "other": 0}
    for p in plumes:
        words[p["instrument"]] += 1
    summary = {
        "lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "since": since.isoformat(),
        "count": len(plumes),
        "by_instrument": {INSTRUMENT_WORDS[k]: v for k, v in words.items() if v},
        "latest_date": latest["date"] if latest else None,
        "latest_rate_kg_h": latest["rate_kg_h"] if latest else None,
        "latest_uncertainty_kg_h": latest["uncertainty_kg_h"] if latest else None,
        "latest_instrument": INSTRUMENT_WORDS[latest["instrument"]] if latest else None,
        "source": source, "fetched": fetched, "publication_lag_days": CM_LAG_DAYS,
    }
    emit = emit_record(lat, lon, s3)
    # The follow rule counts Carbon Mapper plumes within one TROPOMI footprint, whatever radius was asked for.
    cm_follow = next((p["date"] for p in plumes if p["distance_km"] <= CM_RADIUS_KM), None)
    confirmed = latest_confirmed_code((emit or {}).get("latest_candidate"), cm_follow)
    # The stage's record: numbers, dates and codes only (the tip board, the record timeline and the brief read it).
    # The newest plume within one footprint as its own image's columns (fetched in this call: the
    # catalogue's link expires within the hour), cached by plume id.
    target = image_plume(plumes)
    image = None
    if target:
        try:
            image = plume_image(target, urls, lambda: fetch_plumes(lat, lon, radius_km, since,
                                                                   datetime.now(timezone.utc).date())[1], s3)
        except Exception as e:  # the bars are an addition: never fail the check for them
            logger.warning("carbon mapper image failed: %s", type(e).__name__)
            image = {"plume_id": target["id"], "date": target["date"], "status": "unavailable", "code": "cm_image_error"}
    record = {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "since": since.isoformat(),
              "count": len(plumes), "latest": summary["latest_date"],
              "rate_kg_h": latest["rate_kg_h"] if latest else None,
              "uncertainty_kg_h": latest["uncertainty_kg_h"] if latest else None,
              "instrument": latest["instrument"] if latest else None, "source": source,
              "follow_radius_km": CM_RADIUS_KM, "dates": record_dates(plumes), "latest_confirmed": confirmed,
              "image": image}
    geometry_url = None
    try:
        mt._put_json(stage_key(lat, lon, "json"), record)
        if plumes:
            geometry_url = mt._put_json(stage_key(lat, lon, "geojson"), {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                 "properties": {"date": p["date"], "rate_kg_h": p["rate_kg_h"], "instrument": p["instrument"]}}
                for p in plumes[:CM_MAP_MAX]]})
    except Exception as e:  # the board is decoration: never fail the check for it
        logger.warning("carbon mapper record failed: %s", type(e).__name__)
    summary["seconds"] = round(time.time() - started, 1)
    logger.info("CARBON MAPPER: %.3f,%.3f %d plumes, latest %s (%s, %.1fs)", lat, lon, len(plumes),
                summary["latest_date"], source, summary["seconds"])
    out = {
        "summary": summary,
        "plumes": [{"date": p["date"], "instrument": INSTRUMENT_WORDS[p["instrument"]], "rate_kg_h": p["rate_kg_h"],
                    "uncertainty_kg_h": p["uncertainty_kg_h"], "distance_km": p["distance_km"], "sector": p["sector"]}
                   for p in plumes[:CM_LIST_MAX]],
        "emit": emit,
        "latest_confirmed": with_gap(latest_confirmed(emit, cm_follow), tip_start_at(lat, lon, s3)),
        "latest_image": image and ({k: image[k] for k in ("date", "pixels", "peak_ppm_m")} if image.get("status") == "ok"
                                   else {"date": image["date"], "status": "unavailable"}),
        "say": say_line(len(plumes), radius_km, since.isoformat(), latest),
        "attribution": ATTRIBUTION,
        "next_steps": ("Compare the cued sites' latest_confirmed dates and within_90_days (the follow rule, then "
                       "follow_site). A rate is Carbon Mapper's estimate, never EMIT's or yours; sector is a code for "
                       "Carbon Mapper's label for the area, never a cause: do not repeat it."),
    }
    if source == "stale cache":
        out["note"] = (f"Carbon Mapper could not be reached; this is its record as fetched on {fetched}.")
    if geometry_url:
        out["plumes_geometry_s3_url"] = geometry_url
        out["render"] = RENDER_DETECTIONS
    return json.dumps(out)
