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
host, a timeout, a size cap, at most a few pages; every field is validated and mapped to a fixed
vocabulary (dates, numbers, instrument and sector words), so no free text from the catalogue
reaches the model, the brief or the stage. The catalogue's signed image URLs are never kept.
Read-through cache in the bucket (methane/cache/), with the cached record as the fallback when
the API is down.
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
# The catalogue answers browsers; the suffix says who is asking.
CM_USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                 "Chrome/130.0 Safari/537.36 agentic-earth-methane-watch/1.0")
CM_SINCE = date(2025, 1, 1)
CM_RADIUS_KM = 5.0
CM_MAX_RADIUS_KM = 10.0
CM_LIST_MAX = 10                      # plumes returned to the model
CM_MAP_MAX = 200                      # plumes on the map layer
CM_CACHE_TTL_S = 12 * 3600
CM_CACHE_VERSION = "v1"
CM_LAG_DAYS = 30
EMIT_SITE_KM = 2.0                    # the session's pass record for this site: the nearest within 2 km

ATTRIBUTION = "Source: Carbon Mapper (data.carbonmapper.org)"

# Instrument codes in the catalogue -> the stage's codes; anything else that looks like a code is
# "other". The words are ours.
INSTRUMENT_CODES = {"tan": "tanager", "emi": "emit", "av3": "airborne", "ang": "airborne", "gao": "airborne",
                    "avn": "airborne"}
INSTRUMENT_WORDS = {"tanager": "Tanager-1", "emit": "EMIT", "airborne": "airborne", "other": "another instrument"}
# IPCC sector codes as Carbon Mapper labels them -> words. A label, not a cause: the prompt says so.
SECTOR_WORDS = {"1B1a": "coal mining", "1B2": "oil and gas", "6A": "solid waste", "6B": "wastewater",
                "4B": "manure management", "4A": "livestock", "1A1": "power generation", "3C": "agriculture"}

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
    sector_word = (SECTOR_WORDS.get(sector, "other") if isinstance(sector, str) and _SECTOR.fullmatch(sector) else None)
    return {"id": pid, "date": day.isoformat(), "lat": round(plat, 5), "lon": round(plon, 5),
            "distance_km": round(dist, 2), "instrument": instrument,
            "rate_kg_h": round(rate, 1) if rate is not None else None,
            "uncertainty_kg_h": round(unc, 1) if unc is not None else None,
            "sector": sector_word}


def catalogue_url(box: tuple[float, float, float, float], offset: int) -> tuple[str, list[tuple[str, str]]]:
    """The request, from validated numbers only."""
    w, s, e, n = box
    params = [("bbox", f"{w:.5f}"), ("bbox", f"{s:.5f}"), ("bbox", f"{e:.5f}"), ("bbox", f"{n:.5f}"),
              ("limit", str(CM_PAGE_LIMIT)), ("offset", str(int(offset)))]
    return f"https://{CM_HOST}{CM_PATH}", params


def fetch_page(client: httpx.Client, box, offset: int) -> dict:
    url, params = catalogue_url(box, offset)
    r = client.get(url, params=params, headers={"User-Agent": CM_USER_AGENT, "Accept": "application/json"})
    if r.status_code != 200:
        raise CatalogueError(f"carbon_mapper_http_{r.status_code}")
    if len(r.content) > CM_CAP_BYTES:
        raise CatalogueError("carbon_mapper_too_large")
    try:
        body = r.json()
    except ValueError:
        raise CatalogueError("carbon_mapper_not_json")
    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise CatalogueError("carbon_mapper_bad_shape")
    return body


def fetch_plumes(lat: float, lon: float, radius_km: float, since: date, today: date) -> list[dict]:
    """Every validated CH4 plume within the radius since `since`, from one to CM_MAX_PAGES pages."""
    box = box_around(lat, lon, radius_km)
    out: dict[str, dict] = {}
    with httpx.Client(timeout=CM_TIMEOUT_S, follow_redirects=False) as client:
        offset = 0
        for _ in range(CM_MAX_PAGES):
            body = fetch_page(client, box, offset)
            items = body["items"]
            for item in items:
                p = parse_item(item, lat, lon, radius_km, since, today)
                if p and p["id"] not in out:
                    out[p["id"]] = p
            total = body.get("bbox_count")
            offset += CM_PAGE_LIMIT
            if len(items) < CM_PAGE_LIMIT or not isinstance(total, int) or offset >= total:
                break
    return newest_first(list(out.values()))


def newest_first(plumes: list[dict]) -> list[dict]:
    """Newest date first; within a date the plume nearest the site first."""
    return sorted(plumes, key=lambda p: (-date.fromisoformat(p["date"]).toordinal(), p["distance_km"]))


def cache_key(lat: float, lon: float, radius_km: float) -> str:
    return f"methane/cache/carbonmapper_{CM_CACHE_VERSION}_{lat:.4f}_{lon:.4f}_{radius_km:g}km.json"


def load_plumes(lat: float, lon: float, radius_km: float, since: date, s3, now: datetime | None = None) -> tuple[list[dict], str, str]:
    """(plumes, source, fetched day): the shared cache when fresh, else the catalogue, else the cached
    record however old (the API is down). Raises CatalogueError when there is neither."""
    now = now or datetime.now(timezone.utc)
    key = cache_key(lat, lon, radius_km)
    cached = None
    try:
        cached = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=key)["Body"].read(2_000_000))
        fetched = datetime.fromisoformat(cached["fetched_at"])
        if not isinstance(cached.get("plumes"), list) or cached.get("since") != since.isoformat():
            cached = None
        elif (now - fetched).total_seconds() < CM_CACHE_TTL_S:
            return revalidate(cached["plumes"], lat, lon, radius_km, since, now.date()), "cache", fetched.date().isoformat()
    except s3.exceptions.NoSuchKey:
        cached = None
    except Exception as e:  # a malformed cache entry is ignored and refetched
        logger.warning("carbon mapper cache unreadable: %s", type(e).__name__)
        cached = None
    try:
        plumes = fetch_plumes(lat, lon, radius_km, since, now.date())
    except (httpx.HTTPError, CatalogueError) as e:
        code = str(e) if isinstance(e, CatalogueError) else type(e).__name__
        logger.warning("CARBON MAPPER: %.3f,%.3f catalogue unavailable (%s)", lat, lon, code)
        if cached is not None:
            return (revalidate(cached["plumes"], lat, lon, radius_km, since, now.date()), "stale cache",
                    datetime.fromisoformat(cached["fetched_at"]).date().isoformat())
        raise CatalogueError(code)
    try:
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=key, ContentType="application/json",
                      Body=json.dumps({"fetched_at": now.isoformat(), "since": since.isoformat(),
                                       "radius_km": radius_km, "plumes": plumes}).encode())
    except Exception as e:  # the cache is an optimisation: never fail the check for it
        logger.warning("carbon mapper cache write failed: %s", type(e).__name__)
    return plumes, "carbon-mapper", now.date().isoformat()


_SECTOR_VALUES = set(SECTOR_WORDS.values()) | {"other"}


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
        sector = r.get("sector") if r.get("sector") in _SECTOR_VALUES else None
        out.append({"id": pid, "date": day, "lat": plat, "lon": plon, "distance_km": round(dist, 2),
                    "instrument": r["instrument"], "rate_kg_h": rate, "uncertainty_kg_h": unc, "sector": sector})
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


def latest_confirmed(emit: dict | None, cm_latest: str | None) -> dict | None:
    """The site's newest confirmed detection: an EMIT candidate pass or a Carbon Mapper plume."""
    e = (emit or {}).get("latest_candidate")
    if not e and not cm_latest:
        return None
    if e and cm_latest and e == cm_latest:
        return {"date": e, "by": "an EMIT candidate pass and a Carbon Mapper plume"}
    if e and (not cm_latest or e > cm_latest):
        return {"date": e, "by": "an EMIT candidate pass"}
    return {"date": cm_latest, "by": "a Carbon Mapper plume"}


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
        radius_km: Search radius (default 5 km, max 10).

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
        plumes, source, fetched = load_plumes(lat, lon, radius_km, since, s3)
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
    # The stage's record: numbers, dates and codes only (the tip board and the brief read it).
    record = {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "since": since.isoformat(),
              "count": len(plumes), "latest": summary["latest_date"],
              "rate_kg_h": latest["rate_kg_h"] if latest else None,
              "uncertainty_kg_h": latest["uncertainty_kg_h"] if latest else None,
              "instrument": latest["instrument"] if latest else None, "source": source}
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
        # The follow rule counts Carbon Mapper plumes within 5 km, whatever radius was asked for.
        "latest_confirmed": latest_confirmed(emit, next((p["date"] for p in plumes if p["distance_km"] <= CM_RADIUS_KM), None)),
        "say": say_line(len(plumes), radius_km, since.isoformat(), latest),
        "attribution": ATTRIBUTION,
        "next_steps": ("Compare the two cued sites' latest_confirmed dates (the follow rule). A rate is Carbon "
                       "Mapper's estimate, never EMIT's or yours; sector is Carbon Mapper's label for the area, never "
                       "a cause: do not repeat it. If you follow this site, display_visual(plumes_geometry_s3_url, "
                       "render=render) with the TROPOMI composite."),
    }
    if source == "stale cache":
        out["note"] = (f"Carbon Mapper could not be reached; this is its record as fetched on {fetched}.")
    if geometry_url:
        out["plumes_geometry_s3_url"] = geometry_url
        out["render"] = RENDER_DETECTIONS
    return json.dumps(out)
