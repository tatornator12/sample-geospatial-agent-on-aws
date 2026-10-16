"""Shared fixtures for Dark Vessels' unit tests.

Run from agents/dark-vessels/ with the repo venv:
    ../../.venv/bin/python -m pytest -q

Hermetic: no network, no AWS. The platform's shared code comes from the real geo_agent/ with stubs
for runtime-only dependencies; S3 is an in-memory fake holding a small synthetic cache for the
passes on file (data/passes_v1.json): a handful of targets round Santa Cruz and San Cristóbal, AIS
that makes some of that water heard, the reserve's history, the squid fleet's seasons, and the real
S1D plan fixture. The records (data/reserve_v1.geojson) are the real ones.
"""
import importlib
import io
import json
import os
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_DIR.parents[1]
GEO_AGENT_DIR = REPO_ROOT / "geo_agent"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

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

SESSION = "sess-vessels-0001"
BUCKET = "test-bucket"
STAR = "s1d-20261012t0018"
SILENT = "s1a-20240306t0027"
PASS_TIME = datetime(2026, 10, 12, 0, 18, 2, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)     # inside the plan fixture's period
PLAN_FIXTURE = "s1d_mp_user_20261016t175423_20261105t200200.kml"

# The star pass's targets (lon, lat): A both + unmatched in heard water (a candidate), B GFW only
# in heard water (seen once), C both + matched (broadcasting), D both + unmatched far from any AIS
# (unproven), E ours only in heard water (seen once), P both + unmatched by Puerto Ayora (port).
A = (-89.95, -0.45)
B = (-89.90, -0.52)
C = (-90.05, -0.38)
D = (-89.60, 0.80)
E = (-90.00, -0.56)
P = (-90.29, -0.77)


# --- in-memory S3 -----------------------------------------------------------------------------

class _NoSuchKey(Exception):
    pass


class FakeS3:
    exceptions = types.SimpleNamespace(NoSuchKey=_NoSuchKey)

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.copies: list[tuple[str, str]] = []

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
        if CopySource["Key"] not in self.objects:
            raise _NoSuchKey(CopySource["Key"])
        self.objects[Key] = self.objects[CopySource["Key"]]
        self.copies.append((CopySource["Key"], Key))

    def json(self, key):
        return json.loads(self.objects[key])


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%MZ")


def star_targets() -> dict:
    ours = [{"id": "R001", "lon": A[0] + 0.002, "lat": A[1], "px": 6, "peak_db": 14.1, "area_m2": 2400, "in_reserve": True},
            {"id": "R002", "lon": C[0], "lat": C[1] + 0.002, "px": 12, "peak_db": 21.0, "area_m2": 4800, "in_reserve": True},
            {"id": "R003", "lon": D[0], "lat": D[1], "px": 5, "peak_db": 12.5, "area_m2": 2000, "in_reserve": True},
            {"id": "R004", "lon": E[0], "lat": E[1], "px": 4, "peak_db": 11.0, "area_m2": 1600, "in_reserve": True},
            {"id": "R005", "lon": P[0], "lat": P[1], "px": 9, "peak_db": 16.0, "area_m2": 3600, "in_reserve": True}]
    gfw = [{"id": "G001", "lon": A[0], "lat": A[1], "n": 1, "matched": False, "ours": "R001", "pair_km": 0.22},
           {"id": "G002", "lon": B[0], "lat": B[1], "n": 1, "matched": False},
           {"id": "G003", "lon": C[0], "lat": C[1], "n": 1, "matched": True, "ours": "R002", "pair_km": 0.22},
           {"id": "G004", "lon": D[0], "lat": D[1] + 0.001, "n": 1, "matched": False, "ours": "R003", "pair_km": 0.11},
           {"id": "G005", "lon": P[0], "lat": P[1], "n": 1, "matched": False, "ours": "R005", "pair_km": 0.0}]
    for o in ours:
        o["gfw"] = next((g["id"] for g in gfw if g.get("ours") == o["id"]), None)
    return {"pass_id": STAR, "sensed": "2026-10-12T00:18:02Z", "bounds": [-91.33, -2.35, -88.38, 1.6], "ours": ours, "gfw": gfw}


def star_presence() -> dict:
    h = PASS_TIME.replace(minute=0, second=0)
    fixes = [[-89.92, -0.42, _iso(h)], [-89.98, -0.48, _iso(h)], [C[0] + 0.01, C[1], _iso(h)],
             [-89.92, -0.43, _iso(h - timedelta(hours=1))]]
    return {"pass_id": STAR, "sensed": "2026-10-12T00:18:02Z", "window_h": 3.0, "fixes": fixes}


def star_replay() -> dict:
    h = PASS_TIME.replace(minute=0, second=0)
    hours = [h + timedelta(hours=k) for k in (-2, -1, 0, 1)]
    return {"start": _iso(h - timedelta(hours=72)), "end": _iso(PASS_TIME), "tracks": [
        {"n": 1, "type": "passenger", "t": [_iso(t) for t in hours], "c": [[C[0] + 0.01 * k, C[1]] for k in (-1, 0, 1, 2)]},
        {"n": 2, "type": "fishing", "t": [_iso(t) for t in hours], "c": [[-89.92, -0.42]] * 4},
        {"n": 3, "type": "cargo", "t": [_iso(t) for t in hours], "c": [[-89.98, -0.48]] * 4}]}


def silent_targets() -> dict:
    return {"pass_id": SILENT, "sensed": "2024-03-06T00:27:07Z", "bounds": [-94.0, -2.5, -90.5, 1.0], "ours": [],
            "gfw": [{"id": "G001", "lon": -92.4, "lat": -1.2, "n": 1, "matched": False},       # about 40 km by water
                    {"id": "G002", "lon": -90.6, "lat": -0.1, "n": 1, "matched": False}]}      # far beyond 133 km


def history() -> dict:
    rng = np.random.default_rng(7)
    dark = []
    for y in (2023, 2024, 2025, 2026):
        for i in range(40):
            lon, lat = ((-90.45, -0.45), (-91.45, -0.2))[i % 2]
            d = date(y, 1, 1) + timedelta(days=int(rng.integers(0, 280 if y == 2026 else 360)))
            dark.append([d.isoformat(), round(lon + rng.normal(0, 0.03), 4), round(lat + rng.normal(0, 0.03), 4), 1, 25.0])
        for _ in range(10):
            d = date(y, 6, 1)
            dark.append([d.isoformat(), round(rng.uniform(-91.5, -89.5), 4), round(rng.uniform(-1.2, 0.5), 4), 1, 30.0])
    dark.append(["2026-09-01", -90.30, -0.76, 3, 1.5])          # by Puerto Ayora: left out of the map
    went_off = datetime(2024, 3, 5, 12, 27, tzinfo=timezone.utc)
    gaps = [{"start": _iso(went_off), "end": _iso(went_off + timedelta(hours=30)), "type": "fishing", "off": [-92.76, -1.11],
             "on": [-92.55, -1.05], "hours": 30.0, "km": 26.1, "kn": 0.5, "intentional": True, "starts_in_reserve": False}]
    return {"built": "2026-10-16", "until": "2026-10-13", "dark": {"fields": ["day", "lon", "lat", "n", "port_km"], "rows": dark},
            "gaps": {"rows": gaps}}


def fleet() -> dict:
    rows = []
    for y in range(2017, 2027):
        for m in range(1, 13):
            if y == 2026 and m > 9:
                break
            near = 5000.0 if (y < 2026 and m in (6, 7, 8)) else 0.0
            if near:
                rows.append([f"{y}-{m:02d}", -86.0, -2.0, near])
            rows.append([f"{y}-{m:02d}", -82.0, -12.0, 30000.0 if y == 2026 and m >= 6 else 8000.0])
    return {"built": "2026-10-16", "until": "2026-10-13", "fields": ["month", "lon", "lat", "hours"], "rows": rows}


def seed(s3: FakeS3) -> None:
    pre = "vessels/cache/v1"
    files = {f"{STAR}_targets.json": star_targets(), f"{STAR}_presence.json": star_presence(), f"{STAR}_replay.json": star_replay(),
             f"{SILENT}_targets.json": silent_targets(), "history_v1.json": history(), "fleet_v1.json": fleet()}
    for name, body in files.items():
        s3.put_object(Bucket=BUCKET, Key=f"{pre}/{name}", Body=json.dumps(body))
    for pid in (STAR, SILENT):
        s3.put_object(Bucket=BUCKET, Key=f"{pre}/{pid}_display.tif", Body=b"II*\x00display")
    s3.put_object(Bucket=BUCKET, Key=f"{pre}/{STAR}_chip_R001.tif", Body=b"II*\x00chip")

    def products(pid):
        return {k: {"key": f"{pre}/{pid}_{k}.{'tif' if k in ('vv', 'display') else 'json'}", "bytes": 1}
                for k in ("vv", "display", "targets", "presence", "replay")}
    manifest = {"version": "v1", "passes": {
        STAR: {"pass_id": STAR, "bounds": [-91.33, -2.35, -88.38, 1.6], "products": products(STAR),
               "chips": {"R001": f"{pre}/{STAR}_chip_R001.tif"}},
        SILENT: {"pass_id": SILENT, "bounds": [-94.0, -2.5, -90.5, 1.0], "products": products(SILENT), "chips": {}}},
        "history": {"key": f"{pre}/history_v1.json"}, "fleet": {"key": f"{pre}/fleet_v1.json"}}
    s3.put_object(Bucket=BUCKET, Key=f"{pre}/manifest.json", Body=json.dumps(manifest))
    s3.put_object(Bucket=BUCKET, Key=f"vessels/cache/plan/{PLAN_FIXTURE[:-4]}.kml", Body=(FIXTURES / PLAN_FIXTURE).read_bytes())
    s3.put_object(Bucket=BUCKET, Key="vessels/cache/plan/latest.json", Body=json.dumps({
        "fetched_at": "2026-10-16T17:30:00Z", "plans": {"s1d": {"key": f"vessels/cache/plan/{PLAN_FIXTURE[:-4]}.kml",
                                                                "name": PLAN_FIXTURE[:-4],
                                                                "period": ["2026-10-16T17:54:23Z", "2026-11-05T20:02:00Z"]}}}))


@pytest.fixture()
def fake_s3():
    s3 = FakeS3()
    seed(s3)
    return s3


@pytest.fixture()
def vessels(fake_s3, monkeypatch):
    """The tool modules with S3 faked, the session fixed, the clock inside the plan's period."""
    vs = importlib.import_module("vessel_store")
    monkeypatch.setattr(vs, "_s3", lambda: fake_s3)
    monkeypatch.setattr(vs.config, "S3_BUCKET_NAME", BUCKET)
    monkeypatch.setenv("AGENT_SESSION_ID", SESSION)
    vs.clear_cache()
    ft = importlib.import_module("forecast_tools")
    monkeypatch.setattr(ft, "_now", lambda: NOW)
    ft._plan_cache.clear()
    mods = types.SimpleNamespace(vs=vs, s3=fake_s3, pt=importlib.import_module("pass_tools"),
                                 ais=importlib.import_module("ais_tools"), ft=ft,
                                 tk=importlib.import_module("tasking_tools"))
    yield mods
    vs.clear_cache()
    ft._plan_cache.clear()
