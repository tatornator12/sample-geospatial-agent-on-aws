"""The AI Archaeologist's own tools: known sites only, terrain from the pre-built cache, the
profile across an earthwork, and the sites on the record that share its form.

Design decision 2 (known sites only, enforced in tools): every coordinate any of these tools
returns or writes is a catalogue site's centre, frame or transect, or a line through its centre on
one of four bearings (`data/sites_v1.json`, sites whose locations UNESCO, the NPS or a state or
tribal steward already publish). A name that is not in the catalogue gets the fixed refusal and no
numbers. Decision 3: terrain is never computed or
read from 3DEP here; `scripts/build_site_catalogue.py` built it into the bucket, and these tools
copy it into the session. Decision 4 (outcome Oct 13): similar sites are ranked by the published
form, not by embeddings (Clay's 1.28 km cells read the landscape, not the earthwork).
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
import unicodedata
from functools import lru_cache
from pathlib import Path

import boto3
import rasterio
from rasterio.warp import transform as warp_transform
from rasterio.windows import from_bounds
from strands import tool

import _paths  # noqa: F401  (shared code on sys.path before `import config`)
import config
import earthwork_profile as ep

logger = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent
CATALOGUE_PATH = HERE / "data" / "sites_v1.json"
CACHE_PREFIX = "archaeology/cache/v1"
MANIFEST_KEY = f"{CACHE_PREFIX}/manifest.json"
MANIFEST_TTL_S = 300
REFUSAL = "I only work with sites already on the public record."
PRODUCTS = ("hillshade", "lrm")
SITE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
DEFAULT_TRANSECT_M = 600          # a line through the centre: the agent's bearing, or east-west by default
# The lines the agent may choose (decision 9): a bearing through the site's centre, never coordinates.
# Azimuths in degrees clockwise from north. The stage mirrors the keys (steps.ts BEARING_LABELS).
BEARINGS = {"n-s": 0, "ne-sw": 45, "e-w": 90, "nw-se": 135}
BEARING_WORDS = {"n-s": "north-south", "ne-sw": "north-east to south-west", "e-w": "east-west",
                 "nw-se": "north-west to south-east"}
NO_BANK = "I cannot confirm a bank on this line."
MAX_TRANSECT_M = 3000
MIN_TRANSECT_M = 50
SAME_COMPLEX_KM = 10.0            # sites closer than this are parts of the same complex, not "elsewhere"
FT = 0.3048
# Words in the record's description of a form that the ranking compares (the rest is wording).
FORM_WORDS = {
    "circle": ("circle", "circular", "ring"), "octagon": ("octagon",), "square": ("square",),
    "enclosure": ("enclosure", "enclosed", "embankment", "walls", "wall"), "ditch": ("ditch",),
    "gateway": ("gateway", "gateways", "gap"), "avenue": ("avenue", "parallel walls"),
    "hilltop": ("hilltop", "bluff", "ridge-top"), "effigy": ("effigy", "serpent", "bear", "bird"),
    "platform mound": ("platform", "flat-topped", "pyramidal"), "conical mound": ("conical",),
    "ridges": ("ridges", "concentric"), "plaza": ("plaza",), "mound group": ("mounds", "mound group"),
}


# --- S3 and the session ------------------------------------------------------------------------

def _s3():
    return boto3.client("s3")


def _session_id() -> str:
    return os.environ.get("AGENT_SESSION_ID", config.DEFAULT_SESSION_ID)


def session_prefix() -> str:
    return f"session_data/{_session_id()}/"


def _put_json(key: str, body: dict) -> str:
    _s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=json.dumps(body).encode(),
                     ContentType="application/geo+json" if key.endswith(".geojson") else "application/json")
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


# --- the catalogue -----------------------------------------------------------------------------

@lru_cache(maxsize=1)
def catalogue() -> dict[str, dict]:
    sites = json.loads(CATALOGUE_PATH.read_text())["sites"]
    return {s["id"]: s for s in sites}


_manifest_cache: dict = {}


def manifest() -> dict:
    """The terrain build's manifest (which sites are built, their bounds and CRS), cached briefly."""
    now = time.time()
    if _manifest_cache.get("at", 0) + MANIFEST_TTL_S > now:
        return _manifest_cache["body"]
    body = json.loads(_s3().get_object(Bucket=config.S3_BUCKET_NAME, Key=MANIFEST_KEY)["Body"].read())
    _manifest_cache.update(at=now, body=body)
    return body


_GENERIC = {"the", "earthworks", "earthwork", "works", "site", "state", "historic", "park", "national",
            "monument", "historical", "archaeological", "archeological", "memorial", "and", "nature", "preserve"}


def _norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return " ".join(t.split())


def _core(text: str) -> str:
    return " ".join(w for w in _norm(text).split() if w not in _GENERIC)


def resolve(name: str) -> tuple[list[str], str]:
    """Catalogue site ids matching a name: exact on a published name or id first, then on the
    name without generic words ("Hopeton" for "Hopeton Earthworks"). Never fuzzy beyond that."""
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        return [], ""
    exact, core = _norm(name), _core(name)
    hits = [sid for sid, s in catalogue().items()
            if exact in {_norm(n) for n in s["names"]} | {_norm(sid.replace("-", " "))}]
    if hits:
        return hits, "name"
    if core:
        hits = [sid for sid, s in catalogue().items()
                if core in {_core(n) for n in s["names"]} | {_core(sid.replace("-", " "))}]
    return hits, "core"


def _refusal(extra: str = "") -> str:
    names = sorted(s["names"][0] for s in catalogue().values())
    return json.dumps({"error": REFUSAL + (f" {extra}" if extra else ""), "known_sites": names})


def _site(site_id: str) -> dict | None:
    if not isinstance(site_id, str) or not SITE_ID_RE.fullmatch(site_id):
        return None
    return catalogue().get(site_id)


def _frame(site_id: str) -> list[float] | None:
    built = manifest().get("sites", {}).get(site_id)
    return built.get("bounds") if built else None


def _km(a: dict, b: dict) -> float:
    (la1, lo1), (la2, lo2) = (a["lat"], a["lon"]), (b["lat"], b["lon"])
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _documented(site: dict) -> list[dict]:
    """The record's dimensions, with a metre value beside feet where the unit allows it."""
    out = []
    for d in site.get("documented") or []:
        row = dict(d)
        unit, value = str(d.get("unit", "")), d.get("value")
        if isinstance(value, (int, float)) and unit.split(" ")[0] in ("ft", "feet"):
            # The record's feet are round figures ("nearly 1,200 ft"): metres to match, not 365.8.
            metres = value * FT
            row["value_m"] = round(metres) if metres >= 100 else round(metres, 1)
        out.append(row)
    return out


# --- tools -------------------------------------------------------------------------------------

@tool
async def find_known_site(name: str) -> str:
    """Look up a site on the public record. The ONLY way to get a site's location.

    Args:
        name: The site's name as the public record uses it ("Newark Octagon", "Great Circle
            Earthworks", "Hopeton Earthworks", "Serpent Mound", "Poverty Point").

    Returns: JSON with site_id, name, culture, period, designation, steward, source_url, centre
    (lat, lon; centre_verified says whether it was checked on the LiDAR), frame_bounds [w, s, e, n],
    frame_geometry_s3_url (for get_rasters), form (the record's description), documented
    dimensions, terrain (the products built), has_verified_transect (whether the record has a
    verified line for measure_profile; when false, you choose a bearing), next_steps. For a name
    not in the catalogue: an error with the fixed sentence and the catalogue's names, and no
    coordinates.
    """
    ids, how = resolve(name)
    if not ids:
        return _refusal()
    if len(ids) > 1:
        return json.dumps({"error": "More than one site on the record goes by that name; name one of these.",
                           "options": [catalogue()[i]["names"][0] for i in ids]})
    site = catalogue()[ids[0]]
    bounds = _frame(site["id"])
    if not bounds:
        return json.dumps({"error": f"{site['names'][0]} is on the record but its terrain is not built yet "
                                    "(scripts/build_site_catalogue.py)."})
    w, s, e, n = bounds
    ring = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    geom_url = _put_json(f"{session_prefix()}geometries/site_{site['id']}.geojson", {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"site_id": site["id"], "name": site["names"][0]},
                      "geometry": {"type": "Polygon", "coordinates": [ring]}}]})
    return json.dumps({
        "site_id": site["id"], "name": site["names"][0], "also_known_as": site["names"][1:],
        "culture": site["culture"], "period": site["period"], "designation": site["designation"],
        "steward": site["steward"], "source_url": site["source_url"],
        "centre": {"lat": site["centre"]["lat"], "lon": site["centre"]["lon"]},
        "centre_verified": bool(site["centre"].get("verified")),
        "frame_bounds": bounds, "frame_geometry_s3_url": geom_url,
        "form": site["form"], "documented": _documented(site),
        **({"public_note": site["public_note"]} if site.get("public_note") else {}),
        "terrain": list(PRODUCTS), "has_verified_transect": bool(site.get("transect")), "matched_on": how,
        "next_steps": ("get_rasters(location=<name>, geometry_s3_url=frame_geometry_s3_url) for true colour, "
                       "inspect it, then show_terrain(site_id, 'hillshade') and inspect that."),
    })


def _lrm_stretch(site: dict) -> float:
    s = site.get("lrm_stretch_m", 1.0)
    return 0.3 if isinstance(s, (int, float)) and s < 0.6 else 1.0


def session_name(site_id: str, product: str, stretch: float) -> str:
    """hillshade_<id>.tif, lrm_<id>.tif or lrm03_<id>.tif: the shared inspect_image styles key on it."""
    if product == "hillshade":
        return f"hillshade_{site_id}.tif"
    return f"{'lrm03' if stretch < 0.6 else 'lrm'}_{site_id}.tif"


@tool
async def show_terrain(site_id: str, product: str = "hillshade") -> str:
    """Put a catalogue site's LiDAR terrain (USGS 3DEP 1 m) into the session for the map and your eyes.

    Args:
        site_id: From find_known_site.
        product: "hillshade" (the ground lit from the north-west: walls and mounds cast shadows) or
            "lrm" (local relief model: each metre's height above or below its 21 m neighbourhood;
            banks read red, ditches blue).

    Returns: JSON with s3_url (the raster), bounds, render (pass it to display_visual unchanged),
    stretch_m for the LRM, source (the 3DEP project and tile dates), next_steps. Never reads
    3DEP live: the terrain was built ahead of time.
    """
    site = _site(site_id)
    if site is None:
        return _refusal()
    if product not in PRODUCTS:
        return json.dumps({"error": f"product must be one of {', '.join(PRODUCTS)}"})
    built = manifest().get("sites", {}).get(site_id)
    if not built:
        return json.dumps({"error": f"No terrain is built for {site['names'][0]} (scripts/build_site_catalogue.py)."})
    src_key = f"{CACHE_PREFIX}/{site_id}_{product}.tif"
    stretch = _lrm_stretch(site)
    key = f"{session_prefix()}terrain/{session_name(site_id, product, stretch)}"
    try:
        _s3().copy_object(Bucket=config.S3_BUCKET_NAME, Key=key,
                          CopySource={"Bucket": config.S3_BUCKET_NAME, "Key": src_key},
                          ContentType="image/tiff", MetadataDirective="REPLACE")
    except Exception as e:
        logger.warning("show_terrain copy failed for %s: %s", src_key, type(e).__name__)
        return json.dumps({"error": f"The {product} for {site['names'][0]} is missing from the terrain cache "
                                    "(scripts/build_site_catalogue.py)."})
    bounds = built["bounds"]
    # The hillshade travels with the DEM it was lit from, so the stage can light the ground itself
    # (the light sweeps round the earthwork when the LiDAR lands, and the presenter can move the sun).
    # A server-side copy of the cached COG into the session; the stage reads it through TiTiler.
    dem_url = None
    if product == "hillshade":
        dem_key = f"{session_prefix()}terrain/dem_{site_id}.tif"
        try:
            _s3().copy_object(Bucket=config.S3_BUCKET_NAME, Key=dem_key,
                              CopySource={"Bucket": config.S3_BUCKET_NAME, "Key": f"{CACHE_PREFIX}/{site_id}_dem.tif"},
                              ContentType="image/tiff", MetadataDirective="REPLACE")
            dem_url = f"s3://{config.S3_BUCKET_NAME}/{dem_key}"
        except Exception as e:  # the baked hillshade still shows; only the live light is lost
            logger.warning("show_terrain DEM copy failed for %s: %s", site_id, type(e).__name__)
    if product == "hillshade":
        render = {"kind": "raster", "colormap": "gray", "rescale": [1, 255], "group": "terrain",
                  "legend": "Hillshade", "bounds": bounds, **({"dem": dem_url} if dem_url else {})}
    else:
        render = {"kind": "raster", "colormap": "rdbu_r", "rescale": [-stretch, stretch], "units": "m",
                  "group": "terrain", "legend": "Local relief", "bounds": bounds}
    tiles = [{"project": t.get("title"), "published": t.get("publication_date")} for t in built.get("tiles", [])]
    return json.dumps({
        "site_id": site_id, "product": product, "s3_url": f"s3://{config.S3_BUCKET_NAME}/{key}",
        "bounds": bounds, "render": render, **({"stretch_m": stretch} if product == "lrm" else {}),
        "source": {"dataset": "USGS 3DEP 1 m DEM (bare earth)", "tiles": tiles},
        "next_steps": "inspect_image(s3_url) and say what you see in one sentence; then display_visual(s3_url, render=render).",
    })


def _dem_path(site_id: str) -> str:
    """A GDAL path to the cached DEM (presigned HTTPS, range reads only). Patched in tests."""
    from utils.tools import _presigned_vsicurl
    return _presigned_vsicurl(f"s3://{config.S3_BUCKET_NAME}/{CACHE_PREFIX}/{site_id}_dem.tif")


def _metres_per_degree(lat: float) -> tuple[float, float]:
    """Metres in a degree of latitude and of longitude at a latitude (WGS 84; centimetres over a site)."""
    p = math.radians(lat)
    return (111132.954 - 559.822 * math.cos(2 * p) + 1.175 * math.cos(4 * p),
            111412.84 * math.cos(p) - 93.5 * math.cos(3 * p) + 0.118 * math.cos(5 * p))


def _centre_line(site: dict, azimuth: float) -> list[list[float]]:
    """A DEFAULT_TRANSECT_M line through the site's centre at an azimuth (degrees from north), from
    its western end; a north-south line, which has none, from its northern end."""
    lat, lon = site["centre"]["lat"], site["centre"]["lon"]
    m_lat, m_lon = _metres_per_degree(lat)
    half = DEFAULT_TRANSECT_M / 2
    east, north = half * math.sin(math.radians(azimuth)), half * math.cos(math.radians(azimuth))
    a = [lon + east / m_lon, lat + north / m_lat]
    b = [lon - east / m_lon, lat - north / m_lat]
    start, end = (b, a) if east > 1e-6 else (a, b)
    return [[round(v, 7) for v in start], [round(v, 7) for v in end]]


def _bearing(value) -> str | None:
    """The bearing code (lower-cased and trimmed) when it is one of BEARINGS; None when none was
    given. Anything else is a ValueError: the model chooses from the four, it never writes a line."""
    if value is None:
        return None
    code = value.strip().lower() if isinstance(value, str) else None
    if code not in BEARINGS:
        raise ValueError(f"bearing must be one of {', '.join(BEARINGS)}, or left out for the site's own line")
    return code


def _line_for(site: dict, bearing: str | None) -> tuple[list[list[float]], str, bool, str]:
    """(coords, label, verified, line_source) of the line measure_profile reads. No bearing: the
    record's verified transect when the site has one (the Great Circle), else east-west through the
    centre. A bearing (a BEARINGS code): a DEFAULT_TRANSECT_M line through the centre that way."""
    if bearing is None:
        stored = site.get("transect")
        if stored and stored.get("coords"):
            return stored["coords"], stored.get("label", "the site's verified transect"), True, "verified"
        return (_centre_line(site, BEARINGS["e-w"]), f"east-west through the centre ({DEFAULT_TRANSECT_M} m)",
                False, "default")
    return (_centre_line(site, BEARINGS[bearing]),
            f"{BEARING_WORDS[bearing]} through the centre ({DEFAULT_TRANSECT_M} m)", False, "bearing")


def _next_steps(result: dict, label: str, line_source: str) -> str:
    banks = [f for f in result["features"] if f["kind"] == "bank"]
    if not banks:
        return (f'No bank on this line, {label}: say "{NO_BANK}" and what the LiDAR does show; do not '
                "measure a second line. Then display_visual(transect_s3_url, render=render).")
    line = {"verified": f"This is the record's verified line, {label}: say so.",
            "bearing": f"Your line runs {label}: say the direction in words, never the code, and what it crossed.",
            "default": f"The line runs {label}: say so."}[line_source]
    span = ("Say the span and" if result["outer_banks_span_m"] is not None
            else "It crosses one bank, so there is no span: say")
    return (f"{line} {span} the bank and ditch offsets in metres, with the documented value beside your "
            "measurement; then display_visual(transect_s3_url, render=render).")


def _measure_line(site: dict, built: dict, coords, label: str, verified: bool, *,
                  bearing: str | None = None, line_source: str = "verified") -> dict:
    """Read the cached DEM along a line inside the site's frame, find its banks and ditches, write
    the line and its marks for the map. The result body, or {"error": ...}."""
    site_id = site["id"]
    w, s, e, n = built["bounds"]
    if not all(w <= lon <= e and s <= lat <= n for lon, lat in coords):
        return {"error": "The transect must lie inside the site's frame (frame_bounds from find_known_site)."}
    try:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_USE_HEAD="NO",
                          CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"), rasterio.open(_dem_path(site_id)) as ds:
            xs, ys = warp_transform("EPSG:4326", ds.crs, [c[0] for c in coords], [c[1] for c in coords])
            length = math.hypot(xs[1] - xs[0], ys[1] - ys[0])
            if not MIN_TRANSECT_M <= length <= MAX_TRANSECT_M:
                return {"error": f"The transect must be {MIN_TRANSECT_M} to {MAX_TRANSECT_M} m long "
                                 f"(this one is {length:.0f} m)."}
            pad = 3
            win = from_bounds(min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad, transform=ds.transform)
            win = win.round_offsets().round_lengths()
            dem = ds.read(1, window=win, boundless=True, fill_value=ep.NODATA).astype("float32")
            if ds.nodata is not None and ds.nodata != ep.NODATA:
                dem[dem == ds.nodata] = ep.NODATA
            dist, z = ep.sample(dem, ds.window_transform(win), (xs[0], ys[0]), (xs[1], ys[1]))
            result = ep.analyse(dist, z)
            profile = ep.thin(dist, z, result["baseline_m"])
            # Where each feature sits, back in degrees, for the map's labels.
            pts = []
            for f in result["features"]:
                t = f["at_m"] / length if length else 0
                fx, fy = xs[0] + (xs[1] - xs[0]) * t, ys[0] + (ys[1] - ys[0]) * t
                lon, lat = warp_transform(ds.crs, "EPSG:4326", [fx], [fy])
                pts.append((f, lon[0], lat[0]))
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.warning("measure_profile failed for %s: %s", site_id, type(e).__name__)
        return {"error": f"The DEM for {site['names'][0]} could not be read ({type(e).__name__})."}

    # The line carries the section itself (distance along it, height above the baseline, every
    # metre or so), so the stage can draw the cross-section the room reads the numbers on.
    features = [{"type": "Feature",
                 "properties": {"kind": "transect", "label": label, "length_m": result["length_m"],
                                "baseline_m": result["baseline_m"], "max_relief_m": result["max_relief_m"],
                                "outer_banks_span_m": result["outer_banks_span_m"], "profile": profile},
                 "geometry": {"type": "LineString", "coordinates": coords}}]
    for f, lon, lat in pts:
        sign = "+" if f["offset_m"] >= 0 else "−"
        features.append({"type": "Feature",
                         "properties": {"kind": f["kind"], "offset_m": f["offset_m"], "at_m": f["at_m"],
                                        "label": f"{f['kind']} {sign}{abs(f['offset_m']):.1f} m"},
                         "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    url = _put_json(f"{session_prefix()}terrain/profile_{site_id}.geojson",
                    {"type": "FeatureCollection", "features": features})
    return {
        "site_id": site_id, "transect": label, "transect_verified": verified,
        "bearing": bearing, "line_source": line_source, "length_m": result["length_m"],
        "baseline_m": result["baseline_m"], "features": result["features"],
        "outer_banks_span_m": result["outer_banks_span_m"], "max_relief_m": result["max_relief_m"],
        "documented": _documented(site), "transect_s3_url": url,
        "render": {"kind": "vector", "group": "terrain", "label": "label"},
        "next_steps": _next_steps(result, label, line_source),
    }


@tool
async def measure_profile(site_id: str, bearing: str = None) -> str:
    """Measure an earthwork: the ground's height along a line across it, from the 1 m LiDAR DEM.

    Args:
        site_id: From find_known_site.
        bearing: OPTIONAL the line you choose, one of "n-s", "ne-sw", "e-w", "nw-se": a 600 m line
            through the site's centre in that direction. Choose it after looking at the local
            relief, to cross the wall or ring you named. Omit it to measure the record's verified
            line (find_known_site's has_verified_transect), or east-west through the centre when
            the site has none. There is no other way to give a line: never coordinates.

    Returns: JSON with transect (the line in words), bearing (the code, or null), line_source
    ("verified": the record's line; "bearing": your line; "default": east-west through the centre),
    transect_verified, baseline_m (the line's median height), features (each bank and ditch: where
    along the line, height, offset from the baseline in metres), outer_banks_span_m (bank to bank;
    null with fewer than two banks), documented (the record's dimensions, with metres beside feet),
    transect_s3_url (the line and its banks and ditches for the map), next_steps. A bearing that is
    not one of the four is an error and nothing is measured.
    """
    site = _site(site_id)
    if site is None:
        return _refusal()
    built = manifest().get("sites", {}).get(site_id)
    if not built:
        return json.dumps({"error": f"No terrain is built for {site['names'][0]}."})
    try:
        code = _bearing(bearing)
    except ValueError as e:
        return json.dumps({"error": str(e)})
    coords, label, verified, source = _line_for(site, code)
    return json.dumps(_measure_line(site, built, coords, label, verified, bearing=code, line_source=source))


def form_terms(text: str) -> set[str]:
    t = " " + _norm(text) + " "
    return {k for k, words in FORM_WORDS.items() if any(f" {w} " in t or f" {w}s " in t for w in words)}


@tool
async def find_similar_sites(site_id: str, top_k: int = 3) -> str:
    """Find the other sites on the public record that share this site's form.

    Ranked by the record's own description of each site's form (circle, octagon, square, ditch,
    effigy, platform mound, ...), then the same culture, then distance. Every result is a catalogue
    site. Parts of the same complex (closer than 10 km) are listed separately, not as "elsewhere".

    Args:
        site_id: From find_known_site (the example).
        top_k: How many sites to return (default 3, max 8).

    Returns: JSON with example (name, form terms), matches [{site_id, name, designation, culture,
    distance_km, shared_form, same_culture}], same_complex [names], method, next_steps.
    """
    site = _site(site_id)
    if site is None:
        return _refusal()
    try:
        k = max(1, min(8, int(top_k)))
    except (TypeError, ValueError):
        k = 3
    built = manifest().get("sites", {})
    mine = form_terms(site["form"])
    rows, same_complex = [], []
    for sid, other in catalogue().items():
        if sid == site_id or sid not in built:
            continue
        d = _km(site["centre"], other["centre"])
        if d < SAME_COMPLEX_KM:
            same_complex.append({"name": other["names"][0], "distance_km": round(d, 1)})
            continue
        theirs = form_terms(other["form"])
        shared = sorted(mine & theirs)
        if not shared:
            continue
        same_culture = _norm(other["culture"]).split(" ")[0] == _norm(site["culture"]).split(" ")[0]
        score = len(shared) / max(1, len(mine | theirs)) + (0.25 if same_culture else 0.0)
        rows.append((-score, d, sid, shared, same_culture))
    rows.sort()
    matches = [{"site_id": sid, "name": catalogue()[sid]["names"][0], "designation": catalogue()[sid]["designation"],
                "culture": catalogue()[sid]["culture"], "distance_km": round(d), "shared_form": shared,
                "same_culture": same, "form": catalogue()[sid]["form"]}
               for _, d, sid, shared, same in rows[:k]]
    return json.dumps({
        "example": {"site_id": site_id, "name": site["names"][0], "form_terms": sorted(mine)},
        "matches": matches, "same_complex": same_complex,
        "method": ("Ranked by the published form of each site in the catalogue (the record's own words), then "
                   "the same culture, then distance. Only sites already on the public record are compared."),
        "next_steps": ("Name the top match and what it shares; show_terrain(top match, 'lrm'), inspect it, and say "
                       "in one sentence what form you see."),
    })
