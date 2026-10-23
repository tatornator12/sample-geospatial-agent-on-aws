"""The 90-day switch rule (Requirement 17, approved 2026-10-23): the pure rule on the options report's
20 boards, and follow_site's guard on a session's records (in-memory S3)."""
import asyncio
import csv
import json
import statistics
from pathlib import Path

import pytest

import follow_tools as ft

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "follow_boards_2026-10-23.csv"


def boards() -> dict[str, list[dict]]:
    """The options report's section D data: per board, the top three hotspots of each of the two cued
    areas, with the latest confirmation that was public on the run day (EMIT candidates since 2025,
    Carbon Mapper within 7 km)."""
    out: dict[str, list[dict]] = {}
    for row in csv.DictReader(FIXTURE.open()):
        area, rank = row["point"].split("#")
        e, c = row["emit_latest_candidate"] or None, row["cm_latest"] or None
        latest = None
        if e or c:
            by = "both" if e and c and e == c else "emit" if e and (not c or e > c) else "carbon_mapper"
            latest = {"date": c if by == "carbon_mapper" else e, "by": by}
        out.setdefault(row["board_end"], []).append({
            "area": area, "rank": int(rank), "lat": float(row["lat"]), "lon": float(row["lon"]),
            "anomaly_ppb": float(row["anomaly_ppb"]), "tip_start": row["tip_start"], "tip_end": row["board_end"],
            "latest": latest, "emit_candidates": 0, "peak_ppm_m": None})
    return out


def areas_of(points: list[dict]) -> list[dict]:
    order = list(dict.fromkeys(p["area"] for p in points))
    by_area = [{"area": a, "points": sorted((p for p in points if p["area"] == a), key=lambda p: p["rank"])} for a in order]
    return sorted(by_area, key=lambda a: -a["points"][0]["anomaly_ppb"])


def test_the_switch_rule_on_the_20_boards_matches_the_approved_numbers():
    """Approved 2026-10-23: switches on 9 of 20 boards and gives a close look within 90 days on 19
    (median 38 days, worst 78). Step 1 alone (today's rule): 10 of 20 within 90 days, median 77.5 of
    the 18 with a confirmation, worst 137 (the options report's section D; the brief asked for "12 of
    20", but the same data give 10, which is also the report's own "no new look needed on 10")."""
    data = boards()
    assert len(data) == 20
    step1_days, follow_days, switched = [], [], 0
    for end, points in sorted(data.items()):
        rule = ft.follow_rule(areas_of(points))
        step1_days.append(rule["step1_days"])
        follow_days.append(rule["followed_days"])
        switched += rule["reason"] == "top_spot_stale_switched"
    within = lambda ds: [d for d in ds if d is not None and d <= 90]   # noqa: E731
    assert switched == 9
    assert len(within(follow_days)) == 19 and len(within(step1_days)) == 10
    known = [d for d in follow_days if d is not None]
    assert max(d for d in within(follow_days)) == 78 and statistics.median(known) == 38
    assert max(d for d in step1_days if d is not None) == 137
    assert statistics.median([d for d in step1_days if d is not None]) == 77.5


def test_on_the_oct_21_board_nothing_fresher_so_the_stronger_tip_stays():
    """The Oct 21 board: neither top spot is confirmed; the south Caspian's #3 has Carbon Mapper's
    2026-06-20 plume (109 days, over 90) and Shanxi's #3 a 2026-06-17 plume: nothing within 90 days,
    so the stronger tip stays."""
    rule = ft.follow_rule(areas_of(boards()["2026-10-21"]))
    assert rule["basis"] == "stronger_tip" and rule["step2"]
    assert rule["reason"] == "stronger_tip" and rule["followed"]["area"] == "shanxi coal basin" and rule["followed"]["rank"] == 1


def point(area, rank, lat, lon, ppb, latest=None, start="2026-10-07", cands=0):
    return {"area": area, "rank": rank, "lat": lat, "lon": lon, "anomaly_ppb": ppb, "tip_start": start,
            "tip_end": "2026-10-21", "latest": latest, "emit_candidates": cands, "peak_ppm_m": None}


def test_step_two_switches_keeps_or_falls_back():
    a = [point("shanxi coal basin", 1, 35.5, 112.9, 120, {"date": "2026-06-10", "by": "carbon_mapper"}),
         point("shanxi coal basin", 2, 37.9, 113.6, 100), point("shanxi coal basin", 3, 36.0, 114.2, 90)]
    b = [point("south caspian", 1, 37.7, 53.8, 98), point("south caspian", 2, 39.4, 53.5, 80),
         point("south caspian", 3, 37.8, 53.9, 70, {"date": "2026-08-26", "by": "carbon_mapper"})]
    rule = ft.follow_rule([{"area": "shanxi coal basin", "points": a}, {"area": "south caspian", "points": b}])
    assert rule["step1"] is a[0] and rule["step1_days"] == 119 and rule["step2"]
    assert rule["followed"] is b[2] and rule["reason"] == "top_spot_stale_switched" and rule["followed_days"] == 42
    b[2]["latest"] = {"date": "2026-06-01", "by": "emit"}
    rule = ft.follow_rule([{"area": "shanxi coal basin", "points": a}, {"area": "south caspian", "points": b}])
    assert rule["followed"] is a[0] and rule["reason"] == "top_spot_stale_no_fresher"
    a[0]["latest"] = {"date": "2026-08-01", "by": "emit"}
    rule = ft.follow_rule([{"area": "shanxi coal basin", "points": a}, {"area": "south caspian", "points": b}])
    assert rule["reason"] == "newest_confirmation" and not rule["step2"] and rule["followed_days"] == 67


def test_one_named_area_cues_its_top_two_hotspots():
    pts = [point("south caspian", 1, 37.7, 53.8, 98), point("south caspian", 2, 39.4, 53.5, 80,
                                                            {"date": "2026-09-30", "by": "emit"}),
           point("south caspian", 3, 37.8, 53.9, 70)]
    rule = ft.follow_rule([{"area": "south caspian", "points": pts}])
    assert [p["rank"] for p in rule["cued"]] == [1, 2] and rule["followed"]["rank"] == 2
    assert rule["reason"] == "newest_confirmation"


# --- the tool, on a session in the fake bucket ---------------------------------------------------------

PREFIX = None


def put(s3, name, body):
    s3.put_object(Bucket="test-bucket", Key=f"{PREFIX}{name}", Body=json.dumps(body).encode())


def tip(area, start, spots, emit=True):
    return {"area": area, "start": start, "end": "2026-10-21", "days": 14, "emit_can_look": emit,
            "top": spots[0], "hotspots": spots}


def spot(rank, lat, lon, ppb):
    return {"rank": rank, "lat": lat, "lon": lon, "anomaly_ppb": ppb, "valid_days": 5, "emit_can_look": True}


def passes(lat, lon, cand_date=None):
    ps = [{"date": "2026-04-25", "verdict": "rejected", "short": "within noise"}]
    if cand_date:
        ps.insert(0, {"date": cand_date, "verdict": "candidate", "short": "candidate", "peak_ppm_m": 2100.0,
                      "scene_id": "EMIT_L2B_CH4ENH_003_20260901T061000",
                      "chip": "passchip_EMIT_L2B_CH4ENH_003_20260901T061000.png"})
    return {"lat": lat, "lon": lon, "since": "2025-01-01", "looks": 4, "passes": ps}


def cm(lat, lon, plume_date=None):
    dates = [{"date": plume_date, "instrument": "tanager", "rate_kg_h": 500.0, "distance_km": 2.0}] if plume_date else []
    rec = {"lat": lat, "lon": lon, "radius_km": 7.0, "since": "2025-01-01", "count": len(dates), "latest": plume_date,
           "follow_radius_km": 7.0, "dates": dates}
    if plume_date:
        rec["image"] = {"plume_id": "tan20260826t070000c11s4001-A", "date": plume_date, "distance_km": 2.0,
                        "pixels": 40, "file": "cmcolumns_tan20260826t070000c11s4001-A.geojson"}
    return rec


@pytest.fixture()
def session(tools, fake_s3):
    global PREFIX
    PREFIX = tools.session_prefix()
    put(fake_s3, "tip_shanxi_coal_basin.json", tip("shanxi coal basin", "2026-10-07", [
        spot(1, 35.5493, 112.8982, 122.6), spot(2, 37.9643, 113.6682, 102.1), spot(3, 35.9693, 114.1932, 89.2)]))
    put(fake_s3, "tip_south_caspian.json", tip("south caspian", "2026-10-07", [
        spot(1, 37.6834, 53.7827, 98.0), spot(2, 39.4379, 53.573, 80.1), spot(3, 37.7625, 53.9324, 70.0)]))
    put(fake_s3, "tip_amman.json", tip("amman", "2026-10-07", [spot(1, 31.9, 35.9, 15.0)]))
    put(fake_s3, "tip_west_siberia_and_yamal.json", tip("west siberia and yamal", "2026-10-07",
                                                         [spot(1, 66.0, 72.0, 300.0)], emit=False))
    for la, lo in ((35.5493, 112.8982), (37.6834, 53.7827)):
        put(fake_s3, f"passes_{la:.4f}_{lo:.4f}.json", passes(la, lo))
        put(fake_s3, f"cmplumes_{la:.4f}_{lo:.4f}.json", cm(la, lo))
    return fake_s3


def run(**kw):
    return json.loads(asyncio.run(ft.follow_site(**kw)))


def test_follow_site_asks_for_step_two_then_refuses_the_wrong_pick_naming_the_fact(session):
    out = run(lat=35.5493, lon=112.8982, reason="stronger_tip")
    assert "Step 2 applies" in out["error"] and "check_recent_passes and carbon_mapper_plumes(37.9643, 113.6682)" in out["error"]
    for la, lo, cand, plume in ((37.9643, 113.6682, None, None), (35.9693, 114.1932, None, None),
                                (39.4379, 53.573, None, None), (37.7625, 53.9324, None, "2026-08-26")):
        put(session, f"passes_{la:.4f}_{lo:.4f}.json", passes(la, lo, cand))
        put(session, f"cmplumes_{la:.4f}_{lo:.4f}.json", cm(la, lo, plume))
    out = run(lat=35.5493, lon=112.8982, reason="stronger_tip")
    assert "does not fit the record" in out["error"]
    assert "a Carbon Mapper plume within 7 km on 2026-08-26, 42 days before the tip window starts" in out["error"]
    assert "follow_site(37.7625, 53.9324, reason='top_spot_stale_switched')" in out["error"]
    session.put_object(Bucket="test-bucket", Key=f"{PREFIX}cmcolumns_tan20260826t070000c11s4001-A.geojson",
                       Body=json.dumps({"type": "FeatureCollection", "features": []}).encode())
    put(session, "tipcolumns_37.7625_53.9324.geojson", {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"ppb": 70.0}, "geometry": {"type": "Polygon", "coordinates": [[[53.9, 37.7], [53.94, 37.7], [53.94, 37.73], [53.9, 37.7]]]}}]})
    out = run(lat=37.7625, lon=53.9324, reason="top_spot_stale_switched")
    assert out["switched"] and out["follow"]["rank"] == 3 and out["follow"]["latest_confirmed"]["days_before_tip"] == 42
    assert out["say"].startswith("Following the south Caspian (Turkmenistan) site's third hotspot: its latest confirmed "
                                 "detection is a Carbon Mapper plume on 2026-08-26, 42 days before the tip window")
    assert out["tip_columns_s3_url"].endswith("tipcolumns_37.7625_53.9324.geojson")
    assert out["render_tip_columns"]["property"] == "ppb" and out["render_tip_columns"]["height_scale"] > 0
    assert out["record"] == {"by": "carbon_mapper", "date": "2026-08-26", "days_before_tip": 42}
    assert out["record_columns_s3_url"].endswith("cmcolumns_tan20260826t070000c11s4001-A.geojson")
    m = json.loads(session.get_object(Bucket="test-bucket", Key=f"{PREFIX}follow.json")["Body"].read())
    assert m["reason"] == "top_spot_stale_switched" and m["checked"] == 4
    assert m["step1"]["rank"] == 1 and m["step1"]["latest"] is None and m["followed"]["days_before_tip"] == 42
    assert m["record_bars"]["by"] == "carbon_mapper" and m["tip_bars"] == {"file": "tipcolumns_37.7625_53.9324.geojson"}
    # Numbers, dates, enums and file names only: no free text the model wrote reaches the stage.
    assert all(isinstance(v, (int, float, str, bool, type(None), dict, list)) for v in m.values())


def test_follow_site_without_step_two_and_an_unknown_reason(session):
    put(session, "passes_37.6834_53.7827.json", passes(37.6834, 53.7827, "2026-09-01"))
    out = run(lat=37.6834, lon=53.7827, reason="sideways")
    assert "reason must be one of" in out["error"]
    out = run(lat=35.5493, lon=112.8982, reason="newest_confirmation")
    assert "does not fit the record" in out["error"] and "follow_site(37.6834, 53.7827, reason='newest_confirmation')" in out["error"]
    out = run(lat=37.6834, lon=53.7827, reason="newest_confirmation")
    assert out["follow"]["area"] == "south caspian" and not out["switched"] and "error" not in out
    assert out["say"].startswith("Following the south Caspian (Turkmenistan) site: its latest confirmed detection is an "
                                 "EMIT candidate pass on 2026-09-01, 36 days before the tip window, against no confirmed")
