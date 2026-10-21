"""Dark Vessels, AIS: where AIS was being received, which targets broadcast, and the evidence for each
candidate (design components 3 and 4). The order is the argument: check_ais_coverage before
match_ais, and nothing is called a candidate before the coverage check is on the map. A pass speaks
only for the reserve water it imaged where AIS was received; under the standard (CHECKABLE_FLOOR),
match_ais refuses it."""
from __future__ import annotations

import json
import logging

import numpy as np
from shapely.geometry import mapping
from strands import tool

import ais_coverage as cv
import vessel_store as vs
from pass_tools import _built, claim_targets, target_features, targets_for

logger = logging.getLogger(__name__)

CLAIM_KM = vs.CLAIM_KM
OURS_MATCH_KM = vs.OURS_MATCH_KM
MAX_EVIDENCE = 6
INNOCENT = [
    {"id": "small_boat_no_ais", "says": "a small boat that need not carry AIS",
     "would_confirm": "a patrol sighting of a small boat there", "would_rule_out": "a target larger than small craft on the next look"},
    {"id": "reception_or_equipment", "says": "AIS fitted but not received at that hour",
     "would_confirm": "AIS received in the same water again with a vessel there within hours", "would_rule_out": "no AIS there on the next pass either"},
    {"id": "transponder_off", "says": "AIS switched off",
     "would_confirm": "an AIS-off event logged nearby", "would_rule_out": "a broadcast from that spot at the pass minute"},
    {"id": "not_a_vessel", "says": "a buoy, a rock or sea clutter",
     "would_confirm": "the same bright point in the same place on the next look", "would_rule_out": "the point moved between looks"},
]


# The words the room hears for each status (the ids stay the tools' and the stage's).
SAY_AS = {"broadcasting": "broadcasting", "port": "at or near a port", "unproven": "reception unknown",
          "seen_once": "seen by one detector only", "candidate": "candidates"}

STALE_RECORDS = "Those records are from an earlier question: read the pass again."
# match_ais' next steps, word for word (design §3.5, review M2): showing the matched targets is what
# lets the map reveal them; it is not investigation order.
NEXT_WITH_CANDIDATES = "Show the targets (display_visual with targets_s3_url and render) with your next call; then the evidence."
NEXT_NO_CANDIDATES = ("Show the targets (display_visual with targets_s3_url and render) with your next call. "
                      "No candidates on this pass: decide what follows.")


_t = vs.parse_t
heads_at = vs.heads_at


def _pct(share: float) -> int:
    return round(100 * share)


def _coverage_key(pass_id: str) -> str:
    return vs.record_key("coverage", pass_id)


def _match_key(pass_id: str) -> str:
    return vs.record_key("match", pass_id)


def _heard_for(pass_id: str) -> tuple:
    built = _built(pass_id)
    entry = vs.pass_entry(pass_id)
    presence = vs.cached(built["products"]["presence"]["key"])
    fixes = [cv.Fix(lon, lat, _t(h)) for lon, lat, h in presence["fixes"]]
    grid, water = vs.reserve_grid()
    heard = cv.heard_cells(fixes, grid, _t(entry["sensed"]), water=water)
    return grid, water, heard


def _same_grid(stored, grid) -> bool:
    try:
        return len(stored) == 5 and all(abs(float(a) - b) < 1e-6
                                        for a, b in zip(stored, (grid.west, grid.south, grid.east, grid.north, grid.step)))
    except (TypeError, ValueError):
        return False


def imaged_for(pass_id: str, grid, targets: list[dict]) -> np.ndarray | None:
    """The cells the pass imaged (the build's imaged_cells, on the reserve's grid) plus every cell
    holding one of its targets; None when the build has not stored them."""
    built = _built(pass_id) or {}
    runs = built.get("imaged_cells")
    if not isinstance(runs, list) or not _same_grid(built.get("imaged_grid"), grid):
        return None
    try:
        imaged = cv.cells_from_runs(runs, grid.shape)
    except (IndexError, TypeError, ValueError):
        return None
    return cv.with_target_cells(imaged, grid, [(t["lon"], t["lat"]) for t in targets])


@tool
async def check_ais_coverage(pass_id: str) -> str:
    """Where AIS was being received around the pass: the proof that silence means something. A 0.05°
    cell of the reserve counts as received when, in one hour of the three either side of the pass,
    two or more different broadcasting vessels' AIS was received within 30 km of it; everywhere else
    in the radar is reception unknown. A pass can check only the water it imaged where AIS was
    received.

    Args:
        pass_id: From find_pass.

    Returns: JSON with imaged_share (the share of the reserve the pass imaged), heard_share (the share
    of the reserve where AIS was being received), checkable_share (imaged and received), standard,
    unexplained (targets no broadcast accounts for, in received and in reception-unknown water),
    heard_s3_url and unproven_s3_url (the received and the reception-unknown areas inside the radar,
    for the map), render hints for each (pass them to display_visual unchanged), next_steps. Required
    before match_ais.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    refused = vs.require_read(pass_id)
    if refused:
        return json.dumps(refused)
    if not _built(pass_id):
        return json.dumps({"error": f"The AIS for {pass_id} is not built (scripts/build_vessel_cache.py)."})
    grid, water, heard = _heard_for(pass_id)
    targets = targets_for(pass_id)
    imaged = imaged_for(pass_id, grid, targets)
    if imaged is None:
        logger.warning("check_ais_coverage: no imaged cells for %s", pass_id)
        return json.dumps({"error": f"The imaged area for {pass_id} is not built (scripts/build_vessel_cache.py --imaged)."})
    shares = cv.coverage_shares(heard, imaged, water)
    received = heard & imaged
    # Both areas lie inside the radar: the wash is where AIS was received, the hatch the rest it imaged.
    within = cv.cells_shape(imaged, grid).intersection(vs.records()["reserve"])
    drawn = cv.drawn_shape(received, grid, within=within)
    mended = cv.agree(drawn, received, grid, [(t["lon"], t["lat"]) for t in targets], within=within)
    heard_shape = mended.shape
    unproven = within.difference(heard_shape)
    claim_targets(pass_id, targets)
    unexplained = [t for t in targets if t["status"] != "port" and not t.get("claimed")]
    in_received = sum(cv.is_heard(received, grid, t["lon"], t["lat"]) for t in unexplained)
    stamp = vs.question_stamp()
    # The shares ride on the drawing, so the stage quotes the tool's numbers, never its own measure.
    heard_url = vs.put_json(f"{vs.vessels_prefix()}heard_{pass_id}.geojson",
                            vs.fc([{"type": "Feature",
                                    "properties": {"kind": "heard", "share": shares["heard_share"], "imaged": shares["imaged_share"],
                                                   "checkable": shares["checkable_share"], "standard": vs.CHECKABLE_FLOOR},
                                    "geometry": mapping(heard_shape.simplify(0.002))}]))
    unproven_url = vs.put_json(f"{vs.vessels_prefix()}unproven_{pass_id}.geojson",
                               vs.fc([{"type": "Feature", "properties": {"kind": "unproven"}, "geometry": mapping(unproven.simplify(0.002))}]))
    vs.put_json(_coverage_key(pass_id), {"pass_id": pass_id, **shares, "standard": vs.CHECKABLE_FLOOR,
                                         "cells": [[int(r), int(c)] for r, c in zip(*np.nonzero(received))],
                                         "question_id": stamp})
    return json.dumps({
        "pass_id": pass_id,
        "imaged_share": shares["imaged_share"], "imaged_pct": _pct(shares["imaged_share"]),
        "heard_share": shares["heard_share"], "heard_pct": _pct(shares["heard_share"]),
        "checkable_share": shares["checkable_share"], "checkable_pct": _pct(shares["checkable_share"]),
        "standard": vs.CHECKABLE_FLOOR, "standard_pct": _pct(vs.CHECKABLE_FLOOR),
        "unexplained": {"received": in_received, "unknown": len(unexplained) - in_received},
        "rule": "received: in one hour of the three either side of the pass, two or more different vessels' AIS "
                "received within 30 km",
        "heard_s3_url": heard_url, "unproven_s3_url": unproven_url,
        "heard_render": {"kind": "vector", "group": "maritime", "legend": "AIS received"},
        "unproven_render": {"kind": "vector", "group": "maritime", "legend": "AIS reception unknown"},
        "unproven_means": vs.RECEPTION_UNKNOWN,
        # Both areas, every time: the map shows where a missing broadcast proves nothing before any
        # target is called a candidate (gate A attempt 1 showed one area only, once in four runs).
        "next_steps": "Show both areas with your next call, as two display_visual calls: heard_s3_url with "
                      "heard_render, and unproven_s3_url with unproven_render; then judge this pass against the standard.",
    })


def _record(pass_id: str):
    return vs.get_record("coverage", pass_id)


@tool
async def match_ais(pass_id: str) -> str:
    """Match every target to AIS and give it one status: broadcasting (its AIS was received at the
    pass), port (at or near a port), unproven (reception unknown: no AIS, but reception there is
    unknown, so it proves nothing), seen_once (one detector only), or candidate (no AIS where AIS was
    being received, seen by both detectors). It refuses a pass that can check less of the reserve
    than the standard.

    Args:
        pass_id: From find_pass, after check_ais_coverage for the same pass, with both of its areas
            shown (display_visual of heard_s3_url and of unproven_s3_url).

    Returns: JSON with counts in the order to say them and the words to say each status in (say_as),
    checkable_share, the candidates (T01 west to east, with km to the nearest port), targets_s3_url
    (the same map layer, statuses changed in place), render, the fixed sentence, next_steps.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    refused = vs.require_read(pass_id)
    if refused:
        return json.dumps(refused)
    record = _record(pass_id)
    if record is None:
        return json.dumps({"error": "Run check_ais_coverage first: nothing is called a candidate before the coverage check."})
    stamp = vs.question_stamp()
    checkable = record.get("checkable_share")
    if record.get("question_id") != stamp or not isinstance(checkable, (int, float)) or isinstance(checkable, bool):
        return json.dumps({"error": "Run check_ais_coverage again for this question."})
    if checkable < vs.CHECKABLE_FLOOR:
        pct, std = _pct(checkable), _pct(vs.CHECKABLE_FLOOR)
        logger.info("match_ais: refused %s (under the standard)", pass_id)
        return json.dumps({"error": f"This pass can check only {pct}% of the reserve, under the {std}% standard: "
                                    "no target on it can be called a candidate.",
                           "checkable_pct": pct, "standard_pct": std})
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
    vs.put_json(_match_key(pass_id), {"pass_id": pass_id, "targets": targets, "question_id": stamp})
    counts = {s: sum(t["status"] == s for t in targets) for s in ("broadcasting", "port", "unproven", "seen_once", "candidate")}
    candidates = [{"id": t["label"], "port": t["port"], "port_km": t["port_km"], "nearest_ais_km": t["nearest_ais_km"]}
                  for t in targets if t["status"] == "candidate"]
    return json.dumps({
        "pass_id": pass_id, "counts": counts, "say_in_order": ["broadcasting", "port", "unproven", "seen_once", "candidate"],
        "say_as": SAY_AS, "checkable_share": checkable, "candidates": candidates, "targets_s3_url": url,
        "render": {"kind": "points", "group": "maritime", "legend": "Radar targets"},
        "fixed_sentence": vs.CANDIDATE_SENTENCE,
        "next_steps": NEXT_WITH_CANDIDATES if n else NEXT_NO_CANDIDATES,
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
    gallery), the confidence sentence, innocent explanations and say_else (them in one sentence),
    next_steps.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    match = vs.get_record("match", pass_id)
    if match is None:
        return json.dumps({"error": "Run match_ais first."})
    if match.get("question_id") != vs.question_stamp():
        return json.dumps({"error": STALE_RECORDS})
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
        "confidence": "Both detectors saw it in water where AIS was being received, and no broadcast came from it. "
                      "That makes it a candidate for a look, not a finding.",
        "innocent_explanations": INNOCENT, "say_else": vs.SAY_ELSE,
        "next_steps": "Look at one chip (inspect_image with chip_s3_url; a second only if the first is unclear) and "
                      "say what it shows. No vessel is named.",
    })
