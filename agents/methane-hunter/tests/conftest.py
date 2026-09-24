"""Shared fixtures for the Methane Hunter unit tests.

Run from agents/methane-hunter/ with the repo venv:
    ../../.venv/bin/python -m pytest -q

Hermetic, like geo_agent/tests: no network, no AWS. The platform's shared code is imported from
the real geo_agent/ (via _paths), with the same stubs geo_agent/tests uses for runtime-only
dependencies (strands, osmnx, ...). CMR is served from a recorded page (tests/fixtures), LP DAAC
downloads are patched, and S3 is an in-memory fake.
"""
import importlib
import io
import json
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
FIXTURES = Path(__file__).resolve().parent / "fixtures"

os.environ.setdefault("S3_BUCKET_NAME", "test-bucket")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.pop("EARTHDATA_TOKEN", None)
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

SESSION = "sess-methane-0001"
BUCKET = "test-bucket"
PLUME_ID = "EMIT_L2B_CH4PLM_002_20240812T190223_002202"
PLUME_ID_2 = "EMIT_L2B_CH4PLM_002_20240715T181502_001105"
PLUME_ID_3 = "EMIT_L2B_CH4PLM_002_20240601T170000_000999"

# --- synthetic plume COG ---------------------------------------------------------------------
# 222 x 221 float32 like the spike's granule, EPSG:4326, pixel 0.00054 deg, nodata -9999.
# 329 valid pixels: 328 at 600.0 (above the 500 ppm·m enhancement floor) and one peak at 4699.2.
PLUME_W, PLUME_H, PLUME_PX = 222, 221, 0.00054
PLUME_ORIGIN = (-102.108, 32.301)
PLUME_VALID = 329
PLUME_PEAK = 4699.2
PLUME_BASE = 600.0


def make_plume_bytes(peak=PLUME_PEAK, base=PLUME_BASE, valid=PLUME_VALID, nodata=-9999.0, noise=0) -> bytes:
    """`noise` extra valid pixels of background (-300 and 120 ppm·m, below the floor) after the plume."""
    data = np.full((PLUME_H, PLUME_W), nodata, dtype=np.float32)
    flat = data.reshape(-1)
    start = (PLUME_H // 2) * PLUME_W + PLUME_W // 3
    flat[start:start + valid] = base
    if noise:
        flat[start + valid:start + valid + noise] = np.where(np.arange(noise) % 2 == 0, -300.0, 120.0)
    if valid:
        flat[start] = peak
    buf = io.BytesIO()
    with rasterio.MemoryFile() as mem:
        with mem.open(driver="GTiff", width=PLUME_W, height=PLUME_H, count=1, dtype="float32",
                      crs="EPSG:4326", transform=from_origin(PLUME_ORIGIN[0], PLUME_ORIGIN[1], PLUME_PX, PLUME_PX),
                      nodata=nodata) as ds:
            ds.write(data, 1)
        buf.write(mem.read())
    return buf.getvalue()


# --- in-memory S3 -----------------------------------------------------------------------------

class _NoSuchKey(Exception):
    pass


class FakeS3:
    exceptions = types.SimpleNamespace(NoSuchKey=_NoSuchKey)

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.puts: list[dict] = []
        self.gets: list[str] = []
        self._clock = 0

    def put_object(self, Bucket, Key, Body, ContentType=None):
        assert Bucket == BUCKET
        self._clock += 1
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()
        self.puts.append({"Key": Key, "ContentType": ContentType, "t": self._clock})

    def get_object(self, Bucket, Key):
        assert Bucket == BUCKET
        self.gets.append(Key)
        if Key not in self.objects:
            raise _NoSuchKey(Key)
        body = self.objects[Key]
        return {"Body": io.BytesIO(body), "ContentLength": len(body)}

    def list_objects_v2(self, Bucket, Prefix):
        from datetime import datetime, timedelta
        base = datetime(2026, 1, 1)
        stamps = {p["Key"]: p["t"] for p in self.puts}
        return {"Contents": [{"Key": k, "LastModified": base + timedelta(seconds=stamps.get(k, 0))}
                             for k in self.objects if k.startswith(Prefix)]}


@pytest.fixture()
def fake_s3():
    return FakeS3()


@pytest.fixture()
def cmr_page():
    return json.loads((FIXTURES / "cmr_permian_2024_page.json").read_text())


@pytest.fixture()
def tools(fake_s3, monkeypatch):
    """methane_tools with S3 faked, the session fixed, and the archive date pinned."""
    mod = importlib.import_module("methane_tools")
    monkeypatch.setattr(mod, "_s3", lambda: fake_s3)
    monkeypatch.setattr(mod.config, "S3_BUCKET_NAME", BUCKET)
    monkeypatch.setenv("AGENT_SESSION_ID", SESSION)
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    mod._archive_latest_cache.clear()
    return mod


def footprint(gid, lon=-102.05, lat=32.24, d=0.05):
    ring = [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]
    return {"type": "Feature",
            "properties": {"granule_id": gid, "acquired": "2024-08-12T19:02:23Z", "tier": "detected",
                           "center_lat": lat, "center_lon": lon},
            "geometry": {"type": "Polygon", "coordinates": [ring]}}


def put_plume_list(fake_s3, features, name="plumes_permian_basin_2024-01-01_2024-12-31.geojson"):
    key = f"session_data/{SESSION}/methane/{name}"
    fake_s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps({"type": "FeatureCollection", "features": features}).encode())
    return f"s3://{BUCKET}/{key}"
