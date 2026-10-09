"""The public registry of oil and gas infrastructure: what is on record near a site, and whose.

Source: the Oil and Gas Infrastructure Mapping database (OGIM, Environmental Defense Fund and
MethaneSAT LLC; Zenodo, DOI 10.5281/zenodo.7466757; CC BY 4.0). OGIM compiles public records
reported by governments, industry and others: 7.6 million wells, compressor stations, processing
plants, terminals, refineries, LNG plants, platforms, tank batteries and pipelines, each with the
operator of record where the source names one, and the date the source was published.

The database is one 3.4 GB GeoPackage; scripts/build_registry.py turns it into small Parquet
files in our bucket, one per 5 x 5 degree cell (`methane/registry/<version>/cell=<x>_<y>.parquet`,
rows sorted by latitude), so a check reads one cell (cached on the container's disk) and filters a
2 km box with DuckDB: the whole registry is never loaded.

What this module says, and does not say. It reports what the registry LISTS: the kinds of
facility within the radius, their status, and the operators of record, as a fact about the
registry with the source date. It never says who caused a plume. The wording is fixed here (the
`line`), and the agent is told to quote it, not to improve on it.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
import time
from pathlib import Path

import config
import methane_tools as mt

logger = logging.getLogger("methane_tools")

VERSION = "ogim_v3.0"
PREFIX = f"methane/registry/{VERSION}"
CELL_DEG = 5
CELL_CAP_BYTES = 400_000_000
CACHE_DIR = Path(os.environ.get("REGISTRY_CACHE_DIR", "/tmp/methane_registry"))
CACHE_TTL_S = 24 * 3600
ROW_CAP = 20_000                 # a 2 km box in the Permian still fits with room
OPERATORS_SHOWN = 3
LINE_CAP = 300                   # the stage card and the backend's check-line bound (brief.ts, 320)
FIELD_NEAR_KM = 5.0              # a field outline farther than this is not "near the site"
SOURCE_LINE = "OGIM v3.0 (EDF and MethaneSAT, public records, CC BY 4.0)"
SOURCE_SHORT = "OGIM v3.0"

# OGIM layer -> the words the stage prints. Everything else in the GeoPackage (basins, fields,
# licence blocks, flaring detections, the data catalogue) is not infrastructure and is not loaded.
CATEGORIES: dict[str, str] = {
    "Oil_and_Natural_Gas_Wells": "well",
    "Natural_Gas_Compressor_Stations": "compressor station",
    "Gathering_and_Processing": "gathering or processing plant",
    "Petroleum_Terminals": "petroleum terminal",
    "Crude_Oil_Refineries": "refinery",
    "LNG_Facilities": "LNG facility",
    "Offshore_Platforms": "offshore platform",
    "Oil_and_Natural_Gas_Pipelines": "pipeline",
    "Tank_Battery": "tank battery",
    "Injection_and_Disposal": "injection or disposal well",
    "Stations_Other": "other station",
    "Equipment_and_Components": "equipment",
}
_SAFE_TEXT = re.compile(r"[^A-Za-z0-9 .,&'()\-/]+")
_MISSING = ("N/A", "NA", "UNKNOWN", "NOT AVAILABLE", "NONE", "NULL")   # OGIM writes N/A for a blank


def cell_of(lon: float, lat: float) -> tuple[int, int]:
    return int(math.floor(lon / CELL_DEG) * CELL_DEG), int(math.floor(lat / CELL_DEG) * CELL_DEG)


def cells_for(box: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every cell a box touches (a 2 km box touches one, or two at a cell edge, or four at a corner)."""
    w, s, e, n = box
    out = []
    x0, y0 = cell_of(w, s)
    x1, y1 = cell_of(e, n)
    for x in range(x0, x1 + 1, CELL_DEG):
        for y in range(y0, y1 + 1, CELL_DEG):
            out.append((x, y))
    return out


def cell_key(cell: tuple[int, int]) -> str:
    return f"{PREFIX}/cell={cell[0]}_{cell[1]}.parquet"


def clean_text(value, limit: int = 80) -> str | None:
    """A registry string the stage may print: letters, digits and plain punctuation only, bounded."""
    if not isinstance(value, str):
        return None
    text = _SAFE_TEXT.sub("", " ".join(value.split())).strip()
    return text[:limit] if text else None


def field_cell_key(cell: tuple[int, int]) -> str:
    return f"{PREFIX}/fields/cell={cell[0]}_{cell[1]}.parquet"


def cell_file(cell: tuple[int, int], s3=None, kind: str = "facilities") -> Path | None:
    """The cell's Parquet file on local disk (fetched from the bucket once a day), or None when the
    registry has no file for that cell (open sea, ice, nothing on record). `kind` is "facilities"
    (points and pipeline chords) or "fields" (field outlines)."""
    s3 = s3 or mt._s3()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tag = "" if kind == "facilities" else "fields_"
    path = CACHE_DIR / f"{VERSION}_{tag}{cell[0]}_{cell[1]}.parquet"
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL_S:
        return path
    try:
        obj = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=cell_key(cell) if kind == "facilities" else field_cell_key(cell))
    except s3.exceptions.NoSuchKey:
        return None
    if int(obj.get("ContentLength", 0)) > CELL_CAP_BYTES:
        raise mt.MethaneError("a registry cell is unexpectedly large")
    tmp = path.with_suffix(".part")
    with open(tmp, "wb") as f:
        shutil.copyfileobj(obj["Body"], f, 1 << 20)
    tmp.replace(path)
    return path


def query_cells(paths: list[Path], box: tuple[float, float, float, float]) -> list[dict]:
    """Rows whose bbox touches `box`, from the cell files, with DuckDB (local files only)."""
    if not paths:
        return []
    import duckdb
    w, s, e, n = box
    files = ", ".join("'" + str(p).replace("'", "") + "'" for p in paths)
    cols = ("category", "fac_type", "fac_status", "operator", "country", "state_prov", "src_date", "ogim_id",
            "xmin", "ymin", "xmax", "ymax", "diag")
    sql = (f"SELECT {', '.join(cols)} FROM read_parquet([{files}], union_by_name=true) "
           f"WHERE xmin <= {e:.6f} AND xmax >= {w:.6f} AND ymin <= {n:.6f} AND ymax >= {s:.6f} LIMIT {ROW_CAP}")
    con = duckdb.connect()
    try:
        return [dict(zip(cols, row)) for row in con.execute(sql).fetchall()]
    finally:
        con.close()


def query_fields(paths: list[Path], box: tuple[float, float, float, float]) -> list[dict]:
    """Field outlines whose box touches `box` (name, operator of record, country, date, WKB)."""
    if not paths:
        return []
    import duckdb
    w, s, e, n = box
    files = ", ".join("'" + str(p).replace("'", "") + "'" for p in paths)
    cols = ("name", "operator", "country", "src_date", "ogim_id", "wkb")
    sql = (f"SELECT {', '.join(cols)} FROM read_parquet([{files}]) "
           f"WHERE xmin <= {e:.6f} AND xmax >= {w:.6f} AND ymin <= {n:.6f} AND ymax >= {s:.6f} LIMIT 200")
    con = duckdb.connect()
    try:
        return [dict(zip(cols, row)) for row in con.execute(sql).fetchall()]
    finally:
        con.close()


def field_at(rows: list[dict], lat: float, lon: float, near_km: float = FIELD_NEAR_KM) -> dict | None:
    """The field the site lies inside (distance 0), else the nearest field outline within `near_km`,
    measured on a flat km grid centred on the site. Inside beats near; when outlines overlap, the
    smaller field (the more specific record) wins."""
    import shapely
    kx, ky = 111.32 * math.cos(math.radians(lat)), 110.57
    origin = shapely.Point(0.0, 0.0)
    best = None
    for r in rows:
        try:
            geom = shapely.from_wkb(r["wkb"])
            local = shapely.transform(geom, lambda c: (c - [lon, lat]) * [kx, ky])
        except Exception:
            continue
        d = 0.0 if local.covers(origin) else float(local.distance(origin))
        if d > near_km:
            continue
        name = clean_text(r.get("name"), 80)
        if not name:
            continue
        op = clean_text(r.get("operator"), 80)
        cand = {"name": name, "operator": op if op and op.upper() not in _MISSING else None,
                "country": clean_text(r.get("country"), 60), "distance_km": round(d, 1),
                "inside": d == 0.0, "area_km2": round(float(local.area), 1),
                "src_date": str(r.get("src_date") or "")[:10] or None}
        key = (not cand["inside"], cand["distance_km"], cand["area_km2"])
        if best is None or key < (not best["inside"], best["distance_km"], best["area_km2"]):
            best = cand
    return best


def field_line(f: dict | None) -> str | None:
    """The registry's second sentence, about the oil and gas field the site lies in (or the nearest
    outline within FIELD_NEAR_KM), or None when no field is on record nearby. Its own Check line, so
    the room reads one fact per line."""
    if not f:
        return None
    who = f"operator of record {f['operator']}" if f.get("operator") else "no operator on record"
    year = f"; record dated {f['src_date'][:4]}" if f.get("src_date") else ""
    if f["inside"]:
        return f"The public registry places the site inside the {f['name']} oil and gas field; {who}{year}."
    return (f"The public registry's nearest oil and gas field outline is {f['name']}, {f['distance_km']:g} km away; "
            f"{who}{year}.")


def chord_distance_km(lat: float, lon: float, xmin: float, ymin: float, xmax: float, ymax: float, diag) -> float:
    """Distance from a point to the straight chord stored as a box: SW to NE when `diag`, NW to SE
    otherwise (a point is a box with no size). Measured on a flat metre grid centred on the point,
    which is exact enough inside a few kilometres."""
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 110.57
    if diag is None or diag:
        x0, y0, x1, y1 = (xmin - lon) * kx, (ymin - lat) * ky, (xmax - lon) * kx, (ymax - lat) * ky
    else:
        x0, y0, x1, y1 = (xmin - lon) * kx, (ymax - lat) * ky, (xmax - lon) * kx, (ymin - lat) * ky
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, -(x0 * dx + y0 * dy) / length2))
    px, py = x0 + t * dx, y0 + t * dy
    return math.hypot(px, py)


def summarise(rows: list[dict], lat: float, lon: float, radius_km: float) -> dict:
    """What the registry lists within the radius: facilities by kind, operators of record by count."""
    # One facility per OGIM_ID: a pipeline is stored as many chord pieces; keep its nearest one.
    best: dict = {}
    for i, r in enumerate(rows):
        try:
            d = chord_distance_km(lat, lon, float(r["xmin"]), float(r["ymin"]), float(r["xmax"]), float(r["ymax"]), r.get("diag"))
        except (KeyError, TypeError, ValueError):
            continue
        if d > radius_km or CATEGORIES.get(str(r.get("category") or "")) is None:
            continue
        key = (r.get("category"), r["ogim_id"]) if r.get("ogim_id") is not None else ("row", i)
        if key not in best or d < best[key][0]:
            best[key] = (d, r)

    kinds: dict[str, dict] = {}
    operators: dict[str, dict] = {}
    nearest = None
    dates = []
    for d, r in best.values():
        kind = CATEGORIES[str(r["category"])]
        k = kinds.setdefault(kind, {"kind": kind, "count": 0, "nearest_km": d, "statuses": {}})
        k["count"] += 1
        k["nearest_km"] = min(k["nearest_km"], d)
        status = clean_text(r.get("fac_status"), 40)
        if status and status.upper() in _MISSING:
            status = None
        if status:
            k["statuses"][status.lower()] = k["statuses"].get(status.lower(), 0) + 1
        op = clean_text(r.get("operator"), 80)
        if op and op.upper() not in _MISSING:
            o = operators.setdefault(op, {"operator": op, "facilities": 0, "nearest_km": d, "kinds": set()})
            o["facilities"] += 1
            o["nearest_km"] = min(o["nearest_km"], d)
            o["kinds"].add(kind)
        day = str(r.get("src_date") or "")[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            dates.append(day)
        if nearest is None or d < nearest["distance_km"]:
            nearest = {"kind": kind, "operator": op, "status": status, "distance_km": d}
    facilities = sorted(({**k, "nearest_km": round(k["nearest_km"], 1)} for k in kinds.values()), key=lambda k: k["nearest_km"])
    ops = sorted(({**o, "nearest_km": round(o["nearest_km"], 1), "kinds": sorted(o["kinds"])} for o in operators.values()),
                 key=lambda o: (-o["facilities"], o["nearest_km"]))
    total = sum(k["count"] for k in facilities)
    if nearest:
        nearest["distance_km"] = round(nearest["distance_km"], 1)
    return {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "listed": total,
            "facilities": facilities, "operators": ops, "operators_named": len(ops),
            "unnamed": total - sum(o["facilities"] for o in ops),
            "nearest": nearest, "source_dates": (min(dates), max(dates)) if dates else None, "source": SOURCE_LINE}


def plural(n: int, word: str) -> str:
    if n == 1:
        return f"1 {word}"
    if word.endswith("y") and not word.endswith("ey"):
        return f"{n} {word[:-1]}ies"
    return f"{n} {word}s"


def distance_words(km: float) -> str:
    """"at the site" for a distance that rounds to 0, else "0.3 km"."""
    return "at the site" if km < 0.05 else f"{km:g} km"


def registry_line(r: dict) -> str:
    """The one sentence the brief and the stage print: the registry's listing, never a cause.

    "The public registry lists within 2 km: 14 wells (0.2 km), 1 tank battery (0.9 km); operators
    of record: X (9 facilities), Y (5); records dated 2019 to 2024." Facts about a registry, with
    its dates, so the room hears what is on record and when, and nothing about who did what.
    """
    where = f"within {r['radius_km']:g} km"
    if r["listed"] == 0:
        return (f"The public registry ({SOURCE_SHORT}) lists no oil and gas facility {where}; "
                f"a registry gap is not evidence of an empty site.")
    dates = ""
    if r.get("source_dates"):
        first, last = r["source_dates"][0][:4], r["source_dates"][1][:4]
        dates = f"; records dated {first}" if first == last else f"; records dated {first} to {last}"

    def compose(n_kinds: int, n_ops: int) -> str:
        kinds = ", ".join(f"{plural(k['count'], k['kind'])} ({distance_words(k['nearest_km'])})" for k in r["facilities"][:n_kinds])
        ops = r["operators"][:n_ops]
        if ops:
            names = ", ".join(f"{o['operator']} ({plural(o['facilities'], 'facility')})" for o in ops)
            more = f" and {r['operators_named'] - len(ops)} more" if r["operators_named"] > len(ops) else ""
            who = f"; operators of record: {names}{more}"
            if r["unnamed"]:
                who += f"; {r['unnamed']} with no operator on record"
        else:
            who = "; no operator on record for any of them"
        return f"The public registry lists {where}: {kinds}{who}{dates}."

    # Fewer kinds and fewer names (never cut names) until it fits the stage card and the brief.
    shapes = [(3, 3), (3, 2), (2, 2), (3, 1), (2, 1), (1, 1)]
    for n_kinds, n_ops in shapes:
        line = compose(n_kinds, n_ops)
        if len(line) <= LINE_CAP:
            return line
    return line


def registry_hint(r: dict) -> str:
    if r["listed"] == 0 and not any(r.get(k) for k in ("field_line", "mine_line", "gem_field_line")):
        return ("Nothing on record here: say so, and that the registry may be incomplete. Do not name anyone.")
    return ("Quote `line` as written. An operator of record is who the public record names for a facility, "
            "not who caused the methane: never say 'behind', 'responsible', 'caused by' or 'owned by'. "
            "If asked which company, answer with the registry's words and the record dates, then the confidence sentence.")
