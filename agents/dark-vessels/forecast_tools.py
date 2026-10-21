"""Dark Vessels, the predictions and the looks: where dark targets will be (the hotspot map with its
measured check and patrol boxes), the squid fleet's season, when the radar looks again, and where a
silent vessel could have gone (design components 5 to 8). Every prediction ships with its check on
data it did not see; nothing here is a trained model."""
from __future__ import annotations

import json
import logging
import urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
from rasterio import features
from rasterio.transform import from_origin
from shapely.geometry import box as shp_box
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from strands import tool

import plan as P
import predict as R
import reach as RE
import vessel_store as vs

logger = logging.getLogger(__name__)

SPREAD = 1                   # each cell's count spread over its eight neighbours
BOX_CELLS = 4                # patrol boxes of 4 x 4 cells (0.2 deg, about 22 km)
N_BOXES = 3
NEAR_KM = 5.0                # a candidate inside a box or this close to it is near it
HOLD_OUT_MONTHS = 3          # the check holds out the latest whole months to the newest day
PLAN_MAX_AGE = timedelta(hours=24)
PLAN_REFRESH_S = 8
LISTING = "https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-1/acquisition-plans"
HOST = "https://sentinels.copernicus.eu"
NEAR_GALAPAGOS_LAT = -8.0    # the fleet's zones: north of 8 S, off Peru 8 to 20 S, off Chile south of 20 S
PERU_CHILE_LAT = -20.0
SEASON_MIN_HOURS = 1000.0    # a month counts as the fleet being near the Galápagos above this
REACH_STEP = 0.01
RADAR_BOX = (-94.0, -2.5, -88.0, 2.5)
MIN_SPEED_KN = 6.0


def _history() -> dict:
    return vs.cached(vs.manifest()["history"]["key"])


def _dark(history: dict) -> list[R.Detection]:
    out = []
    for day, lon, lat, n, port_km in history["dark"]["rows"]:
        if port_km >= vs.PORT_KM:
            out.append(R.Detection(lon, lat, date.fromisoformat(day), int(n)))
    return out


def _months_back(d: date, months: int) -> date:
    y, m = d.year, d.month - months
    while m <= 0:
        y, m = y - 1, m + 12
    return date(y, m, 1)


# --- the plan ----------------------------------------------------------------------------------

_plan_cache: dict = {}


def _now() -> datetime:
    """The clock (patched in tests, so a fixture plan stays in the future)."""
    return datetime.now(timezone.utc)


def plan_takes() -> tuple[list, dict]:
    """The newest plans' takes and where they came from: the cached plans, refreshed from ESA once
    (8 s) when they are more than 24 h old; on failure, the cached plans with their date."""
    now = _now()
    if _plan_cache.get("at") and now - _plan_cache["at"] < timedelta(minutes=10):
        return _plan_cache["takes"], _plan_cache["source"]
    latest = vs.get_json(f"{vs.PLAN_PREFIX}/latest.json")
    fetched = datetime.fromisoformat(latest["fetched_at"].replace("Z", "+00:00"))
    takes, source = [], {"fetched_at": latest["fetched_at"], "refreshed": False, "plans": {}}
    if now - fetched > PLAN_MAX_AGE:
        try:
            html = urllib.request.urlopen(urllib.request.Request(LISTING, headers={"User-Agent": "agentic-ai-for-earth-demo"}),
                                          timeout=PLAN_REFRESH_S).read().decode("utf-8", "replace")
            # The newest plan per satellite and any older one still running past it (plan_chain).
            for sat, paths in P.plan_chain(html, now).items():
                chain = [P.parse_plan(urllib.request.urlopen(HOST + path, timeout=PLAN_REFRESH_S).read()) for path in paths]
                takes += P.merge_takes(chain)
                end = max(period[1] for period, _ in chain if period)
                source["plans"][sat] = {"name": " + ".join(p.rsplit("/", 1)[1] for p in paths), "to": end.strftime("%Y-%m-%dT%H:%MZ")}
            source.update(refreshed=True, fetched_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
        except Exception as e:
            logger.warning("next_look: the plan refresh failed (%s); using the cached plans", type(e).__name__)
            takes, source["plans"] = [], {}
    if not takes:
        for sat, p in latest["plans"].items():
            chain = []
            for c in p.get("chain") or [p]:      # latest.json before Oct 19 named one plan per satellite
                body = vs._s3().get_object(Bucket=vs.config.S3_BUCKET_NAME, Key=c["key"])["Body"].read()
                chain.append(P.parse_plan(body))
            takes += P.merge_takes(chain)
            source["plans"][sat] = {"name": " + ".join(c["name"] for c in p.get("chain") or [p]), "to": p["period"][1]}
    _plan_cache.update(at=now, takes=takes, source=source)
    return takes, source


def looks_over(area, after: datetime | None = None, limit: int = 3) -> list[dict]:
    takes, _ = plan_takes()
    after = after or _now()
    out = []
    for lk in P.next_looks(takes, area, after=after, min_share=0.2, limit=limit):
        d = lk.as_dict()
        d["footprint"] = mapping(lk.take.footprint)
        out.append(d)
    return out


def _look_line(lk: dict) -> str:
    t = datetime.fromisoformat(lk["start"].replace("Z", "+00:00"))
    return f"{lk['satellite'][:2]}-{lk['satellite'][2:]} {t:%b} {t.day} {t:%H:%M} UTC"


# --- prediction one: where dark targets will be ------------------------------------------------

def times(lift: float) -> str:
    """A times-chance the room can hear: whole above 10 ("14"), one decimal below ("5.7"), no ".0" ("9")."""
    text = f"{lift:.0f}" if lift >= 10 else f"{lift:.1f}"
    return text[:-2] if text.endswith(".0") else text


def rolling_say(since: date, pct: int, times_text: str) -> str:
    """The check for the answer (22 words), the way it was measured."""
    return (f"Refitted before each radar day since {since:%B}, the map's top 5% of water held {pct}% of the dark "
            f"targets, {times_text} times chance.")


def boxes_say(pct: int, times_text: str) -> str:
    """The boxes' own record (17 words), said only when the presenter asks about the boxes."""
    return f"Refitted the same way, the three patrol boxes held {pct}% of the dark targets, {times_text} times chance."


def no_check_say(since: date) -> str:
    return f"No dark targets were found from {since:%B} {since.day}, {since:%Y}, so the map's check cannot be measured."


def _km_to_box(lon: float, lat: float, bounds) -> float:
    """0 inside the box, else the km to its nearest edge."""
    w, s, e, n = bounds
    return vs.km((lon, lat), (min(max(lon, w), e), min(max(lat, s), n)))


@tool
async def predict_hotspots(pass_id: str = "") -> str:
    """Where to look next: a map of where radar targets with no AIS were seen in the reserve before
    (away from the five ports), with its measured check: before each radar day of the latest three
    months the map was refitted on everything before that day, then that day's dark targets were
    counted in its top 5% of the water and in the three patrol boxes drawn the same way, against
    what that much water holds by chance. Then three patrol boxes (about 22 km) and the next planned
    radar look over each.

    Args:
        pass_id: OPTIONAL the pass read for this question; each box then carries candidates_near, that
            pass's candidates inside the box or within 5 km of it.

    Returns: JSON with rolling (the check's numbers), say (the check in one sentence, word for word),
    say_boxes (the boxes' own record, only when asked about the boxes), boxes (box, share of past dark
    targets, next look, candidates_near), heat_s3_url and boxes_s3_url with render hints (pass them to
    display_visual unchanged), next_steps.
    """
    if pass_id and vs.pass_entry(pass_id) is None:
        return vs.refusal()
    history = _history()
    dets = _dark(history)
    grid, water = vs.reserve_grid()
    until = date.fromisoformat(history["until"])
    cut = _months_back(until, HOLD_OUT_MONTHS)
    # Today's single hold-out stays in the record (and the draft); the room hears the rolling check.
    checks = R.backtest(dets, grid, cut=cut, until=until, shares=(0.01, 0.05, 0.10), spread=SPREAD, water=water)
    rc = R.rolling_check(dets, grid, since=cut, until=until, share=0.05, spread=SPREAD, water=water,
                         box_cells=BOX_CELLS, n_boxes=N_BOXES)
    score = R.surface(dets, grid, before=until, spread=SPREAD, water=water)
    boxes = R.patrol_boxes(score, grid, size=BOX_CELLS, k=N_BOXES)
    stamp = vs.question_stamp()
    cands = []
    if pass_id:
        match = vs.get_record("match", pass_id)
        if match is not None and match.get("question_id") == stamp:
            cands = [(t["lon"], t["lat"]) for t in match.get("targets", []) if t.get("status") == "candidate"]
    measured = rc.total > 0
    pct, bpct = round(rc.hit * 100), round(rc.boxes_hit * 100)
    mx = float(score.max()) or 1.0
    heat = [vs.point(grid.west + (c + 0.5) * grid.step, grid.south + (r + 0.5) * grid.step, v=round(float(score[r, c]) / mx, 3))
            for r, c in zip(*np.nonzero(score / mx > 0.02))]
    if heat:
        # The top 5% figure rides on the heat (as the received share rides on the coverage), the
        # boxes' figure on the boxes: each beside its own layer.
        heat[0]["properties"].update(check_pct=pct if measured else None, check_times=round(rc.lift, 1) if measured else None,
                                     check_since=cut.isoformat())
    out_boxes, box_feats = [], []
    for k, b in enumerate(boxes, 1):
        area = shp_box(*b.bounds)
        looks = looks_over(area, limit=2)
        nxt = looks[0] if looks else None
        row = {"box": k, "share_of_past_dark_targets": b.share_of_history, "bounds": list(b.bounds),
               "next_look": {"satellite": nxt["satellite"], "start": nxt["start"], "share": nxt["share"], "text": _look_line(nxt)}
               if nxt else None}
        if pass_id:
            row["candidates_near"] = sum(_km_to_box(lon, lat, b.bounds) <= NEAR_KM for lon, lat in cands)
        out_boxes.append(row)
        box_feats.append({"type": "Feature", "properties": {
            "box": k, "label": f"Box {k}", "next": _look_line(nxt) if nxt else "no look planned yet",
            "boxes_pct": bpct if measured else None, "boxes_times": round(rc.boxes_lift, 1) if measured else None,
            "boxes_days_hit": rc.boxes_days_hit, "days": rc.days}, "geometry": mapping(area)})
    pre = vs.vessels_prefix()
    heat_url = vs.put_json(f"{pre}hotspots.geojson", vs.fc(heat))
    boxes_url = vs.put_json(f"{pre}boxes.geojson", vs.fc(box_feats))
    by = {c.share: c for c in checks}
    rolling = {"since": cut.isoformat(), "until": (until - timedelta(days=1)).isoformat(), **rc.as_dict()}
    record = {"cut": cut.isoformat(), "until": until.isoformat(), "boxes": out_boxes,
              "check": {f"top_{int(s * 100)}pct": by[s].as_dict() for s in by}, "rolling": rolling,
              "pass_id": pass_id or None, "question_id": stamp}
    vs.put_json(f"{pre}hotspots.json", record)
    say = rolling_say(cut, pct, times(rc.lift)) if measured else no_check_say(cut)
    return json.dumps({
        "rolling": {"since": rolling["since"], "until": rolling["until"], "radar_days": rc.days, "days_hit": rc.days_hit,
                    "dark_targets": rc.total,
                    "top_5pct_of_water_held": f"{pct}% ({times(rc.lift)}x chance)" if measured else None,
                    "boxes_held": f"{bpct}% ({times(rc.boxes_lift)}x chance)" if measured else None,
                    "boxes_days_hit": rc.boxes_days_hit},
        "say": say, "say_boxes": boxes_say(bpct, times(rc.boxes_lift)) if measured else say,
        "boxes": out_boxes, "heat_s3_url": heat_url, "boxes_s3_url": boxes_url,
        "heat_render": {"kind": "points", "group": "maritime", "legend": "Dark targets seen before", "property": "v"},
        "boxes_render": {"kind": "vector", "group": "maritime", "legend": "Patrol boxes", "label": "label"},
        "attribution": vs.ATTRIBUTION,
        "next_steps": "Show the heat and the boxes (display_visual with each render); say the check with say, word for "
                      "word. Choose which box to draft and announce it with decide in the same response as next_look.",
    })


# --- prediction two: the squid fleet's season --------------------------------------------------

def _zone(lat: float) -> str:
    return "near_galapagos" if lat > NEAR_GALAPAGOS_LAT else ("off_peru" if lat > PERU_CHILE_LAT else "off_chile")


def fleet_summary(rows: list) -> dict:
    by: dict = {}
    for month, _lon, lat, h in rows:
        z = _zone(lat)
        by.setdefault(month, {"near_galapagos": 0.0, "off_peru": 0.0, "off_chile": 0.0})[z] += h
    years = sorted({int(m[:4]) for m in by})
    latest = max(by)
    complete = [y for y in years if y < int(latest[:4])]
    present = {m: sum(1 for y in complete if by.get(f"{y}-{m:02d}", {}).get("near_galapagos", 0) >= SEASON_MIN_HOURS)
               for m in range(1, 13)}
    expected = [m for m in range(1, 13) if complete and present[m] >= len(complete) / 2]
    seasons = {}
    for y in years:
        months = [m for m in expected if f"{y}-{m:02d}" <= latest]
        if not months:
            continue
        came = [m for m in months if by.get(f"{y}-{m:02d}", {}).get("near_galapagos", 0) >= SEASON_MIN_HOURS]
        seasons[y] = "came" if came else ("missed" if len(months) == len(expected) else "not yet")
    now = by[latest]
    return {"expected_months": expected, "seasons": seasons, "latest_month": latest,
            "latest_hours": {k: round(v) for k, v in now.items()}, "where_now": max(now, key=now.get)}


@tool
async def fleet_pattern() -> str:
    """The distant-water squid fleet's season: the months the pattern since 2017 expects it near the
    Galápagos (north of 8° S), each year's season came or missed, and where the fleet is in the latest
    month (its fishing hours as heat). From Global Fishing Watch's apparent fishing effort.

    Returns: JSON with expected_months, seasons, latest month, where_now, heat_s3_url and render
    (pass it to display_visual unchanged), say (one sentence), next_steps.
    """
    data = vs.cached(vs.manifest()["fleet"]["key"])
    s = fleet_summary(data["rows"])
    latest = [r for r in data["rows"] if r[0] == s["latest_month"]]
    mx = max((r[3] for r in latest), default=1.0)
    heat = [vs.point(lon, lat, v=round(h / mx, 3)) for _, lon, lat, h in latest]
    url = vs.put_json(f"{vs.vessels_prefix()}fleet_{s['latest_month']}.geojson", vs.fc(heat))
    names = {1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August",
             9: "September", 10: "October", 11: "November", 12: "December"}
    exp = s["expected_months"]
    exp_text = f"{names[exp[0]]} to {names[exp[-1]]}" if exp else "no month"
    this_year = int(s["latest_month"][:4])
    came = sorted(y for y, v in s["seasons"].items() if v == "came")
    zone_words = {"near_galapagos": "near the Galápagos", "off_peru": "off Peru", "off_chile": "off Chile"}
    say = (f"The pattern expects the fleet near the Galápagos from {exp_text}; it came in {len(came)} of "
           f"{len([y for y in s['seasons'] if y < this_year])} years since {min(s['seasons']) if s['seasons'] else 2017}, "
           f"and in {this_year} it {'did not' if s['seasons'].get(this_year) == 'missed' else 'did'}: "
           f"in {names[int(s['latest_month'][5:7])]} {s['latest_month'][:4]} it was {zone_words[s['where_now']]}.")
    return json.dumps({
        **s, "heat_s3_url": url,
        "render": {"kind": "points", "group": "maritime", "legend": "Squid fleet hours", "property": "v"},
        "say": say, "attribution": vs.ATTRIBUTION,
        "next_steps": "Show the fleet's hours (display_visual with heat_s3_url and render); say it with say, in one "
                      "sentence. The fleet is a fleet: no vessel, flag or country is named.",
    })


# --- when the radar looks again ----------------------------------------------------------------

@tool
async def next_look(box: int = 0) -> str:
    """When Sentinel-1 is next planned to look: the next interferometric-wide passes from ESA's
    newest published plans that cover at least a fifth of the area.

    Args:
        box: 1, 2 or 3 for a patrol box from predict_hotspots; 0 (default) for the whole reserve.

    Returns: JSON with looks (satellite, start UTC, share of the area covered), the plan's date,
    footprint_s3_url and render for the first look (pass it to display_visual unchanged). Never
    extrapolates an orbit: past the plan's end there is no look yet.
    """
    if box not in (0, 1, 2, 3):
        return json.dumps({"error": "box must be 0 (the reserve) or 1 to 3"})
    if box:
        try:
            rec = vs.get_json(f"{vs.vessels_prefix()}hotspots.json")
            area = shp_box(*next(b for b in rec["boxes"] if b["box"] == box)["bounds"])
        except Exception:
            return json.dumps({"error": "Run predict_hotspots first to name the boxes."})
    else:
        area = vs.records()["reserve"]
    looks = looks_over(area, limit=3)
    _, source = plan_takes()
    if not looks:
        return json.dumps({"looks": [], "plan": source, "note": "No look over that area is planned in ESA's published plans yet."})
    first = looks[0]
    url = vs.put_json(f"{vs.vessels_prefix()}look_{box}_{first['start'][:13].replace(':', '')}.geojson",
                      vs.fc([{"type": "Feature", "properties": {"label": "next look  " + _look_line(first)}, "geometry": first["footprint"]}]))
    return json.dumps({
        "area": f"box {box}" if box else "the reserve",
        "looks": [{k: lk[k] for k in ("satellite", "start", "relative_orbit", "share")} | {"text": _look_line(lk)} for lk in looks],
        "plan": source, "footprint_s3_url": url,
        "render": {"kind": "vector", "group": "maritime", "legend": "Next radar look", "label": "label"},
        "next_steps": "Show the look (display_visual with footprint_s3_url and render); say the first look's time in UTC.",
    })


# --- where a silent vessel could have gone ------------------------------------------------------

def _water_grid() -> RE.WaterGrid:
    w, s, e, n = RADAR_BOX
    cols, rows = int(round((e - w) / REACH_STEP)), int(round((n - s) / REACH_STEP))
    land = vs.records()["land"]
    parts = [mapping(p) for p in getattr(land, "geoms", [land])]
    # rasterize writes row 0 at the north; the reach grid has row 0 at the south.
    mask = features.rasterize(parts, out_shape=(rows, cols), transform=from_origin(w, n, REACH_STEP, REACH_STEP),
                              fill=0, default_value=1, dtype="uint8").astype(bool)
    return RE.WaterGrid(west=w, south=s, step=REACH_STEP, water=~mask[::-1])


def _area_shape(grid: RE.WaterGrid, mask: np.ndarray):
    w, s = grid.west, grid.south
    rows = grid.shape[0]
    tr = from_origin(w, s + rows * grid.step, grid.step, grid.step)
    polys = [shape(g) for g, v in features.shapes(mask[::-1].astype("uint8"), mask=mask[::-1], transform=tr) if v == 1]
    return unary_union(polys).simplify(0.005) if polys else None


@tool
async def reachable_area() -> str:
    """A vessel that went silent near the reserve while the radar looked (the best moment on file, an
    earlier pass): where its AIS went off, every place it could have reached by water at a stated
    speed by the time the radar passed (round the islands, not over them), the dark targets inside
    that area, and where its AIS came back on.

    Returns: JSON with pass_id (call find_pass with it for the radar), the vessel's type, off and on
    times, speed_kn and hours (state both), reach_km, targets_inside (km by water), area_s3_url and
    render (pass it to display_visual unchanged), back_on (reveal it last), the fixed sentence.
    """
    sv = vs.on_file()["silent_vessel"]
    built = vs.manifest().get("passes", {}).get(sv["pass_id"])
    if not built:
        return json.dumps({"error": "The silent vessel's pass is not built (scripts/build_vessel_cache.py)."})
    sensed = datetime.fromisoformat(sv["sensed"].replace("Z", "+00:00"))
    off = tuple(sv["gap"]["off"])
    hours = float(sv["gap"]["off_h_before_pass"])
    speed = max(MIN_SPEED_KN, float(sv.get("speed_kn", MIN_SPEED_KN)))
    max_km = RE.reach_km(speed, hours)
    grid = _water_grid()
    r = RE.by_water(grid, off[0], off[1], max_km)
    area = _area_shape(grid, r.mask)
    data = vs.cached(built["products"]["targets"]["key"])
    inside = []
    for g in data["gfw"]:
        d = RE.km_to(r, grid, g["lon"], g["lat"])
        if d is not None and d <= max_km and not g["matched"]:
            inside.append({"lon": g["lon"], "lat": g["lat"], "km_by_water": d, "source": "both" if g.get("ours") else "gfw"})
    gap = next((g for g in _history()["gaps"]["rows"]
                if vs.km(tuple(g["off"]), off) < 5 and abs(datetime.fromisoformat(g["start"].replace("Z", "+00:00"))
                                                             - (sensed - timedelta(hours=hours))) < timedelta(hours=2)), None)
    back_on = None
    if gap and gap.get("on"):
        back_on = {"lon": gap["on"][0], "lat": gap["on"][1], "at": gap["end"], "km_from_off": round(vs.km(off, tuple(gap["on"])), 1),
                   "hours_after_off": gap["hours"]}
    feats = [{"type": "Feature", "properties": {"kind": "reach", "label": f"{round(max_km)} km by water at {speed:g} kn"},
              "geometry": mapping(area)}] if area is not None else []
    feats.append(vs.point(off[0], off[1], kind="off", label="last broadcast"))
    feats += [vs.point(t["lon"], t["lat"], kind="target") for t in inside]
    if back_on:
        feats.append(vs.point(back_on["lon"], back_on["lat"], kind="on", label="AIS back on"))
    url = vs.put_json(f"{vs.vessels_prefix()}reach_{sv['pass_id']}.geojson", vs.fc(feats))
    return json.dumps({
        "pass_id": sv["pass_id"], "sensed": sv["sensed"], "sensed_text": vs.nice_time(sv["sensed"]),
        "vessel": {"type": sv["gap"]["type"]}, "went_off": (sensed - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%MZ"),
        "speed_kn": speed, "hours": hours, "reach_km": round(max_km), "start_moved_off_land_km": r.snapped_km,
        "targets_inside": [{k: t[k] for k in ("km_by_water", "source")} for t in sorted(inside, key=lambda t: t["km_by_water"])],
        "back_on": back_on, "area_s3_url": url,
        "render": {"kind": "vector", "group": "maritime", "legend": "Reach by water", "label": "label"},
        "fixed_sentence": vs.CANNOT_SAY,
        "next_steps": "Show that pass's radar (find_pass with pass_id) and the area (display_visual with area_s3_url and "
                      "render). Say the date plainly (an earlier pass), the speed and the hours, the targets inside, the "
                      "fixed sentence word for word, and only then where the AIS came back on.",
    })
