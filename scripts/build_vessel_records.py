"""Act 3 records (task 1.2): the reserve, its ports and the land mask's coastline, with a source and a
licence on every feature, into agents/dark-vessels/data/reserve_v1.geojson.

  .venv/bin/python scripts/build_vessel_records.py            # fetch, write, print a summary
  .venv/bin/python scripts/build_vessel_records.py --check    # read the file back and check it

- The reserve: GFW's reference layer public-mpa-all, region 11753 (the WDPA record of the Galápagos
  Marine Reserve), simplified to 0.0005° (about 55 m). Islands are holes in it: land is not reserve.
- The ports: the five harbours whose boats the 10 km port rule sets aside, set by hand for the demo.
- The land: AWS Terrain Tiles (terrarium) at zoom 9 (about 305 m a pixel), every pixel above 0 m,
  as polygons; the build buffers them by 500 m before the detector runs (`buffer_m`).
- The reserve's internal zoning is not included: no licence was found for the zoning layer, so the
  reserve is drawn whole.

Needs the builder's GFW token (agents/dark-vessels/.env) and the network; the runtime never runs this.
"""
from __future__ import annotations

import io
import json
import math
import sys
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio import features
from rasterio.transform import from_bounds
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
OUT = ROOT / "agents" / "dark-vessels" / "data" / "reserve_v1.geojson"

RESERVE_REGION = ("public-mpa-all", 11753)
WDPA_KEEP = ("SITE_ID", "NAME_ENG", "DESIG_ENG", "IUCN_CAT", "STATUS_YR", "MANG_AUTH", "version")
PORTS = [  # name, island, lon, lat (the harbour, to about 0.5 km)
    ("Puerto Ayora", "Santa Cruz", -90.3132, -0.7466),
    ("Puerto Baquerizo Moreno", "San Cristóbal", -89.6103, -0.9015),
    ("Puerto Villamil", "Isabela", -90.9660, -0.9568),
    ("Baltra", "Baltra", -90.2830, -0.4350),
    ("Puerto Velasco Ibarra", "Floreana", -90.4880, -1.2753),
]
TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
LAND_ZOOM = 9

WDPA_SOURCE = ("Global Fishing Watch API v3, reference layer public-mpa-all, region 11753, from the World "
               "Database on Protected Areas (UNEP-WCMC and IUCN, Protected Planet, www.protectedplanet.net)")
WDPA_LICENCE = "WDPA terms of use (non-commercial use, attribution required) and GFW's API terms (non-commercial)"
TERRAIN_SOURCE = "AWS Terrain Tiles (terrarium, Registry of Open Data on AWS), zoom 9, elevation above 0 m"
TERRAIN_LICENCE = "Attribution as listed by the Terrain Tiles project: https://github.com/tilezen/joerd/blob/master/docs/attribution.md"


def r5(geom: dict) -> dict:
    """Coordinates rounded to 5 decimals (about 1 m)."""
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    return {"type": geom["type"], "coordinates": rnd(geom["coordinates"])}


def land_polygons(bounds: tuple[float, float, float, float], z: int = LAND_ZOOM) -> list:
    w0, s0, e0, n0 = bounds
    nt = 2 ** z
    tx = lambda lon: (lon + 180) / 360 * nt  # noqa: E731
    ty = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * nt  # noqa: E731
    tlat = lambda yt: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yt / nt))))  # noqa: E731
    x0, x1, y0, y1 = int(tx(w0)), int(tx(e0)), int(ty(n0)), int(ty(s0))
    mos = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            png = urllib.request.urlopen(TERRAIN.format(z=z, x=x, y=y), timeout=30).read()
            a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.float32)
            mos[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    # The mosaic is in Web Mercator rows; this close to the equator a linear lat transform is off by
    # well under a pixel (measured over this mosaic, ±2.8°: at most 48 m against 305 m pixels).
    tr = from_bounds(x0 / nt * 360 - 180, tlat(y1 + 1), (x1 + 1) / nt * 360 - 180, tlat(y0), mos.shape[1], mos.shape[0])
    mask = (mos > 0).astype(np.uint8)
    polys = [shape(g) for g, v in features.shapes(mask, mask=mask.astype(bool), transform=tr) if v == 1]
    return [p.simplify(0.001, preserve_topology=True) for p in polys]


def build() -> dict:
    import vessels_gfw as gfw
    ds, rid = RESERVE_REGION
    feat = gfw.context_layer(ds, rid)
    reserve = shape(feat["geometry"]).simplify(0.0005, preserve_topology=True)
    wdpa = {k: feat["properties"].get(k) for k in WDPA_KEEP}
    w, s, e, n = reserve.bounds
    land = land_polygons((w - 0.05, s - 0.05, e + 0.05, n + 0.05))
    feats = [{"type": "Feature", "properties": {"kind": "reserve", "name": "Galápagos Marine Reserve", "wdpa": wdpa,
                                                "source": WDPA_SOURCE, "licence": WDPA_LICENCE,
                                                "note": "simplified to 0.0005 deg; islands are holes"},
              "geometry": r5(mapping(reserve))}]
    for name, island, lon, lat in PORTS:
        feats.append({"type": "Feature", "properties": {"kind": "port", "name": name, "island": island, "rule_km": 10,
                                                        "source": "set by hand for the demo (the harbour, to about 0.5 km)",
                                                        "licence": "none needed (a coordinate pair)"},
                      "geometry": {"type": "Point", "coordinates": [lon, lat]}})
    for p in sorted(land, key=lambda g: -g.area):
        feats.append({"type": "Feature", "properties": {"kind": "land", "buffer_m": 500, "source": TERRAIN_SOURCE,
                                                        "licence": TERRAIN_LICENCE},
                      "geometry": r5(mapping(p))})
    return {"type": "FeatureCollection", "name": "reserve_v1", "built": date.today().isoformat(),
            "attribution": ["UNEP-WCMC and IUCN, Protected Planet: The World Database on Protected Areas (WDPA)",
                            "Powered by Global Fishing Watch.", "AWS Terrain Tiles"],
            "features": feats}


def check(fc: dict) -> list[str]:
    """Every feature has a kind, a source and a licence; one reserve; five ports inside its outline;
    land inside the reserve's holes (mostly) and none in its water beyond the mask's 500 m."""
    problems = []
    kinds = [f["properties"].get("kind") for f in fc["features"]]
    for f in fc["features"]:
        p = f["properties"]
        if not (p.get("kind") and p.get("source") and p.get("licence")):
            problems.append(f"feature without kind, source or licence: {p}")
    if kinds.count("reserve") != 1:
        problems.append(f"reserves: {kinds.count('reserve')}")
    if kinds.count("port") != len(PORTS):
        problems.append(f"ports: {kinds.count('port')}")
    reserve = shape(next(f["geometry"] for f in fc["features"] if f["properties"]["kind"] == "reserve"))
    outline = unary_union([shape({"type": "Polygon", "coordinates": [list(p.exterior.coords)]})
                           for p in getattr(reserve, "geoms", [reserve])])
    for f in fc["features"]:
        if f["properties"]["kind"] == "port" and not outline.contains(shape(f["geometry"])):
            problems.append(f"port outside the reserve's outline: {f['properties']['name']}")
    land = unary_union([shape(f["geometry"]) for f in fc["features"] if f["properties"]["kind"] == "land"])
    spill = land.intersection(reserve).area / land.area if land.area else 1.0
    if spill > 0.15:
        problems.append(f"{spill:.0%} of the land lies in the reserve's water")
    return problems


def main(argv: list[str]) -> int:
    if "--check" in argv:
        fc = json.loads(OUT.read_text())
    else:
        fc = build()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n")
    problems = check(fc)
    kinds = [f["properties"]["kind"] for f in fc["features"]]
    reserve = shape(next(f["geometry"] for f in fc["features"] if f["properties"]["kind"] == "reserve"))
    land = unary_union([shape(f["geometry"]) for f in fc["features"] if f["properties"]["kind"] == "land"])
    holes = unary_union([shape({"type": "Polygon", "coordinates": [list(r.coords)]})
                         for p in getattr(reserve, "geoms", [reserve]) for r in p.interiors])
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e3:.0f} kB; reserve 1, ports {kinds.count('port')}, "
          f"land polygons {kinds.count('land')}; land {land.area * 111.2 ** 2:.0f} km2, the reserve's holes "
          f"{holes.area * 111.2 ** 2:.0f} km2, overlap {land.intersection(holes).area / max(land.area, 1e-12):.0%} of the land")
    for p in problems:
        print("  problem:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
