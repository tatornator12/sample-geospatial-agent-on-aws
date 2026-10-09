"""Turn Global Energy Monitor's trackers into the small Parquet files the registry check reads.

    AWS_PROFILE=main .venv/bin/python scripts/build_gem.py ~/Downloads/data --ogim /tmp/ogim/OGIM_v3.0.gpkg
    AWS_PROFILE=main .venv/bin/python scripts/build_gem.py ~/Downloads/data --ogim /tmp/ogim/OGIM_v3.0.gpkg --upload

Inputs (Global Energy Monitor, CC BY 4.0; the user downloads them through GEM's form):
  - Global Coal Mine Tracker (August 2026): every coal mine with its status, owners of record (with
    shares), parent company and location (exact or approximate).
  - Coal Mine Boundaries and Methane Sources (v1.0.2): mine boundaries and the mapped ventilation
    shafts, vents, degasification wells and stations, flares, for 250 mines.
  - Global Oil and Gas Extraction Tracker (March 2026): fields with operator, owners and parents,
    a point location for most and an outline for a few.
  - Global Energy Ownership Tracker (September 2026): parent companies, used only to fill a coal
    mine's parent where the mine tracker leaves it empty.

Outputs under `methane/registry/<version>/`: mines.parquet (points), mine_features.parquet (WKB:
boundaries and methane-related points) and fields.parquet (points and/or WKB outlines). A GEM field
without coordinates (20 of Turkmenistan's 23) takes the outline of the one OGIM field in the same
country whose name matches after normalisation ("Goturdepe Gas Field (Turkmenistan)" and OGIM's
GOTURDEPE), and the record says it was located that way. Names are carried for mines and fields:
they are places on the record. Owners and operators are kept exactly as GEM writes them.
"""
import argparse
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import shapely

VERSION = "gem_2026"
COAL_FILE = "Global Coal Mine Tracker, August 2026.xlsx"
GOGET_FILE = "Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx"
GEOT_FILE = "Global-Energy-Ownership-Tracker-September-2026-V2.xlsx"
BOUNDARY_DIR = "Coal Mine Boundaries and Methane Sources - version 1.0.2 (built on May 12 2026 09.50 EST)"
SOURCES = {
    "mines": "Global Energy Monitor, Global Coal Mine Tracker, August 2026 release (CC BY 4.0)",
    "mine_features": "Global Energy Monitor, Coal Mine Boundaries and Methane Sources v1.0.2 (CC BY 4.0)",
    "fields": "Global Energy Monitor, Global Oil and Gas Extraction Tracker, March 2026 release (CC BY 4.0)",
    "parents": "Global Energy Monitor, Global Energy Ownership Tracker, September 2026 (CC BY 4.0)",
}
_DROP = {"oil", "gas", "and", "field", "fields", "condensate", "cbm", "project", "the"}


def text(v, limit=160):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = " ".join(str(v).split())
    return s[:limit] if s and s.upper() not in ("N/A", "NA", "NAN", "NONE", "UNKNOWN") else None


def number(v):
    try:
        x = float(str(v).strip().rstrip(","))
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def shares(v, limit=200):
    """GEM writes owners as "A [60.0%]; B [40%]": keep the words, write the shares as (60%)."""
    s = text(v, 400)
    if not s:
        return None
    s = re.sub(r"\[(\d+(?:\.\d+)?)%\]", lambda m: f"({float(m[1]):g}%)", s)
    return s[:limit]


def norm_name(s) -> str:
    s = re.sub(r"\(.*?\)", " ", str(s).lower())
    return "".join(w for w in re.split(r"[^a-z]+", s) if w and w not in _DROP)


def rows_of(df: pd.DataFrame):
    """Each row as {column name: value}; GEM's headers have spaces and slashes, so no attribute access."""
    cols = [" ".join(str(c).split()) for c in df.columns]
    for values in df.itertuples(index=False, name=None):
        yield dict(zip(cols, values))


def build_mines(data: Path, parents: dict) -> pd.DataFrame:
    rows = []
    for sheet in ("Non-closed mines", "Closed mines"):
        for d in rows_of(pd.read_excel(data / COAL_FILE, sheet_name=sheet)):
            lat, lon = number(d.get("Latitude")), number(d.get("Longitude"))
            if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            gid = text(d.get("GEM Mine ID"), 20)
            parent = shares(d.get("Parent Company")) or parents.get(gid)
            status = text(d.get("Status"), 40) if sheet == "Non-closed mines" else "closed"
            rows.append({"gem_id": gid, "name": text(d.get("Mine Name"), 200), "country": text(d.get("Country / Area"), 60),
                         "status": (status or "status not recorded").lower(), "owners": shares(d.get("Owners")),
                         "parent": parent, "accuracy": (text(d.get("Location Accuracy"), 20) or "").lower() or None,
                         "lat": lat, "lon": lon})
    out = pd.DataFrame(rows)
    return out.dropna(subset=["name"])


def build_parents(data: Path) -> dict:
    """GEM Mine ID -> its parents from the ownership tracker, largest share first (at most three)."""
    out = defaultdict(dict)
    for d in rows_of(pd.read_excel(data / GEOT_FILE, sheet_name="Coal Mine Ownership")):
        gid, name = text(d.get("GEM Mine ID"), 20), text(d.get("Parent"), 120)
        if not gid or not name:
            continue
        share = number(d.get("Share"))
        out[gid][name] = max(out[gid].get(name) or 0, share or 0)
    return {gid: "; ".join(f"{n} ({s:g}%)" if s else n for n, s in sorted(p.items(), key=lambda kv: -kv[1])[:3])
            for gid, p in out.items()}


def build_mine_features(data: Path) -> pd.DataFrame:
    folder = data / BOUNDARY_DIR
    combined = next(folder.glob("*version 1.0.2*.geojson"))
    rows = []
    for f in json.loads(combined.read_text())["features"]:
        p, g = f.get("properties") or {}, f.get("geometry")
        if not g:
            continue
        geom = shapely.geometry.shape(g)
        if geom.is_empty:
            continue
        geom = shapely.make_valid(shapely.force_2d(geom))
        x0, y0, x1, y1 = geom.bounds
        rows.append({"gem_id": text(p.get("GEM Mine ID"), 20), "mine_name": text(p.get("Mine Name"), 200),
                     "category": text(p.get("mine feature category"), 40), "subcategory": text(p.get("mine feature subcategory"), 60),
                     "src_date": (text(p.get("data source date"), 32) or "")[:10] or None,
                     "precision": text(p.get("coordinates precision"), 20),
                     "owners": shares(p.get("Owners")), "parent": shares(p.get("Parent Company")),
                     "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "wkb": shapely.to_wkb(geom)})
    return pd.DataFrame(rows)


def ogim_outlines(gpkg: str) -> dict:
    """(country, normalised name) -> (OGIM_ID, outline) for names that occur once in their country."""
    import pyogrio
    gdf = pyogrio.read_dataframe(gpkg, layer="Oil_and_Natural_Gas_Fields", columns=["OGIM_ID", "COUNTRY", "NAME"])
    seen: dict = {}
    dup = set()
    for oid, country, name, geom in zip(gdf.OGIM_ID, gdf.COUNTRY, gdf.NAME, gdf.geometry):
        if not isinstance(name, str) or name.upper() in ("N/A", "NA") or geom is None:
            continue
        key = (str(country).upper(), norm_name(name))
        if not key[1]:
            continue
        if key in seen:
            dup.add(key)
        seen[key] = (int(oid), shapely.simplify(shapely.force_2d(geom), 0.001, preserve_topology=True))
    return {k: v for k, v in seen.items() if k not in dup}


def build_fields(data: Path, outlines: dict) -> pd.DataFrame:
    df = pd.read_excel(data / GOGET_FILE, sheet_name="Field-level main data")
    counts = defaultdict(int)
    names = df.groupby([df["Country/Area"].astype(str).str.upper(), df["Unit Name"].map(norm_name)]).size()
    rows = []
    for d in rows_of(df):
        country = text(d.get("Country/Area"), 60)
        lat, lon = number(d.get("Latitude")), number(d.get("Longitude"))
        point_ok = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
        wkb, located = None, "point" if point_ok else None
        wkt = text(d.get("Field outline (WKT)"), 5_000_000)
        if wkt:
            try:
                g = shapely.make_valid(shapely.from_wkt(wkt))
                if not g.is_empty:
                    wkb, located = shapely.to_wkb(shapely.simplify(g, 0.001, preserve_topology=True)), "outline"
            except Exception:
                pass
        key = (str(country).upper(), norm_name(d.get("Unit Name")))
        ogim = outlines.get(key) if key[1] and names.get(key, 0) == 1 else None
        if wkb is None and ogim is not None:
            wkb, located = shapely.to_wkb(ogim[1]), "registry outline matched by name"
        if located is None:
            counts["unlocated"] += 1
            continue
        if wkb is not None:
            x0, y0, x1, y1 = shapely.from_wkb(wkb).bounds
        else:
            x0 = x1 = lon
            y0 = y1 = lat
        counts[located] += 1
        # Names keep their trailing "(Province, Country)" here; the check drops it (gem.display_name).
        rows.append({"unit_id": text(d.get("Unit ID"), 20), "name": text(d.get("Unit Name"), 200), "country": country,
                     "status": (text(d.get("Status"), 30) or "status not recorded").lower(),
                     "operator": text(d.get("Operator"), 120), "owners": shares(d.get("Owner(s)")),
                     "parents": shares(d.get("Parent(s)")),
                     "accuracy": (text(d.get("Location accuracy"), 20) or "").lower() or None,
                     "located": located, "ogim_id": ogim[0] if ogim else None,
                     "lat": lat if point_ok else None, "lon": lon if point_ok else None,
                     "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "wkb": wkb})
    print(f"  fields: {dict(counts)}")
    return pd.DataFrame(rows)


def write(df: pd.DataFrame, path: Path) -> int:
    pq.write_table(pa.Table.from_pandas(df.sort_values("ymin" if "ymin" in df else "lat"), preserve_index=False),
                   path, compression="zstd")
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("data", help="the folder with the GEM downloads")
    parser.add_argument("--ogim", required=True, help="OGIM_v3.0.gpkg, for locating GEM fields that have no coordinates")
    parser.add_argument("--out", default="/tmp/gem/parquet")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--env", default=str(Path(__file__).resolve().parents[1] / "agents" / "methane-hunter" / ".env.dev"))
    args = parser.parse_args()
    data = Path(os.path.expanduser(args.data))
    out = Path(args.out) / VERSION
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()

    parents = build_parents(data)
    mines = build_mines(data, parents)
    feats = build_mine_features(data)
    fields = build_fields(data, ogim_outlines(args.ogim))
    sizes = {"mines.parquet": write(mines.assign(ymin=mines.lat), out / "mines.parquet"),
             "mine_features.parquet": write(feats, out / "mine_features.parquet"),
             "fields.parquet": write(fields, out / "fields.parquet")}
    manifest = {"version": VERSION, "built_at": int(time.time()), "sources": SOURCES, "bytes": sizes,
                "mines": len(mines), "mines_with_owner": int(mines.owners.notna().sum()),
                "mines_with_parent": int(mines.parent.notna().sum()), "mine_features": len(feats),
                "fields": len(fields), "fields_with_operator": int(fields.operator.notna().sum()),
                "fields_by_location": fields.located.value_counts().to_dict()}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps({k: v for k, v in manifest.items() if k != "sources"}, indent=1))

    if args.upload:
        bucket = None
        for line in Path(args.env).read_text().splitlines():
            if line.strip().startswith("S3_BUCKET_NAME="):
                bucket = line.split("=", 1)[1].strip().strip("'\"")
        if not bucket:
            raise SystemExit(f"No S3_BUCKET_NAME in {args.env}")
        dest = f"s3://{bucket}/methane/registry/{VERSION}/"
        print(f"Uploading to {dest}")
        os.system(f"aws s3 sync '{out}/' '{dest}' --only-show-errors")
    print(f"Done in {time.time() - started:.0f}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
