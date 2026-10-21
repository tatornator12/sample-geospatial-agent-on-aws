"""Dark Vessels: what every tool shares. The passes on file, the records (the reserve, its ports, the
land), the cache in the project bucket (vessels/cache/v1/, built by scripts/build_vessel_cache.py),
the session's folder (session_data/<sid>/vessels/), and the fixed sentences.

The runtime reads only the bucket and the session (and, in next_look, ESA's plan). It never calls
Global Fishing Watch, Planetary Computer or NOAA, and nothing it reads carries a vessel's identity:
the build stripped and scanned every file.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import boto3
import numpy as np
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep

import _paths  # noqa: F401  (shared platform code on sys.path before `import config`)
import config
from predict import Grid

logger = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent
PASSES_PATH = HERE / "data" / "passes_v1.json"
RECORDS_PATH = HERE / "data" / "reserve_v1.geojson"
CACHE_PREFIX = "vessels/cache/v1"
PLAN_PREFIX = "vessels/cache/plan"
MANIFEST_KEY = f"{CACHE_PREFIX}/manifest.json"
CACHE_TTL_S = 300
PORT_KM = 10.0
PASS_ID_RE = re.compile(r"^s1[a-d]-\d{8}t\d{4}$")
CANDIDATE_ID_RE = re.compile(r"^T\d{2}$")
ATTRIBUTION = "Powered by Global Fishing Watch."
CLAIM_KM = 5.0              # a broadcasting target's hairline to its AIS position at the pass minute
OURS_MATCH_KM = 1.0         # one of our targets with an AIS position this close is broadcasting

# Fixed sentences (the eval checks them word for word).
ON_FILE_ONLY = "I only investigate passes on file."
CANDIDATE_SENTENCE = "A candidate is a radar target with no broadcast nearby; it is not an accusation."
CANNOT_SAY = "I cannot say which, if any, of these it is."
RECEPTION_UNKNOWN = "reception unknown: no AIS there proves nothing"
# gather_evidence's four innocent explanations in one sentence.
SAY_ELSE = "Each could be a small boat, a missed or switched-off AIS, or not a vessel."
OFFICERS_DECISION = "The decision is the officer's; I only draft."


# --- S3 and the session ------------------------------------------------------------------------

def _s3():
    return boto3.client("s3")


def session_id() -> str:
    return os.environ.get("AGENT_SESSION_ID", config.DEFAULT_SESSION_ID)


def session_prefix() -> str:
    return f"session_data/{session_id()}/"


def vessels_prefix() -> str:
    return f"{session_prefix()}vessels/"


def s3_url(key: str) -> str:
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


def put_json(key: str, body) -> str:
    _s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=json.dumps(body, separators=(",", ":")).encode(),
                     ContentType="application/geo+json" if key.endswith(".geojson") else "application/json")
    return s3_url(key)


def get_json(key: str):
    return json.loads(_s3().get_object(Bucket=config.S3_BUCKET_NAME, Key=key)["Body"].read())


def exists(key: str) -> bool:
    """Whether an object is there (a HEAD: never the body). Any refusal reads as not there."""
    try:
        _s3().head_object(Bucket=config.S3_BUCKET_NAME, Key=key)
        return True
    except Exception:
        return False


def list_keys(prefix: str, limit: int = 200) -> list[str]:
    """The keys under a prefix (one page; a session folder holds a few dozen)."""
    page = _s3().list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=prefix, MaxKeys=limit)
    return [o["Key"] for o in page.get("Contents", [])]


def copy_into_session(src_key: str, dst_key: str, content_type: str = "image/tiff") -> str:
    """A server-side copy of a cached file into the session (the stage reads only session copies)."""
    _s3().copy_object(Bucket=config.S3_BUCKET_NAME, Key=dst_key,
                      CopySource={"Bucket": config.S3_BUCKET_NAME, "Key": src_key},
                      ContentType=content_type, MetadataDirective="REPLACE")
    return s3_url(dst_key)


_cache: dict = {}


def cached(key: str):
    """A cache file, kept in the process for a few minutes (the same pass is read by every tool)."""
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] + CACHE_TTL_S > now:
        return hit[1]
    body = get_json(key)
    _cache[key] = (now, body)
    return body


def manifest() -> dict:
    return cached(MANIFEST_KEY)


def clear_cache() -> None:
    _cache.clear()


# --- the passes on file and the records ---------------------------------------------------------

@lru_cache(maxsize=1)
def on_file() -> dict:
    return json.loads(PASSES_PATH.read_text())


def passes() -> list[dict]:
    """Every pass on file: the star, the alternates, the silent vessel's earlier pass."""
    f = on_file()
    return f["passes"] + [f["silent_vessel"]]


def pass_entry(pass_id: str) -> dict | None:
    if not isinstance(pass_id, str) or not PASS_ID_RE.fullmatch(pass_id):
        return None
    return next((p for p in passes() if p["pass_id"] == pass_id), None)


def on_file_list() -> list[str]:
    """The passes on file as the agent names them ("Sentinel-1D, Oct 12, 2026")."""
    out = []
    for p in passes():
        d = p["sensed"][:10]
        out.append(f"{p['pass_id']} ({p.get('satellite', 'Sentinel-1')}, {d})")
    return out


def refusal(extra: str = "") -> str:
    return json.dumps({"error": ON_FILE_ONLY + (f" {extra}" if extra else ""), "passes_on_file": on_file_list()})


@lru_cache(maxsize=1)
def records() -> dict:
    rec = json.loads(RECORDS_PATH.read_text())
    reserve = shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))
    ports = [(f["properties"]["name"], tuple(f["geometry"]["coordinates"])) for f in rec["features"]
             if f["properties"]["kind"] == "port"]
    land = unary_union([shape(f["geometry"]) for f in rec["features"] if f["properties"]["kind"] == "land"])
    return {"reserve": reserve, "reserve_prep": prep(reserve), "ports": ports, "land": land}


def km(a, b) -> float:
    p = math.pi / 180
    h = math.sin((b[1] - a[1]) * p / 2) ** 2 + math.cos(a[1] * p) * math.cos(b[1] * p) * math.sin((b[0] - a[0]) * p / 2) ** 2
    return 12742.0176 * math.asin(math.sqrt(min(1.0, h)))


def nearest_port(lon: float, lat: float) -> tuple[str, float]:
    name, xy = min(records()["ports"], key=lambda p: km((lon, lat), p[1]))
    return name, round(km((lon, lat), xy), 1)


def km_to_shore(lon: float, lat: float) -> float:
    """Distance to the nearest land polygon, in km (equirectangular at this latitude; fine at 0°)."""
    d = Point(lon, lat).distance(records()["land"])
    return round(d * 111.2, 1)


def in_reserve(lon: float, lat: float) -> bool:
    return records()["reserve_prep"].contains(Point(lon, lat))


@lru_cache(maxsize=1)
def reserve_grid() -> tuple[Grid, np.ndarray]:
    """The 0.05° grid over the reserve (decision 3) and its water cells (cell centre in the reserve)."""
    step = 0.05
    w, s, e, n = records()["reserve"].bounds
    grid = Grid(round(math.floor(w / step) * step, 2), round(math.floor(s / step) * step, 2),
                round(math.ceil(e / step) * step, 2), round(math.ceil(n / step) * step, 2), step)
    rp = records()["reserve_prep"]
    h, wd = grid.shape
    water = np.array([[rp.contains(Point(grid.west + (c + .5) * step, grid.south + (r + .5) * step)) for c in range(wd)]
                      for r in range(h)])
    return grid, water


def parse_t(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def heads_at(replay: dict, when: datetime, max_gap_h: float = 3.0) -> list[dict]:
    """Every replay track's position at `when`, interpolated between hourly fixes up to `max_gap_h` apart."""
    out = []
    for tr in replay["tracks"]:
        ts = [parse_t(x) for x in tr["t"]]
        if not ts or when < ts[0] - timedelta(minutes=30) or when > ts[-1] + timedelta(hours=1):
            continue
        i = max(0, sum(1 for t in ts if t <= when) - 1)
        lon, lat = tr["c"][i]
        if i + 1 < len(ts) and (ts[i + 1] - ts[i]) <= timedelta(hours=max_gap_h) and ts[i] <= when:
            a = (when - ts[i]) / (ts[i + 1] - ts[i])
            lon = lon + a * (tr["c"][i + 1][0] - lon)
            lat = lat + a * (tr["c"][i + 1][1] - lat)
        minutes = round(min(abs((when - t).total_seconds()) for t in ts) / 60)
        out.append({"lon": lon, "lat": lat, "type": tr.get("type", "unknown"), "fix_minutes": minutes})
    return out


def nearest_head(target: dict, heads: list[dict]) -> tuple[dict | None, float]:
    near = min(heads, key=lambda h: km((target["lon"], target["lat"]), (h["lon"], h["lat"])), default=None)
    return near, (km((target["lon"], target["lat"]), (near["lon"], near["lat"])) if near else math.inf)


def broadcasts(target: dict, near_km: float) -> bool:
    """A target AIS claims: GFW matched it to a broadcast, or it is ours alone with a broadcast within 1 km."""
    return target["status"] != "port" and bool(target.get("gfw_matched") or (target["source"] == "ours" and near_km <= OURS_MATCH_KM))


def fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def point(lon: float, lat: float, **props) -> dict:
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}}


def nice_time(iso: str) -> str:
    """'2026-10-12T00:18:02Z' -> 'Oct 12, 2026 00:18 UTC'."""
    from datetime import datetime
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return f"{t:%b} {t.day}, {t:%Y %H:%M} UTC"
