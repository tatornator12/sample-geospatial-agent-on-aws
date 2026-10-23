"""The Methane Watch follow rule, pure (no AWS, no network): the 90-day switch rule over plain dicts,
and the parsing of the session's records it reads (tip, pass and Carbon Mapper manifests).

follow_tools.follow_site runs it on the session's records as its guard; scripts/eval.py runs it on a
finished mission's records to check the agent's follow against the facts (golden `follow_check`);
tests/test_follow.py runs it on the options report's 20 boards. Approved 2026-10-23 (Requirement 17).
"""
from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

GAP_DAYS = 90                       # brief_tools.GAP_DAYS: the same threshold, said once
RANKS_CHECKED = 3                   # step 2 reads the scan's top three hotspots per cued area
REASONS = ("newest_confirmation", "stronger_tip", "top_spot_stale_switched", "top_spot_stale_no_fresher")
POINT_KM = 1.0                      # a record belongs to a hotspot when written within 1 km of it
CM_FOLLOW_KM = 7.0                  # carbon_mapper.CM_RADIUS_KM: one TROPOMI footprint

_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIP_KEY = re.compile(r"^tip_([a-z_]{3,40})\.json$")
POINT_FILE = re.compile(r"^(passes|cmplumes)_(-?\d+\.\d{4})_(-?\d+\.\d{4})\.json$")
_SCENE = re.compile(r"^EMIT_L2B_CH4ENH_(?:002_\d{8}T\d{6}_\d{7}_\d{3}|003_\d{8}T\d{6})$")
_CHIP_SCENE = re.compile(r"^passchip_(EMIT_L2B_CH4ENH_[A-Za-z0-9_]{1,60})\.png$")
_CM_FILE = re.compile(r"^cmcolumns_[A-Za-z0-9_.-]{1,80}\.geojson$")


# --- the rule, as a pure function (tests and the 20-board check run it on plain dicts) -------------

def days_before(tip_start: str, day: str) -> int:
    """Whole days from `day` to the tip window's first day (negative: inside or after it)."""
    return (date.fromisoformat(tip_start) - date.fromisoformat(day)).days


def _fresh(p: dict) -> int | None:
    latest = p.get("latest")
    return days_before(p["tip_start"], latest["date"]) if latest else None


def follow_rule(areas: list[dict]) -> dict:
    """The follow, by the two-step rule. `areas`: the cued areas, strongest tip first, each
    {"area", "points": [hotspot rank 1, 2, 3 ...]}; a point is {"area", "rank", "lat", "lon",
    "anomaly_ppb", "tip_start", "latest": {"date", "by"} | None, "emit_candidates", "peak_ppm_m"}.
    With one area, its top two hotspots are the cued pair.

    Returns {"cued", "step1", "basis", "step1_days", "step2", "pool", "followed", "followed_days",
    "reason"}."""
    if not areas or not areas[0]["points"]:
        raise ValueError("no cued area")
    cued = [a["points"][0] for a in areas[:2] if a["points"]]
    if len(areas) == 1:
        cued = areas[0]["points"][:2]
    confirmed = [p for p in cued if p.get("latest")]
    if confirmed:
        step1 = max(confirmed, key=lambda p: (p["latest"]["date"], p.get("emit_candidates") or 0, p.get("peak_ppm_m") or 0))
        basis = "newest_confirmation"
    else:
        step1 = max(cued, key=lambda p: p.get("anomaly_ppb") or -math.inf)
        basis = "stronger_tip"
    step1_days = _fresh(step1)
    out = {"cued": cued, "step1": step1, "basis": basis, "step1_days": step1_days, "step2": False, "pool": [],
           "followed": step1, "followed_days": step1_days, "reason": "newest_confirmation"}
    if step1_days is not None and step1_days <= GAP_DAYS:
        return out
    pool = [p for a in areas[:2] for p in a["points"][:RANKS_CHECKED]]
    fresh = [p for p in pool if _fresh(p) is not None and _fresh(p) <= GAP_DAYS]
    out.update(step2=True, pool=pool)
    if fresh:
        best = max(fresh, key=lambda p: (p["latest"]["date"], p.get("anomaly_ppb") or -math.inf))
        out.update(followed=best, followed_days=_fresh(best), reason="top_spot_stale_switched")
    else:
        out["reason"] = "top_spot_stale_no_fresher" if basis == "newest_confirmation" else "stronger_tip"
    return out


def _num(value, lo: float, hi: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value) if lo <= value <= hi else None


def _km(lat1, lon1, lat2, lon2) -> float:
    return math.hypot((lat1 - lat2) * 110.574, (lon1 - lon2) * 111.320 * math.cos(math.radians((lat1 + lat2) / 2)))


def parse_tip(area: str, raw: Any) -> dict | None:
    """One tip manifest, field by field: the window, whether EMIT can look, the top three hotspots."""
    if not isinstance(raw, dict) or raw.get("area") != area:
        return None
    start, end = raw.get("start"), raw.get("end")
    if not (isinstance(start, str) and _DAY.fullmatch(start) and isinstance(end, str) and _DAY.fullmatch(end)):
        return None
    spots = raw.get("hotspots") if isinstance(raw.get("hotspots"), list) else [raw.get("top")]
    points = []
    for i, h in enumerate(spots[:RANKS_CHECKED], start=1):
        if not isinstance(h, dict):
            continue
        lat, lon = _num(h.get("lat"), -90, 90), _num(h.get("lon"), -180, 180)
        ppb = _num(h.get("anomaly_ppb"), -1000, 1000)
        if lat is None or lon is None or ppb is None:
            continue
        rank = h.get("rank") if isinstance(h.get("rank"), int) and not isinstance(h.get("rank"), bool) else i
        points.append({"area": area, "rank": rank, "lat": lat, "lon": lon, "anomaly_ppb": ppb, "tip_start": start,
                       "tip_end": end, "emit_can_look": h.get("emit_can_look") is not False})
    return {"area": area, "start": start, "end": end, "emit": raw.get("emit_can_look") is True, "points": points}


def cued_areas(tips: list[dict]) -> list[dict]:
    """The two strongest EMIT-visible areas by their top hotspot (the W3 cue), strongest first."""
    visible = [t for t in tips if t["emit"] and t["points"] and t["points"][0]["emit_can_look"]]
    return sorted(visible, key=lambda t: -t["points"][0]["anomaly_ppb"])[:2]


def nearest(records: list[tuple[float, float, Any]], lat: float, lon: float) -> Any:
    """The record written nearest the point, within POINT_KM; None when there is none."""
    best = min(((_km(lat, lon, a, b), i) for i, (a, b, _) in enumerate(records)), default=None)
    return records[best[1]][2] if best and best[0] <= POINT_KM else None


def emit_facts(raw: Any) -> dict | None:
    """A pass manifest's candidates: count, newest candidate (date and scene), peak."""
    if not isinstance(raw, dict) or not isinstance(raw.get("passes"), list):
        return None
    cands = []
    for p in raw["passes"][:40]:
        if not isinstance(p, dict) or p.get("verdict") != "candidate":
            continue
        day = p.get("date")
        if not (isinstance(day, str) and _DAY.fullmatch(day)):
            continue
        scene = p.get("scene_id") if isinstance(p.get("scene_id"), str) and _SCENE.fullmatch(p["scene_id"]) else None
        if not scene and isinstance(p.get("chip"), str):
            m = _CHIP_SCENE.fullmatch(p["chip"])
            scene = m[1] if m and _SCENE.fullmatch(m[1]) else None
        cands.append({"date": day, "scene_id": scene, "peak": _num(p.get("peak_ppm_m"), -1e6, 1e6)})
    newest = max(cands, key=lambda c: c["date"], default=None)
    peaks = [c["peak"] for c in cands if c["peak"] is not None]
    return {"read": len(raw["passes"]), "candidates": len(cands), "latest": newest and newest["date"],
            "latest_scene": newest and newest["scene_id"], "peak_ppm_m": max(peaks) if peaks else None}


def cm_facts(raw: Any) -> dict | None:
    """A Carbon Mapper record's newest plume within 7 km and its image (numbers, dates and a file name)."""
    if not isinstance(raw, dict):
        return None
    if raw.get("status") == "unavailable":
        return {"latest": None, "unavailable": True, "image": None}
    radius = _num(raw.get("follow_radius_km"), 0.5, 10) or CM_FOLLOW_KM
    days = [d["date"] for d in (raw.get("dates") or [])[:60]
            if isinstance(d, dict) and isinstance(d.get("date"), str) and _DAY.fullmatch(d["date"])
            and _num(d.get("distance_km"), 0, radius) is not None]
    image = raw.get("image") if isinstance(raw.get("image"), dict) else None
    if image and not (isinstance(image.get("file"), str) and _CM_FILE.fullmatch(image["file"])
                      and isinstance(image.get("date"), str) and _DAY.fullmatch(image["date"])):
        image = None
    return {"latest": max(days, default=None), "unavailable": False,
            "image": image and {"file": image["file"], "date": image["date"],
                                "pixels": int(image["pixels"]) if isinstance(image.get("pixels"), int) else None,
                                "distance_km": _num(image.get("distance_km"), 0, 10)}}


def latest_code(emit_latest: str | None, cm_latest: str | None) -> dict | None:
    """The newer confirmation as data: {date, by: emit | carbon_mapper | both} (carbon_mapper.latest_confirmed_code)."""
    if not emit_latest and not cm_latest:
        return None
    if emit_latest and cm_latest and emit_latest == cm_latest:
        return {"date": emit_latest, "by": "both"}
    if emit_latest and (not cm_latest or emit_latest > cm_latest):
        return {"date": emit_latest, "by": "emit"}
    return {"date": cm_latest, "by": "carbon_mapper"}


def attach_facts(areas: list[dict], passes: list[tuple[float, float, Any]],
                 cm: list[tuple[float, float, Any]]) -> dict[tuple[str, int], dict]:
    """Each point's records (raw manifests by position) parsed onto it: latest confirmation, EMIT
    candidates, peak. Returns the per-point records ({emit, cm, has_passes, has_cm})."""
    out: dict[tuple[str, int], dict] = {}
    for a in areas:
        for p in a["points"]:
            pr, cr = nearest(passes, p["lat"], p["lon"]), nearest(cm, p["lat"], p["lon"])
            emit = emit_facts(pr) if pr is not None else None
            cmf = cm_facts(cr) if cr is not None else None
            p.update(latest=latest_code((emit or {}).get("latest"), (cmf or {}).get("latest")),
                     emit_candidates=(emit or {}).get("candidates") or 0, peak_ppm_m=(emit or {}).get("peak_ppm_m"))
            out[(p["area"], p["rank"])] = {"emit": emit, "cm": cmf, "has_passes": pr is not None, "has_cm": cr is not None}
    return out


def rule_from_files(files: dict[str, Any], areas_known) -> tuple[dict | None, dict]:
    """The rule over a mission's records by file name (tip_*.json, passes_*.json, cmplumes_*.json), as
    eval reads them from S3: (the rule's outcome or None without a cued area, per-point records)."""
    tips, passes, cms = [], [], []
    for name, raw in files.items():
        m = TIP_KEY.fullmatch(name)
        if m and (areas_known is None or m[1].replace("_", " ") in areas_known):
            t = parse_tip(m[1].replace("_", " "), raw)
            if t:
                tips.append(t)
        m = POINT_FILE.fullmatch(name)
        if m:
            (passes if m[1] == "passes" else cms).append((float(m[2]), float(m[3]), raw))
    areas = cued_areas(tips)
    if not areas:
        return None, {}
    records = attach_facts(areas, passes, cms)
    return follow_rule(areas), records
