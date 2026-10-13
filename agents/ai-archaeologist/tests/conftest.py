"""Shared fixtures for the AI Archaeologist's unit tests.

Run from agents/ai-archaeologist/ with the repo venv:
    ../../.venv/bin/python -m pytest -q

Hermetic, like the other agents' tests: no network, no AWS. The platform's shared code comes from
the real geo_agent/ (via _paths) with the same stubs for runtime-only dependencies; S3 is an
in-memory fake; the DEM is a synthetic earthwork (a ring bank with an interior ditch) written to a
temporary GeoTIFF on the Newark Great Circle's grid.
"""
import importlib
import io
import json
import math
import os
import sys
import types
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_DIR.parents[1]
GEO_AGENT_DIR = REPO_ROOT / "geo_agent"

os.environ.setdefault("S3_BUCKET_NAME", "test-bucket")
os.environ.setdefault("AWS_REGION", "us-east-1")
for p in (str(AGENT_DIR), str(GEO_AGENT_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _stub_module(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


def _identity_tool(fn=None, **_kwargs):
    if callable(fn):
        return fn
    return lambda f: f


def _unavailable(*_a, **_k):
    raise RuntimeError("stubbed dependency called inside a unit test")


_stub_module("strands", tool=_identity_tool)
_stub_module("strands_tools", calculator=types.SimpleNamespace(name="calculator"))
_stub_module("osmnx", geocode=_unavailable, geocode_to_gdf=_unavailable)
_geopy = _stub_module("geopy")
_geopy.geocoders = _stub_module("geopy.geocoders")
_stub_module("rasterstats", zonal_stats=_unavailable)
_stub_module("pystac_client", Client=types.SimpleNamespace(open=_unavailable))

# Real geo_agent/utils modules without executing utils/__init__.py's wildcard imports.
_utils_pkg = types.ModuleType("utils")
_utils_pkg.__path__ = [str(GEO_AGENT_DIR / "utils")]
sys.modules.setdefault("utils", _utils_pkg)

SESSION = "sess-archaeo-0001"
BUCKET = "test-bucket"

# --- synthetic earthwork on the Great Circle's grid -------------------------------------------
# NAD83 / UTM 17N is close enough to WGS 84 / UTM 17N for a test: the DEM is written in 32617.
CENTRE_UTM = (377913.0, 4433290.0)
GROUND_M = 263.0
BANK_R, BANK_H, BANK_W = 181.0, 2.5, 6.0      # crest radius 181 m: crest-to-crest 362 m
DITCH_R, DITCH_D, DITCH_W = 168.0, 2.6, 5.0   # interior ditch
DEM_HALF = 400


def make_dem(path: Path) -> Path:
    n = 2 * DEM_HALF
    x0, y0 = CENTRE_UTM[0] - DEM_HALF, CENTRE_UTM[1] + DEM_HALF
    cols, rows = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    x, y = x0 + cols, y0 - rows
    r = np.hypot(x - CENTRE_UTM[0], y - CENTRE_UTM[1])
    z = (GROUND_M + BANK_H * np.exp(-((r - BANK_R) / BANK_W) ** 2)
         - DITCH_D * np.exp(-((r - DITCH_R) / DITCH_W) ** 2)).astype("float32")
    with rasterio.open(path, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32",
                       crs="EPSG:32617", transform=from_origin(x0, y0, 1.0, 1.0), nodata=-9999.0) as ds:
        ds.write(z, 1)
    return path


def lonlat(x, y):
    from rasterio.warp import transform
    lon, lat = transform("EPSG:32617", "EPSG:4326", [x], [y])
    return round(lon[0], 6), round(lat[0], 6)


# --- in-memory S3 -----------------------------------------------------------------------------

class _NoSuchKey(Exception):
    pass


class FakeS3:
    exceptions = types.SimpleNamespace(NoSuchKey=_NoSuchKey)

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.copies: list[tuple[str, str]] = []
        self.fail_copy = False

    def put_object(self, Bucket, Key, Body, ContentType=None):
        assert Bucket == BUCKET
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()

    def get_object(self, Bucket, Key):
        assert Bucket == BUCKET
        if Key not in self.objects:
            raise _NoSuchKey(Key)
        return {"Body": io.BytesIO(self.objects[Key])}

    def copy_object(self, Bucket, Key, CopySource, **_kw):
        assert Bucket == BUCKET and CopySource["Bucket"] == BUCKET
        if self.fail_copy or CopySource["Key"] not in self.objects:
            raise _NoSuchKey(CopySource["Key"])
        self.objects[Key] = self.objects[CopySource["Key"]]
        self.copies.append((CopySource["Key"], Key))


def manifest_for(sites) -> dict:
    """A terrain manifest with a 3 km frame around each site's catalogue centre."""
    out = {}
    for s in sites:
        lat, lon = s["centre"]["lat"], s["centre"]["lon"]
        dlat, dlon = 1500 / 110574.0, 1500 / (111320.0 * math.cos(math.radians(lat)))
        out[s["id"]] = {"id": s["id"], "bounds": [round(lon - dlon, 6), round(lat - dlat, 6),
                                                   round(lon + dlon, 6), round(lat + dlat, 6)],
                        "tiles": [{"title": "USGS 1 Meter test tile", "publication_date": "2025-01-01"}]}
    return {"version": "v1", "sites": out}


@pytest.fixture()
def fake_s3():
    return FakeS3()


@pytest.fixture()
def tools(fake_s3, monkeypatch):
    """site_tools with S3 faked, the session fixed, and every catalogue site 'built' with its products."""
    mod = importlib.import_module("site_tools")
    monkeypatch.setattr(mod, "_s3", lambda: fake_s3)
    monkeypatch.setattr(mod.config, "S3_BUCKET_NAME", BUCKET)
    monkeypatch.setenv("AGENT_SESSION_ID", SESSION)
    mod._manifest_cache.clear()
    sites = list(mod.catalogue().values())
    fake_s3.put_object(Bucket=BUCKET, Key=mod.MANIFEST_KEY, Body=json.dumps(manifest_for(sites)).encode())
    for s in sites:
        for product in ("dem", "hillshade", "lrm"):
            fake_s3.put_object(Bucket=BUCKET, Key=f"{mod.CACHE_PREFIX}/{s['id']}_{product}.tif", Body=b"II*\x00")
    yield mod
    mod._manifest_cache.clear()
