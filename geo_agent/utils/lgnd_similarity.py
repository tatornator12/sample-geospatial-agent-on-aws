"""Find places that look like an example place, using the LGND Clay v1.5 embeddings.

`scan_region_change` (lgnd_embeddings.py) compares a cell with itself across time. This
module compares one place with every other cell in a region at the same time of year:

  1. query_embedding(): the LGND cells under the example geometry for one (year, month)
     are fetched through the shared `lgnd-partition-query` Lambda (`mode: embed`), the
     cells whose centre falls inside the geometry are kept (nearest cell as a fallback),
     and their vectors are mean-pooled into one L2-normalised query vector.
  2. search_similar(): the query vector is fanned out per geohash partition of the search
     extent (`mode: similar`; ranking happens inside DuckDB, only winners return), then
     merged here: the query's own cells and anything within `exclude_radius_km` are
     dropped, ocean cells are dropped with the Natural Earth land mask, the rest is sorted
     deterministically (similarity desc, lat, lon, cell_id), thinned so no two matches are
     closer than `min_separation_km`, and cut to `top_k`.
  3. to_geojson(): one FeatureCollection with the query cell(s) (`tier: "query"`) and the
     ranked matches (`tier: "match"`, `rank`, `similarity`), styled by the map.

Everything the model can influence (region names, bbox numbers, k, thresholds, the
geometry) is validated here before it is turned into a Lambda payload or an S3 key; the
Lambda validates again on its side. Nothing in `lgnd_embeddings.py` changes: its bbox
table, geohash cover, peak-month rule, land mask and haversine are imported as-is.
"""
from __future__ import annotations

import json
import logging
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import numpy as np

from .lgnd_embeddings import (
    COUNTRY_BBOXES,
    LAMBDA_FUNCTION_NAME,
    _get_geohashes_for_bbox,
    _get_peak_month,
    _haversine_km,
    _is_on_land,
)

logger = logging.getLogger(__name__)

# The monthly-aggregated archive: first and last (year, month) available.
ARCHIVE_START = (2017, 1)
ARCHIVE_END = (2026, 4)

EMBED_DIMS = 256
QUERY_CELL_CAP = 64          # ~100 km2 of 1.28 km cells: beyond this "one example" is not one thing
QUERY_PAD_DEG = 0.012        # about one 1.28 km cell; see query_embedding()
MAX_PARTITIONS = 20          # same limit as scan_region_change
TOP_K_MAX = 50
PER_PARTITION_FACTOR = 20    # ask each partition for top_k * this, then merge/thin/cut
MAX_WORKERS = 8

METHOD = ("Clay v1.5 foundation model embeddings (LGND/Source Cooperative), "
          "cosine similarity, 1.28 km cells, same month and year as the example")

MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


class SimilarityError(ValueError):
    """A user-facing problem (bad argument, no data); the tool turns it into a JSON error."""


# --- validation ---------------------------------------------------------------------------

def _finite(value: Any, name: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SimilarityError(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not lo <= value <= hi:
        raise SimilarityError(f"{name} must be a finite number between {lo} and {hi}")
    return value


def _int(value: Any, name: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SimilarityError(f"{name} must be an integer")
    if not lo <= value <= hi:
        raise SimilarityError(f"{name} must be between {lo} and {hi}")
    return value


def parse_bbox(raw: Any, name: str = "search_bbox") -> tuple[float, float, float, float]:
    """[west, south, east, north] in degrees, from a list or a "w,s,e,n" string."""
    if isinstance(raw, str):
        try:
            raw = [float(x) for x in raw.strip("[]() ").split(",")]
        except ValueError:
            raise SimilarityError(f"{name} must be [west, south, east, north] in degrees")
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        raise SimilarityError(f"{name} must be [west, south, east, north] in degrees")
    west = _finite(raw[0], f"{name}.west", -180.0, 180.0)
    south = _finite(raw[1], f"{name}.south", -90.0, 90.0)
    east = _finite(raw[2], f"{name}.east", -180.0, 180.0)
    north = _finite(raw[3], f"{name}.north", -90.0, 90.0)
    if not (west < east and south < north):
        raise SimilarityError(f"{name} must have west < east and south < north")
    return west, south, east, north


def resolve_search_extent(search_region: str | None, search_bbox: Any) -> tuple[tuple[float, float, float, float], str]:
    """The search bbox and a slug-friendly label. Same rules as scan_region_change:
    an explicit bbox wins; otherwise the name must be an exact whole-country / US-state
    key (no substring matching, so a sub-region never collapses to its parent)."""
    if search_bbox is not None:
        return parse_bbox(search_bbox), (search_region or "custom_area")
    key = (search_region or "").lower().strip()
    if key in COUNTRY_BBOXES:
        return tuple(float(v) for v in COUNTRY_BBOXES[key]), search_region.strip()
    raise SimilarityError(
        f"'{search_region}' is not a recognized whole country or US state. Pass the search "
        f"extent as search_bbox=[west, south, east, north] in degrees, or name a whole "
        f"country / US state. Sample: {', '.join(sorted(COUNTRY_BBOXES)[:20])}"
    )


def resolve_period(center_lat: float, year: int | None, month: int | None) -> tuple[int, int, str]:
    """(year, month, note). Month defaults to the latitude's peak season (same rule as the
    change scan; a given month inside the season is kept); year defaults to the most recent
    year in which that month is inside the archive. A given (year, month) must be inside
    the archive."""
    note_parts = []
    if month is None:
        month = _get_peak_month(center_lat, 0)
        note_parts.append(f"peak-season month {MONTH_NAMES[month]} chosen for latitude {center_lat:.1f}")
    else:
        month = _int(month, "month", 1, 12)
        adjusted = _get_peak_month(center_lat, month)
        if adjusted != month:
            note_parts.append(f"{MONTH_NAMES[month]} is outside the peak season at this latitude; "
                              f"using {MONTH_NAMES[adjusted]} for a fair comparison")
            month = adjusted
    if year is None:
        year = ARCHIVE_END[0] if (ARCHIVE_END[0], month) <= ARCHIVE_END else ARCHIVE_END[0] - 1
        note_parts.append(f"most recent {MONTH_NAMES[month]} in the archive: {year}")
    else:
        year = _int(year, "year", ARCHIVE_START[0], ARCHIVE_END[0])
        if not ARCHIVE_START <= (year, month) <= ARCHIVE_END:
            raise SimilarityError(
                f"{year}-{month:02d} is outside the embedding archive "
                f"({ARCHIVE_START[0]}-{ARCHIVE_START[1]:02d} to {ARCHIVE_END[0]}-{ARCHIVE_END[1]:02d})"
            )
    return year, month, "; ".join(note_parts)


# --- Lambda plumbing ----------------------------------------------------------------------

def lambda_client():
    import boto3
    region = os.environ.get("LGND_LAMBDA_REGION", "us-west-2")
    return boto3.client("lambda", region_name=region)


def _invoke(client, payload: dict) -> dict:
    response = client.invoke(FunctionName=LAMBDA_FUNCTION_NAME, Payload=json.dumps(payload).encode())
    if response.get("FunctionError"):
        raise RuntimeError(f"Lambda {response['FunctionError']}")
    body = json.loads(response["Payload"].read())
    if body.get("error"):
        raise RuntimeError(body["error"])
    return body


def _partitions(bbox: tuple[float, float, float, float]) -> list[str]:
    geohashes = _get_geohashes_for_bbox(*bbox)
    if len(geohashes) > MAX_PARTITIONS:
        raise SimilarityError(
            f"The search extent spans {len(geohashes)} geohash partitions (max {MAX_PARTITIONS}). "
            f"Search a smaller region or pass a tighter search_bbox."
        )
    return geohashes


def _bbox_dict(bbox: tuple[float, float, float, float]) -> dict:
    west, south, east, north = bbox
    return {"west": west, "south": south, "east": east, "north": north}


def cell_center(cell_bbox: dict) -> tuple[float, float]:
    """(lat, lon) of a cell from its {xmin, ymin, xmax, ymax} bbox."""
    return ((cell_bbox["ymin"] + cell_bbox["ymax"]) / 2, (cell_bbox["xmin"] + cell_bbox["xmax"]) / 2)


# --- 1. query embedding -------------------------------------------------------------------

def query_embedding(geometry, year: int, month: int, client) -> tuple[np.ndarray, list[dict]]:
    """One L2-normalised vector for the example geometry (a shapely geometry in EPSG:4326)
    and the cells it was pooled from.

    Cells are fetched by the geometry's bounds, then filtered to those whose centre lies
    inside the geometry: a small park's bounding box otherwise drags in its whole city
    block and the query stops meaning "park". If no centre falls inside (a point, or a
    polygon smaller than a cell), the single cell nearest the centroid is used.
    """
    from shapely.geometry import Point
    from shapely.prepared import prep

    # Pad the bounds by about one cell. The monthly grid has gaps (cells with no clear
    # observation that month are simply absent), so a point or a thin polygon can fall
    # between cells; the padding lets the nearest-cell fallback below find a neighbour.
    # Live check, Longs Peak 2025-07: 0 cells at the point itself, 6 within 0.01 deg.
    west, south, east, north = (float(v) for v in geometry.bounds)
    bounds = (west - QUERY_PAD_DEG, south - QUERY_PAD_DEG, east + QUERY_PAD_DEG, north + QUERY_PAD_DEG)

    cells: dict[str, dict] = {}
    for gh in _get_geohashes_for_bbox(*bounds):
        body = _invoke(client, {"mode": "embed", "geohash": gh, "year": year, "month": month,
                                "bbox": _bbox_dict(bounds)})
        for c in body.get("cells", []):
            if len(c.get("embedding", [])) == EMBED_DIMS:
                cells[c["cell_id"]] = c

    if not cells:
        raise SimilarityError(
            f"No embedding cells cover the example for {MONTH_NAMES[month]} {year} "
            f"(archive {ARCHIVE_START[0]}-{ARCHIVE_START[1]:02d} to {ARCHIVE_END[0]}-{ARCHIVE_END[1]:02d}); "
            f"try another month or year, or a place on land."
        )

    prepared = prep(geometry)
    inside = [c for c in cells.values() if prepared.contains(Point(cell_center(c["bbox"])[1], cell_center(c["bbox"])[0]))]
    if not inside:
        centroid = geometry.centroid
        inside = [min(cells.values(),
                      key=lambda c: _haversine_km(centroid.y, centroid.x, *cell_center(c["bbox"])))]
    if len(inside) > QUERY_CELL_CAP:
        raise SimilarityError(
            f"The example covers {len(inside)} embedding cells (max {QUERY_CELL_CAP}, about 100 km2). "
            f"Use a point or a smaller polygon so the example means one place."
        )

    matrix = np.asarray([c["embedding"] for c in inside], dtype=np.float64)
    vec = matrix.mean(axis=0)
    norm = float(np.linalg.norm(vec))
    if not norm or not math.isfinite(norm):
        raise SimilarityError("The example's embedding is degenerate (zero vector); try another month.")
    vec /= norm

    query_cells = [{"cell_id": c["cell_id"], "bbox": c["bbox"]} for c in inside]
    return vec, query_cells


# --- 2. search ----------------------------------------------------------------------------

def search_similar(
    query_vec: np.ndarray,
    query_cells: list[dict],
    query_center: tuple[float, float],
    search_bbox: tuple[float, float, float, float],
    year: int,
    month: int,
    *,
    top_k: int,
    min_similarity: float,
    exclude_radius_km: float,
    min_separation_km: float,
    client,
) -> dict:
    """Rank the search extent's cells against the query vector. Returns
    {"matches": [...], "cells_compared", "partitions", "errors", "seconds"}."""
    started = time.time()
    geohashes = _partitions(search_bbox)
    payload_base = {
        "mode": "similar",
        "year": year,
        "month": month,
        "bbox": _bbox_dict(search_bbox),
        "query_embedding": [float(x) for x in query_vec],
        "min_similarity": min_similarity,
        "limit": min(top_k * PER_PARTITION_FACTOR, 5000),
    }

    def one(gh: str) -> dict:
        return _invoke(client, {**payload_base, "geohash": gh})

    raw: list[dict] = []
    cells_compared = 0
    errors: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(geohashes), MAX_WORKERS)) as pool:
        futures = {pool.submit(one, gh): gh for gh in geohashes}
        for fut in as_completed(futures):
            gh = futures[fut]
            try:
                body = fut.result()
            except Exception as e:  # one partition failing must not sink the search
                logger.warning("similar partition %s failed: %s", gh, e)
                errors.append({"geohash": gh, "error": f"{type(e).__name__}: {str(e)[:200]}"})
                continue
            cells_compared += int(body.get("cells_compared", 0))
            raw.extend(body.get("cells", []))

    if errors and len(errors) == len(geohashes):
        raise SimilarityError(
            f"Every partition query failed ({errors[0]['error']}); the embedding service may be unavailable."
        )

    query_ids = {c["cell_id"] for c in query_cells}
    qlat, qlon = query_center
    candidates = []
    for c in raw:
        b = c.get("bbox")
        if not isinstance(b, dict) or c.get("cell_id") in query_ids:
            continue
        lat, lon = cell_center(b)
        if _haversine_km(qlat, qlon, lat, lon) < exclude_radius_km:
            continue
        if not _is_on_land(lon, lat):
            continue
        candidates.append({"cell_id": c["cell_id"], "similarity": float(c["similarity"]), "bbox": b,
                           "center_lat": lat, "center_lon": lon})

    # Deterministic: similarity desc, then geography, then id. Never arrival order.
    candidates.sort(key=lambda c: (-c["similarity"], c["center_lat"], c["center_lon"], c["cell_id"]))

    matches: list[dict] = []
    for c in candidates:
        if min_separation_km > 0 and any(
            _haversine_km(c["center_lat"], c["center_lon"], m["center_lat"], m["center_lon"]) < min_separation_km
            for m in matches
        ):
            continue
        matches.append(c)
        if len(matches) >= top_k:
            break

    for rank, m in enumerate(matches, start=1):
        m["rank"] = rank
        m["similarity"] = round(m["similarity"], 4)
        m["center_lat"] = round(m["center_lat"], 4)
        m["center_lon"] = round(m["center_lon"], 4)
        m["distance_km"] = round(_haversine_km(qlat, qlon, m["center_lat"], m["center_lon"]), 1)
        b = m.pop("bbox")
        m["bbox"] = {"west": b["xmin"], "south": b["ymin"], "east": b["xmax"], "north": b["ymax"]}

    return {
        "matches": matches,
        "cells_compared": cells_compared,
        "partitions": len(geohashes),
        "errors": errors,
        "seconds": round(time.time() - started, 1),
    }


# --- 3. GeoJSON ---------------------------------------------------------------------------

def _cell_polygon(west: float, south: float, east: float, north: float) -> dict:
    return {"type": "Polygon",
            "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


def to_geojson(query_cells: list[dict], matches: list[dict], location: str) -> dict:
    features = []
    for c in query_cells:
        b = c["bbox"]
        lat, lon = cell_center(b)
        features.append({
            "type": "Feature",
            "properties": {"tier": "query", "rank": None, "similarity": None, "cell_id": c["cell_id"],
                           "center_lat": round(lat, 4), "center_lon": round(lon, 4), "example": location},
            "geometry": _cell_polygon(b["xmin"], b["ymin"], b["xmax"], b["ymax"]),
        })
    for m in matches:
        b = m["bbox"]
        features.append({
            "type": "Feature",
            "properties": {"tier": "match", "rank": m["rank"], "similarity": m["similarity"],
                           "cell_id": m["cell_id"], "center_lat": m["center_lat"],
                           "center_lon": m["center_lon"], "distance_km": m["distance_km"]},
            "geometry": _cell_polygon(b["west"], b["south"], b["east"], b["north"]),
        })
    return {"type": "FeatureCollection", "features": features}
