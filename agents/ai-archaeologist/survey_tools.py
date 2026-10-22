"""The condition survey (decision 10, approved Oct 22): after "Where else did they build like this?"
the agent looks at the local relief of the top two or three matches and records, for each, whether
the form it shares with the example still shows in the ground, with its reason.

`record_condition` takes enums only. An accepted verdict writes one small file of enums and
numbers for the stage, `session_data/<sid>/archaeology/survey_<toolUseId>.json`, which the stage
words in its own language (react-ui/frontend/src/utils/survey.ts); no model text reaches the row.

It is refused, and writes nothing, unless:
  - verdict and because come from the fixed sets, as one of the allowed pairs (PAIRS);
  - the site is in the catalogue and among THIS turn's find_similar_sites matches;
  - its local relief is built (a match without one is skipped, never given a verdict);
  - its local relief was inspected THIS turn (the rendering inspect_image saved for that file was
    written after the turn began), and in an earlier model response than this verdict's (a verdict
    in the same response as its inspect_image was chosen before the image came back): the agent
    looks before it judges;
  - the site has no verdict yet this turn (one verdict each);
  - "walls_in_relief" is not claimed for a site whose relief the build stretched to ±0.3 m for
    ploughed walls (lrm_stretch_m in the catalogue): those walls are traced, not standing.
"""
from __future__ import annotations

import json
import logging
import re
import threading

from strands import tool

import _paths  # noqa: F401  (shared code on sys.path before `import config`)
import config
import site_tools as st

logger = logging.getLogger(__name__)

VERDICTS = ("visible", "faint", "cannot_confirm")
BECAUSE = ("walls_in_relief", "ploughed_but_traced", "low_relief_only", "no_form_seen")
# The reasons each verdict may give. The stage mirrors these keys (utils/survey.ts SURVEY_PAIRS).
PAIRS = {
    "visible": ("walls_in_relief", "ploughed_but_traced"),
    "faint": ("ploughed_but_traced", "low_relief_only"),
    "cannot_confirm": ("low_relief_only", "no_form_seen"),
}
TOOL_USE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# S3's LastModified is whole seconds and its clock is not ours: an inspection written in the
# turn's first second must still count.
CLOCK_SLACK_S = 2.0
_LOCK = threading.Lock()   # one check-and-write at a time, whatever runs a response's calls

NOT_A_MATCH = ("Record a condition only for a site find_similar_sites returned this turn; "
               "call find_similar_sites first.")
NO_LIDAR = "No local relief is built for {name}: skip it and say so. It gets no verdict."
LOOK_FIRST = ("Look first: show_terrain(site_id, 'lrm', extent='site'), then inspect_image(its s3_url) as a "
              "call of its own; record the condition in your next response, once you have seen the image.")
# The look and the verdict sat in one response: the image has come back with this refusal, so the
# model judges it next, with no second cut or look.
SAME_RESPONSE = ("{name}'s image comes back with this reply: this verdict was chosen before you saw it. "
                 "Do not look again; record the condition in your next response, from that image.")
ALREADY = "{name} already has a verdict this turn: one verdict per site."
# The build stretched this site's relief to ±0.3 m because its walls are ploughed down (the record):
# what reads there stands tens of centimetres high, so "standing walls" would overclaim.
PLOUGHED = ("{name}'s relief is stretched to ±0.3 m for walls ploughed down to tens of centimetres: "
            "they do not stand in relief. Give ploughed_but_traced, or a weaker verdict.")
NOT_RECORDED = "The verdict could not be recorded (no tool-use id); nothing was written."


def survey_key(call_id: str) -> str:
    return f"{st.session_prefix()}archaeology/survey_{call_id}.json"


def tool_use_id(tool_context) -> str | None:
    """The call's own id (Strands passes it through @tool(context=True)), when it is a safe file name."""
    try:
        tid = tool_context.tool_use["toolUseId"]
    except (AttributeError, KeyError, TypeError):
        return None
    return tid if isinstance(tid, str) and TOOL_USE_ID_RE.fullmatch(tid) else None


def inspected_this_turn(site_id: str, started_at: float) -> bool:
    """Whether inspect_image saved its rendering of this site's local relief since the turn began.

    inspect_image saves what it showed the model at session_data/<sid>/inspections/<raster stem>.png
    (geo_agent/utils/tools.py _inspection_key); show_terrain names the raster (st.session_name)."""
    stretch = st._lrm_stretch(st.catalogue()[site_id])
    for extent in ("site", "frame"):   # the close look first; the whole frame's relief counts too
        stem = st.session_name(site_id, "lrm", stretch, extent).rsplit(".", 1)[0]
        for ext in ("png", "jpg"):
            try:
                head = st._s3().head_object(Bucket=config.S3_BUCKET_NAME,
                                            Key=f"{st.session_prefix()}inspections/{stem}.{ext}")
            except Exception:
                continue
            modified = head.get("LastModified")
            if modified is not None and modified.timestamp() >= started_at - CLOCK_SLACK_S:
                return True
    return False


_RELIEF_NAME = re.compile(r"^lrm(?:03)?_([a-z0-9][a-z0-9-]{1,63}?)(?:_site)?\.tiff?$")


def looked_in_this_response(tool_context, site_id: str) -> bool:
    """Whether this same model response also asked to inspect this site's relief.

    Strands appends the assistant message (every tool use of the response) to the conversation
    before it runs the response's tools, all at once. A verdict in that message was chosen before
    the image came back, even when the inspection's file is already in S3 by the time this runs."""
    try:
        message = tool_context.agent.messages[-1]
    except (AttributeError, IndexError, TypeError):
        return False
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return False
    for block in message.get("content") or []:
        use = block.get("toolUse") if isinstance(block, dict) else None
        if not isinstance(use, dict) or use.get("name") != "inspect_image":
            continue
        url = (use.get("input") or {}).get("s3_url") if isinstance(use.get("input"), dict) else None
        m = _RELIEF_NAME.match(url.rsplit("/", 1)[-1]) if isinstance(url, str) else None
        if m and m.group(1) == site_id:
            return True
    return False


def _record(site_id, verdict, because, tool_context) -> dict:
    if not isinstance(verdict, str) or verdict not in PAIRS:
        return {"error": f"verdict must be one of {', '.join(VERDICTS)}"}
    if not isinstance(because, str) or because not in BECAUSE:
        return {"error": f"because must be one of {', '.join(BECAUSE)}"}
    if because not in PAIRS[verdict]:
        return {"error": f"A {verdict} verdict gives one of these reasons: {', '.join(PAIRS[verdict])}"}
    site = st._site(site_id)
    if site is None:
        return json.loads(st._refusal())
    name = site["names"][0]
    turn = st.current_turn()
    match = turn["matches"].get(site_id)
    if match is None:
        return {"error": NOT_A_MATCH}
    if not match["lidar"] or not st.has_lrm(site_id):
        return {"error": NO_LIDAR.format(name=name)}
    if site_id in turn["recorded"]:
        return {"error": ALREADY.format(name=name)}
    if because == "walls_in_relief" and st._lrm_stretch(site) < 0.6:
        return {"error": PLOUGHED.format(name=name)}
    if looked_in_this_response(tool_context, site_id):
        logger.info("record_condition refused for %s: same response as its inspect_image", site_id)
        return {"error": SAME_RESPONSE.format(name=name)}
    if not inspected_this_turn(site_id, turn["started_at"]):
        return {"error": LOOK_FIRST}
    call_id = tool_use_id(tool_context)
    if call_id is None:
        return {"error": NOT_RECORDED}
    n = len(turn["recorded"]) + 1
    body = {"turn_id": turn["turn_id"], "tool_use_id": call_id, "n": n, "site_id": site_id,
            "verdict": verdict, "because": because, "example_id": match["example"],
            "rank": match["rank"], "distance_km": match["distance_km"]}
    try:
        st._put_json(survey_key(call_id), body)
    except Exception as e:
        logger.warning("record_condition write failed for %s: %s", site_id, type(e).__name__)
        return {"error": "The verdict could not be written; try once more."}
    turn["recorded"][site_id] = verdict
    return {"status": "recorded", "site_id": site_id, "name": name, "verdict": verdict, "because": because,
            "recorded_this_turn": n,
            "next_steps": ("display_visual(the local relief's s3_url, render=render) in the same response as your "
                           "next tool call (the next match's show_terrain); after the last site, display_visual on "
                           "its own, then the answer.")}


@tool(context=True)
async def record_condition(site_id: str, verdict: str, because: str, tool_context=None) -> str:
    """Record how a similar site stands today: whether the form it shares with the example still
    shows in its 1 m local relief, with the reason. Only after you have looked at that relief.

    Args:
        site_id: A match from this turn's find_similar_sites (lidar true).
        verdict: "visible" (the walls read plainly), "faint" (you can make the form out, only just)
            or "cannot_confirm" (you cannot trace the form; a designed outcome, not a failure).
        because: Why. visible: "walls_in_relief" (standing walls; not on a ±0.3 m relief, which
            is for walls ploughed down) or "ploughed_but_traced" (ploughed down, the LiDAR still
            traces them); faint: "ploughed_but_traced" or "low_relief_only" (only low, broad
            rises); cannot_confirm: "low_relief_only" or "no_form_seen".

    Returns: JSON with status "recorded" and next_steps; or an error, and nothing is recorded:
    a site that is not this turn's match, a match with no local relief (skip it: no verdict), a
    relief you have not inspected this turn, a second verdict for a site, or a reason the verdict
    does not take.
    """
    with _LOCK:
        result = _record(site_id, verdict, because, tool_context)
    if "error" in result:
        logger.info("record_condition refused for %r: %s", site_id, result["error"][:80])
    return json.dumps(result)
