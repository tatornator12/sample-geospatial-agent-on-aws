"""Ground-record checks for a Methane Watch site: two open-data tests of the brief's hypotheses.

thermal_anomalies      VIIRS active-fire detections (NASA FIRMS) within ~1 km of the site over the
                       last N nights. A persistent night-time heat source at an oil and gas site is
                       a lit flare; none means flaring was not observed. Tests the "unlit or
                       malfunctioning flare" hypothesis.
nearby_infrastructure  What OpenStreetMap has mapped within R km, by TYPE only: wells, flares,
                       pipelines, tanks, mines, landfills, wetlands, farmland. Names, operators,
                       owners and brands never leave this module (only our own category words and
                       numbers are returned), so no name can reach the model. Tests the
                       "non-oil-and-gas source" hypothesis against the oil and gas ones.

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
from methane_tools import MethaneError, _finite, _int
from watch_tools import box_around, parse_point

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
FIRMS_API_CHUNK_DAYS = 10                                        # the area API's longest range
THERMAL_RADIUS_KM = 1.0
THERMAL_MAX_RADIUS_KM = 3.0
THERMAL_DEFAULT_NIGHTS = 30
THERMAL_MAX_NIGHTS = 60
PERSISTENT_NIGHTS = 3                                            # heat on this many nights reads as a lit flare

# --- OpenStreetMap (Overpass) ---------------------------------------------------------------------

# Public Overpass servers, tried in turn. They are often "too busy" (504) or slow; the shared 7-day
# cache (filled by scripts/warm_watch.py the day before a show) is what the stage relies on.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# A tool that is silent for over a minute stalls the agent's stream (the client's read timeout), so
# the whole Overpass attempt, every server and retry included, fits one budget well under that.
OVERPASS_TIMEOUT_S = 15.0                                        # per request
OVERPASS_BUDGET_S = 40.0                                         # for the whole check
OVERPASS_RETRIES = 2                                             # rounds over the servers, with a short pause
OVERPASS_CAP_BYTES = 5_000_000
OVERPASS_MAX_ELEMENTS = 200
INFRA_RADIUS_KM = 2.0
INFRA_MAX_RADIUS_KM = 5.0
INFRA_CACHE_TTL_S = 7 * 24 * 3600
USER_AGENT = "agentic-earth-methane-watch/1.0 (open data check; no names kept)"

# Our own category words, from allowlisted OSM key/value pairs. Nothing else from a tag is kept.
OIL_GAS = "oil and gas"
COAL = "coal"
WASTE = "waste"
AGRICULTURE = "agriculture"
WETLAND = "wetland"
OTHER = "other industry"
# (key, value regex) -> (type, group). First match wins; order matters for the specific ones.
TYPE_RULES: tuple[tuple[str, str, str, str], ...] = (
    ("man_made", r"^(petroleum_well|oil_well|gas_well)$", "well", OIL_GAS),
    ("man_made", r"^flare$", "flare stack", OIL_GAS),
    ("man_made", r"^pipeline$", "pipeline", OIL_GAS),
    ("pipeline", r".+", "pipeline", OIL_GAS),
    ("man_made", r"^(storage_tank|gasometer)$", "storage tank", OIL_GAS),
    ("industrial", r"^(oil|gas|oil_gas|refinery|petroleum_terminal|well_cluster|gas_processing)$", "oil or gas plant", OIL_GAS),
    ("substance", r"^(oil|gas|natural_gas|lng|petroleum)$", "oil or gas facility", OIL_GAS),
    ("resource", r"coal", "coal mine", COAL),
    ("man_made", r"^(mineshaft|adit)$", "mine shaft", COAL),
    ("man_made", r"^tailings_pond$", "tailings pond", COAL),
    ("landuse", r"^quarry$", "quarry or surface mine", COAL),
    ("industrial", r"^mine$", "mine", COAL),
    ("landuse", r"^landfill$", "landfill", WASTE),
    ("amenity", r"^waste_disposal$", "landfill", WASTE),
    ("man_made", r"^wastewater_plant$", "wastewater plant", WASTE),
    ("landuse", r"^(farmland|farmyard|orchard|meadow)$", "farmland", AGRICULTURE),
    ("natural", r"^wetland$", "wetland", WETLAND),
    ("landuse", r"^reservoir$", "reservoir", WETLAND),
    ("power", r"^plant$", "power plant", OTHER),
    ("landuse", r"^industrial$", "industrial area", OTHER),
)
_TYPE_RULES = tuple((k, re.compile(rx, re.IGNORECASE), t, g) for k, rx, t, g in TYPE_RULES)
PLANT_SOURCES = ("coal", "gas", "oil", "hydro", "solar", "wind", "nuclear", "biomass", "waste")
# Every clause names its values (open-ended key scans and farmland polygons made the query time out
# on the public servers); farmland is not asked for, since a count of fields says nothing here.
OVERPASS_QUERY = """[out:json][timeout:{timeout}];
(
  nwr(around:{r},{lat},{lon})["man_made"~"^(petroleum_well|oil_well|gas_well|flare|pipeline|storage_tank|gasometer|wastewater_plant|mineshaft|adit|tailings_pond)$"];
  nwr(around:{r},{lat},{lon})["landuse"~"^(quarry|industrial|landfill|reservoir)$"];
  nwr(around:{r},{lat},{lon})["industrial"~"^(oil|gas|oil_gas|refinery|petroleum_terminal|well_cluster|gas_processing|mine)$"];
  nwr(around:{r},{lat},{lon})["substance"~"^(oil|gas|natural_gas|lng|petroleum)$"];
  nwr(around:{r},{lat},{lon})["resource"~"coal"];
  nwr(around:{r},{lat},{lon})["power"="plant"];
  nwr(around:{r},{lat},{lon})["amenity"="waste_disposal"];
  nwr(around:{r},{lat},{lon})["natural"="wetland"];
);
out tags center {cap};
"""


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
        logger.warning("FIRMS failed: %s", type(e).__name__)
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


# --- nearby infrastructure --------------------------------------------------------------------------

def classify(tags: dict) -> tuple[str, str] | None:
    """Our own (type, group) for an element, from allowlisted tags only; None when nothing matches."""
    if not isinstance(tags, dict):
        return None
    for key, rx, typ, group in _TYPE_RULES:
        value = tags.get(key)
        if isinstance(value, str) and rx.search(value):
            if typ == "power plant":
                src = str(tags.get("plant:source", "")).lower()
                if src in PLANT_SOURCES:
                    return f"{src} power plant", (COAL if src == "coal" else OIL_GAS if src in ("gas", "oil") else OTHER)
            if typ == "quarry or surface mine" and re.search("coal", str(tags.get("resource", "")), re.IGNORECASE):
                return "coal mine", COAL
            return typ, group
    return None


def element_point(el: dict) -> tuple[float, float] | None:
    c = el.get("center") if isinstance(el.get("center"), dict) else el
    try:
        la, lo = float(c.get("lat")), float(c.get("lon"))
    except (TypeError, ValueError, AttributeError):
        return None
    return (la, lo) if abs(la) <= 90 and abs(lo) <= 180 else None


def summarise_infra(elements: list, lat: float, lon: float, radius_km: float) -> dict:
    """Counts and nearest distance per type; groups; nothing from a tag but the matched category."""
    by_type: dict[str, dict] = {}
    for el in elements[:OVERPASS_MAX_ELEMENTS]:
        if not isinstance(el, dict):
            continue
        hit = classify(el.get("tags"))
        pt = element_point(el)
        if not hit or not pt:
            continue
        typ, group = hit
        d = haversine_km(lat, lon, *pt)
        if d > radius_km * 1.5:   # Overpass `around` is generous with long ways; keep the honest radius
            continue
        row = by_type.setdefault(typ, {"type": typ, "group": group, "count": 0, "nearest_km": d})
        row["count"] += 1
        row["nearest_km"] = min(row["nearest_km"], d)
    types = sorted(({**r, "nearest_km": round(r["nearest_km"], 1)} for r in by_type.values()), key=lambda r: r["nearest_km"])
    groups = {g: sum(r["count"] for r in types if r["group"] == g) for g in (OIL_GAS, COAL, WASTE, AGRICULTURE, WETLAND, OTHER)}
    return {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "types": types, "groups": groups,
            "mapped": sum(groups.values())}


def infra_line(i: dict) -> str:
    if i["mapped"] == 0:
        return (f"OpenStreetMap has nothing relevant mapped within {i['radius_km']:g} km; "
                "that is a mapping gap, not evidence of empty ground.")
    parts = [f"{r['count']} {r['type']}{'s' if r['count'] != 1 and not r['type'].endswith('s') else ''} "
             f"({r['nearest_km']:g} km)" for r in i["types"][:5]]
    absent = [g for g in (OIL_GAS, COAL, WASTE, WETLAND) if i["groups"].get(g, 0) == 0]
    tail = f"; nothing mapped for {', '.join(absent)}" if absent else ""
    return f"OpenStreetMap maps within {i['radius_km']:g} km: {', '.join(parts)}{tail}."


def infra_hint(i: dict) -> str:
    g = i["groups"]
    if i["mapped"] == 0:
        return "non_oil_gas_source: 'cannot assess' (nothing mapped); the oil and gas hypotheses stay possible."
    bits = []
    if g[COAL]:
        bits.append("non_oil_gas_source (coal): 'possible', supported by mapping")
    if g[WASTE]:
        bits.append("non_oil_gas_source (landfill): 'possible', supported by mapping")
    if g[OIL_GAS] and not (g[COAL] or g[WASTE] or g[WETLAND]):
        bits.append("non_oil_gas_source: 'less likely' (only oil and gas infrastructure is mapped)")
    if not g[OIL_GAS] and (g[COAL] or g[WASTE]):
        bits.append("routine_venting, unlit_flare: 'less likely' (no oil and gas infrastructure is mapped)")
    if any(r["type"] == "flare stack" for r in i["types"]):
        bits.append("a flare stack is mapped: read it with the VIIRS check")
    return "; ".join(bits) or "the mapping neither supports nor argues against any hypothesis."


def fetch_overpass(lat: float, lon: float, radius_km: float) -> list:
    query = OVERPASS_QUERY.format(timeout=int(OVERPASS_TIMEOUT_S) - 5, r=int(radius_km * 1000),
                                  lat=f"{lat:.5f}", lon=f"{lon:.5f}", cap=OVERPASS_MAX_ELEMENTS)
    last: Exception | None = None
    deadline = time.monotonic() + OVERPASS_BUDGET_S
    with httpx.Client(timeout=OVERPASS_TIMEOUT_S, follow_redirects=False) as client:
        for attempt in range(OVERPASS_RETRIES):
            for url in OVERPASS_URLS:
                left = deadline - time.monotonic()
                if left < 3:
                    raise last or RuntimeError("overpass_budget")
                try:
                    r = client.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT},
                                    timeout=min(OVERPASS_TIMEOUT_S, left))
                    if r.status_code != 200 or len(r.content) > OVERPASS_CAP_BYTES:
                        last = RuntimeError(f"overpass_{r.status_code}")
                        continue
                    body = r.json()
                    return body.get("elements", []) if isinstance(body, dict) else []
                except (httpx.HTTPError, ValueError) as e:
                    last = e
            if attempt + 1 < OVERPASS_RETRIES and deadline - time.monotonic() > 10:
                time.sleep(3)
    raise last or RuntimeError("overpass_unreachable")


@tool
async def nearby_infrastructure(lat: float, lon: float, radius_km: float = INFRA_RADIUS_KM) -> str:
    """Check what is mapped around the site in OpenStreetMap, by type only (no names, no operators).

    Counts wells, flare stacks, pipelines, storage tanks, oil or gas plants, mines and quarries, landfills,
    wastewater plants, farmland, wetlands and power plants within the radius, with the nearest distance of
    each. Tests the "non-oil-and-gas source" hypothesis against the oil and gas ones. Absence of mapping is
    a mapping gap, never evidence that the ground is empty.

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
    cache = f"methane/cache/osm_{lat:.4f}_{lon:.4f}_{radius_km:g}km.json"
    source = "cache"
    try:
        cached = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=cache)["Body"].read(1_000_000))
        if time.time() - cached.get("fetched_at", 0) > INFRA_CACHE_TTL_S:
            raise s3.exceptions.NoSuchKey(cache)
        elements = cached["elements"]
    except s3.exceptions.NoSuchKey:
        try:
            elements = fetch_overpass(lat, lon, radius_km)
        except Exception as e:
            logger.warning("Overpass failed: %s", type(e).__name__)
            return json.dumps({"error": "OpenStreetMap (Overpass) could not be reached; the infrastructure check is unavailable."})
        # Cache only what we need to re-summarise: tags are reduced to the allowlisted keys plus position.
        keep = ("man_made", "landuse", "industrial", "pipeline", "substance", "resource", "power", "plant:source",
                "amenity", "natural")
        elements = [{"center": element_point(el) and {"lat": element_point(el)[0], "lon": element_point(el)[1]},
                     "tags": {k: v for k, v in (el.get("tags") or {}).items() if k in keep}}
                    for el in elements[:OVERPASS_MAX_ELEMENTS] if isinstance(el, dict)]
        source = "overpass"
        s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=cache, ContentType="application/json",
                      Body=json.dumps({"fetched_at": time.time(), "elements": elements}).encode())
    i = summarise_infra(elements, lat, lon, radius_km)
    i["line"] = infra_line(i)
    _record("infra", lat, lon, i)
    i.update(source=source, seconds=round(time.time() - started, 1))
    logger.info("INFRA: %.3f,%.3f %d mapped (%s)", lat, lon, i["mapped"], source)
    return json.dumps({**i, "hypothesis_hint": infra_hint(i),
                       "next_steps": "Use `line` in the brief; say what kinds of things are mapped, never who owns them."})
