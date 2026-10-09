"""Global Energy Monitor's records near a site: coal mines (with their mapped vents, shafts and gas
wells) and oil and gas fields, each with its owners or operator of record.

Sources (Global Energy Monitor, CC BY 4.0; built by scripts/build_gem.py into three small Parquet
files under methane/registry/gem_2026/): the Global Coal Mine Tracker (August 2026), Coal Mine
Boundaries and Methane Sources (v1.0.2), the Global Oil and Gas Extraction Tracker (March 2026), and
the Global Energy Ownership Tracker (September 2026) for parents the mine tracker leaves empty.

What the check says is fixed words written here, never the model's: the mine whose boundary the
site lies in, or the nearest mine on record with its distance; the field the site lies in, or the
nearest one. An owner, operator or parent "of record" is who the public record names for an asset,
never who caused a plume. Government bodies listed among owners or parents are left out of the
sentence: the stage never names a government (the record keeps them).
"""
from __future__ import annotations

import logging
import math
import os
import re
import shutil
import time
from pathlib import Path

import config
import methane_tools as mt

logger = logging.getLogger("methane_tools")

VERSION = "gem_2026"
PREFIX = f"methane/registry/{VERSION}"
FILES = ("mines", "mine_features", "fields")
CACHE_DIR = Path(os.environ.get("REGISTRY_CACHE_DIR", "/tmp/methane_registry"))
CACHE_TTL_S = 24 * 3600
FILE_CAP_BYTES = 50_000_000
MINE_NEAR_KM = 10.0         # a mine's map point can sit kilometres from its vents and shafts
FIELD_NEAR_KM = 10.0        # a field's map point is its centroid
FEATURE_KM = 2.0            # mapped methane-related points counted around the site
LINE_CAP = 300
SOURCE = "Global Energy Monitor (CC BY 4.0)"

_GOVERNMENT = re.compile(r"\bgovernment\b|\bministry\b|people'?s government|\bSASAC\b|state-owned assets supervision|"
                         r"\bstate property\b|\bstate assets\b", re.IGNORECASE)
_SAFE = re.compile(r"[^\w .,;&'()%\-/]+", re.UNICODE)   # ";" separates GEM's owners
_COUNTRY_SUFFIX = re.compile(r"\s*\([^()]*\)\s*$")
_FEATURE_WORDS = {   # GEM subcategory -> what the sentence counts
    "shaft": "ventilation shaft", "vent": "vent", "gas well": "gas well", "drainage station": "gas drainage station",
    "flare": "flare", "gas to electric station": "gas power station", "combined heat and power plant": "gas power station",
    "regenerative thermal oxidizer (RTO)": "methane oxidiser", "drainage pipeline": "gas drainage pipeline",
}


def clean(value, limit: int = 120) -> str | None:
    if not isinstance(value, str):
        return None
    s = _SAFE.sub("", " ".join(value.split())).strip(" ;,")
    return s[:limit] if s else None


def display_name(value) -> str | None:
    """A GEM asset name without its trailing "(Country)" or "(Province, Country)", at most 90
    characters cut at a word."""
    s = clean(value, 400)
    if not s:
        return None
    s = _COUNTRY_SUFFIX.sub("", s)
    return s if len(s) <= 90 else s[:90].rsplit(" ", 1)[0]


def parties(value, keep: int = 3) -> str | None:
    """Owners or parents as GEM lists them ("A (60%); B (40%)"), at most `keep`, government bodies
    left out, joined with commas so the sentence's own semicolons stay clauses."""
    s = clean(value, 400)
    if not s:
        return None
    kept = [p.strip() for p in s.split(";") if p.strip() and not _GOVERNMENT.search(p)]
    return ", ".join(kept[:keep]) or None


def plural(n: int, word: str) -> str:
    return f"1 {word}" if n == 1 else f"{n} {word}s"


def gem_file(name: str, s3=None) -> Path | None:
    """One of the three GEM files on local disk (fetched once a day), or None when it is not built."""
    s3 = s3 or mt._s3()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{VERSION}_{name}.parquet"
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL_S:
        return path
    try:
        obj = s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{PREFIX}/{name}.parquet")
    except s3.exceptions.NoSuchKey:
        return None
    if int(obj.get("ContentLength", 0)) > FILE_CAP_BYTES:
        raise mt.MethaneError("a GEM file is unexpectedly large")
    tmp = path.with_suffix(".part")
    with open(tmp, "wb") as f:
        shutil.copyfileobj(obj["Body"], f, 1 << 20)
    tmp.replace(path)
    return path


def query(path: Path | None, box: tuple[float, float, float, float], cols: tuple[str, ...], point: bool = False,
          limit: int = 500) -> list[dict]:
    """Rows of one file whose point (or box) touches `box`, with DuckDB on the local file."""
    if path is None:
        return []
    import duckdb
    w, s, e, n = box
    where = (f"lon BETWEEN {w:.6f} AND {e:.6f} AND lat BETWEEN {s:.6f} AND {n:.6f}" if point else
             f"xmin <= {e:.6f} AND xmax >= {w:.6f} AND ymin <= {n:.6f} AND ymax >= {s:.6f}")
    sql = f"SELECT {', '.join(cols)} FROM read_parquet('{str(path).replace(chr(39), '')}') WHERE {where} LIMIT {limit}"
    con = duckdb.connect()
    try:
        return [dict(zip(cols, row)) for row in con.execute(sql).fetchall()]
    finally:
        con.close()


def _km_grid(lat: float):
    return 111.32 * math.cos(math.radians(lat)), 110.57


def point_km(lat: float, lon: float, la: float, lo: float) -> float:
    kx, ky = _km_grid(lat)
    return math.hypot((lo - lon) * kx, (la - lat) * ky)


def shape_km(lat: float, lon: float, wkb) -> float | None:
    """0 when the shape covers the site, else the distance to it in km (flat grid at the site)."""
    import shapely
    try:
        kx, ky = _km_grid(lat)
        local = shapely.transform(shapely.from_wkb(wkb), lambda c: (c - [lon, lat]) * [kx, ky])
        origin = shapely.Point(0.0, 0.0)
        return 0.0 if local.covers(origin) else float(local.distance(origin))
    except Exception:
        return None


# --- coal mines ------------------------------------------------------------------------------

def mines_at(lat: float, lon: float, mines: list[dict], features: list[dict]) -> dict | None:
    """The mine whose mapped boundary covers the site, else the nearest mine point within
    MINE_NEAR_KM; with the number of mines on record within that radius and the methane-related
    points GEM maps within FEATURE_KM."""
    nearest: dict = {}     # one per GEM mine id (the tracker lists a mine's phases as rows)
    for i, m in enumerate(mines):
        if m.get("lat") is None or m.get("lon") is None:
            continue
        d = point_km(lat, lon, float(m["lat"]), float(m["lon"]))
        if d <= MINE_NEAR_KM and display_name(m.get("name")):
            key = m.get("gem_id") or f"row{i}"
            if key not in nearest or d < nearest[key][0]:
                nearest[key] = (d, m)
    near = list(nearest.values())
    inside = None
    counts: dict[str, int] = {}
    for f in features:
        d = shape_km(lat, lon, f.get("wkb"))
        if d is None:
            continue
        if f.get("category") == "mine boundary" and d == 0.0 and inside is None:
            inside = f
        elif f.get("category") in ("ventilation system", "degasification system") and d <= FEATURE_KM:
            word = _FEATURE_WORDS.get(str(f.get("subcategory") or ""))
            if word:
                counts[word] = counts.get(word, 0) + 1
    if inside is None and not near:
        return None
    near.sort(key=lambda dm: dm[0])
    if inside is not None:
        match = next((m for _, m in near if m.get("gem_id") == inside.get("gem_id")), None)
        mine = {"name": display_name(inside.get("mine_name")), "distance_km": 0.0, "inside": True,
                "status": clean((match or {}).get("status"), 40),
                "owners": parties((match or {}).get("owners") or inside.get("owners")),
                "parent": parties((match or {}).get("parent") or inside.get("parent")),
                "accuracy": "mapped boundary", "gem_id": inside.get("gem_id")}
    else:
        d, m = near[0]
        mine = {"name": display_name(m.get("name")), "distance_km": round(d, 1), "inside": False,
                "status": clean(m.get("status"), 40), "owners": parties(m.get("owners")), "parent": parties(m.get("parent")),
                "accuracy": clean(m.get("accuracy"), 20), "gem_id": m.get("gem_id")}
    others = sum(1 for _, m in near if m.get("gem_id") != mine.get("gem_id"))
    return {"mine": mine, "mines_within_km": MINE_NEAR_KM, "mines_near": len(near), "other_mines": others,
            "methane_points": dict(sorted(counts.items(), key=lambda kv: -kv[1])), "source": SOURCE}


def mine_line(r: dict | None) -> str | None:
    if not r or not r.get("mine") or not r["mine"].get("name"):
        return None
    m = r["mine"]
    status = m.get("status") or "status not recorded"
    where = ("Global Energy Monitor maps the site inside the boundary of " + f"{m['name']} ({status})"
             if m["inside"] else
             "The nearest coal mine on Global Energy Monitor's record is " + f"{m['name']} ({status}"
             + (", approximate location" if m.get("accuracy") == "approximate" else "") + f"), {m['distance_km']:g} km away")
    points = r.get("methane_points") or {}
    vents = (", ".join(plural(n, w) for w, n in list(points.items())[:3]) + f" within {FEATURE_KM:g} km") if points else ""
    others = r.get("other_mines", 0)

    def compose(owners: bool, parent: bool, extra: bool) -> str:
        parts = [where]
        if owners:
            parts.append(f"owners of record {m['owners']}" if m.get("owners") else "no owner on record")
        if parent and m.get("parent"):
            parts.append(f"parent of record {m['parent']}")
        if extra and vents:
            parts.append(f"it maps {vents}")
        if extra and others > 0:
            parts.append(f"{plural(others, 'other mine')} on its record within {MINE_NEAR_KM:g} km")
        return "; ".join(parts) + "."

    for shape in ((True, True, True), (True, False, True), (True, True, False), (True, False, False), (False, False, False)):
        line = compose(*shape)
        if len(line) <= LINE_CAP:
            return line
    return line


# --- oil and gas fields ----------------------------------------------------------------------

def field_at(lat: float, lon: float, fields: list[dict]) -> dict | None:
    """The GEM field whose outline covers the site, else the nearest field (outline or point)
    within FIELD_NEAR_KM. Inside beats near; the smaller distance wins."""
    best = None
    for f in fields:
        if f.get("wkb") is not None:
            d = shape_km(lat, lon, f["wkb"])
        elif f.get("lat") is not None and f.get("lon") is not None:
            d = point_km(lat, lon, float(f["lat"]), float(f["lon"]))
        else:
            d = None
        if d is None or d > FIELD_NEAR_KM or not display_name(f.get("name")):
            continue
        if best is None or d < best[0]:
            best = (d, f)
    if best is None:
        return None
    d, f = best
    return {"name": display_name(f.get("name")), "distance_km": round(d, 1), "inside": d == 0.0,
            "status": clean(f.get("status"), 30), "operator": parties(f.get("operator"), keep=1),
            "owners": parties(f.get("owners")), "located": clean(f.get("located"), 40),
            "ogim_id": f.get("ogim_id"), "unit_id": f.get("unit_id"), "source": SOURCE}


def gem_field_line(f: dict | None) -> str | None:
    if not f or not f.get("name"):
        return None
    status = f.get("status") or "status not recorded"
    if f.get("located") == "registry outline matched by name":
        status += "; outline from the OGIM registry"
    where = (f"Global Energy Monitor's field record places the site inside {f['name']} ({status})"
             if f["inside"] else
             f"The nearest oil and gas field on Global Energy Monitor's record is {f['name']} ({status}), "
             f"{f['distance_km']:g} km away")

    owner_names = {re.sub(r"\s*\(\d+(?:\.\d+)?%\)$", "", o).strip().lower() for o in (f.get("owners") or "").split(", ") if o}
    same = owner_names <= {(f.get("operator") or "").lower()}      # "Turkmennebit (100%)" adds nothing

    def compose(owners: bool) -> str:
        parts = [where, f"operator of record {f['operator']}" if f.get("operator") else "no operator on record"]
        if owners and f.get("owners") and not same:
            parts.append(f"owners of record {f['owners']}")
        return "; ".join(parts) + "."

    line = compose(True)
    return line if len(line) <= LINE_CAP else compose(False)


_NAME_DROP = {"oil", "gas", "and", "field", "fields", "condensate", "cbm", "project", "the"}


def norm_name(value) -> str:
    """A field name reduced for matching across records ("Goturdepe Gas Field (Turkmenistan)" and
    OGIM's "GOTURDEPE" are the same name)."""
    s = re.sub(r"\(.*?\)", " ", str(value or "").lower())
    return "".join(w for w in re.split(r"[^a-z]+", s) if w and w not in _NAME_DROP)


def merge_fields(ogim_field: dict | None, gem_field: dict | None) -> tuple[bool, dict | None]:
    """When the OGIM outline and GEM's record name the same field, one line says it: OGIM's when it
    carries an operator (its outline places the site best), else GEM's operator placed by OGIM's
    outline. Returns (keep the OGIM line, the GEM field to print or None)."""
    if not ogim_field or not gem_field or norm_name(ogim_field.get("name")) != norm_name(gem_field.get("name")):
        return True, gem_field
    if ogim_field.get("operator") or not gem_field.get("operator"):
        return True, None
    return False, {**gem_field, "inside": bool(ogim_field.get("inside")), "distance_km": ogim_field.get("distance_km", 0.0),
                   "located": "registry outline matched by name"}


def gem_hint(r: dict) -> str | None:
    """How GEM's records move the hypotheses (the brief's assessments follow the checks' hints)."""
    mines = r.get("mines") or {}
    m = mines.get("mine") or {}
    if m.get("inside") or (m and m.get("distance_km", 99) <= 3):
        points = mines.get("methane_points") or {}
        what = ", ".join(plural(n, w) for w, n in points.items()) or "no mapped vents or gas wells"
        return (f"A coal mine is on record at the site ({m.get('name')}; {what} within {FEATURE_KM:g} km): "
                "non_oil_gas_source (coal) is possible, and say so in its next_check.")
    if m:
        return (f"The nearest coal mine on record is {m.get('distance_km')} km away: non_oil_gas_source (coal) "
                "cannot be ruled out from the record alone.")
    return None


# --- the check -------------------------------------------------------------------------------

def lookup(lat: float, lon: float, s3=None) -> dict:
    """GEM's mine and field records near the site, and their sentences (None when nothing is near
    or the files are not built). Never raises: GEM is an addition to the registry check."""
    from watch_tools import box_around
    out = {"mines": None, "gem_field": None, "mine_line": None, "gem_field_line": None}
    s3 = s3 or mt._s3()

    def rows(name, box, cols, point=False):
        try:
            return query(gem_file(name, s3), box, cols, point=point)
        except Exception as e:   # one unreadable file never hides the others
            logger.warning("GEM %s read failed: %s", name, type(e).__name__)
            return []

    mbox = box_around(lat, lon, MINE_NEAR_KM)
    mines = rows("mines", mbox, ("gem_id", "name", "status", "owners", "parent", "accuracy", "lat", "lon"), point=True)
    feats = rows("mine_features", mbox, ("gem_id", "mine_name", "category", "subcategory", "owners", "parent", "wkb"))
    fields = rows("fields", box_around(lat, lon, FIELD_NEAR_KM),
                  ("unit_id", "name", "status", "operator", "owners", "located", "ogim_id", "lat", "lon", "wkb"))
    try:
        out["mines"] = mines_at(lat, lon, mines, feats)
        out["gem_field"] = field_at(lat, lon, fields)
    except Exception as e:
        logger.warning("GEM summary failed: %s", type(e).__name__)
    out["mine_line"] = mine_line(out["mines"])
    out["gem_field_line"] = gem_field_line(out["gem_field"])
    return out
