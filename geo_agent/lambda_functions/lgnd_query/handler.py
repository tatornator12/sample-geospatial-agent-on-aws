"""`lgnd-partition-query` Lambda: embedding queries for one geohash partition.

Reads a single geohash partition of the public LGND Clay v1.5 embedding dataset
(GeoParquet on Source Cooperative, us-west-2) with DuckDB. Three modes, chosen by
`event["mode"]` (default `change`, so callers that predate the field are unchanged):

  change   Two monthly periods; per-cell cosine similarity between the matched
           embeddings; returns only the cells whose change score clears the
           threshold. Fan-out worker for the country/state-wide region scan.
  embed    One period; the cells intersecting a small bbox, with their vectors,
           capped to the EMBED_CELL_CAP nearest the bbox centre. The runtime
           mean-pools these into one query vector.
  similar  One period; every cell in the bbox ranked by cosine similarity to a
           caller-supplied 256-float query vector, computed inside DuckDB;
           returns the top `limit` above `min_similarity`, without vectors.

Every event field is validated before it reaches a query (allowlisted mode,
geohash regex, int/float range checks, exactly 256 finite floats for the query
vector), and SQL literals are rendered only from the parsed numbers. Invalid
input returns the same always-200 error envelope as a failed query, never a
DuckDB error or a stack trace.

The calibration constants (SIM_HIGH, SIM_LOW, ARTIFACT_SIM_FLOOR) must stay in
sync with the main application so partition results and in-app results agree.

Input events:
{
    "mode": "change",                  # optional; default
    "geohash": "9x",
    "year1": 2019, "month1": 7,
    "year2": 2024, "month2": 7,
    "bbox": {"west": -109.06, "south": 36.99, "east": -102.04, "north": 41.0},
    "min_change_score": 0.15
}
{
    "mode": "embed",
    "geohash": "dr", "year": 2025, "month": 7,
    "bbox": {"west": -73.99, "south": 40.76, "east": -73.94, "north": 40.80}
}
{
    "mode": "similar",
    "geohash": "dr", "year": 2025, "month": 7,
    "bbox": {"west": -79.76, "south": 40.5, "east": -71.86, "north": 45.02},
    "query_embedding": [256 floats],
    "min_similarity": 0.75,
    "limit": 200
}

Outputs (all statusCode 200; failures add "error" and empty results):
change  -> {"changed_cells": [{cell_id, change_score, similarity, bbox}], "total_d1",
            "total_d2", "matched", "above_threshold", "geohash"}
embed   -> {"mode": "embed", "geohash", "cells_found", "cells": [{cell_id, bbox, embedding}]}
similar -> {"mode": "similar", "geohash", "cells_compared", "cells": [{cell_id, similarity, bbox}]}
"""
import json
import math
import re

import duckdb


MONTHLY_PATH = "s3://us-west-2.opendata.source.coop/clay/lgnd-embeddings/monthly-aggregated"
DEFAULT_MODEL_VERSION = "v1.5"
DEFAULT_COLLECTION = "sentinel-2-l2a"
DEFAULT_CHIP_SIZE = "1280m"
DEFAULT_DIMS = "256"

# Change-score calibration (must match the main app). Cosine similarity is
# mapped linearly onto [0, 1]: at/above SIM_HIGH = no change (score 0),
# at/below SIM_LOW = full change (score 1), scaled over SIM_RANGE between them.
SIM_HIGH = 0.90
SIM_LOW = 0.50
SIM_RANGE = SIM_HIGH - SIM_LOW

# Artifact guard: similarity below this is almost always cloud/snow/nodata in
# one period's monthly aggregate (degenerate embedding), not real land change.
ARTIFACT_SIM_FLOOR = 0.30

# Input bounds. The archive is monthly from 2017-01 to 2026-04; geohash partitions
# are 2-character prefixes (base32 alphabet, no a/i/l/o). The embed cap keeps the
# response small and bounds what "one example place" can mean (64 cells ~ 100 km2).
MODES = ("change", "embed", "similar")
GEOHASH_RE = re.compile(r"^[0-9b-hjkmnp-z]{1,4}$")
YEAR_MIN, YEAR_MAX = 2017, 2026
EMBED_DIMS = 256
EMBED_CELL_CAP = 64
SIMILAR_LIMIT_MAX = 5000


class InvalidEvent(ValueError):
    """An event field failed validation; reported in the error envelope, no query runs."""


# --- validation -------------------------------------------------------------------------

def _int_value(value, name, lo, hi):
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidEvent(f"{name} must be an integer")
    if not lo <= value <= hi:
        raise InvalidEvent(f"{name} must be between {lo} and {hi}")
    return value


def _int_in(event, key, lo, hi):
    return _int_value(event.get(key), key, lo, hi)


def _float_in(value, name, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidEvent(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not lo <= value <= hi:
        raise InvalidEvent(f"{name} must be a finite number between {lo} and {hi}")
    return value


def _geohash(event):
    gh = event.get("geohash")
    if not isinstance(gh, str) or not GEOHASH_RE.match(gh):
        raise InvalidEvent("geohash must be 1-4 geohash base32 characters")
    return gh


def _bbox(event):
    raw = event.get("bbox")
    if not isinstance(raw, dict):
        raise InvalidEvent("bbox must be an object with west, south, east, north")
    west = _float_in(raw.get("west"), "bbox.west", -180.0, 180.0)
    east = _float_in(raw.get("east"), "bbox.east", -180.0, 180.0)
    south = _float_in(raw.get("south"), "bbox.south", -90.0, 90.0)
    north = _float_in(raw.get("north"), "bbox.north", -90.0, 90.0)
    if not (west < east and south < north):
        raise InvalidEvent("bbox must have west < east and south < north")
    return west, south, east, north


def _embedding(event):
    raw = event.get("query_embedding")
    if not isinstance(raw, list) or len(raw) != EMBED_DIMS:
        raise InvalidEvent(f"query_embedding must be a list of exactly {EMBED_DIMS} numbers")
    return [_float_in(x, "query_embedding[]", -1e6, 1e6) for x in raw]


# --- SQL helpers (literals only from validated numbers) ---------------------------------

def _connect():
    con = duckdb.connect()
    con.execute("SET home_directory='/tmp';")
    con.execute("SET extension_directory='/var/task/duckdb_extensions';")
    con.execute("LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    con.execute("SET s3_endpoint='s3.us-west-2.amazonaws.com';")
    con.execute("SET s3_url_style='path';")
    con.execute("SET s3_access_key_id='';")
    con.execute("SET s3_secret_access_key='';")
    con.execute("SET s3_session_token='';")
    return con


def _partition_path(gh, year, month):
    return (f"{MONTHLY_PATH}/model_version={DEFAULT_MODEL_VERSION}"
            f"/collection={DEFAULT_COLLECTION}/chip_size={DEFAULT_CHIP_SIZE}"
            f"/dims={DEFAULT_DIMS}/geohash={gh}/year={year}/month={month:02d}/*.parquet")


def _bbox_filter(bbox):
    west, south, east, north = (repr(v) for v in bbox)
    return (f"WHERE bbox.xmin <= {east} AND bbox.xmax >= {west} "
            f"AND bbox.ymin <= {north} AND bbox.ymax >= {south}")


def _float_list_literal(values):
    return "[" + ", ".join(repr(v) for v in values) + "]::FLOAT[]"


def _error_text(exc):
    return f"{type(exc).__name__}: {str(exc)[:200]}"


def _empty(mode, gh):
    if mode == "change":
        return {"statusCode": 200, "changed_cells": [], "total_d1": 0, "total_d2": 0,
                "matched": 0, "above_threshold": 0, "geohash": gh}
    key = "cells_found" if mode == "embed" else "cells_compared"
    return {"statusCode": 200, "mode": mode, "geohash": gh, key: 0, "cells": []}


# --- modes ------------------------------------------------------------------------------

def _change(event, gh, bbox, con):
    year1 = _int_in(event, "year1", YEAR_MIN, YEAR_MAX)
    month1 = _int_in(event, "month1", 1, 12)
    year2 = _int_in(event, "year2", YEAR_MIN, YEAR_MAX)
    month2 = _int_in(event, "month2", 1, 12)
    min_change_score = _float_in(event.get("min_change_score", 0.15), "min_change_score", 0.0, 1.0)

    path1 = _partition_path(gh, year1, month1)
    path2 = _partition_path(gh, year2, month2)
    bbox_filter = _bbox_filter(bbox)

    # Cell counts. Reads only the cell_id column (parquet column pruning), so
    # this stays cheap and never materializes embeddings.
    counts = con.execute(f"""
        WITH d1 AS (SELECT cell_id FROM read_parquet('{path1}', hive_partitioning=true) {bbox_filter}),
             d2 AS (SELECT cell_id FROM read_parquet('{path2}', hive_partitioning=true) {bbox_filter})
        SELECT (SELECT count(*) FROM d1),
               (SELECT count(*) FROM d2),
               (SELECT count(*) FROM d1 JOIN d2 USING (cell_id))
    """).fetchone()
    total_d1, total_d2, matched = int(counts[0]), int(counts[1]), int(counts[2])

    # Change detection. Cosine similarity is computed INSIDE DuckDB via
    # list_cosine_similarity, so the 256-dim embeddings never cross into
    # Python -- only cells past the artifact floor + change threshold come
    # back. This keeps the function fast and bounds peak memory.
    rows = con.execute(f"""
        WITH d1 AS (
            SELECT cell_id, embedding AS e1
            FROM read_parquet('{path1}', hive_partitioning=true) {bbox_filter}
        ),
        d2 AS (
            SELECT cell_id, embedding AS e2, bbox
            FROM read_parquet('{path2}', hive_partitioning=true) {bbox_filter}
        ),
        sims AS (
            SELECT d1.cell_id AS cell_id,
                   list_cosine_similarity(d1.e1, d2.e2) AS sim,
                   d2.bbox AS bbox
            FROM d1 JOIN d2 USING (cell_id)
        )
        SELECT cell_id, sim, bbox,
               greatest(0.0, least(1.0, ({SIM_HIGH!r} - sim) / {SIM_RANGE!r})) AS change_score
        FROM sims
        WHERE sim >= {ARTIFACT_SIM_FLOOR!r}
          AND greatest(0.0, least(1.0, ({SIM_HIGH!r} - sim) / {SIM_RANGE!r})) >= {min_change_score!r}
    """).fetchall()

    changed_cells = [
        {
            "cell_id": r[0],
            "change_score": round(float(r[3]), 4),
            "similarity": round(float(r[1]), 4),
            "bbox": r[2],
        }
        for r in rows
    ]
    return {
        "statusCode": 200,
        "changed_cells": changed_cells,
        "total_d1": total_d1,
        "total_d2": total_d2,
        "matched": matched,
        "above_threshold": len(changed_cells),
        "geohash": gh,
    }


def _embed(event, gh, bbox, con):
    year = _int_in(event, "year", YEAR_MIN, YEAR_MAX)
    month = _int_in(event, "month", 1, 12)
    path = _partition_path(gh, year, month)
    bbox_filter = _bbox_filter(bbox)
    west, south, east, north = bbox
    cx, cy = repr((west + east) / 2), repr((south + north) / 2)

    cells_found = int(con.execute(
        f"SELECT count(*) FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}"
    ).fetchone()[0])

    # Nearest-to-centre cap: the query stays "one place" even if the caller's bbox is generous.
    rows = con.execute(f"""
        SELECT cell_id, bbox, embedding
        FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}
        ORDER BY power((bbox.xmin + bbox.xmax) / 2 - {cx}, 2)
               + power((bbox.ymin + bbox.ymax) / 2 - {cy}, 2),
                 cell_id
        LIMIT {EMBED_CELL_CAP}
    """).fetchall()

    return {
        "statusCode": 200,
        "mode": "embed",
        "geohash": gh,
        "cells_found": cells_found,
        "cells": [
            {"cell_id": r[0], "bbox": r[1], "embedding": [float(x) for x in r[2]]}
            for r in rows
        ],
    }


def _similar(event, gh, bbox, con):
    year = _int_in(event, "year", YEAR_MIN, YEAR_MAX)
    month = _int_in(event, "month", 1, 12)
    query = _embedding(event)
    min_similarity = _float_in(event.get("min_similarity", 0.0), "min_similarity", -1.0, 1.0)
    limit = _int_value(event.get("limit", 200), "limit", 1, SIMILAR_LIMIT_MAX)
    path = _partition_path(gh, year, month)
    bbox_filter = _bbox_filter(bbox)

    cells_compared = int(con.execute(
        f"SELECT count(*) FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}"
    ).fetchone()[0])

    # Ranking happens in DuckDB; only the winners (without vectors) cross into Python.
    # Geographic tie-breakers keep the per-partition order deterministic.
    rows = con.execute(f"""
        WITH sims AS (
            SELECT cell_id, bbox,
                   list_cosine_similarity(embedding, {_float_list_literal(query)}) AS sim
            FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}
        )
        SELECT cell_id, sim, bbox
        FROM sims
        WHERE sim >= {min_similarity!r}
        ORDER BY sim DESC, bbox.ymin, bbox.xmin, cell_id
        LIMIT {limit}
    """).fetchall()

    return {
        "statusCode": 200,
        "mode": "similar",
        "geohash": gh,
        "cells_compared": cells_compared,
        "cells": [
            {"cell_id": r[0], "similarity": round(float(r[1]), 4), "bbox": r[2]}
            for r in rows
        ],
    }


_MODES = {"change": _change, "embed": _embed, "similar": _similar}


def handler(event, context):
    mode = event.get("mode", "change")
    # Echo the geohash back only when it is well-formed; invalid input is never reflected.
    raw_gh = event.get("geohash")
    gh = raw_gh if isinstance(raw_gh, str) and GEOHASH_RE.match(raw_gh) else None
    if mode not in MODES:
        out = _empty("change", gh)
        out["error"] = f"InvalidEvent: mode must be one of {', '.join(MODES)}"
        return out

    try:
        gh = _geohash(event)
        bbox = _bbox(event)
    except InvalidEvent as e:
        out = _empty(mode, gh)
        out["error"] = _error_text(e)
        return out

    con = None
    try:
        con = _connect()
        return _MODES[mode](event, gh, bbox, con)
    except Exception as e:
        out = _empty(mode, gh)
        out["error"] = _error_text(e)
        return out
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
