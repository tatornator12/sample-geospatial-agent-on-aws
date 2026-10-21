"""display_visual for the AI Archaeologist: the platform's tool (geo_agent/utils/tools.py), plus a
check that the file it names is one this session wrote (the pattern of agents/dark-vessels).

The stage loads a display_visual's s3_url exactly as the model wrote it. A retyped name (stage
review Oct 20, act4 P0-2: `lrm_seip-earthworks.tif` for show_terrain's `lrm03_seip-earthworks.tif`)
leaves the LiDAR off the map, every tile a 500, while the answer describes it. So a session URL
that is not there is refused, with the session file the model most likely meant, and the model
shows that one instead. Anything outside the session (a replay case's files) passes as before: the
stage checks those itself.
"""
from __future__ import annotations

import json
import re

from strands import tool

import _paths  # noqa: F401  (shared code on sys.path before `import config`)
import config
import site_tools as st

MISSING = "That file is not in this session. Show the s3_url a tool returned, unchanged."
# The terrain products show_terrain and measure_profile write: <product>_<site_id>.<ext>. lrm and
# lrm03 (the ±0.3 m stretch for ploughed walls) are one family: the model may drop the "03".
_PRODUCT = re.compile(r"^(hillshade|lrm03|lrm|dem|profile)_(.+)\.[a-z]+$")
_FAMILY = {"lrm03": "lrm"}


def _url(key: str) -> str:
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


def exists(key: str) -> bool:
    """Whether an object is there (a HEAD: never the body). Any refusal reads as not there."""
    try:
        st._s3().head_object(Bucket=config.S3_BUCKET_NAME, Key=key)
        return True
    except Exception:
        return False


def list_keys(prefix: str, limit: int = 200) -> list[str]:
    """The keys under a prefix (one page; a session folder holds a few dozen)."""
    page = st._s3().list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=prefix, MaxKeys=limit)
    return [o["Key"] for o in page.get("Contents", [])]


def _norm(name: str) -> str:
    """A file name without its punctuation or case: lrm03_seip-earthworks and LRM03_seip_earthworks are one name."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _product(name: str) -> tuple[str, str] | None:
    """(family, site id without punctuation) for a terrain product's file name, else None."""
    m = _PRODUCT.match(name.lower())
    return (_FAMILY.get(m.group(1), m.group(1)), _norm(m.group(2))) if m else None


def _meant(name: str, keys: list[str]) -> str | None:
    """The one file in the folder the model most likely meant: the same name but for punctuation
    and case, else the same product family for the same site. None when there is no single match."""
    names = {k: k.rpartition("/")[2] for k in keys}
    same = [k for k, n in names.items() if _norm(n) == _norm(name)]
    if len(same) == 1:
        return same[0]
    want = _product(name)
    if not want:
        return None
    family = [k for k, n in names.items() if _product(n) == want]
    return family[0] if len(family) == 1 else None


def check_display_url(s3_url) -> dict | None:
    """None when the URL is fine to show; otherwise the error to return, with `did_you_mean`."""
    session = _url(st.session_prefix())
    if not isinstance(s3_url, str) or not s3_url.startswith(session):
        return None
    key = s3_url[len(_url("")):]
    if exists(key):
        return None
    folder, _, name = key.rpartition("/")
    try:
        meant = _meant(name, list_keys(f"{folder}/"))
    except Exception:
        meant = None
    if meant:
        return {"error": MISSING, "did_you_mean": _url(meant)}
    return {"error": MISSING}


@tool
async def display_visual(s3_url: str, title: str, description: str = "", render: dict = None) -> str:
    """Put a layer on the map: true colour (get_rasters' tci_s3_url), the LiDAR (show_terrain's
    s3_url) or the transect (measure_profile's transect_s3_url).

    Args:
        s3_url: The s3_url a tool returned, copied exactly (a file this session wrote).
        title: Display title, "<site name>, <product>".
        description: Optional details (the date and the source).
        render: OPTIONAL the tool's `render` hint, copied unchanged.

    Returns: JSON with status "success"; or an error with `did_you_mean` when the file is not in
    this session (then call display_visual again with that URL and nothing else changed).
    """
    problem = check_display_url(s3_url)
    if problem:
        return json.dumps(problem)
    return json.dumps({"status": "success"}, indent=2)
