#!/usr/bin/env python3
"""Warm the Methane Watch caches before a rehearsal or the show.

    AWS_PROFILE=main .venv/bin/python scripts/warm_watch.py            # every watch area
    AWS_PROFILE=main .venv/bin/python scripts/warm_watch.py --areas "south caspian" "zagros foreland"

Runs the Methane Watch tools from this machine against the same shared S3 cache the runtimes
use (`s3://<bucket>/methane/cache/`), so the mission on stage reads warm results in about a
second per tool instead of fetching from NASA and the Sentinel-5P archive:

  - watch_baseline (the global site clusters)
  - scan_tropomi for each area at the day counts the mission uses (the composite is keyed by its
    end day, so run this the day before AND the morning of the show)
  - for each area's top EMIT-visible hotspots: check_recent_passes and site_history, at the exact
    coordinates the scan reports (which the agent passes on verbatim)
  - fixed sites the run sheet names

Reads agents/methane-hunter/.env.dev for the bucket and the Earthdata token (never printed).
The runtime-only frameworks the tools import but do not need here are stubbed, as in the tests.
"""
import argparse
import asyncio
import json
import os
import sys
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = REPO_ROOT / "agents" / "methane-hunter"
FIXED_SITES = [  # (label for the log, lat, lon)
    ("Permian rank 1 (2024-01-31)", 31.86424, -101.7662),
    ("Turkmenistan recurring site", 37.48, 61.025),
]


def load_env(path: Path) -> None:
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def import_tools():
    sys.path.insert(0, str(AGENT_DIR))
    for name in ("strands", "strands_tools", "osmnx", "rasterstats", "geopy", "geopy.geocoders", "pystac_client"):
        try:
            __import__(name)
        except ImportError:
            stub = types.ModuleType(name)
            stub.tool = lambda f=None, **_k: f if callable(f) else (lambda g: g)
            stub.calculator = stub.zonal_stats = stub.Client = None
            sys.modules[name] = stub
    import _paths  # noqa: F401  (geo_agent's config and utils on sys.path)
    utils = types.ModuleType("utils")   # the tools' utils imports, without utils/__init__'s wildcard imports
    utils.__path__ = [os.path.join(_paths.shared_code_dir(), "utils")]
    sys.modules.setdefault("utils", utils)
    import watch_tools
    import ground_tools
    watch_tools.thermal_anomalies = ground_tools.thermal_anomalies
    watch_tools.nearby_infrastructure = ground_tools.nearby_infrastructure
    return watch_tools


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--areas", nargs="*", help="watch areas (default: all)")
    parser.add_argument("--days", default="14,7", help="TROPOMI day counts to warm (default 14,7)")
    parser.add_argument("--hotspots", type=int, default=2, help="EMIT-visible hotspots per area to warm (default 2)")
    parser.add_argument("--env", default=str(AGENT_DIR / ".env.dev"))
    args = parser.parse_args()

    load_env(Path(args.env))
    if not os.environ.get("EARTHDATA_TOKEN"):
        print("EARTHDATA_TOKEN missing from the env file: EMIT passes cannot be warmed.")
        return 1
    os.environ["AGENT_SESSION_ID"] = f"warm-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4()}"
    os.chdir(AGENT_DIR)
    w = import_tools()
    areas = args.areas or list(w.WATCH_AREAS)
    day_counts = [int(d) for d in args.days.split(",") if d.strip()]
    failures = 0

    def run(label, coro):
        nonlocal failures
        t = time.time()
        out = json.loads(asyncio.run(coro))
        status = "ERROR " + out["error"] if "error" in out else "ok"
        failures += "error" in out
        print(f"  {time.time() - t:5.1f}s  {label}: {status}")
        return out

    print(f"Warming Methane Watch caches ({len(areas)} areas, days {day_counts})")
    # Overture extracts: everything mapped of an allowlisted type inside each watch area, once per
    # Overture release (minutes each, straight from AWS Open Data), so the infrastructure check inside
    # a watch area is one small S3 read on the day.
    import overture as ov
    s3 = w.mt._s3()
    # The file index first: each parquet file's bbox from its footer, so every later read (the
    # extracts here, a live check on the day) opens only the few files that cover its box.
    if ov.load_index(s3) is not None:
        print(f"   cached  overture index ({ov.RELEASE})")
    else:
        t = time.time()
        try:
            files = ov.build_index(s3)
            print(f"  {time.time() - t:5.1f}s  overture index: " + ", ".join(f"{k.split('/')[1]} {len(v)}" for k, v in files.items()))
        except Exception as e:
            failures += 1
            print(f"  {time.time() - t:5.1f}s  overture index: ERROR {type(e).__name__} (extracts and live checks read every file)")
    for area in areas:
        if ov.load_extract(area, s3) is not None:
            print(f"   cached  overture extract {area} ({ov.RELEASE})")
            continue
        t = time.time()
        try:
            out = ov.extract_area(area, w.WATCH_AREAS[area]["bbox"], s3)
            print(f"  {time.time() - t:5.1f}s  overture extract {area}: {out['rows']} rows, {out['bytes'] // 1024} kB")
        except Exception as e:
            failures += 1
            print(f"  {time.time() - t:5.1f}s  overture extract {area}: ERROR {type(e).__name__}")
    base = run("watch_baseline", w.watch_baseline())
    if "summary" in base:
        s = base["summary"]
        print(f"         {s['detections']} detections, {s['sites']} sites, {s['repeat_sites']} repeat sites")

    for area in areas:
        scans = [run(f"scan_tropomi {area} {d}d", w.scan_tropomi(area=area, days=d)) for d in day_counts]
        visible = [h for h in (scans[0].get("hotspots") or []) if h.get("emit_can_look")][: args.hotspots]
        for h in visible:
            where = f"{area} hotspot {h['rank']} ({h['lat']}, {h['lon']}, +{h['anomaly_ppb']} ppb)"
            passes = run(f"check_recent_passes {where}", w.check_recent_passes(h["lat"], h["lon"]))
            if "summary" in passes:
                s = passes["summary"]
                print(f"         {s['read']} passes: {s['candidates']} candidates, {s['rejected']} rejected")
            run(f"site_history {where}", w.site_history(h["lat"], h["lon"]))
            # The ground-record checks: inside a watch area the Overture read comes from the extract
            # above, and the VIIRS pull is quick but cached per day too.
            run(f"nearby_infrastructure {where}", w.nearby_infrastructure(h["lat"], h["lon"]))
            run(f"thermal_anomalies {where}", w.thermal_anomalies(h["lat"], h["lon"]))

    for label, lat, lon in FIXED_SITES:
        run(f"check_recent_passes {label}", w.check_recent_passes(lat, lon))
        run(f"site_history {label}", w.site_history(lat, lon))
        run(f"nearby_infrastructure {label}", w.nearby_infrastructure(lat, lon))
        run(f"thermal_anomalies {label}", w.thermal_anomalies(lat, lon))

    print("Done." if not failures else f"Done with {failures} error(s): rerun, or check the token and the sources.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
