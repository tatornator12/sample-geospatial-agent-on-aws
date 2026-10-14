#!/usr/bin/env python3
"""Publish the AI Archaeologist's record for the stage: one GeoJSON point per catalogue site.

The stage shows it the moment the act is chosen (react-ui backend `/api/archaeology/record`).
Every point is a site already on the public record (agents/ai-archaeologist/data/sites_v1.json,
each entry reviewed against its steward's page); nothing else can appear. Properties are the
record's: name, culture, period, designation, steward, and `world_heritage` for the ring.

    AWS_PROFILE=main python scripts/publish_site_record.py            # write to the bucket
    python scripts/publish_site_record.py --dry-run                   # print the collection
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "agents" / "ai-archaeologist" / "data" / "sites_v1.json"
KEY = "archaeology/cache/v1/sites_public.geojson"


def record(catalogue: dict) -> dict:
    """The collection: one Point per site, properties copied from the record (no coordinates
    beyond the published centre, no notes, no transects)."""
    features = []
    for site in catalogue["sites"]:
        c = site["centre"]
        designation = str(site.get("designation", ""))
        features.append({
            "type": "Feature",
            "properties": {
                "site_id": site["id"],
                "name": site["names"][0],
                "culture": site.get("culture", ""),
                "period": site.get("period", ""),
                "designation": designation,
                "steward": site.get("steward", ""),
                "world_heritage": "world heritage" in designation.lower(),
            },
            "geometry": {"type": "Point", "coordinates": [round(float(c["lon"]), 4), round(float(c["lat"]), 4)]},
        })
    features.sort(key=lambda f: (not f["properties"]["world_heritage"], f["properties"]["name"]))
    return {
        "type": "FeatureCollection",
        "rule": catalogue.get("rule", ""),
        "catalogue_version": catalogue.get("version"),
        "features": features,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print the collection; write nothing")
    ap.add_argument("--bucket", default=os.environ.get("S3_BUCKET_NAME", "geospatial-agent-on-aws-419324627248"))
    args = ap.parse_args()
    collection = record(json.loads(CATALOGUE.read_text()))
    body = json.dumps(collection, indent=1)
    if args.dry_run:
        print(body)
        return 0
    import boto3
    boto3.client("s3").put_object(Bucket=args.bucket, Key=KEY, Body=body.encode(), ContentType="application/geo+json")
    print(f"published {len(collection['features'])} sites to s3://{args.bucket}/{KEY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
