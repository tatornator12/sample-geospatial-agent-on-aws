#!/usr/bin/env python3
"""Act 3 warm-up (task 2.2): ESA's newest Sentinel-1 acquisition plans into the cache, and the check
the morning of the show that everything the act reads is there.

    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --dry-run   # fetch and parse, upload nothing
    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py             # the day before and the morning of
    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --check     # fails loudly if anything is missing
    AWS_PROFILE=main .venv/bin/python scripts/warm_vessels.py --check --newest   # and the rest is the newest pass's

The plans: per satellite, ESA's newest plan and any older one that still runs past it
(plan.plan_chain: ESA lays six-day plans over three-week ones); each KML is parsed (plan.parse_plan)
before it is kept, and written to vessels/cache/plan/<name>.kml with vessels/cache/plan/latest.json
naming the chain, its span, and its IW takes over the reserve (plan.merge_takes: each date from the
newest plan that covers it). The runtime's next_look reads latest.json and refreshes it itself only
when it is more than 24 h old.

The check: every pass on file (data/passes_v1.json) has its five products in the cache manifest and
in the bucket, and its imaged cells in the manifest (R7.4); the history and the fleet are there;
rest_v1.json carries a `bucket` that passes the stage's bucket rule (with --newest, its pass is the
newest pass on file); the plans are under 24 h old and run at least three days past now. Exit 1 on
any failure, with the reason.
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
from build_vessel_cache import BUCKET_RE, PASSES, PREFIX, RECORDS, bucket_name  # noqa: E402
from publish_vessel_rest import KEY as REST_KEY, newest_pass  # noqa: E402

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


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _s3():
    import boto3
    return boto3.client("s3")


def warm(dry: bool, bucket: str | None) -> int:
    html = fetch(LISTING).decode("utf-8", "replace")
    now = datetime.now(timezone.utc)
    chains = P.plan_chain(html, now)
    if not chains:
        raise SystemExit("ESA's listing page names no current plan (has the page changed?)")
    for sat in sorted(set(P.plan_links(html)) - set(chains)):   # a retired satellite's last plan (S1A's ended Jun 30, 2026)
        print(f"{sat}: no current plan on the listing page; left out")
    area = reserve()
    latest = {"fetched_at": iso(now), "source": LISTING, "plans": {}}
    files = {}
    for sat, paths in chains.items():
        # The newest plan first, then any older plan that still runs past it (ESA lays a short plan
        # over a three-week one; the long one's later takes are still the latest word on those days).
        chain = []
        for path in paths:
            data = fetch(HOST + path, timeout=60)
            period, takes = P.parse_plan(data)
            if not takes or period is None:
                raise SystemExit(f"{sat}: the plan at {path} parsed to no takes or no period")
            name = path.rsplit("/", 1)[1]
            files[name] = data
            chain.append((name, period, takes))
        merged = P.merge_takes([(period, takes) for _, period, takes in chain])
        looks = P.next_looks(merged, area, after=now, min_share=0.2, limit=50)
        newest, (start, _), _ = chain[0]
        end = max(period[1] for _, period, _ in chain)
        latest["plans"][sat] = {"key": f"{PLAN_PREFIX}/{newest}.kml", "name": newest, "period": [iso(start), iso(end)],
                                "chain": [{"key": f"{PLAN_PREFIX}/{n}.kml", "name": n, "period": [iso(p[0]), iso(p[1])]}
                                          for n, p, _ in chain],
                                "takes": len(merged), "iw_looks_over_reserve": len(looks),
                                "next": looks[0].as_dict() if looks else None}
        nxt = looks[0].as_dict() if looks else None
        print(f"{sat}: {' + '.join(n for n, _, _ in chain)} ({len(merged)} takes, to {end:%b %d}); "
              f"IW looks over the reserve {len(looks)}" + (f", next {nxt['start']} ({nxt['share']:.0%})" if nxt else ""))
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


def check(bucket: str, newest: bool = False) -> int:
    s3 = _s3()
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
        elif not rec.get("imaged_cells") or rec.get("imaged_share") is None:
            problems.append(f"{e['pass_id']}: no imaged cells in the manifest (run build_vessel_cache.py --imaged)")
        else:
            print(f"ok   {e['pass_id']:20s} {e['role']:13s} built {rec.get('built_at')}; imaged {rec['imaged_share']:.0%}; "
                  f"candidates {rec['counts']['candidates_both']}")
    for part in ("history", "fleet"):
        rec = manifest.get(part)
        if not rec or not exists(rec["key"]):
            problems.append(f"{part}: missing")
        else:
            print(f"ok   {part:34s} built {rec.get('built_at')}")
    try:
        rest = json.loads(s3.get_object(Bucket=bucket, Key=REST_KEY)["Body"].read())
    except Exception as e:
        rest = None
        problems.append(f"rest_v1.json: unreadable ({type(e).__name__}): run publish_vessel_rest.py")
    if rest is not None:
        rest_pass = (rest.get("pass") or {}).get("pass_id")
        if not isinstance(rest.get("bucket"), str) or not BUCKET_RE.fullmatch(rest["bucket"]):
            problems.append(f"rest_v1.json: no bucket that passes the stage's rule ({rest.get('bucket')!r}): "
                            f"run publish_vessel_rest.py")
        elif newest and manifest.get("passes") and rest_pass != newest_pass(manifest, on_file):
            problems.append(f"rest_v1.json: its pass {rest_pass} is not the newest on file "
                            f"({newest_pass(manifest, on_file)}): run publish_vessel_rest.py --newest")
        else:
            print(f"ok   {'rest_v1.json':34s} pass {rest_pass}, bucket {rest['bucket']}" + (" (the newest)" if newest else ""))
    try:
        latest = json.loads(s3.get_object(Bucket=bucket, Key=f"{PLAN_PREFIX}/latest.json")["Body"].read())
        now = _now()
        fetched = datetime.fromisoformat(latest["fetched_at"].replace("Z", "+00:00"))
        if now - fetched > MAX_AGE:
            problems.append(f"plans fetched {latest['fetched_at']}, more than 24 h ago: run warm_vessels.py")
        for sat, p in latest["plans"].items():
            end = datetime.fromisoformat(p["period"][1].replace("Z", "+00:00"))
            if end - now < AHEAD:
                problems.append(f"{sat}: its plan ends {p['period'][1]}, under three days ahead")
            elif any(not exists(c["key"]) for c in p.get("chain") or [p]):
                problems.append(f"{sat}: a plan file is missing ({', '.join(c['key'] for c in p.get('chain') or [p])})")
            else:
                names = " + ".join(c["name"] for c in p.get("chain") or [p])
                print(f"ok   plan {sat:29s} {names} (to {p['period'][1][:10]})")
    except Exception as e:
        problems.append(f"plans: {type(e).__name__}")
    for p in problems:
        print("FAIL", p)
    print("all clear" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse the plans, upload nothing")
    ap.add_argument("--check", action="store_true", help="check the cache and the plans; exit 1 on any failure")
    ap.add_argument("--newest", action="store_true", help="with --check: the rest file's pass is the newest on file")
    ap.add_argument("--bucket")
    args = ap.parse_args(argv)
    if args.newest and not args.check:
        raise SystemExit("--newest goes with --check")
    started = time.time()
    rc = (check(bucket_name(args.bucket), args.newest) if args.check
          else warm(args.dry_run, None if args.dry_run else bucket_name(args.bucket)))
    print(f"{time.time() - started:.0f}s")
    return rc


if __name__ == "__main__":
    sys.exit(main())
