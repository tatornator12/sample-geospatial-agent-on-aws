#!/usr/bin/env python3
"""Act 3 warm-up (task 2.2): ESA's newest Sentinel-1 acquisition plans into the cache, and the check
the morning of the show that everything the act reads is there.

    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --dry-run   # fetch and parse, upload nothing
    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py             # the day before and the morning of
    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --check     # fails loudly if anything is missing

The plans: ESA's listing page names the newest plan per satellite (plan.plan_links); each KML is
parsed (plan.parse_plan) before it is kept, and written to vessels/cache/plan/<name>.kml with
vessels/cache/plan/latest.json naming them, their periods, and their IW takes over the reserve. The
runtime's next_look reads latest.json and refreshes it itself only when it is more than 24 h old.

The check: every pass on file (data/passes_v1.json) has its five products in the cache manifest and
in the bucket; the history and the fleet are there; the plans are under 24 h old and run at least
three days past now. Exit 1 on any failure, with the reason.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agents" / "dark-vessels"
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(AGENT))
import plan as P  # noqa: E402
from build_vessel_cache import PASSES, PREFIX, RECORDS, bucket_name  # noqa: E402

LISTING = "https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-1/acquisition-plans"
HOST = "https://sentinels.copernicus.eu"
PLAN_PREFIX = "vessels/cache/plan"
USER_AGENT = "agentic-ai-for-earth-demo/0.2 (plan warm-up)"
MAX_AGE = timedelta(hours=24)
AHEAD = timedelta(days=3)


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def reserve():
    rec = json.loads(RECORDS.read_text())
    return shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))


def warm(dry: bool, bucket: str | None) -> int:
    links = P.plan_links(fetch(LISTING).decode("utf-8", "replace"))
    if not links:
        raise SystemExit("ESA's listing page names no plan (has the page changed?)")
    area = reserve()
    now = datetime.now(timezone.utc)
    latest = {"fetched_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": LISTING, "plans": {}}
    files = {}
    for sat, path in links.items():
        data = fetch(HOST + path, timeout=60)
        period, takes = P.parse_plan(data)
        if not takes or period is None:
            raise SystemExit(f"{sat}: the plan at {path} parsed to no takes or no period")
        name = path.rsplit("/", 1)[1]
        if period[1] <= now:   # the listing still names a retired satellite's last plan (S1A's ended Jun 30, 2026)
            print(f"{sat}: newest plan {name} ended {period[1]:%b %d, %Y}; left out")
            continue
        looks = P.next_looks(takes, area, after=now, min_share=0.2, limit=50)
        latest["plans"][sat] = {"key": f"{PLAN_PREFIX}/{name}.kml", "name": name,
                                "period": [period[0].strftime("%Y-%m-%dT%H:%M:%SZ"), period[1].strftime("%Y-%m-%dT%H:%M:%SZ")],
                                "takes": len(takes), "iw_looks_over_reserve": len(looks),
                                "next": looks[0].as_dict() if looks else None}
        files[name] = data
        nxt = looks[0].as_dict() if looks else None
        print(f"{sat}: {name} ({len(takes)} takes, to {period[1]:%b %d}); IW looks over the reserve {len(looks)}"
              + (f", next {nxt['start']} ({nxt['share']:.0%})" if nxt else ""))
    if dry:
        return 0
    import boto3
    s3 = boto3.client("s3")
    for name, data in files.items():
        s3.put_object(Bucket=bucket, Key=f"{PLAN_PREFIX}/{name}.kml", Body=data, ContentType="application/vnd.google-earth.kml+xml")
    s3.put_object(Bucket=bucket, Key=f"{PLAN_PREFIX}/latest.json", Body=json.dumps(latest, indent=1).encode(),
                  ContentType="application/json")
    print(f"uploaded {len(files)} plans and latest.json to s3://{bucket}/{PLAN_PREFIX}/")
    return 0


def check(bucket: str) -> int:
    import boto3
    s3 = boto3.client("s3")
    problems = []

    def exists(key: str) -> bool:
        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False

    try:
        manifest = json.loads(s3.get_object(Bucket=bucket, Key=f"{PREFIX}/manifest.json")["Body"].read())
    except Exception as e:
        raise SystemExit(f"FAIL: no cache manifest ({type(e).__name__}): run scripts/build_vessel_cache.py")
    on_file = json.loads(PASSES.read_text())
    for e in on_file["passes"] + [on_file["silent_vessel"]]:
        rec = manifest.get("passes", {}).get(e["pass_id"])
        if not rec:
            problems.append(f"{e['pass_id']} ({e['role']}): not in the manifest")
            continue
        missing = [k for k, p in rec["products"].items() if not exists(p["key"])]
        if missing or len(rec["products"]) < 5:
            problems.append(f"{e['pass_id']}: products missing {missing or 'some'}")
        else:
            print(f"ok   {e['pass_id']:20s} {e['role']:13s} built {rec.get('built_at')}; candidates {rec['counts']['candidates_both']}")
    for part in ("history", "fleet"):
        rec = manifest.get(part)
        if not rec or not exists(rec["key"]):
            problems.append(f"{part}: missing")
        else:
            print(f"ok   {part:34s} built {rec.get('built_at')}")
    try:
        latest = json.loads(s3.get_object(Bucket=bucket, Key=f"{PLAN_PREFIX}/latest.json")["Body"].read())
        now = datetime.now(timezone.utc)
        fetched = datetime.fromisoformat(latest["fetched_at"].replace("Z", "+00:00"))
        if now - fetched > MAX_AGE:
            problems.append(f"plans fetched {latest['fetched_at']}, more than 24 h ago: run warm_vessels.py")
        for sat, p in latest["plans"].items():
            end = datetime.fromisoformat(p["period"][1].replace("Z", "+00:00"))
            if end - now < AHEAD:
                problems.append(f"{sat}: its plan ends {p['period'][1]}, under three days ahead")
            elif not exists(p["key"]):
                problems.append(f"{sat}: {p['key']} missing")
            else:
                print(f"ok   plan {sat:29s} {p['name']} (to {p['period'][1][:10]})")
    except Exception as e:
        problems.append(f"plans: {type(e).__name__}")
    for p in problems:
        print("FAIL", p)
    print("all clear" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse the plans, upload nothing")
    ap.add_argument("--check", action="store_true", help="check the cache and the plans; exit 1 on any failure")
    ap.add_argument("--bucket")
    args = ap.parse_args()
    started = time.time()
    rc = check(bucket_name(args.bucket)) if args.check else warm(args.dry_run, None if args.dry_run else bucket_name(args.bucket))
    print(f"{time.time() - started:.0f}s")
    return rc


if __name__ == "__main__":
    sys.exit(main())
