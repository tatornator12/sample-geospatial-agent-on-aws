"""Methane Watch: which site the agent follows, as a validated decision (approved 2026-10-23).

The 90-day switch rule (Requirement 17):
  Step 1 (today's rule). Among the two cued sites (the top hotspot of each of the two strongest
  EMIT-visible watch areas; with one area scanned, its top two hotspots), follow the one with the
  newest confirmed close look: an EMIT candidate pass (the mirror test included) or a Carbon Mapper
  plume within 7 km. A tie goes to more EMIT candidate passes, then the higher peak. With neither,
  the stronger tip.
  Step 2. If that follow's latest confirmation is more than 90 days before the tip window starts
  (or there is none), check the top three hotspots the scan flagged in each of those areas; if any
  has a confirmation within 90 days, follow the freshest of them instead (a tie: the stronger tip);
  otherwise keep step 1's follow. 90 days is the threshold draft_brief already uses (GAP_DAYS).

The model makes the choice and says why with one enum (REASONS); follow_site computes the facts
from the session's own records (the tip manifests, the EMIT pass manifests, Carbon Mapper's
records) and refuses a choice they contradict, naming the fact, as draft_brief does. On a follow it
writes the stage's manifest (follow.json: enums, dates and numbers only) and hands back the two bar
layers for the followed site: this fortnight's TROPOMI cells around it (the tip bars) and its latest
fine-scale confirmation as columns (the record bars: EMIT's significant pixels or Carbon Mapper's
plume image).
"""
from __future__ import annotations

import json
import logging
from typing import Any

import _paths  # noqa: F401
from strands import tool

import config
import methane_tools as mt
from methane_tools import MethaneError, _finite

from follow_rule import (  # noqa: F401  (re-exported: tests and eval read the rule from here too)
    CM_FOLLOW_KM, GAP_DAYS, POINT_FILE, POINT_KM, RANKS_CHECKED, REASONS, TIP_KEY, _CM_FILE, _SCENE, _km, _num,
    attach_facts, cm_facts, cued_areas, days_before, emit_facts, follow_rule, nearest, parse_tip,
)

logger = logging.getLogger("methane_tools")
RANK_WORDS = {1: "top", 2: "second", 3: "third"}


def _get_json(s3, key: str, cap: int = 500_000) -> Any:
    return json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=key)["Body"].read(cap))


def _listing(s3, prefix: str) -> list[str]:
    keys, token = [], None
    while True:
        kwargs = {"Bucket": config.S3_BUCKET_NAME, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = s3.list_objects_v2(**kwargs)
        keys += [o["Key"] for o in page.get("Contents", [])]
        token = page.get("NextContinuationToken") if page.get("IsTruncated") else None
        if not token or len(keys) >= 2000:
            return keys


def site_facts(s3, prefix: str) -> tuple[list[dict], dict[tuple[str, int], dict]]:
    """(cued areas with their points, each point's records): what the rule and the guard read, from
    this session's tip, pass and Carbon Mapper manifests."""
    from watch_tools import WATCH_AREAS
    tips, passes, cms = [], [], []
    for key in _listing(s3, prefix):
        name = key.rsplit("/", 1)[-1]
        m = TIP_KEY.fullmatch(name)
        if m and m[1].replace("_", " ") in WATCH_AREAS:
            t = parse_tip(m[1].replace("_", " "), _safe_json(s3, key, 50_000))
            if t:
                tips.append(t)
            continue
        m = POINT_FILE.fullmatch(name)
        if m:
            (passes if m[1] == "passes" else cms).append((float(m[2]), float(m[3]), key))
    areas = cued_areas(tips)
    # Only the records near the points the rule reads are fetched.
    wanted = [(p["lat"], p["lon"]) for a in areas for p in a["points"]]
    load = lambda recs: [(a, b, _safe_json(s3, k, 500_000)) for a, b, k in recs   # noqa: E731
                         if any(_km(a, b, la, lo) <= POINT_KM for la, lo in wanted)]
    keys = {"passes": {(a, b): k for a, b, k in passes}, "cm": {(a, b): k for a, b, k in cms}}
    records = attach_facts(areas, load(passes), load(cms))
    for a in areas:
        for p in a["points"]:
            rec = records[(p["area"], p["rank"])]
            rec["passes_key"] = nearest([(x, y, k) for (x, y), k in keys["passes"].items()], p["lat"], p["lon"])
            rec["cm_key"] = nearest([(x, y, k) for (x, y), k in keys["cm"].items()], p["lat"], p["lon"])
    return areas, records


def _safe_json(s3, key: str, cap: int) -> Any:
    try:
        return _get_json(s3, key, cap)
    except Exception:
        return None


# --- the guard -----------------------------------------------------------------------------------

def where(p: dict, labels: dict[str, str]) -> str:
    rank = RANK_WORDS.get(p["rank"], f"#{p['rank']}")
    return f"the {labels[p['area']]} {rank} spot ({p['lat']:.4f}, {p['lon']:.4f})"


def confirmation(p: dict) -> str:
    latest = p.get("latest")
    if not latest:
        return "no confirmed close look"
    by = {"emit": "an EMIT candidate pass", "carbon_mapper": "a Carbon Mapper plume within 7 km",
          "both": "an EMIT candidate pass and a Carbon Mapper plume"}[latest["by"]]
    d = days_before(p["tip_start"], latest["date"])
    when = "inside the tip window" if d <= 0 else f"{d} days before the tip window starts ({p['tip_start']})"
    return f"{by} on {latest['date']}, {when}"


def missing_records(points: list[dict], records: dict) -> list[str]:
    out = []
    for p in points:
        r = records.get((p["area"], p["rank"])) or {}
        need = [n for n, k in (("check_recent_passes", "passes_key"), ("carbon_mapper_plumes", "cm_key")) if not r.get(k)]
        if need:
            out.append(f"{' and '.join(need)}({p['lat']}, {p['lon']})")
    return out


def judge(lat: float, lon: float, reason: str, areas: list[dict], records: dict, labels: dict[str, str]) -> tuple[dict | None, str | None]:
    """(the rule's outcome, None) when the model's follow fits the records; (None, why) otherwise."""
    cued = [a["points"][0] for a in areas] if len(areas) > 1 else areas[0]["points"][:2]
    gap = missing_records(cued, records)
    if gap:
        return None, ("The cued sites' records are not all in this session yet: call " + "; ".join(gap)
                      + " first, then follow_site again.")
    rule = follow_rule(areas)
    if rule["step2"]:
        gap = missing_records(rule["pool"], records)
        if gap:
            s1 = rule["step1"]
            why = (f"its latest confirmation is {confirmation(s1)}" if s1.get("latest")
                   else "neither cued site has a confirmed close look")
            return None, (f"Step 2 applies: the step 1 follow is {where(s1, labels)} and {why}, more than {GAP_DAYS} days "
                          f"or none. Check the top {RANKS_CHECKED} hotspots of each cued area first: "
                          + "; ".join(gap) + " (all in parallel), then follow_site again.")
    f = rule["followed"]
    chosen = min(rule["pool"] or rule["cued"], key=lambda p: _km(lat, lon, p["lat"], p["lon"]))
    facts = []
    if _km(lat, lon, f["lat"], f["lon"]) > POINT_KM:
        if _km(lat, lon, chosen["lat"], chosen["lon"]) > POINT_KM:
            facts.append(f"({lat}, {lon}) is not one of the hotspots the rule compares")
        else:
            facts.append(f"{where(chosen, labels)} has {confirmation(chosen)}")
        facts.append(f"the rule follows {where(f, labels)}, which has {confirmation(f)}")
    if reason != rule["reason"]:
        s1 = rule["step1"]
        facts.append(f"the step 1 follow, {where(s1, labels)}, has {confirmation(s1)}"
                     + ("" if rule["step2"] else f" (within {GAP_DAYS} days, so step 2 does not apply)"))
        if rule["step2"]:
            fresh = [p for p in rule["pool"] if p.get("latest") and days_before(p["tip_start"], p["latest"]["date"]) <= GAP_DAYS]
            facts.append(f"{len(fresh)} of the {len(rule['pool'])} hotspots checked has a confirmation within {GAP_DAYS} days"
                         if len(fresh) == 1 else
                         f"{len(fresh)} of the {len(rule['pool'])} hotspots checked have a confirmation within {GAP_DAYS} days")
    if facts:
        return None, (f"follow_site({lat}, {lon}, reason='{reason}') does not fit the record: " + "; ".join(facts)
                      + f". The record supports follow_site({f['lat']}, {f['lon']}, reason='{rule['reason']}'). "
                      "Call follow_site again with that, everything else unchanged.")
    return rule, None


# --- the stage's manifest and the bars -------------------------------------------------------------

RENDER_RECORD_EMIT = {"kind": "columns", "property": "ppm_m", "ramp": "plasma", "rescale": [0, 1500], "units": "ppm·m",
                      "group": "methane", "legend": "CH4 enhancement"}
RENDER_RECORD_CM = {"kind": "columns", "property": "ppm_m", "ramp": "plasma", "rescale": [0, 1500], "units": "ppm·m",
                    "group": "methane", "legend": "Carbon Mapper plume"}


def _exists(s3, key: str) -> bool:
    try:
        s3.head_object(Bucket=config.S3_BUCKET_NAME, Key=key)
        return True
    except Exception:
        return False


def emit_record_bars(s3, prefix: str, scene: str | None, lat: float, lon: float) -> str | None:
    """The session's columns file for an EMIT candidate (built from its cached significant pixels when
    check_recent_passes built another candidate's), or None."""
    if not scene or not _SCENE.fullmatch(scene):
        return None
    key = f"{prefix}columns_{scene}.geojson"
    if _exists(s3, key):
        return key
    from watch_tools import SCENE_CAP_BYTES, columns_geojson, pass_cache_base
    try:
        sig = s3.get_object(Bucket=config.S3_BUCKET_NAME,
                            Key=f"{pass_cache_base(scene, lat, lon)}_sig.tif")["Body"].read(SCENE_CAP_BYTES)
        mt._put_json(key, columns_geojson(sig))
        return key
    except Exception as e:
        logger.warning("record columns failed: %s", type(e).__name__)
        return None


def tip_bars(s3, prefix: str, p: dict) -> tuple[str | None, dict | None]:
    """The tip bars scan_tropomi wrote for this hotspot, and their render hint (from the file's own numbers)."""
    from watch_tools import tip_columns_key, tip_columns_render
    key = tip_columns_key(p["lat"], p["lon"])
    try:
        fc = _get_json(s3, key, 2_000_000)
    except Exception:
        return None, None
    feats = fc.get("features") if isinstance(fc, dict) else None
    peaks = [f["properties"]["ppb"] for f in feats or [] if isinstance(f, dict)
             and isinstance((f.get("properties") or {}).get("ppb"), (int, float))]
    return (key, tip_columns_render(max(peaks))) if peaks else (None, None)


def say_follow(rule: dict, labels: dict[str, str]) -> str:
    """The model's one sentence about the follow, written here from the facts (it is said word for word)."""
    f, s1 = rule["followed"], rule["step1"]

    def site(p):
        return f"the {labels[p['area']]} site" + ("" if p["rank"] == 1 else f"'s {RANK_WORDS[p['rank']]} hotspot")

    def det(p):
        latest = p.get("latest")
        if not latest:
            return "no confirmed detection since 2025-01-01"
        by = {"emit": "an EMIT candidate pass", "carbon_mapper": "a Carbon Mapper plume",
              "both": "an EMIT candidate pass and a Carbon Mapper plume"}[latest["by"]]
        d = days_before(p["tip_start"], latest["date"])
        return f"{by} on {latest['date']}, {'inside the tip window' if d <= 0 else f'{d} days before the tip window'}"

    others = [p for p in rule["cued"] if p is not s1]
    if rule["reason"] == "newest_confirmation":
        other = f", against {det(others[0])} at {site(others[0])}" if others else ""
        return f"Following {site(f)}: its latest confirmed detection is {det(f)}{other}."
    if rule["reason"] == "top_spot_stale_switched":
        return (f"Following {site(f)}: its latest confirmed detection is {det(f)}, while at {site(s1)} it is {det(s1)}, "
                f"more than {GAP_DAYS} days.")
    if rule["reason"] == "top_spot_stale_no_fresher":
        return (f"Following {site(f)}: its latest confirmed detection is {det(f)}, more than {GAP_DAYS} days, and none of "
                f"the {len(rule['pool'])} hotspots checked has one within {GAP_DAYS} days.")
    return (f"Following {site(f)}, the stronger tip at +{f['anomaly_ppb']:.1f} ppb: its latest confirmed detection is none "
            f"since 2025-01-01, and none of the {len(rule['pool'])} hotspots checked has one within {GAP_DAYS} days.")


def manifest(rule: dict, record: dict | None, tip_key: str | None) -> dict:
    """follow.json: what the stage words the decision and the bars from. Numbers, dates, enums, file names."""
    def pt(p):
        latest = p.get("latest")
        return {"area": p["area"], "rank": p["rank"], "lat": round(p["lat"], 4), "lon": round(p["lon"], 4),
                "anomaly_ppb": p["anomaly_ppb"],
                "latest": latest and {"date": latest["date"], "by": latest["by"]},
                "days_before_tip": days_before(p["tip_start"], latest["date"]) if latest else None}
    f = rule["followed"]
    return {"reason": rule["reason"], "basis": rule["basis"], "gap_days": GAP_DAYS,
            "tip": {"start": f["tip_start"], "end": f["tip_end"]},
            "step1": pt(rule["step1"]), "followed": pt(f),
            "checked": len(rule["pool"]) - len(rule["cued"]) if rule["step2"] else 0,
            "tip_bars": tip_key and {"file": tip_key.rsplit("/", 1)[-1]},
            "record_bars": record}


@tool
@mt.offload
async def follow_site(lat: float, lon: float, reason: str) -> str:
    """Follow one site: your choice by the 90-day switch rule, checked against the session's records.

    Step 1: among the two cued sites, the one whose latest confirmed detection (latest_confirmed in
    carbon_mapper_plumes) is the most recent; with neither confirmed, the stronger tip. Step 2, only
    when that follow's latest confirmation is more than 90 days before the tip window starts (or there
    is none; carbon_mapper_plumes says within_90_days): check_recent_passes and carbon_mapper_plumes at
    the scan's hotspots ranked 2 and 3 in each cued area, then follow the freshest confirmation within
    90 days among them, or keep step 1's follow when none has one.

    Args:
        lat, lon: The hotspot you follow, exactly as the scan gave it.
        reason: "newest_confirmation" (step 1's follow, confirmed within 90 days), "top_spot_stale_switched"
            (step 1's follow was older than 90 days or unconfirmed; another checked hotspot has a
            confirmation within 90 days), "top_spot_stale_no_fresher" (step 1's follow has a confirmation
            older than 90 days and no checked hotspot has a fresher one within 90 days), "stronger_tip"
            (neither cued site has a confirmation and no checked hotspot has one within 90 days).

    Returns: JSON with follow (area, rank, lat, lon, latest_confirmed with days_before_tip), say (the
    sentence to say, word for word), tip_columns_s3_url + render_tip_columns (this fortnight's TROPOMI
    cells around the site, as 3D bars), record (the latest confirmation: by, date, days_before_tip) with
    record_columns_s3_url + render_record_columns (its bars) and, for EMIT, record_window_s3_url (the
    candidate's window to look at first), next_steps. If the choice does not fit the record, an error
    naming the fact: fix exactly that and call again.
    """
    from watch_tools import WATCH_AREAS
    try:
        lat, lon = _finite(lat, "lat", -90, 90), _finite(lon, "lon", -180, 180)
        if reason not in REASONS:
            raise MethaneError(f"reason must be one of: {', '.join(REASONS)}")
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    s3, prefix = mt._s3(), mt.session_prefix()
    try:
        areas, records = site_facts(s3, prefix)
    except Exception as e:
        logger.warning("follow facts failed: %s", type(e).__name__)
        return json.dumps({"error": "The session's records could not be read; try follow_site again."})
    if not areas:
        return json.dumps({"error": "No EMIT-visible watch area has been scanned this session: scan_tropomi first."})
    labels = {k: v["label"] for k, v in WATCH_AREAS.items()}
    rule, problem = judge(lat, lon, reason, areas, records, labels)
    if problem:
        return json.dumps({"error": problem})
    f = rule["followed"]
    rec = records[(f["area"], f["rank"])]
    tip_key, render_tip = tip_bars(s3, prefix, f)
    latest = f.get("latest")
    record, record_key, window_key, render_record = None, None, None, None
    if latest and latest["by"] in ("emit", "both"):
        scene = (rec["emit"] or {}).get("latest_scene")
        record_key = emit_record_bars(s3, prefix, scene, f["lat"], f["lon"])
        if record_key:
            window = f"{prefix}pass_{scene}.tif"
            window_key = window if _exists(s3, window) else None
            render_record = {**mt.scaled(RENDER_RECORD_EMIT, (rec["emit"] or {}).get("peak_ppm_m"))}
            record = {"by": "emit", "date": latest["date"], "file": record_key.rsplit("/", 1)[-1],
                      "days_before_tip": days_before(f["tip_start"], latest["date"])}
    elif latest and latest["by"] == "carbon_mapper":
        image = (rec["cm"] or {}).get("image")
        if image and _exists(s3, f"{prefix}{image['file']}"):
            record_key = f"{prefix}{image['file']}"
            render_record = RENDER_RECORD_CM
            record = {"by": "carbon_mapper", "date": image["date"], "file": image["file"],
                      "days_before_tip": days_before(f["tip_start"], image["date"])}
    try:
        mt._put_json(f"{prefix}follow.json", manifest(rule, record, tip_key))
    except Exception as e:  # the stage's words are decoration: never fail the follow for it
        logger.warning("follow manifest failed: %s", type(e).__name__)
    bucket = config.S3_BUCKET_NAME
    out: dict[str, Any] = {
        "follow": {"area": f["area"], "label": labels[f["area"]], "rank": f["rank"], "lat": f["lat"], "lon": f["lon"],
                   "anomaly_ppb": f["anomaly_ppb"], "reason": rule["reason"],
                   "latest_confirmed": latest and {**latest, "days_before_tip": days_before(f["tip_start"], latest["date"])}},
        "switched": rule["reason"] == "top_spot_stale_switched",
        "say": say_follow(rule, labels),
    }
    steps = []
    if tip_key:
        out.update(tip_columns_s3_url=f"s3://{bucket}/{tip_key}", render_tip_columns=render_tip)
        steps.append("display_visual(tip_columns_s3_url, render=render_tip_columns): ONE display, in the same response "
                     "as the ground-record checks and nothing else on the map")
    if record:
        out["record"] = {k: record[k] for k in ("by", "date", "days_before_tip")}
        out.update(record_columns_s3_url=f"s3://{bucket}/{record_key}", render_record_columns=render_record)
        if window_key:
            out["record_window_s3_url"] = f"s3://{bucket}/{window_key}"
            steps.append("inspect_image(record_window_s3_url) and say one sentence on the shape")
        steps.append("display_visual(record_columns_s3_url, render=render_record_columns) in its own response with "
                     "get_rasters: the close-look bars replace this fortnight's bars")
    elif latest:
        out["record"] = None
        steps.append("the latest confirmation's bars are not available: this fortnight's bars stay")
    else:
        steps.append("no confirmation: this fortnight's bars stay")
    out["next_steps"] = "Say `say` word for word. Then " + "; then ".join(steps) + "."
    logger.info("FOLLOW: %s #%d (%s), record %s", f["area"], f["rank"], rule["reason"], record and record["by"])
    return json.dumps(out)
