"""Turn the OGIM GeoPackage into the per-cell Parquet files the registry check reads.

    AWS_PROFILE=main .venv/bin/python scripts/build_registry.py /tmp/ogim/OGIM_v3.0.gpkg
    AWS_PROFILE=main .venv/bin/python scripts/build_registry.py /tmp/ogim/OGIM_v3.0.gpkg --upload

OGIM (Oil and Gas Infrastructure Mapping database; EDF and MethaneSAT LLC; CC BY 4.0; Zenodo DOI
10.5281/zenodo.7466757) is one 3.4 GB GeoPackage with 7.6 million features. The agent needs a 2 km
box of it at a time, so this writes one Parquet file per 5 x 5 degree cell under
`methane/registry/<version>/cell=<x>_<y>.parquet` with the few columns the check prints (kind,
type, status, operator of record, country, state, source date) and each feature's bounding box.
Points become degenerate boxes. A pipeline is cut into straight chords, each the diagonal of its
own small box (see `chords`), so the check can measure the true distance to the pipe rather than to
a bounding box that may be hundreds of kilometres across; the pieces share the pipe's OGIM_ID and
the check counts them once. A piece that crosses cells is written into every cell it touches, so a
box query on one cell finds it. Rows are sorted by latitude inside a cell.

Only the infrastructure layers are loaded (see registry.CATEGORIES); basins, fields, licence
blocks, flaring detections and the data catalogue are not. Facility names are not carried: the
check names the kind of facility and its operator of record, nothing else.
"""
import argparse
import json
import math
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pyogrio

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agents" / "methane-hunter"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "geo_agent"))
import warm_watch as ww  # noqa: E402  (path hack for the shared config; the stubs for strands etc.)

COLUMNS = ["CATEGORY", "FAC_TYPE", "FAC_STATUS", "OPERATOR", "COUNTRY", "STATE_PROV", "SRC_DATE", "OGIM_ID"]
CELL_DEG = 5
CHUNK = 500_000
SIMPLIFY_DEG = 0.0002     # ~20 m: takes the digitising jitter out of pipelines before they are cut into chords
CHORD_DEG = 0.02          # ~2 km: the longest extent of one chord piece
FIELD_LAYER = "Oil_and_Natural_Gas_Fields"
FIELD_SIMPLIFY_DEG = 0.001   # ~100 m: a field outline is a licence-scale boundary, not a survey line


def cell_of(lon: float, lat: float) -> tuple[int, int]:
    return int(math.floor(lon / CELL_DEG) * CELL_DEG), int(math.floor(lat / CELL_DEG) * CELL_DEG)


def _carry_sign(s):
    """A sign array with zeros replaced by the last nonzero sign, so flat segments do not break a run."""
    last = 0
    for i in range(len(s)):
        if s[i] == 0:
            s[i] = last
        else:
            last = s[i]
    return s


def chords(line):
    """A polyline as straight chords, each the diagonal of its own bounding box.

    The line is cut wherever it turns back in x or in y (so every piece is monotone in both, and its
    two ends are opposite corners of its box), then any piece wider or taller than CHORD_DEG is cut
    again. A piece is stored as its box plus one bit, `diag`: True when the chord runs SW to NE, False
    when it runs NW to SE. The check rebuilds the chord from the box and measures the true distance to
    it; the error is the bend of the pipe inside a 2 km box, not the length of the pipe.
    """
    import numpy as np
    out = []
    for part in (line.geoms if hasattr(line, "geoms") else [line]):
        c = np.asarray(part.coords)[:, :2]
        if len(c) < 2:
            continue
        d = np.diff(c, axis=0)
        sx, sy = _carry_sign(np.sign(d[:, 0])), _carry_sign(np.sign(d[:, 1]))
        turns = np.where((sx[1:] * sx[:-1] < 0) | (sy[1:] * sy[:-1] < 0))[0] + 1
        bounds = [0, *turns.tolist(), len(d)]
        for a, b in zip(bounds[:-1], bounds[1:]):
            run = c[a:b + 1]
            start = 0
            for i in range(1, len(run)):
                seg = run[start:i + 1]
                if (seg[:, 0].max() - seg[:, 0].min() > CHORD_DEG) or (seg[:, 1].max() - seg[:, 1].min() > CHORD_DEG):
                    if i - 1 > start:
                        out.append((run[start], run[i - 1]))
                        start = i - 1
                    else:                                   # one segment longer than the cap: cut it evenly
                        p0, p1 = run[start], run[i]
                        n = int(math.ceil(max(abs(p1 - p0)) / CHORD_DEG))
                        for k in range(n):
                            out.append((p0 + (p1 - p0) * k / n, p0 + (p1 - p0) * (k + 1) / n))
                        start = i
            if start < len(run) - 1:
                out.append((run[start], run[-1]))
    return out


def cells_touching(xmin, ymin, xmax, ymax):
    x0, y0 = cell_of(xmin, ymin)
    x1, y1 = cell_of(min(xmax, 179.999999), min(ymax, 89.999999))
    for x in range(x0, x1 + 1, CELL_DEG):
        for y in range(y0, y1 + 1, CELL_DEG):
            yield (x, y)


def build_fields(gpkg: str, out: Path) -> int:
    """OGIM's oil and gas field outlines, one Parquet per cell under `fields/`: the field's name, its
    operator of record where the source names one, country, source date, its box and the outline as
    WKB (simplified to ~100 m). The check asks whether the site is inside a field, or how far the
    nearest one is; a field name is a place on the record, not a facility."""
    import shapely

    out.mkdir(parents=True, exist_ok=True)
    gdf = pyogrio.read_dataframe(gpkg, layer=FIELD_LAYER, columns=["OGIM_ID", "COUNTRY", "NAME", "OPERATOR", "SRC_DATE"])
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    geoms = shapely.make_valid(shapely.simplify(shapely.force_2d(gdf.geometry.values), FIELD_SIMPLIFY_DEG, preserve_topology=True))
    bounds = shapely.bounds(geoms)
    wkb = shapely.to_wkb(geoms)

    def text(v, limit):
        if v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip().upper() in ("N/A", "NA", ""):
            return None
        return str(v)[:limit]

    schema = pa.schema([("name", pa.string()), ("operator", pa.string()), ("country", pa.string()), ("src_date", pa.string()),
                        ("ogim_id", pa.int64()), ("xmin", pa.float32()), ("ymin", pa.float32()), ("xmax", pa.float32()),
                        ("ymax", pa.float32()), ("wkb", pa.binary())])
    per_cell: dict[tuple[int, int], list] = defaultdict(list)
    for i, row in enumerate(gdf.itertuples(index=False)):
        x0, y0, x1, y1 = (float(v) for v in bounds[i])
        if not (math.isfinite(x0) and math.isfinite(y0)) or wkb[i] is None:
            continue
        rec = {"name": text(row.NAME, 80), "operator": text(row.OPERATOR, 120), "country": text(row.COUNTRY, 60),
               "src_date": (text(row.SRC_DATE, 32) or "")[:10] or None,
               "ogim_id": int(row.OGIM_ID) if row.OGIM_ID is not None else None,
               "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "wkb": wkb[i]}
        for cell in cells_touching(x0, y0, x1, y1):
            per_cell[cell].append(rec)
    for cell, rows in per_cell.items():
        rows.sort(key=lambda r: r["ymin"])
        pq.write_table(pa.Table.from_pylist(rows, schema=schema), out / f"cell={cell[0]}_{cell[1]}.parquet", compression="zstd")
    print(f"  {FIELD_LAYER}: {len(gdf):,} outlines into {len(per_cell)} cells")
    return len(gdf)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("gpkg")
    parser.add_argument("--out", default="/tmp/ogim/parquet")
    parser.add_argument("--version", default="ogim_v3.0")
    parser.add_argument("--upload", action="store_true", help="sync the cells to the bucket's methane/registry/<version>/")
    parser.add_argument("--env", default=str(ww.AGENT_DIR / ".env.dev"))
    args = parser.parse_args()

    ww.import_tools()                 # the stubs methane_tools needs; registry imports it
    from registry import CATEGORIES  # the layer list the check understands

    layers = {name for name, _ in pyogrio.list_layers(args.gpkg)}
    wanted = [l for l in CATEGORIES if l in layers]
    missing = [l for l in CATEGORIES if l not in layers]
    print(f"{len(layers)} layers in the GeoPackage; loading {len(wanted)}" + (f"; not present: {missing}" if missing else ""))

    out = Path(args.out) / args.version
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    writers: dict[tuple[int, int], pq.ParquetWriter] = {}
    counts = defaultdict(int)
    # float32 places a point to about a metre at these magnitudes and halves the files; `diag` is the chord bit.
    schema = pa.schema([
        ("category", pa.string()), ("fac_type", pa.string()), ("fac_status", pa.string()), ("operator", pa.string()),
        ("country", pa.string()), ("state_prov", pa.string()), ("src_date", pa.string()), ("ogim_id", pa.int64()),
        ("xmin", pa.float32()), ("ymin", pa.float32()), ("xmax", pa.float32()), ("ymax", pa.float32()), ("diag", pa.bool_()),
    ])

    def flush(cell, rows):
        if not rows:
            return
        rows.sort(key=lambda r: r["ymin"])
        table = pa.Table.from_pylist(rows, schema=schema)
        w = writers.get(cell)
        if w is None:
            w = writers[cell] = pq.ParquetWriter(out / f"cell={cell[0]}_{cell[1]}.parquet", schema, compression="zstd")
        w.write_table(table)

    for layer in wanted:
        info = pyogrio.read_info(args.gpkg, layer=layer)
        n = info["features"]
        cols = [c for c in COLUMNS if c in info["fields"]]
        print(f"  {layer}: {n:,} features, columns {cols}")
        for skip in range(0, n, CHUNK):
            gdf = pyogrio.read_dataframe(args.gpkg, layer=layer, columns=cols, skip_features=skip, max_features=CHUNK)
            if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
                gdf = gdf.to_crs(4326)
            is_line = "Line" in str(info["geometry_type"])
            if is_line:
                import shapely
                geoms = shapely.simplify(shapely.force_2d(gdf.geometry.values), SIMPLIFY_DEG)
            per_cell: dict[tuple[int, int], list] = defaultdict(list)

            def column(name, limit):
                if name not in cols:
                    return [None] * len(gdf)
                # OGIM writes "N/A" where a source gave nothing; store a null so the check never prints it
                return [None if v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip().upper() in ("N/A", "NA", "")
                        else str(v)[:limit] for v in gdf[name].tolist()]

            fac_type, fac_status = column("FAC_TYPE", 80), column("FAC_STATUS", 40)
            operator, country, state = column("OPERATOR", 120), column("COUNTRY", 60), column("STATE_PROV", 60)
            src_date = [None if v is None else v[:10] for v in column("SRC_DATE", 32)]
            ogim_id = [None if v is None else int(float(v)) for v in column("OGIM_ID", 20)]
            if is_line:
                boxes = [[(min(p[0][0], p[1][0]), min(p[0][1], p[1][1]), max(p[0][0], p[1][0]), max(p[0][1], p[1][1]),
                           bool((p[1][0] - p[0][0]) * (p[1][1] - p[0][1]) >= 0)) for p in chords(g)] for g in geoms]
            else:
                b = gdf.geometry.bounds
                boxes = [[(x0, y0, x1, y1, True)] for x0, y0, x1, y1 in
                         zip(b.minx.tolist(), b.miny.tolist(), b.maxx.tolist(), b.maxy.tolist())]
            for i, pieces in enumerate(boxes):
                attrs = {"category": layer, "fac_type": fac_type[i], "fac_status": fac_status[i], "operator": operator[i],
                         "country": country[i], "state_prov": state[i], "src_date": src_date[i], "ogim_id": ogim_id[i]}
                placed = False
                for xmin, ymin, xmax, ymax, diag in pieces:
                    if not (math.isfinite(xmin) and math.isfinite(ymin)):
                        continue
                    row = {**attrs, "xmin": float(xmin), "ymin": float(ymin), "xmax": float(xmax), "ymax": float(ymax), "diag": diag}
                    for cell in cells_touching(xmin, ymin, xmax, ymax):
                        per_cell[cell].append(row)
                    placed = True
                if placed:
                    counts[layer] += 1
            for cell, rows in per_cell.items():
                flush(cell, rows)
            print(f"    {min(skip + CHUNK, n):,}/{n:,} in {time.time() - started:.0f}s")
    for w in writers.values():
        w.close()
    if FIELD_LAYER in layers:
        counts[FIELD_LAYER] = build_fields(args.gpkg, out / "fields")
    sizes = {p.name: p.stat().st_size for p in out.glob("cell=*.parquet")}
    field_sizes = {p.name: p.stat().st_size for p in (out / "fields").glob("cell=*.parquet")}
    manifest = {"version": args.version, "source": "OGIM (EDF and MethaneSAT LLC), Zenodo DOI 10.5281/zenodo.7466757, CC BY 4.0",
                "built_at": int(time.time()), "cell_deg": CELL_DEG, "cells": len(sizes), "bytes": sum(sizes.values()),
                "field_cells": len(field_sizes), "field_bytes": sum(field_sizes.values()),
                "features": dict(counts), "largest_cells": sorted(sizes.items(), key=lambda kv: -kv[1])[:5]}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(sizes)} cells, {sum(sizes.values()) // (1 << 20)} MB; largest: "
          + ", ".join(f"{k} {v // (1 << 20)} MB" for k, v in manifest["largest_cells"]))

    if args.upload:
        ww.load_env(Path(args.env))
        bucket = os.environ["S3_BUCKET_NAME"]
        dest = f"s3://{bucket}/methane/registry/{args.version}/"
        print(f"Uploading to {dest}")
        os.system(f"aws s3 sync '{out}/' '{dest}' --only-show-errors")
    print(f"Done in {time.time() - started:.0f}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
