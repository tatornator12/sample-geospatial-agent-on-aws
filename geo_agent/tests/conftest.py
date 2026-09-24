"""Shared fixtures for the geo_agent unit tests.

Run from geo_agent/ with the repo venv:

    cd geo_agent && ../.venv/bin/python -m pytest -q

Two things make these tests hermetic:

1. Environment: config.py raises at import when S3_BUCKET_NAME is unset, so it is
   defaulted here before any application module loads. Tests never read the local .env.

2. Imports: utils/__init__.py wildcard-imports every utils module, dragging in heavy
   dependencies (strands, osmnx, geopy, rasterstats, pystac_client) that are not part of
   the local test environment — they live in the runtime container. A synthetic `utils`
   package with the real directory as its __path__ lets tests import `utils.tools` and
   `utils.raster_utils` without executing utils/__init__.py, and lightweight module stubs
   stand in for the runtime-only dependencies. The stubs are ALWAYS installed (even if a
   real package is present) so test behaviour does not depend on what happens to be
   installed locally: the functions under test (_slugify, bbox_around_point,
   clip_raster_v2) use none of the stubbed libraries.

Fixtures build all test data on the fly: a 256x256 float32 COG chip, a 2 km AOI GeoJSON
inside it, and a synthetic two-period LGND embedding parquet partition with known cosine
similarities.
"""
import importlib
import importlib.util
import json
import math
import os
import sys
import types
from pathlib import Path

import duckdb
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

GEO_AGENT_DIR = Path(__file__).resolve().parents[1]

# --- Environment before any application import -------------------------------------
os.environ.setdefault("S3_BUCKET_NAME", "test-bucket")
os.environ.setdefault("AWS_REGION", "us-east-1")

if str(GEO_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(GEO_AGENT_DIR))


# --- Stubs for runtime-only dependencies --------------------------------------------
def _stub_module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


def _identity_tool(fn=None, **_kwargs):
    """Stand-in for strands' @tool: leaves the function directly callable."""
    if callable(fn):
        return fn
    return lambda f: f


def _unavailable(*_args, **_kwargs):
    raise RuntimeError("stubbed dependency called inside a unit test")


_stub_module("strands", tool=_identity_tool)
_stub_module("strands_tools", calculator=types.SimpleNamespace(name="calculator"))
_stub_module("osmnx", geocode=_unavailable, geocode_to_gdf=_unavailable)
_geopy = _stub_module("geopy")
_geopy.geocoders = _stub_module("geopy.geocoders")
_stub_module("rasterstats", zonal_stats=_unavailable)
_stub_module("pystac_client", Client=types.SimpleNamespace(open=_unavailable))

# --- Synthetic `utils` package: real modules without utils/__init__.py --------------
_utils_pkg = types.ModuleType("utils")
_utils_pkg.__path__ = [str(GEO_AGENT_DIR / "utils")]
sys.modules.setdefault("utils", _utils_pkg)


@pytest.fixture(scope="session")
def tools_module():
    """geo_agent/utils/tools.py imported with runtime-only deps stubbed."""
    return importlib.import_module("utils.tools")


@pytest.fixture(scope="session")
def raster_utils_module():
    """geo_agent/utils/raster_utils.py (real rasterio/geopandas, no __init__ cascade)."""
    return importlib.import_module("utils.raster_utils")


@pytest.fixture(scope="session")
def lgnd_handler_module():
    """The lgnd-partition-query Lambda handler, imported by file path.

    Module import is cheap (json + duckdb only); lambda_functions has no __init__.py.
    """
    path = GEO_AGENT_DIR / "lambda_functions" / "lgnd_query" / "handler.py"
    spec = importlib.util.spec_from_file_location("lgnd_query_handler", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- Raster + AOI fixtures -----------------------------------------------------------
# The chip is centred on (-105.0, 39.0), EPSG:4326, 256x256 float32 pixels of
# 0.0003125 deg (span 0.08 deg, roughly 7 km x 9 km) — comfortably larger than the 2 km AOI.
CHIP_CENTER = (-105.0, 39.0)
CHIP_SIZE = 256
CHIP_PIXEL_DEG = 0.0003125
CHIP_NODATA = -9999.0


@pytest.fixture(scope="session")
def cog_chip(tmp_path_factory) -> Path:
    """A 256x256 float32 single-band COG with a deterministic gradient."""
    path = tmp_path_factory.mktemp("raster") / "chip.tif"
    half_span = CHIP_SIZE * CHIP_PIXEL_DEG / 2
    transform = from_origin(
        CHIP_CENTER[0] - half_span, CHIP_CENTER[1] + half_span, CHIP_PIXEL_DEG, CHIP_PIXEL_DEG
    )
    data = np.linspace(0.0, 1.0, CHIP_SIZE * CHIP_SIZE, dtype=np.float32).reshape(
        CHIP_SIZE, CHIP_SIZE
    )
    with rasterio.open(
        path,
        "w",
        driver="COG",
        width=CHIP_SIZE,
        height=CHIP_SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
        nodata=CHIP_NODATA,
        compress="DEFLATE",
    ) as dst:
        dst.write(data, 1)
    return path


@pytest.fixture(scope="session")
def aoi_geojson(tmp_path_factory) -> Path:
    """A 2 km AOI polygon (GeoJSON, EPSG:4326) centred inside the chip."""
    path = tmp_path_factory.mktemp("aoi") / "aoi_2km.geojson"
    lon, lat = CHIP_CENTER
    radius_m = 2000
    earth_radius_m = 6378137
    lat_off = math.degrees(radius_m / earth_radius_m)
    lon_off = math.degrees(radius_m / (earth_radius_m * math.cos(math.radians(lat))))
    ring = [
        [lon - lon_off, lat - lat_off],
        [lon - lon_off, lat + lat_off],
        [lon + lon_off, lat + lat_off],
        [lon + lon_off, lat - lat_off],
        [lon - lon_off, lat - lat_off],
    ]
    feature = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"name": "test_aoi"},
            }
        ],
    }
    path.write_text(json.dumps(feature))
    return path


# --- Synthetic LGND partition ---------------------------------------------------------
# 50 cells in a 10x5 grid of 0.01 deg bboxes starting at (-105.5, 39.0). Embeddings are
# constructed with exact cosine similarity between the two periods:
#   cells 00-29: identical           -> sim 1.0  -> change_score 0.0   (excluded)
#   cells 30-39: cosine 0.6          -> change_score (0.9-0.6)/0.4 = 0.75 (returned)
#   cells 40-49: cosine 0.1 (< 0.30) -> artifact floor                 (excluded)
LGND_GEOHASH = "9x"
LGND_PERIODS = ((2019, 7), (2024, 7))
LGND_CHANGED_IDS = [f"cell_{i:02d}" for i in range(30, 40)]
LGND_EXPECTED_SCORE = 0.75


def _cell_bbox(i: int) -> dict:
    col, row = i % 10, i // 10
    xmin = -105.5 + col * 0.01
    ymin = 39.0 + row * 0.01
    return {"xmin": xmin, "ymin": ymin, "xmax": xmin + 0.01, "ymax": ymin + 0.01}


def lgnd_base_vectors() -> tuple[np.ndarray, np.ndarray]:
    """The two orthonormal 256-vectors every synthetic embedding is built from.

    `u` is the unchanged/base direction (cells 00-29 in both periods); `v` is the
    orthogonal direction mixed in to hit exact cosines. Exposed so tests can build a
    query vector that matches the partition exactly (similarity-search tests).
    """
    rng = np.random.default_rng(42)
    u = rng.normal(size=256)
    u /= np.linalg.norm(u)
    v = rng.normal(size=256)
    v -= (v @ u) * u
    v /= np.linalg.norm(v)
    return u, v


@pytest.fixture(scope="session")
def lgnd_partition(tmp_path_factory, lgnd_handler_module) -> Path:
    """Two monthly parquet partitions in the handler's exact hive layout, local base dir."""
    h = lgnd_handler_module
    base = tmp_path_factory.mktemp("lgnd")

    u, v = lgnd_base_vectors()

    def embedding(i: int, period: int) -> list[float]:
        if period == 0 or i < 30:
            e = u
        elif i < 40:
            c = 0.6
            e = c * u + math.sqrt(1 - c * c) * v
        else:
            c = 0.1
            e = c * u + math.sqrt(1 - c * c) * v
        return [float(x) for x in e.astype(np.float32)]

    partition_root = (
        base
        / f"model_version={h.DEFAULT_MODEL_VERSION}"
        / f"collection={h.DEFAULT_COLLECTION}"
        / f"chip_size={h.DEFAULT_CHIP_SIZE}"
        / f"dims={h.DEFAULT_DIMS}"
        / f"geohash={LGND_GEOHASH}"
    )
    con = duckdb.connect()
    for period, (year, month) in enumerate(LGND_PERIODS):
        out_dir = partition_root / f"year={year}" / f"month={month:02d}"
        out_dir.mkdir(parents=True)
        con.execute(
            "CREATE OR REPLACE TABLE part ("
            "cell_id VARCHAR, embedding FLOAT[], "
            "bbox STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE))"
        )
        for i in range(50):
            b = _cell_bbox(i)
            con.execute(
                "INSERT INTO part SELECT ?, CAST(? AS FLOAT[]), "
                "struct_pack(xmin := ?, ymin := ?, xmax := ?, ymax := ?)",
                [f"cell_{i:02d}", embedding(i, period), b["xmin"], b["ymin"], b["xmax"], b["ymax"]],
            )
        con.execute(f"COPY part TO '{(out_dir / 'data.parquet').as_posix()}' (FORMAT PARQUET)")
    con.close()
    return base


class LocalDuckDBCon:
    """duckdb connection wrapper that ignores Lambda-only SET/LOAD statements.

    The handler configures httpfs + S3 before its try-block; none of that exists (or is
    needed) for a local parquet path, so those statements become no-ops and everything
    else runs on a real connection.
    """

    def __init__(self):
        self._real = duckdb.connect()

    def execute(self, sql, *args):
        head = sql.strip().split(None, 1)[0].lower()
        if head in ("set", "load"):
            return self
        self._real.execute(sql, *args)
        return self

    def fetchone(self):
        return self._real.fetchone()

    def fetchall(self):
        return self._real.fetchall()

    def close(self):
        self._real.close()


@pytest.fixture()
def local_lgnd_handler(lgnd_handler_module, lgnd_partition, monkeypatch):
    """The handler wired to the synthetic partition: local MONTHLY_PATH, no httpfs."""
    monkeypatch.setattr(lgnd_handler_module, "MONTHLY_PATH", lgnd_partition.as_posix())
    monkeypatch.setattr(
        lgnd_handler_module,
        "duckdb",
        types.SimpleNamespace(connect=LocalDuckDBCon),
    )
    return lgnd_handler_module
