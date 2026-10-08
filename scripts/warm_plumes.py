"""Build the whole-record plume index, so "the strongest plume EMIT has ever seen" has an answer.

    AWS_PROFILE=main .venv/bin/python scripts/warm_plumes.py              # build (or refresh) the index
    AWS_PROFILE=main .venv/bin/python scripts/warm_plumes.py --top 50     # also cache the top-50 rasters

NASA's plume product (EMITL2BCH4PLM, ~1,700 plume complexes since 2022-08) lists footprints in
CMR, but strength lives in a per-plume metadata file on LP DAAC (max concentration, emission rate).
This script walks the whole collection once, fetches every metadata file into the shared cache
(`methane/cache/ch4plmmeta_*.json`, 6 to 14 KB each) and writes one FeatureCollection,
`methane/cache/plume_index_v001.json`: every footprint with NASA's numbers on it. The agent's
`search_methane_plumes(region="global")` ranks from that file in a second instead of touching
1,700 files on the day. With `--top N` the N strongest rasters are pulled into the cache too, so
the triage that follows on stage reads them from S3.

Rerun after NASA adds plumes (the collection has been nearly static since 2024). Reads
agents/methane-hunter/.env.dev for the bucket and the Earthdata token (never printed).
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import warm_watch as ww  # noqa: E402  (load_env, import_tools: the same stubs the tests use)

INDEX_VERSION = "v001"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--top", type=int, default=0, help="also cache the N strongest plume rasters (default 0)")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--env", default=str(ww.AGENT_DIR / ".env.dev"))
    args = parser.parse_args()

    ww.load_env(Path(args.env))
    token = os.environ.get("EARTHDATA_TOKEN", "")
    if not token:
        print("EARTHDATA_TOKEN missing from the env file: NASA's metadata cannot be fetched.")
        return 1
    os.chdir(ww.AGENT_DIR)
    ww.import_tools()
    import httpx
    import methane_tools as mt

    started = time.time()
    s3 = mt._s3()
    with httpx.Client(timeout=mt.CMR_TIMEOUT_S) as client:
        latest = mt.archive_latest(client) or date.today()
        features, hits, skipped = mt.search_cmr(client, mt.WORLD_BBOX, mt.MISSION_START, latest, 10_000)
    print(f"CMR: {hits} plumes in the record ({mt.MISSION_START} to {latest}); {len(features)} footprints"
          + (f", skipped {skipped}" if skipped else "") + f" in {time.time() - started:.0f}s")

    def enrich(f):
        gid = f["properties"]["granule_id"]
        meta = mt.fetch_plume_meta(gid, token, s3)
        f["properties"].update({k: meta.get(k) for k in ("max_ppm_m_nasa", "rate_kg_h", "rate_uncertainty_kg_h",
                                                           "peak_lat", "peak_lon")})
        return "meta_error" not in meta

    ok = fail = 0
    t = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, good in enumerate(as_completed(pool.submit(enrich, f) for f in features), 1):
            ok += bool(good.result())
            fail += not good.result()
            if i % 200 == 0:
                print(f"  {i}/{len(features)} metadata files ({ok} ok, {fail} missing) in {time.time() - t:.0f}s")
    with_max = [f for f in features if f["properties"].get("max_ppm_m_nasa") is not None]
    print(f"Metadata: {ok} ok, {fail} missing; {len(with_max)} plumes carry NASA's max concentration")

    features.sort(key=lambda f: (-(f["properties"].get("max_ppm_m_nasa") or -1.0), f["properties"]["granule_id"]))
    index = {"type": "FeatureCollection", "version": INDEX_VERSION, "built_at": int(time.time()),
             "collection_latest": latest.isoformat(), "count": len(features), "features": features}
    body = json.dumps(index).encode()
    s3.put_object(Bucket=mt.config.S3_BUCKET_NAME, Key=mt.PLUME_INDEX_KEY, Body=body, ContentType="application/geo+json")
    print(f"Index: s3://{mt.config.S3_BUCKET_NAME}/{mt.PLUME_INDEX_KEY} ({len(body) // 1024} kB)")
    for f in features[:5]:
        p = f["properties"]
        print(f"   {p['acquired'][:10]}  max {p['max_ppm_m_nasa']:>9} ppm·m  rate {p.get('rate_kg_h')} kg/h  "
              f"({p['center_lat']:.3f}, {p['center_lon']:.3f})  {p['granule_id'][-28:]}")

    if args.top > 0:
        t = time.time()
        top = features[:args.top]
        cached = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for stats in pool.map(lambda f: mt.fetch_plume(f["properties"]["granule_id"], token, s3,
                                                           f["properties"].get("center_lat")), top):
                cached += stats.get("source") == "cache"
        print(f"Rasters: top {len(top)} in the cache ({cached} were already) in {time.time() - t:.0f}s")
    print(f"Done in {time.time() - started:.0f}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
