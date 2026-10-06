"""Overture Maps on AWS Open Data: what is mapped around a site, by type only.

Overture publishes GeoParquet releases to `s3://overturemaps-us-west-2/release/<release>/`
(base: infrastructure, land_use, land; places), each row with a `bbox` struct, so DuckDB can read
just the row groups that touch a small box straight from S3, no server in between. Only `subtype`,
`class` (or a place's taxonomy category) and the bbox are ever selected: names, brands, operators
and addresses never leave the parquet files.

Two paths:
  - an **area extract**: every mapped thing of an allowlisted type inside a watch area, pulled once
    per Overture release by scripts/warm_watch.py into our bucket (`methane/cache/overture_<area>_
    <release>.json`), so a check inside a watch area is one small S3 read;
  - a **live query** for a site outside the watch areas (the two-beat flow anywhere), four parquet
    types in parallel within a time budget, opening only the files a per-release index says cover
    the site (see the DuckDB section below for why that index is what keeps it quick).

The category table below is the whole vocabulary the stage can ever print for a mapped thing.
"""
from __future__ import annotations

import json
import logging
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor

import config
import methane_tools as mt

logger = logging.getLogger("methane_tools")

RELEASE = "2026-09-23.1"
BUCKET_URL = "s3://overturemaps-us-west-2/release"
S3_REGION = "us-west-2"
LIVE_BUDGET_S = 40.0
EXTRACT_MAX_ROWS = 200_000
EXTRACT_CAP_BYTES = 60_000_000

OIL_GAS = "oil and gas"
MINING = "mining"
WASTE = "waste"
AGRICULTURE = "agriculture"
WETLAND = "wetland"
OTHER = "other industry"
GROUPS = (OIL_GAS, MINING, WASTE, AGRICULTURE, WETLAND, OTHER)

# (theme/type, subtype, class) -> (type we print, group). `*` matches any class of that subtype.
TYPE_TABLE: dict[tuple[str, str, str], tuple[str, str]] = {
    ("base/infrastructure", "utility", "storage_tank"): ("storage tank", OIL_GAS),
    ("base/infrastructure", "utility", "gasometer"): ("storage tank", OIL_GAS),
    ("base/infrastructure", "utility", "pipeline"): ("pipeline", OIL_GAS),
    ("base/infrastructure", "power", "plant"): ("power plant", OTHER),
    ("base/infrastructure", "waste_management", "waste_disposal"): ("landfill", WASTE),
    ("base/infrastructure", "waste_management", "wastewater_plant"): ("wastewater plant", WASTE),
    ("base/infrastructure", "waste_management", "waste_transfer_station"): ("waste transfer station", WASTE),
    ("base/land_use", "developed", "industrial"): ("industrial area", OTHER),
    ("base/land_use", "developed", "brownfield"): ("industrial area", OTHER),
    ("base/land_use", "resource_extraction", "quarry"): ("quarry or surface mine", MINING),
    ("base/land_use", "resource_extraction", "*"): ("mine", MINING),
    ("base/land_use", "landfill", "*"): ("landfill", WASTE),
    ("base/land_use", "agriculture", "farmland"): ("farmland", AGRICULTURE),
    ("base/land_use", "agriculture", "farmyard"): ("farmland", AGRICULTURE),
    ("base/land_use", "agriculture", "meadow"): ("farmland", AGRICULTURE),
    ("base/land_use", "horticulture", "orchard"): ("farmland", AGRICULTURE),
    ("base/land", "wetland", "*"): ("wetland", WETLAND),
}
# A place's taxonomy category -> (type, group). Businesses, counted by kind only.
PLACE_PREFIXES: tuple[tuple[str, str, str], ...] = (
    ("b2b_oil_and_gas", "oil and gas business", OIL_GAS),
    ("b2b_oil_refinery", "oil and gas business", OIL_GAS),
    ("oil_and_gas_field", "oil and gas business", OIL_GAS),
    ("well_drilling", "oil and gas business", OIL_GAS),
    ("natural_gas_utility_provider", "oil and gas business", OIL_GAS),
    ("landfill", "landfill", WASTE),
    ("hazardous_waste_disposal", "landfill", WASTE),
    ("waste_disposal", "landfill", WASTE),
    ("mining", "mining business", MINING),
    ("coal", "mining business", MINING),
)
# What each parquet type is asked for: the subtypes worth reading (SQL IN list, from the table above).
SUBTYPES = {
    "base/infrastructure": ("utility", "power", "waste_management"),
    "base/land_use": ("developed", "resource_extraction", "landfill", "agriculture", "horticulture"),
    "base/land": ("wetland",),
}


def classify(source: str, subtype: str | None, cls: str | None) -> tuple[str, str] | None:
    if source == "places/place":
        cat = (subtype or "").lower()
        for prefix, typ, group in PLACE_PREFIXES:
            if cat.startswith(prefix) or (prefix in ("mining", "coal", "landfill") and prefix in cat):
                return typ, group
        return None
    key = (source, subtype or "", cls or "")
    if key in TYPE_TABLE:
        return TYPE_TABLE[key]
    return TYPE_TABLE.get((source, subtype or "", "*"))


def bbox_distance_km(lat: float, lon: float, xmin: float, ymin: float, xmax: float, ymax: float) -> float:
    """Distance from the site to a feature's bounding box (0 inside it): honest for lines and polygons."""
    dx = max(xmin - lon, 0.0, lon - xmax) * 111.320 * max(math.cos(math.radians(lat)), 0.05)
    dy = max(ymin - lat, 0.0, lat - ymax) * 110.574
    return math.hypot(dx, dy)


def summarise(rows: list[dict], lat: float, lon: float, radius_km: float) -> dict:
    """rows: {type, group, xmin, ymin, xmax, ymax}. Counts and nearest distance per type; groups."""
    by_type: dict[str, dict] = {}
    for r in rows:
        try:
            d = bbox_distance_km(lat, lon, float(r["xmin"]), float(r["ymin"]), float(r["xmax"]), float(r["ymax"]))
        except (KeyError, TypeError, ValueError):
            continue
        if d > radius_km or r.get("group") not in GROUPS:
            continue
        row = by_type.setdefault(r["type"], {"type": r["type"], "group": r["group"], "count": 0, "nearest_km": d})
        row["count"] += 1
        row["nearest_km"] = min(row["nearest_km"], d)
    types = sorted(({**t, "nearest_km": round(t["nearest_km"], 1)} for t in by_type.values()), key=lambda t: t["nearest_km"])
    groups = {g: sum(t["count"] for t in types if t["group"] == g) for g in GROUPS}
    return {"lat": round(lat, 4), "lon": round(lon, 4), "radius_km": radius_km, "types": types, "groups": groups,
            "mapped": sum(groups.values()), "source": f"Overture Maps {RELEASE}"}


# --- DuckDB --------------------------------------------------------------------------------------------
#
# Cold reads are the whole cost. A type is 16 to 128 parquet files and DuckDB must read every file's
# footer before it can prune row groups by bbox: tens of seconds from a fresh process, minutes on one
# thread. Two things keep a live check inside its budget:
#   - a per-release **file index** (each file's overall bbox, read once from the footers by
#     scripts/warm_watch.py into our bucket): the files are spatially partitioned, so a site box
#     touches one to five of them and only those are opened;
#   - one shared in-process database (cursors per thread) so footers read once are kept for the
#     life of the container, and the four sources share the cache.

DUCKDB_THREADS = 8                     # S3 range reads are I/O bound; the runtime has few cores
DUCKDB_MEMORY = "512MB"
_DB = None
_INDEX: dict | None = None


def connect():
    """A cursor on the shared DuckDB database (httpfs loaded from the image's extension directory)."""
    global _DB
    if _DB is None:
        import duckdb
        db = duckdb.connect()
        ext_dir = os.environ.get("DUCKDB_EXTENSION_DIR", "/opt/duckdb_ext")
        if os.path.isdir(ext_dir):
            db.execute(f"SET extension_directory='{ext_dir}'")
        try:
            db.execute("LOAD httpfs")
        except Exception:
            db.execute("INSTALL httpfs; LOAD httpfs")
        db.execute(f"SET s3_region='{S3_REGION}'")
        db.execute("SET enable_object_cache=true")
        db.execute(f"SET threads={DUCKDB_THREADS}")
        db.execute(f"SET memory_limit='{DUCKDB_MEMORY}'")
        _DB = db
    return _DB.cursor()


def _glob(source: str) -> str:
    theme, typ = source.split("/")
    return f"{BUCKET_URL}/{RELEASE}/theme={theme}/type={typ}/*"


def _parquet(source: str, files: list[str] | None = None) -> str:
    if files:
        return "read_parquet([" + ", ".join("'" + f + "'" for f in files) + "])"
    return f"read_parquet('{_glob(source)}', hive_partitioning=1)"


def _sql_in(values) -> str:
    return ", ".join("'" + v.replace("'", "") + "'" for v in values)


def query_source(con, source: str, box: tuple[float, float, float, float], limit: int,
                 files: list[str] | None = None) -> list[dict]:
    """Allowlisted types inside `box` from one parquet type: category words and bbox only, never a name."""
    w, s, e, n = box
    where = f"bbox.xmin <= {e:.6f} AND bbox.xmax >= {w:.6f} AND bbox.ymin <= {n:.6f} AND bbox.ymax >= {s:.6f}"
    if source == "places/place":
        sql = (f"SELECT taxonomy['primary'] AS a, NULL AS b, bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax "
               f"FROM {_parquet(source, files)} WHERE {where} LIMIT {int(limit)}")
    else:
        sql = (f"SELECT subtype AS a, class AS b, bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax "
               f"FROM {_parquet(source, files)} WHERE {where} AND subtype IN ({_sql_in(SUBTYPES[source])}) LIMIT {int(limit)}")
    out = []
    for a, b, xmin, ymin, xmax, ymax in con.execute(sql).fetchall():
        hit = classify(source, a, b)
        if hit:
            out.append({"type": hit[0], "group": hit[1], "xmin": round(xmin, 5), "ymin": round(ymin, 5),
                        "xmax": round(xmax, 5), "ymax": round(ymax, 5)})
    return out


SOURCES = ("base/infrastructure", "base/land_use", "base/land", "places/place")


# --- the file index (built once per release by the warm script) --------------------------------------

def index_key() -> str:
    return f"methane/cache/overture_index_{RELEASE}.json"


def build_index(s3=None) -> dict:
    """Each file's overall bbox from its footer statistics, per source: {source: [[file, xmin, ymin, xmax, ymax]]}."""
    s3 = s3 or mt._s3()
    con = connect()
    files: dict[str, list] = {}
    try:
        for source in SOURCES:
            rows = con.execute(f"""
                SELECT file_name,
                       min(CASE WHEN path_in_schema = 'bbox, xmin' THEN CAST(stats_min AS DOUBLE) END),
                       min(CASE WHEN path_in_schema = 'bbox, ymin' THEN CAST(stats_min AS DOUBLE) END),
                       max(CASE WHEN path_in_schema = 'bbox, xmax' THEN CAST(stats_max AS DOUBLE) END),
                       max(CASE WHEN path_in_schema = 'bbox, ymax' THEN CAST(stats_max AS DOUBLE) END)
                FROM parquet_metadata('{_glob(source)}')
                WHERE path_in_schema LIKE 'bbox, %'
                GROUP BY file_name ORDER BY file_name""").fetchall()
            files[source] = [[f, round(a, 4), round(b, 4), round(c, 4), round(d, 4)] for f, a, b, c, d in rows
                             if None not in (a, b, c, d)]
            if not files[source]:
                raise RuntimeError(f"no bbox statistics for {source}")
    finally:
        con.close()
    body = json.dumps({"release": RELEASE, "built_at": time.time(), "files": files}).encode()
    s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=index_key(), Body=body, ContentType="application/json")
    logger.info("OVERTURE index: %s", ", ".join(f"{k} {len(v)} files" for k, v in files.items()))
    return files


def load_index(s3=None) -> dict | None:
    """The file index for this release, read once per process; None when the warm script has not built it."""
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    s3 = s3 or mt._s3()
    try:
        body = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=index_key())["Body"].read(EXTRACT_CAP_BYTES)
    except s3.exceptions.NoSuchKey:
        return None
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("release") != RELEASE or not isinstance(data.get("files"), dict):
        return None
    _INDEX = data["files"]
    return _INDEX


def files_for(index: dict | None, source: str, box: tuple[float, float, float, float]) -> list[str] | None:
    """The files whose bbox touches `box`; None when there is no index (read the whole type), [] for none."""
    if index is None or source not in index:
        return None
    w, s, e, n = box
    return [f for f, xmin, ymin, xmax, ymax in index[source] if xmin <= e and xmax >= w and ymin <= n and ymax >= s]


# --- the live path ----------------------------------------------------------------------------------------

def live_rows(box: tuple[float, float, float, float], budget_s: float = LIVE_BUDGET_S,
              s3=None) -> tuple[list[dict], list[str]]:
    """The four sources in parallel on the shared database; whatever finished inside the budget.

    A source still running at the deadline is interrupted (DuckDB stops the scan) and reported as
    missed, so the tool returns on time whatever S3 is doing.
    """
    deadline = time.monotonic() + budget_s
    try:
        index = load_index(s3)
    except Exception as e:  # no index is slower, not fatal
        logger.warning("Overture index unavailable: %s", type(e).__name__)
        index = None
    cursors: dict[str, object] = {}

    def one(source):
        files = files_for(index, source, box)
        if files == []:
            return []
        con = connect()
        cursors[source] = con
        try:
            return query_source(con, source, box, 20_000, files)
        finally:
            con.close()

    rows: list[dict] = []
    missed: list[str] = []
    pool = ThreadPoolExecutor(max_workers=len(SOURCES))
    try:
        futures = {pool.submit(one, s): s for s in SOURCES}
        for fut, source in futures.items():
            left = max(0.5, deadline - time.monotonic())
            try:
                rows += fut.result(timeout=left)
            except Exception as e:  # a slow or failed source is reported, not fatal
                logger.warning("Overture %s: %s", source, type(e).__name__)
                missed.append(source)
                con = cursors.get(source)
                if con is not None:
                    try:
                        con.interrupt()
                    except Exception:
                        pass
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return rows, missed


# --- area extracts (the warm path) ------------------------------------------------------------------------

def extract_key(area_key: str) -> str:
    return f"methane/cache/overture_{area_key.replace(' ', '_')}_{RELEASE}.json"


def extract_area(area_key: str, box: tuple[float, float, float, float], s3=None) -> dict:
    """Pull every allowlisted thing inside a watch area into our bucket, once per release."""
    s3 = s3 or mt._s3()
    started = time.time()
    index = load_index(s3)
    con = connect()
    rows: list[dict] = []
    try:
        for source in SOURCES:
            files = files_for(index, source, box)
            if files == []:
                continue
            rows += query_source(con, source, box, EXTRACT_MAX_ROWS, files)
    finally:
        con.close()
    rows = rows[:EXTRACT_MAX_ROWS]
    body = json.dumps({"area": area_key, "release": RELEASE, "bbox": list(box), "built_at": time.time(), "rows": rows}).encode()
    s3.put_object(Bucket=config.S3_BUCKET_NAME, Key=extract_key(area_key), Body=body, ContentType="application/json")
    summary = {"area": area_key, "rows": len(rows), "bytes": len(body), "seconds": round(time.time() - started, 1)}
    logger.info("OVERTURE extract %s: %d rows, %d bytes, %.1fs", area_key, len(rows), len(body), summary["seconds"])
    return summary


def load_extract(area_key: str, s3=None) -> list[dict] | None:
    s3 = s3 or mt._s3()
    try:
        body = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=extract_key(area_key))["Body"].read(EXTRACT_CAP_BYTES)
    except s3.exceptions.NoSuchKey:
        return None
    data = json.loads(body)
    return data.get("rows") if isinstance(data, dict) and data.get("release") == RELEASE else None
