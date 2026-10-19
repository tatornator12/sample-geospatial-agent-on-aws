#!/usr/bin/env python3
"""Act 3's resting state for the stage (task 4.3): what the room sees the moment Dark Vessels is
chosen, before any prompt. One file, `vessels/cache/v1/rest_v1.json`, beside the cache it is cut from:

    pass       the star pass (id, satellite, sensed, orbit state): the replay runs up to its minute
    replay     the star pass's AIS replay as built (three days of hourly positions per track, numbered
               for this pass only, type only; no identity was ever in it)
    reserve    the Galápagos Marine Reserve's outline (WDPA through GFW, as data/reserve_v1.geojson)
    ports      the five ports (name and position)
    islands    where the stage names the islands
    passes     every pass on file (id, satellite, sensed, orbit state): the stage dates and sweeps any
               radar the agent shows, from its file name
    attribution

The backend serves it at /api/vessels/rest (a fixed key: the browser never names one). Run after
every cache build:

    AWS_PROFILE=main .venv/bin/python scripts/publish_vessel_rest.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import vessels_gfw as gfw  # noqa: E402
from build_vessel_cache import PASSES, PREFIX, RECORDS, bucket_name  # noqa: E402

KEY = f"{PREFIX}/rest_v1.json"
# The stage's island names, at each island's middle (the stage keeps them off the traffic).
ISLANDS = [("Isabela", -91.12, -0.62), ("Fernandina", -91.55, -0.38), ("Santa Cruz", -90.35, -0.63),
           ("San Cristóbal", -89.45, -0.84), ("Santiago", -90.78, -0.22), ("Española", -89.68, -1.38),
           ("Marchena", -90.47, 0.33), ("Genovesa", -89.96, 0.32), ("Floreana", -90.43, -1.29)]
ATTRIBUTION = "Powered by Global Fishing Watch."


def rest_payload(manifest: dict, replay: dict, records: dict, on_file: dict) -> dict:
    star_id = next(pid for pid, p in manifest["passes"].items() if p.get("role") == "star")
    entries = {e["pass_id"]: e for e in on_file["passes"] + [on_file["silent_vessel"]]}
    star = entries[star_id]
    reserve = next(f["geometry"] for f in records["features"] if f["properties"]["kind"] == "reserve")
    # Places carry `label`, never `name`: the identity scan refuses that key anywhere (it is a vessel's).
    ports = [{"label": f["properties"]["name"], "coordinates": f["geometry"]["coordinates"]}
             for f in records["features"] if f["properties"]["kind"] == "port"]
    tracks = [{"n": t["n"], "type": t.get("type", "unknown"), "t": t["t"], "c": t["c"]} for t in replay["tracks"]]
    return {
        "version": 1,
        "pass": {"pass_id": star_id, "satellite": star.get("satellite"), "sensed": star["sensed"],
                 "orbit_state": star.get("orbit_state")},
        "replay": {"start": replay["start"], "end": replay["end"], "tracks": tracks},
        "reserve": reserve,
        "ports": ports,
        "islands": [{"label": n, "coordinates": [x, y]} for n, x, y in ISLANDS],
        "passes": [{"pass_id": e["pass_id"], "satellite": e.get("satellite"), "sensed": e["sensed"],
                    "orbit_state": e.get("orbit_state"), "role": e.get("role")} for e in entries.values()],
        "attribution": ATTRIBUTION,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="build and scan, upload nothing")
    ap.add_argument("--bucket")
    args = ap.parse_args()
    import boto3
    s3 = boto3.client("s3")
    bucket = bucket_name(args.bucket)
    manifest = json.loads(s3.get_object(Bucket=bucket, Key=f"{PREFIX}/manifest.json")["Body"].read())
    star_id = next(pid for pid, p in manifest["passes"].items() if p.get("role") == "star")
    replay_key = manifest["passes"][star_id]["products"]["replay"]["key"]
    replay = json.loads(s3.get_object(Bucket=bucket, Key=replay_key)["Body"].read())
    body = json.dumps(rest_payload(manifest, replay, json.loads(RECORDS.read_text()), json.loads(PASSES.read_text())),
                      ensure_ascii=False, separators=(",", ":"))
    problems = gfw.scan_identity(body)
    if problems:
        raise SystemExit(f"the identity scan failed: {problems[:3]}")
    print(f"{KEY}: {len(body) / 1e3:.0f} kB, star {star_id}, {len(replay['tracks'])} tracks; identity scan clean")
    if args.dry_run:
        return 0
    s3.put_object(Bucket=bucket, Key=KEY, Body=body.encode(), ContentType="application/json")
    print(f"uploaded s3://{bucket}/{KEY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
