"""Ground-record checks for a Methane Watch site: two open-data tests of the brief's hypotheses.

thermal_anomalies      VIIRS active-fire detections (NASA FIRMS) within ~1 km of the site over the
                       last N nights. A persistent night-time heat source at an oil and gas site is
                       a lit flare; none means flaring was not observed. Tests the "unlit or
                       malfunctioning flare" hypothesis.
nearby_infrastructure  What Overture Maps (AWS Open Data, read straight from S3) has mapped within
                       R km, by TYPE only: storage tanks, pipelines, oil and gas businesses, power
                       plants, industrial areas, mines, landfills, wetlands, farmland. Names,
                       operators, owners and brands are never selected from the parquet files (see
                       overture.py), so no name can reach the model. Tests the "non-oil-and-gas
                       source" hypothesis against the oil and gas ones.

Both write a small numbers-only record beside the session's methane files
(thermal_<lat>_<lon>.json, infra_<lat>_<lon>.json) so draft_brief can embed the checks in the
brief without the model copying numbers. Hosts are fixed; every URL and query is built from
validated numbers; the FIRMS key is read from the environment and never logged or returned.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import _paths  # noqa: F401
import httpx
from strands import tool

import config
import methane_tools as mt
import overture as ov
from methane_tools import MethaneError, _finite, _int
from watch_tools import WATCH_AREAS, box_around, parse_point

logger = logging.getLogger("methane_tools")

# --- FIRMS (VIIRS active fire) --------------------------------------------------------------------

FIRMS_HOST = "firms.modaps.eosdis.nasa.gov"
FIRMS_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT")          # near-real-time, last ~2 months
FIRMS_7D_FILES = {                                               # keyless fallback: the last 7 days, global
    "VIIRS_SNPP_NRT": "data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv",
    "VIIRS_NOAA20_NRT": "data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv",
}
FIRMS_TIMEOUT_S = 30.0
FIRMS_CAP_BYTES = 80_000_000
FIRMS_API_CHUNK_DAYS = 5                                         # the area API rejects longer ranges ("Expects [1..5]")
THERMAL_RADIUS_KM = 1.0
THERMAL_MAX_RADIUS_KM = 3.0
THERMAL_DEFAULT_NIGHTS = 30
THERMAL_MAX_NIGHTS = 60
PERSISTENT_NIGHTS = 3                                            # heat on this many nights reads as a lit flare

USER_AGENT = "agentic-earth-methane-watch/1.0 (open data check; no names kept)"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def check_key(kind: str, lat: float, lon: float) -> str:
    return f"{mt.session_prefix()}{kind}_{lat:.4f}_{lon:.4f}.json"


def _record(kind: str, lat: float, lon: float, body: dict) -> None:
    try:
        mt._put_json(check_key(kind, lat, lon), body)
    except Exception as e:  # the record feeds the brief card; never fail the check for it
        logger.warning("%s record failed: %s", kind, type(e).__name__)


# --- thermal anomalies ------------------------------------------------------------------------------

def firms_key() -> str:
    return os.environ.get("FIRMS_MAP_KEY", "").strip()


def firms_get(client: httpx.Client, url: str) -> str:
    """A FIRMS CSV body (capped). The key may be in the path: it never reaches a log or an error."""
    r = client.get(url, headers={"User-Agent": USER_AGENT})
    if r.status_code != 200:
        raise RuntimeError(f"firms_http_{r.status_code}")
    if len(r.content) > FIRMS_CAP_BYTES:
        raise RuntimeError("firms_too_large")
    return r.content.decode("utf-8", errors="replace")


def firms_rows(body: str) -> list[dict]:
    try:
        return list(csv.DictReader(io.StringIO(body)))
    except csv.Error:
        return []


def fetch_firms(lat: float, lon: float, radius_km: float, nights: int, s3) -> tuple[list[dict], int, str]:
    """VIIRS detections near the site: (rows, nights actually covered, source)."""
    box = box_around(lat, lon, radius_km)
    today = datetime.now(timezone.utc).date()
    key = firms_key()
    with httpx.Client(timeout=FIRMS_TIMEOUT_S, follow_redirects=False) as client:
        if key:
            chunks = []
            start = today - timedelta(days=nights)
            while start < today:
                span = min(FIRMS_API_CHUNK_DAYS, (today - start).days + 1)
                for source in FIRMS_SOURCES:
                    chunks.append((source, start, span))
                start += timedelta(days=FIRMS_API_CHUNK_DAYS)

            def one(chunk):
                source, day, span = chunk
                url = (f"https://{FIRMS_HOST}/api/area/csv/{key}/{source}/"
                       f"{box[0]:.4f},{box[1]:.4f},{box[2]:.4f},{box[3]:.4f}/{span}/{day.isoformat()}")
                return firms_rows(firms_get(client, url))

            with ThreadPoolExecutor(max_workers=min(mt.MAX_PARALLEL, len(chunks))) as pool:
                rows = [row for part in pool.map(one, chunks) for row in part]
            return rows, nights, "firms-api"
        # No key: the public 7-day global files, cached per day in the shared cache.
        rows = []
        for source, path in FIRMS_7D_FILES.items():
            cache = f"methane/cache/firms_{source}_7d_{today.isoformat()}.csv"
            try:
                body = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=cache)["Body"].read(FIRMS_CAP_BYTES).decode("utf-8")
            except s3.exceptions.NoSuchKey:
                body = firms_get(client, f"https://{FIRMS_HOST}/{path}")
                s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=cache, Body=body.encode("utf-8"), ContentType="text/csv")
            rows += [r for r in firms_rows(body) if _inside(r, box)]
        return rows, 7, "firms-7d"


def _inside(row: dict, box) -> bool:
    try:
        la, lo = float(row.get("latitude")), float(row.get("longitude"))
    except (TypeError, ValueError):
        return False
    return box[0] <= lo <= box[2] and box[1] <= la <= box[3]


def summarise_thermal(rows: list[dict], lat: float, lon: float, radius_km: float, nights: int, source: str) -> dict:
    """Numbers only, from the CSV rows within the radius."""
    hits = []
    for r in rows:
        try:
            la, lo = float(r.get("latitude")), float(r.get("longitude"))
        except (TypeError, ValueError):
            continue
        if haversine_km(lat, lon, la, lo) > radius_km:
            continue
        day = str(r.get("acq_date", ""))[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            continue
        try:
            frp = float(r.get("frp") or 0.0)
        except ValueError:
            frp = 0.0
        hits.append({"date": day, "night": str(r.get("daynight", "")).upper().startswith("N"), "frp": frp,
                     "static": str(r.get("type", "")).strip() == "2"})
    night_dates = sorted({h["date"] for h in hits if h["night"]})
    all_dates = sorted({h["date"] for h in hits})
    frps = [h["frp"] for h in hits if h["frp"] > 0]
    n_nights = len(night_dates)
    verdict = "persistent heat" if n_nights >= PERSISTENT_NIGHTS else "occasional heat" if n_nights else "no heat"
    return {
        "lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "nights_checked": nights,
        "source": source, "detections": len(hits), "night_detections": sum(h["night"] for h in hits),
        "nights_with_heat": n_nights, "dates_with_heat": all_dates[-10:],
        "static_source_detections": sum(h["static"] for h in hits),
        "mean_frp_mw": round(sum(frps) / len(frps), 1) if frps else None,
        "max_frp_mw": round(max(frps), 1) if frps else None,
        "verdict": verdict,
    }


def thermal_line(t: dict) -> str:
    """One sentence for the brief, written by code from the numbers."""
    where = f"within {t['radius_km']:g} km over the last {t['nights_checked']} nights"
    if t["detections"] == 0:
        return f"VIIRS saw no heat source {where}; flaring was not observed (small or brief flares can be missed)."
    frp = f", {t['max_frp_mw']:g} MW at most" if t.get("max_frp_mw") else ""
    static = f", {t['static_source_detections']} flagged as a static land source" if t["static_source_detections"] else ""
    return (f"VIIRS saw heat on {t['nights_with_heat']} of {t['nights_checked']} nights {where} "
            f"({t['detections']} detections{frp}{static}): {t['verdict']}.")


@tool
@mt.offload
async def thermal_anomalies(lat: float, lon: float, nights: int = THERMAL_DEFAULT_NIGHTS,
                            radius_km: float = THERMAL_RADIUS_KM) -> str:
    """Check the ground record for heat: VIIRS active-fire detections (NASA FIRMS) near the site.

    A lit flare is a persistent night-time heat source VIIRS sees from orbit; no heat on any night
    means flaring was not observed there. This tests the "unlit or malfunctioning flare" hypothesis:
    persistent heat → a flare is burning (unlit flare less likely); no heat and no flare mapped → the
    hypothesis cannot be assessed; no heat but a flare mapped nearby → unlit flare possible.

    Args:
        lat, lon: The site in degrees.
        nights: How many recent nights to check (default 30, max 60; 7 when no FIRMS key is configured).
        radius_km: Search radius (default 1 km, max 3; VIIRS pixels are 375 m).

    Returns: JSON with nights_checked, detections, nights_with_heat, dates_with_heat, max_frp_mw,
    static_source_detections, verdict ("no heat" | "occasional heat" | "persistent heat"), line (one
    sentence for the brief), hypothesis_hint.
    """
    started = time.time()
    try:
        lat, lon = parse_point(lat, lon)
        nights = _int(nights, "nights", 1, THERMAL_MAX_NIGHTS)
        radius_km = _finite(radius_km, "radius_km", 0.2, THERMAL_MAX_RADIUS_KM)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    try:
        rows, covered, source = fetch_firms(lat, lon, radius_km, nights, mt._s3())
    except httpx.HTTPError as e:
        return json.dumps({"error": f"NASA FIRMS could not be reached ({type(e).__name__}); the flare check is unavailable."})
    except Exception as e:
        # RuntimeError messages are our own short codes (firms_http_400 etc.), never a URL or the key.
        logger.warning("FIRMS failed: %s %s", type(e).__name__, e if isinstance(e, RuntimeError) else "")
        return json.dumps({"error": "NASA FIRMS did not return usable data; the flare check is unavailable."})
    t = summarise_thermal(rows, lat, lon, radius_km, covered, source)
    t["line"] = thermal_line(t)
    hint = {
        "no heat": "unlit_flare: 'possible' only if a flare stack is mapped nearby, else 'cannot assess'; flaring not observed.",
        "occasional heat": "unlit_flare: 'possible' (a flare that burns some nights and not others); say the nights.",
        "persistent heat": "unlit_flare: 'less likely' (the flare is lit); routine venting and leaks stay possible.",
    }[t["verdict"]]
    _record("thermal", lat, lon, t)
    t["seconds"] = round(time.time() - started, 1)
    logger.info("THERMAL: %.3f,%.3f %s (%d detections, %s)", lat, lon, t["verdict"], t["detections"], source)
    if source == "firms-7d":
        t["note"] = "No FIRMS_MAP_KEY is configured, so only the public 7-day file was read; set the key for 30 nights."
    return json.dumps({**t, "hypothesis_hint": hint,
                       "next_steps": "Use `line` as an observation in the brief and let it move the flare hypothesis."})


# --- nearby infrastructure (Overture Maps) --------------------------------------------------------------

INFRA_RADIUS_KM = 2.0
INFRA_MAX_RADIUS_KM = 5.0


def plural(n: int, typ: str) -> str:
    if n == 1:
        return typ
    if typ.endswith("business"):
        return typ + "es"
    if typ.endswith(("quarry", "farmland", "wetland")):
        return typ if typ.endswith("land") else typ[:-1] + "ies"
    return typ + "s"


def infra_line(i: dict) -> str:
    """One sentence for the brief, written by code from the counts."""
    if i["mapped"] == 0:
        return (f"Overture Maps has nothing relevant mapped within {i['radius_km']:g} km; "
                "that is a mapping gap, not evidence of empty ground.")
    parts = [f"{t['count']} {plural(t['count'], t['type'])} ({t['nearest_km']:g} km)" for t in i["types"][:5]]
    absent = [g for g in (ov.OIL_GAS, ov.MINING, ov.WASTE, ov.WETLAND) if i["groups"].get(g, 0) == 0]
    tail = f"; nothing mapped for {', '.join(absent)}" if absent else ""
    return f"Overture Maps shows within {i['radius_km']:g} km: {', '.join(parts)}{tail}."


def infra_hint(i: dict) -> str:
    g = i["groups"]
    if i["mapped"] == 0:
        return "non_oil_gas_source: 'cannot assess' (nothing mapped); the oil and gas hypotheses stay possible."
    bits = []
    if g[ov.MINING]:
        bits.append("non_oil_gas_source (mining): 'possible', supported by mapping")
    if g[ov.WASTE]:
        bits.append("non_oil_gas_source (landfill): 'possible', supported by mapping")
    if g[ov.WETLAND] or g[ov.AGRICULTURE]:
        bits.append("non_oil_gas_source (wetland or agriculture): 'possible', supported by mapping")
    if g[ov.OIL_GAS] and not (g[ov.MINING] or g[ov.WASTE] or g[ov.WETLAND]):
        bits.append("non_oil_gas_source: 'less likely' (only oil and gas infrastructure is mapped)")
    if not g[ov.OIL_GAS] and (g[ov.MINING] or g[ov.WASTE]):
        bits.append("routine_venting, unlit_flare: 'less likely' (no oil and gas infrastructure is mapped)")
    if any(t["type"] == "storage tank" for t in i["types"]):
        bits.append("storage tanks are mapped: tank venting is a known methane source, read with the VIIRS check")
    return "; ".join(bits) or "the mapping neither supports nor argues against any hypothesis."


@tool
@mt.offload
async def nearby_infrastructure(lat: float, lon: float, radius_km: float = INFRA_RADIUS_KM) -> str:
    """Check what is mapped around the site, by type only (no names, no operators), from Overture Maps.

    Counts storage tanks, pipelines, oil and gas businesses, power plants, industrial areas, quarries and
    mines, landfills, wastewater plants, farmland and wetlands within the radius, with the nearest distance
    of each (Overture Maps on AWS Open Data, read straight from S3). Tests the "non-oil-and-gas source"
    hypothesis against the oil and gas ones. Absence of mapping is a mapping gap, never evidence that the
    ground is empty. Wells are not in this map; a mapped tank or pipeline is the oil and gas signal.

    Args:
        lat, lon: The site in degrees.
        radius_km: Search radius (default 2 km, max 5).

    Returns: JSON with types[] (type, group, count, nearest_km), groups (counts per group), mapped (total),
    line (one sentence for the brief), hypothesis_hint.
    """
    started = time.time()
    try:
        lat, lon = parse_point(lat, lon)
        radius_km = _finite(radius_km, "radius_km", 0.5, INFRA_MAX_RADIUS_KM)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    s3 = mt._s3()
    # Inside a watch area the extract (one small S3 read, pulled once per release) answers; anywhere
    # else, Overture is read live from S3 within the budget.
    area = next((k for k, spec in WATCH_AREAS.items()
                 if spec["bbox"][0] <= lon <= spec["bbox"][2] and spec["bbox"][1] <= lat <= spec["bbox"][3]), None)
    rows, source, missed = None, None, []
    if area:
        try:
            rows = ov.load_extract(area, s3, box=tuple(WATCH_AREAS[area]["bbox"]))
            source = f"extract:{area}"
        except Exception as e:
            logger.warning("Overture extract read failed: %s", type(e).__name__)
    if rows is None:
        try:
            rows, missed = ov.live_rows(box_around(lat, lon, radius_km))
            source = "live"
        except Exception as e:
            logger.warning("Overture live query failed: %s", type(e).__name__)
            return json.dumps({"error": "Overture Maps could not be read; the infrastructure check is unavailable."})
        if missed and len(missed) == len(ov.SOURCES):
            return json.dumps({"error": "Overture Maps could not be read in time; the infrastructure check is unavailable."})
    i = ov.summarise(rows, lat, lon, radius_km)
    i["line"] = infra_line(i)
    _record("infra", lat, lon, i)
    i.update(read_from=source, seconds=round(time.time() - started, 1))
    if missed:
        i["note"] = f"{len(missed)} of {len(ov.SOURCES)} Overture layers did not answer in time; counts may be low."
    logger.info("INFRA: %.3f,%.3f %d mapped (%s, %.1fs)", lat, lon, i["mapped"], source, i["seconds"])
    return json.dumps({**i, "hypothesis_hint": infra_hint(i),
                       "next_steps": "Use `line` in the brief; say what kinds of things are mapped, never who owns them."})


# --- the public registry ------------------------------------------------------------------------------

REGISTRY_RADIUS_KM = 2.0
REGISTRY_MAX_RADIUS_KM = 5.0


@tool
@mt.offload
async def registry_lookup(lat: float, lon: float, radius_km: float = REGISTRY_RADIUS_KM) -> str:
    """Check the public registry: what oil and gas infrastructure is on record near the site, and the
    operators of record (OGIM v3.0: EDF and MethaneSAT's compilation of public records, CC BY 4.0).

    Wells, compressor stations, processing plants, terminals, refineries, LNG, platforms, tank
    batteries and pipelines within the radius, counted by kind with the nearest distance, and the
    operators the public record names for them (by number of facilities), with the records' dates.
    This is what a registry LISTS, as of its source dates: it is never who caused a plume. Quote
    `line` as written; never say "behind", "responsible", "caused by" or "owned by".

    Args:
        lat, lon: The site in degrees.
        radius_km: Search radius (default 2 km, max 5).

    Returns: JSON with listed (total), facilities[] (kind, count, nearest_km, statuses), operators[]
    (operator, facilities, nearest_km, kinds), nearest, source_dates, line (one sentence for the
    brief), hypothesis_hint.
    """
    started = time.time()
    try:
        lat, lon = parse_point(lat, lon)
        radius_km = _finite(radius_km, "radius_km", 0.5, REGISTRY_MAX_RADIUS_KM)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    import registry as rg
    box = box_around(lat, lon, radius_km)
    try:
        s3 = mt._s3()
        paths = [p for p in (rg.cell_file(c, s3) for c in rg.cells_for(box)) if p is not None]
        rows = rg.query_cells(paths, box)
    except Exception as e:
        logger.warning("registry read failed: %s", type(e).__name__)
        return json.dumps({"error": "The public registry could not be read; the registry check is unavailable."})
    r = rg.summarise(rows, lat, lon, radius_km)
    r["line"] = rg.registry_line(r)
    # The field outline the site lies in (or the nearest within 5 km): its own sentence. A failed
    # field read leaves the facility check standing.
    try:
        fbox = box_around(lat, lon, rg.FIELD_NEAR_KM)
        fpaths = [p for p in (rg.cell_file(c, s3, kind="fields") for c in rg.cells_for(fbox)) if p is not None]
        r["field"] = rg.field_at(rg.query_fields(fpaths, fbox), lat, lon)
    except Exception as e:
        logger.warning("registry field read failed: %s", type(e).__name__)
        r["field"] = None
    r["field_line"] = rg.field_line(r["field"])
    _record("registry", lat, lon, r)
    r.update(cells_read=len(paths), seconds=round(time.time() - started, 1))
    logger.info("REGISTRY: %.3f,%.3f %d listed, %d operators (%d cells, %.1fs)", lat, lon, r["listed"],
                r["operators_named"], len(paths), r["seconds"])
    return json.dumps({**r, "hypothesis_hint": rg.registry_hint(r),
                       "next_steps": ("Quote `line`, and `field_line` when it is not null, verbatim; they are the only "
                                      "place an operator is ever named. draft_brief adds both to the brief itself.")})
