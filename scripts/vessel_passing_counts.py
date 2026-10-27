#!/usr/bin/env python3
"""Dark Vessels: every pass on file, its candidates before and after the passing rule (approved
2026-10-27), read-only.

For each pass in a cache prefix's manifest it runs the agent's own code (targets_for, the coverage
cells, broadcasts, closest_passing) on the cache's files and prints the statuses match_ais would
give with and without the rule, and the passing evidence for each would-be candidate. It only
reads S3 (get_object); it writes nothing, anywhere.

    AWS_PROFILE=main .venv/bin/python scripts/vessel_passing_counts.py --bucket <bucket> \
        [--prefix vessels/cache/v1] [--prefix vessels/cache/v1r] [--json out.json]
"""
import argparse
import json
import os
import sys
import types
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AGENT = REPO / "agents" / "dark-vessels"


def load(bucket: str):
    os.environ["S3_BUCKET_NAME"] = bucket
    os.environ.setdefault("AWS_REGION", "us-east-1")
    for p in (str(AGENT), str(REPO / "geo_agent")):
        if p not in sys.path:
            sys.path.insert(0, p)
    # The tools' modules import strands for @tool only; the shared utils without their wildcard imports.
    sys.modules.setdefault("strands", types.SimpleNamespace(tool=lambda fn=None, **_: fn if callable(fn) else (lambda f: f)))
    utils = types.ModuleType("utils")
    utils.__path__ = [str(REPO / "geo_agent" / "utils")]
    sys.modules.setdefault("utils", utils)
    import ais_coverage as cv
    import vessel_store as vs
    vs.put_json = vs.copy_into_session = None          # read-only: any write would fail loudly
    import ais_tools as at
    import pass_tools as pt
    return vs, cv, at, pt


def counts_for(prefix: str, vs, cv, at, pt) -> dict:
    vs.MANIFEST_KEY = f"{prefix}/manifest.json"
    vs.clear_cache()
    man = vs.manifest()
    out = {}
    for p in vs.passes():
        pid = p["pass_id"]
        built = man.get("passes", {}).get(pid)
        if not built:
            continue
        grid, water, heard = at._heard_for(pid)
        targets = pt.targets_for(pid)
        imaged = at.imaged_for(pid, grid, targets)
        shares = cv.coverage_shares(heard, imaged, water)
        received = heard & imaged
        replay = vs.cached(built["products"]["replay"]["key"])
        when = vs.parse_t(p["sensed"])
        heads = vs.heads_at(replay, when)
        before, after, rows = {}, {}, []
        for t in targets:
            near, near_km = vs.nearest_head(t, heads)
            if t["status"] == "port":
                s = "port"
            elif vs.broadcasts(t, near_km):
                s = "broadcasting"
            elif not cv.is_heard(received, grid, t["lon"], t["lat"]):
                s = "unproven"
            elif t["source"] != "both":
                s = "seen_once"
            else:
                s = "candidate"
            before[s] = before.get(s, 0) + 1
            s2 = s
            if s == "candidate":
                ev = vs.closest_passing(t, replay, when)
                s2 = "passed_close" if ev else s
                rows.append({"lon": round(t["lon"], 5), "lat": round(t["lat"], 5), "passed": ev,
                             "closest_within_60_min": vs.closest_passing(t, replay, when, km_limit=99, minutes=60)})
            after[s2] = after.get(s2, 0) + 1
        out[pid] = {"sensed": p["sensed"], "role": built.get("role"), "checkable_share": round(shares["checkable_share"], 3),
                    "meets_standard": shares["checkable_share"] >= vs.CHECKABLE_FLOOR,
                    "candidates_before": before.get("candidate", 0), "candidates_after": after.get("candidate", 0),
                    "passed_close": after.get("passed_close", 0), "before": before, "after": after,
                    "would_be_candidates": rows, "replay_key": built["products"]["replay"]["key"]}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--prefix", action="append", help="default: vessels/cache/v1 and vessels/cache/v1r")
    ap.add_argument("--json", type=Path)
    args = ap.parse_args(argv)
    vs, cv, at, pt = load(args.bucket)
    report = {pre: counts_for(pre, vs, cv, at, pt) for pre in (args.prefix or ["vessels/cache/v1", "vessels/cache/v1r"])}
    for pre, passes in report.items():
        print(pre)
        for pid, r in passes.items():
            std = "" if r["meets_standard"] else "  (under the standard: match_ais refuses it)"
            print(f"  {pid} {r['role'] or '':13} checkable {round(100 * r['checkable_share']):>3}%  candidates "
                  f"{r['candidates_before']} -> {r['candidates_after']}  passed close {r['passed_close']}{std}")
            for w in r["would_be_candidates"]:
                e = w["passed"]
                print(f"      ({w['lon']}, {w['lat']}): " + (f"set aside, {e['km']} km at {e['minutes']:+d} min, {e['type']} {e['knots']} kn"
                                                           if e else "kept"))
    if args.json:
        args.json.write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
