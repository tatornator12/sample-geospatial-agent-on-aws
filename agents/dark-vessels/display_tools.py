"""display_visual for Dark Vessels: the platform's tool (geo_agent/utils/tools.py), plus a check
that the file it names is one this session wrote.

The stage loads a display_visual's s3_url exactly as the model wrote it. A mistyped name (seen on
dev, Oct 19: `fleet_2026_10.geojson` for the tool's `fleet_2026-10.geojson`) leaves the beat off the
map with nothing said. So a session URL that is not there is refused, with the session file the
model most likely meant, and the model shows that one instead. Anything outside the session (a
replay case's files) passes as before: the stage checks those itself.
"""
import json
import re

from strands import tool

import vessel_store as vs


def _norm(name: str) -> str:
    """A file name without its punctuation or case: fleet_2026_10 and fleet_2026-10 are one name."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def check_display_url(s3_url) -> dict | None:
    """None when the URL is fine to show; otherwise the error to return, with `did_you_mean`."""
    session = vs.s3_url(vs.session_prefix())
    if not isinstance(s3_url, str) or not s3_url.startswith(session):
        return None
    key = s3_url[len(vs.s3_url("")):]
    if vs.exists(key):
        return None
    folder, _, name = key.rpartition("/")
    try:
        meant = next((k for k in vs.list_keys(f"{folder}/") if _norm(k.rpartition("/")[2]) == _norm(name)), None)
    except Exception:
        meant = None
    if meant:
        return {"error": "That file is not in this session. Show the file the tool returned, unchanged.",
                "did_you_mean": vs.s3_url(meant)}
    return {"error": "That file is not in this session. Show the s3_url a tool returned, unchanged."}


@tool
async def display_visual(s3_url: str, title: str, description: str = "", render: dict = None) -> str:
    """Display a radar pass or a tool's map layer (targets, coverage, heat, boxes, fleet, next look,
    reach) on the map.

    Args:
        s3_url: The s3_url a tool returned, copied exactly (a file this session wrote).
        title: Display title.
        description: Optional details.
        render: OPTIONAL the tool's `render` hint, copied unchanged.

    Returns: JSON with status "success"; or an error with `did_you_mean` when the file is not in
    this session (then call display_visual again with that URL).
    """
    problem = check_display_url(s3_url)
    if problem:
        return json.dumps(problem)
    return json.dumps({"status": "success"}, indent=2)
