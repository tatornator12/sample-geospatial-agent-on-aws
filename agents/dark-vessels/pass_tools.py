"""Dark Vessels, the radar: find a pass on file and the targets on the water (design component 2)."""
from __future__ import annotations

import json
import logging
import re

from strands import tool

import vessel_store as vs

logger = logging.getLogger(__name__)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _resolve(when: str) -> dict | None:
    """'latest' (the star), a pass id, or a date (YYYY-MM-DD) to a pass on file."""
    when = (when or "latest").strip().lower()
    if when in ("latest", "newest", "today", "star"):
        return next(p for p in vs.passes() if p["role"] == "star")
    if vs.PASS_ID_RE.fullmatch(when):
        return vs.pass_entry(when)
    if DATE_RE.fullmatch(when):
        return next((p for p in vs.passes() if p["sensed"].startswith(when)), None)
    return None


def _built(pass_id: str) -> dict | None:
    return vs.manifest().get("passes", {}).get(pass_id)


@tool
async def find_pass(when: str = "latest") -> str:
    """Find a Sentinel-1 radar pass over the Galápagos Marine Reserve on file and put its image in the
    session for the map and your eyes.

    Args:
        when: "latest" (the newest pass with candidates on file), a date "YYYY-MM-DD", or a pass id
            from a previous answer (e.g. "s1d-20261012t0018").

    Returns: JSON with pass_id, satellite, sensed (UTC), orbit, reserve_share (of the reserve the pass
    saw), s3_url (the radar image), render (pass it to display_visual unchanged), source, next_steps.
    Only passes on file: the radar was read ahead of time, never live.
    """
    entry = _resolve(when)
    if entry is None:
        return vs.refusal()
    built = _built(entry["pass_id"])
    if not built:
        return json.dumps({"error": f"The radar for {entry['pass_id']} is not built (scripts/build_vessel_cache.py)."})
    pid = entry["pass_id"]
    key = f"{vs.vessels_prefix()}radar_{pid}.tif"
    try:
        url = vs.copy_into_session(built["products"]["display"]["key"], key)
    except Exception as e:
        logger.warning("find_pass copy failed for %s: %s", pid, type(e).__name__)
        return json.dumps({"error": f"The radar image for {pid} is missing from the cache (scripts/build_vessel_cache.py)."})
    return json.dumps({
        "pass_id": pid, "role": entry["role"], "satellite": entry.get("satellite", "Sentinel-1"),
        "sensed": entry["sensed"], "sensed_text": vs.nice_time(entry["sensed"]),
        "orbit": f"{entry.get('orbit_state', '')} orbit {entry.get('relative_orbit')}".strip(),
        "reserve_share": entry.get("reserve_share"), "s3_url": url,
        "render": {"kind": "raster", "colormap": "gray", "rescale": [1, 255], "group": "maritime",
                   "legend": "Radar backscatter", "bounds": built["bounds"]},
        "source": "Copernicus Sentinel-1 (ESA), VV, read ahead of time from Microsoft Planetary Computer",
        "next_steps": "inspect_image(s3_url) and say what you see in one sentence; then display_visual(s3_url, "
                      "render=render) in the same response as detect_vessels(pass_id).",
    })


def targets_for(pass_id: str) -> list[dict]:
    """The pass's targets inside the reserve: our detector's and GFW's, one per pair, with source,
    port distance and both readings. West to east."""
    built = _built(pass_id)
    data = vs.cached(built["products"]["targets"]["key"])
    ours = {o["id"]: o for o in data["ours"]}
    out = []
    used = set()
    for g in data["gfw"]:
        o = ours.get(g.get("ours"))
        if o:
            used.add(o["id"])
        lon, lat = (g["lon"], g["lat"]) if not o else ((g["lon"] + o["lon"]) / 2, (g["lat"] + o["lat"]) / 2)
        out.append({"lon": lon, "lat": lat, "source": "both" if o else "gfw", "gfw_id": g["id"], "ours_id": o["id"] if o else None,
                    "gfw_matched": g["matched"], "gfw_n": g.get("n", 1), "pair_km": g.get("pair_km"),
                    "peak_db": o["peak_db"] if o else None, "area_m2": o["area_m2"] if o else None})
    for o in data["ours"]:
        if o["id"] not in used:
            out.append({"lon": o["lon"], "lat": o["lat"], "source": "ours", "gfw_id": None, "ours_id": o["id"],
                        "gfw_matched": None, "gfw_n": 0, "pair_km": None, "peak_db": o["peak_db"], "area_m2": o["area_m2"]})
    out = [t for t in out if vs.in_reserve(t["lon"], t["lat"])]
    for t in out:
        t["port"], t["port_km"] = vs.nearest_port(t["lon"], t["lat"])
        t["status"] = "port" if t["port_km"] < vs.PORT_KM else "detected"
    out.sort(key=lambda t: t["lon"])
    return out


def claim_targets(pass_id: str, targets: list[dict]) -> None:
    """The claim, in place: each target a broadcast accounts for at the pass minute (GFW matched it,
    or it is ours alone with an AIS position within 1 km) is `claimed`, with the hairline's far end
    (`claim`, the AIS position) when that is within 5 km. It is the same rule match_ais uses for
    "broadcasting"; nothing here calls anything dark: the left-alone targets stay plain."""
    built = _built(pass_id)
    entry = vs.pass_entry(pass_id)
    try:
        replay = vs.cached(built["products"]["replay"]["key"])
    except Exception as e:
        logger.warning("detect_vessels: no replay for %s (%s); no claims drawn", pass_id, type(e).__name__)
        return
    heads = vs.heads_at(replay, vs.parse_t(entry["sensed"]))
    for t in targets:
        near, near_km = vs.nearest_head(t, heads)
        if vs.broadcasts(t, near_km):
            t["claimed"] = True
            if near_km <= vs.CLAIM_KM:
                t["claim"] = [round(near["lon"], 5), round(near["lat"], 5)]


def target_features(targets: list[dict]) -> dict:
    feats = []
    for t in targets:
        props = {k: t[k] for k in ("status", "source", "port_km") if k in t}
        for k in ("label", "claimed", "claim", "pair_km", "peak_db", "heard"):
            if t.get(k) is not None:
                props[k] = t[k]
        feats.append(vs.point(t["lon"], t["lat"], **props))
    return vs.fc(feats)


@tool
async def detect_vessels(pass_id: str) -> str:
    """Find every vessel-sized target on the water in a pass: our own detector (a CA-CFAR on the radar)
    and Global Fishing Watch's detections of the same pass, side by side, inside the reserve.

    Args:
        pass_id: From find_pass.

    Returns: JSON with counts (ours, gfw, both within 1 km, port: moored or near the five ports,
    claimed_by_ais: a broadcast at the pass minute accounts for them), targets_s3_url (the targets for
    the map), render (pass it to display_visual unchanged), attribution, next_steps. Nothing is called
    dark here: that waits for check_ais_coverage and match_ais.
    """
    entry = vs.pass_entry(pass_id)
    if entry is None:
        return vs.refusal()
    if not _built(pass_id):
        return json.dumps({"error": f"The targets for {pass_id} are not built (scripts/build_vessel_cache.py)."})
    targets = targets_for(pass_id)
    claim_targets(pass_id, targets)
    url = vs.put_json(f"{vs.vessels_prefix()}targets_{pass_id}.geojson", target_features(targets))
    counts = {"ours": sum(t["source"] in ("ours", "both") for t in targets),
              "gfw": sum(t["source"] in ("gfw", "both") for t in targets),
              "both": sum(t["source"] == "both" for t in targets),
              "port": sum(t["status"] == "port" for t in targets),
              "claimed_by_ais": sum(bool(t.get("claimed")) for t in targets),
              "targets": len(targets)}
    return json.dumps({
        "pass_id": pass_id, "counts": counts, "targets_s3_url": url,
        "render": {"kind": "points", "group": "maritime", "legend": "Radar targets"},
        "detectors": "ours: a two-parameter CA-CFAR on the VV radar at 20 m; GFW: its public SAR vessel detections "
                     "(larger vessels); a pair is one of each within 1 km",
        "attribution": vs.ATTRIBUTION,
        "next_steps": "display_visual(targets_s3_url, render=render) in the same response as check_ais_coverage(pass_id). "
                      "Say the counts in one sentence; say 'data from Global Fishing Watch' once.",
    })
