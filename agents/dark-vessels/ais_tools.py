"""Dark Vessels, AIS: where AIS could be heard, which targets broadcast, and the evidence for each
candidate (design components 3 and 4). The order is the argument: check_ais_coverage before
match_ais, and nothing is called a candidate before the coverage check is on the map."""
from __future__ import annotations

import json
import logging

import numpy as np
from shapely.geometry import mapping
from strands import tool

import ais_coverage as cv
import vessel_store as vs
from pass_tools import _built, target_features, targets_for

logger = logging.getLogger(__name__)

CLAIM_KM = vs.CLAIM_KM
OURS_MATCH_KM = vs.OURS_MATCH_KM
MAX_EVIDENCE = 6
INNOCENT = [
    {"id": "small_boat_no_ais", "says": "a small boat that need not carry AIS",
     "would_confirm": "a patrol sighting of a small boat there", "would_rule_out": "a target larger than small craft on the next look"},
    {"id": "reception_or_equipment", "says": "AIS fitted but not received at that hour",
     "would_confirm": "the same water heard again with a vessel there within hours", "would_rule_out": "no AIS there on the next pass either"},
    {"id": "transponder_off", "says": "AIS switched off",
     "would_confirm": "an AIS-off event logged nearby", "would_rule_out": "a broadcast from that spot at the pass minute"},
    {"id": "not_a_vessel", "says": "a buoy, a rock or sea clutter",
     "would_confirm": "the same bright point in the same place on the next look", "would_rule_out": "the point moved between looks"},
]


_t = vs.parse_t
heads_at = vs.heads_at


def _coverage_key(pass_id: str) -> str:
    return f"{vs.vessels_prefix()}coverage_{pass_id}.json"


def _match_key(pass_id: str) -> str:
    return f"{vs.vessels_prefix()}match_{pass_id}.json"


def _heard_for(pass_id: str) -> tuple:
    built = _built(pass_id)
    entry = vs.pass_entry(pass_id)
    presence = vs.cached(built["products"]["presence"]["key"])
    fixes = [cv.Fix(lon, lat, _t(h)) for lon, lat, h in presence["fixes"]]
    grid, water = vs.reserve_grid()
    heard = cv.heard_cells(fixes, grid, _t(entry["sensed"]), water=water)
    return grid, water, heard


@tool
async def check_ais_coverage(pass_id: str) -> str:
    """Where AIS could be heard around the pass: the proof that silence means something. A 0.05° cell
    of the reserve is heard when, in one hour of the three either side of the pass, two or more
    different broadcasting vessels were heard within 30 km of it; everywhere else is unproven.

    Args:
        pass_id: From find_pass.

    Returns: JSON with heard_share (of the reserve), heard_s3_url and unproven_s3_url (the areas for
    the map), render hints for each (pass them to display_visual unchanged), next_steps. Required
    before match_ais.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    if not _built(pass_id):
        return json.dumps({"error": f"The AIS for {pass_id} is not built (scripts/build_vessel_cache.py)."})
    grid, water, heard = _heard_for(pass_id)
    reserve = vs.records()["reserve"]
    targets = targets_for(pass_id)
    drawn = cv.drawn_shape(heard, grid, within=reserve)
    mended = cv.agree(drawn, heard, grid, [(t["lon"], t["lat"]) for t in targets], within=reserve)
    heard_shape = mended.shape
    unproven = reserve.difference(heard_shape)
    share = cv.heard_share(heard, water)
    # The share rides on the drawing, so the stage quotes the tool's number, never its own measure.
    heard_url = vs.put_json(f"{vs.vessels_prefix()}heard_{pass_id}.geojson",
                            vs.fc([{"type": "Feature", "properties": {"kind": "heard", "share": round(share, 3)},
                                    "geometry": mapping(heard_shape.simplify(0.002))}]))
    unproven_url = vs.put_json(f"{vs.vessels_prefix()}unproven_{pass_id}.geojson",
                               vs.fc([{"type": "Feature", "properties": {"kind": "unproven"}, "geometry": mapping(unproven.simplify(0.002))}]))
    vs.put_json(_coverage_key(pass_id), {"pass_id": pass_id, "heard_share": round(share, 3),
                                         "cells": [[int(r), int(c)] for r, c in zip(*np.nonzero(heard))]})
    return json.dumps({
        "pass_id": pass_id, "heard_share": round(share, 3), "heard_pct": round(100 * share),
        "rule": "heard: in one hour of the three either side of the pass, two or more different vessels heard within 30 km",
        "heard_s3_url": heard_url, "unproven_s3_url": unproven_url,
        "heard_render": {"kind": "vector", "group": "maritime", "legend": "Heard water"},
        "unproven_render": {"kind": "vector", "group": "maritime", "legend": "Unproven water"},
        "unproven_means": vs.NOT_EVIDENCE,
        "next_steps": "display_visual(heard_s3_url, render=heard_render) and display_visual(unproven_s3_url, "
                      "render=unproven_render) in the same response as match_ais(pass_id).",
    })


def _record(pass_id: str):
    try:
        return vs.get_json(_coverage_key(pass_id))
    except Exception:
        return None


@tool
async def match_ais(pass_id: str) -> str:
    """Match every target to AIS and give it one status: broadcasting (its AIS was heard at the pass),
    port (at or near a port), unproven (no AIS, but AIS could not be heard there: not evidence),
    seen_once (one detector only), or candidate (no AIS, in heard water, seen by both detectors).

    Args:
        pass_id: From find_pass, after check_ais_coverage for the same pass.

    Returns: JSON with counts in the order to say them, the candidates (T01 west to east, with km
    to the nearest port), targets_s3_url (the same map layer, statuses changed in place), render,
    the fixed sentence, next_steps.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    record = _record(pass_id)
    if record is None:
        return json.dumps({"error": "Run check_ais_coverage first: nothing is called a candidate before the coverage check."})
    built = _built(pass_id)
    grid, _ = vs.reserve_grid()
    heard = np.zeros(grid.shape, dtype=bool)
    for r, c in record["cells"]:
        heard[r, c] = True
    replay = vs.cached(built["products"]["replay"]["key"])
    heads = heads_at(replay, _t(entry["sensed"]))
    targets = targets_for(pass_id)
    n = 0
    for t in targets:
        t["heard"] = cv.is_heard(heard, grid, t["lon"], t["lat"])
        near, near_km = vs.nearest_head(t, heads)
        if t["status"] == "port":
            pass
        elif vs.broadcasts(t, near_km):
            t["status"] = "broadcasting"
            t["claimed"] = True
            if near_km <= CLAIM_KM:
                t["claim"] = [round(near["lon"], 5), round(near["lat"], 5)]
        elif not t["heard"]:
            t["status"] = "unproven"
        elif t["source"] != "both":
            t["status"] = "seen_once"
        else:
            t["status"] = "candidate"
        t["nearest_ais_km"] = round(near_km, 1) if near else None
        t["nearest_ais_type"] = near["type"] if near else None
    for t in targets:
        if t["status"] == "candidate":
            n += 1
            t["label"] = f"T{n:02d}"
    url = vs.put_json(f"{vs.vessels_prefix()}targets_{pass_id}.geojson", target_features(targets))
    vs.put_json(_match_key(pass_id), {"pass_id": pass_id, "targets": targets})
    counts = {s: sum(t["status"] == s for t in targets) for s in ("broadcasting", "port", "unproven", "seen_once", "candidate")}
    candidates = [{"id": t["label"], "port": t["port"], "port_km": t["port_km"], "nearest_ais_km": t["nearest_ais_km"]}
                  for t in targets if t["status"] == "candidate"]
    return json.dumps({
        "pass_id": pass_id, "counts": counts, "say_in_order": ["broadcasting", "port", "unproven", "seen_once", "candidate"],
        "candidates": candidates, "targets_s3_url": url,
        "render": {"kind": "points", "group": "maritime", "legend": "Radar targets"},
        "fixed_sentence": vs.CANDIDATE_SENTENCE,
        "next_steps": "display_visual(targets_s3_url, render=render) in the same response as gather_evidence(pass_id). "
                      "Give the counts in that order, then the fixed sentence word for word.",
    })


@tool
async def gather_evidence(pass_id: str, candidate_ids: list = None) -> str:
    """The evidence for each candidate (at most six): a radar chip at 10 m, both detectors' readings,
    the nearest broadcasting vessel at the pass (type only), km to the nearest port and shore, and the
    innocent explanations with what would confirm or rule each out.

    Args:
        pass_id: From find_pass, after match_ais.
        candidate_ids: OPTIONAL ["T01", "T02"]; all candidates (up to six) when omitted.

    Returns: JSON with evidence per candidate (chip_s3_url for inspect_image and the evidence
    gallery), the confidence sentence, innocent explanations, next_steps.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    try:
        match = vs.get_json(_match_key(pass_id))
    except Exception:
        return json.dumps({"error": "Run match_ais first."})
    cands = [t for t in match["targets"] if t["status"] == "candidate"]
    if candidate_ids:
        if not isinstance(candidate_ids, list) or not all(isinstance(c, str) and vs.CANDIDATE_ID_RE.fullmatch(c) for c in candidate_ids):
            return json.dumps({"error": 'candidate_ids must be like ["T01", "T02"]'})
        cands = [t for t in cands if t["label"] in candidate_ids]
    if not cands:
        return json.dumps({"pass_id": pass_id, "evidence": [], "note": "No candidates on this pass."})
    built = _built(pass_id)
    chips = built.get("chips", {})
    out = []
    for t in cands[:MAX_EVIDENCE]:
        chip_url = None
        src = chips.get(t["ours_id"])
        if src:
            try:
                chip_url = vs.copy_into_session(src, f"{vs.vessels_prefix()}chips/{pass_id}_{t['label']}.tif")
            except Exception as e:
                logger.warning("gather_evidence chip copy failed for %s %s: %s", pass_id, t["label"], type(e).__name__)
        out.append({
            "id": t["label"], "chip_s3_url": chip_url,
            "ours": {"peak_db_over_sea": t.get("peak_db"), "area_m2": t.get("area_m2")},
            "gfw": {"detected": True, "matched_to_ais": False},
            "pair_km": t.get("pair_km"),
            "nearest_broadcast": {"km": t.get("nearest_ais_km"), "type": t.get("nearest_ais_type")},
            "where": "inside the Galápagos Marine Reserve", "port": t["port"], "port_km": t["port_km"],
            "shore_km": vs.km_to_shore(t["lon"], t["lat"]),
        })
    vs.put_json(f"{vs.vessels_prefix()}evidence_{pass_id}.json", {"pass_id": pass_id, "evidence": out})
    return json.dumps({
        "pass_id": pass_id, "evidence": out,
        "confidence": "Both detectors saw it in water where AIS was heard, and no broadcast came from it. "
                      "That makes it a candidate for a look, not a finding.",
        "innocent_explanations": INNOCENT,
        "next_steps": "inspect_image(chip_s3_url) for at most two chips and say what you see; then give one line per "
                      "candidate: id, km to port, nearest broadcast (km, type). No vessel is named.",
    })
