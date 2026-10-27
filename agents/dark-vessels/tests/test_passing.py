"""The passing rule (approved 2026-10-27; thresholds chosen after seeing the Oct 12 pass): a target
that would be a candidate is set aside (passed_close) when a broadcasting ship's straight path
between two consecutive hourly fixes (at most 3 h apart) came within 1 km of it at a time within
30 minutes of the radar minute. Synthetic ships first, then the real Oct 12 numbers (a fixture cut
from the cache's replay, read-only), then match_ais end to end on those numbers. No network."""
import asyncio
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from conftest import BUCKET, C, P, SESSION, STAR

PRE = f"session_data/{SESSION}/vessels/"
FIXTURE = json.loads((Path(__file__).resolve().parent / "fixtures" / "oct12_passing.json").read_text())
WHEN = datetime(2026, 10, 12, 0, 18, 2, tzinfo=timezone.utc)
TARGET = {"lon": -89.5, "lat": -0.65}


def run(coro):
    return json.loads(asyncio.run(coro))


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%MZ")


def ship(vs, off_km: float, minutes: float, knots: float, gap_h: float = 1.0, kind: str = "passenger",
         start: datetime | None = None) -> dict:
    """A ship sailing east past TARGET, off_km north of it at its closest, `minutes` from the radar
    minute (negative: before), at `knots`, with two hourly fixes `gap_h` apart around that moment
    (the first on the hour before it, unless `start` is given)."""
    closest = WHEN + timedelta(minutes=minutes)
    t0 = start or closest.replace(minute=0, second=0)
    t1 = t0 + timedelta(hours=gap_h)
    kmh = knots * vs.KNOT_KMH
    kx = vs.KM_PER_DEG * math.cos(math.radians(TARGET["lat"]))

    def at(t):
        x = kmh * (t - closest).total_seconds() / 3600
        return [TARGET["lon"] + x / kx, TARGET["lat"] + off_km / vs.KM_PER_DEG]
    return {"n": 1, "type": kind, "t": [iso(t0), iso(t1)], "c": [at(t0), at(t1)]}


def passing(vs, *tracks):
    return vs.closest_passing(TARGET, {"tracks": list(tracks)}, WHEN)


def test_the_thresholds_are_named_beside_the_match_rule(vessels):
    vs = vessels.vs
    assert (vs.PASSING_KM, vs.PASSING_MIN, vs.PASSING_GAP_H) == (1.0, 30, 3.0)
    assert vs.OURS_MATCH_KM == 1.0
    assert vessels.ais.PASSED_RULE == ("a broadcasting ship's straight path between two hourly fixes (at most 3 h apart) "
                                       "came within 1 km of the target within 30 minutes of the radar minute")


def test_a_ship_0_2_km_away_13_minutes_before_sets_the_target_aside(vessels):
    got = passing(vessels.vs, ship(vessels.vs, 0.2, -13, 15))
    assert got == {"km": pytest.approx(0.2, abs=0.01), "minutes": -13, "type": "passenger", "knots": pytest.approx(15, abs=0.1)}


def test_a_ship_1_2_km_away_7_minutes_before_counts_only_beside_a_closer_one(vessels):
    """T03's second ship: 1.2 km at 7 minutes before. Under the approved 1 km it does not set a target
    aside on its own; T03 is set aside by the 0.2 km ship, and the evidence keeps the closest."""
    vs = vessels.vs
    assert passing(vs, ship(vs, 1.2, -7, 15)) is None
    got = passing(vs, ship(vs, 1.2, -7, 15), ship(vs, 0.2, -13, 15))
    assert got["km"] == pytest.approx(0.2, abs=0.01) and got["minutes"] == -13


def test_a_ship_0_4_km_away_40_minutes_before_is_outside_the_window(vessels):
    """T01 and T02's case: a close pass about 40 minutes before; within the 30 minutes the ship
    was already kilometres away, so the target stays a candidate."""
    vs = vessels.vs
    assert passing(vs, ship(vs, 0.4, -40, 9)) is None
    # The same ship, the window widened, is what the evidence would have shown.
    assert vs.closest_passing(TARGET, {"tracks": [ship(vs, 0.4, -40, 9)]}, WHEN, minutes=45)["minutes"] == -40


def test_a_ship_1_5_km_away_at_the_radar_minute_is_kept(vessels):
    vs = vessels.vs
    assert passing(vs, ship(vs, 1.5, 0, 10)) is None
    assert passing(vs, ship(vs, 0.99, 0, 10))["km"] == pytest.approx(0.99, abs=0.01)


def test_a_gap_over_3_hours_is_ignored(vessels):
    vs = vessels.vs
    four = ship(vs, 0.1, 0, 4, gap_h=4, start=WHEN.replace(minute=0, second=0) - timedelta(hours=2))
    three = ship(vs, 0.1, 0, 4, gap_h=3, start=WHEN.replace(minute=0, second=0) - timedelta(hours=1))
    assert passing(vs, four) is None
    assert passing(vs, three)["km"] == pytest.approx(0.1, abs=0.01)


def test_an_anchored_ship_on_the_target_within_30_minutes_sets_it_aside(vessels):
    vs = vessels.vs
    h = WHEN.replace(minute=0, second=0)
    anchored = {"n": 1, "type": "fishing", "t": [iso(h), iso(h + timedelta(hours=1))], "c": [[TARGET["lon"], TARGET["lat"]]] * 2}
    assert passing(vs, anchored) == {"km": 0.0, "minutes": 0, "type": "fishing", "knots": 0.0}
    # At anchor there, but its fixes two and three hours after: no path within the 30 minutes.
    later = {**anchored, "t": [iso(h + timedelta(hours=2)), iso(h + timedelta(hours=3))]}
    assert passing(vs, later) is None


def test_a_ship_passing_after_the_radar_minute_counts_too(vessels):
    got = passing(vessels.vs, ship(vessels.vs, 0.3, 20, 12))
    assert got["minutes"] == 20 and got["km"] == pytest.approx(0.3, abs=0.01)
    assert passing(vessels.vs, ship(vessels.vs, 0.3, 35, 12)) is None


def test_the_real_oct_12_numbers_set_aside_t03_and_t04_and_keep_t01_and_t02(vessels):
    vs = vessels.vs
    when = vs.parse_t(FIXTURE["sensed"])
    got = {t["old_label"]: vs.closest_passing(t, FIXTURE, when) for t in FIXTURE["targets"]}
    assert got["T01"] is None and got["T02"] is None
    assert got["T03"] == {"km": 0.18, "minutes": -13, "type": "passenger", "knots": 14.8}
    assert got["T04"] == {"km": 0.58, "minutes": -14, "type": "passenger", "knots": 15.1}
    # T01 and T02 each had a ship pass close by about 40 minutes before, outside the window.
    wide = {t["old_label"]: vs.closest_passing(t, FIXTURE, when, minutes=60) for t in FIXTURE["targets"][:2]}
    assert (wide["T01"]["km"], wide["T01"]["minutes"]) == (0.4, -40)
    assert (wide["T02"]["km"], wide["T02"]["minutes"]) == (0.29, -41)


def oct12_cache(vessels) -> None:
    """The synthetic star pass's cache with the real Oct 12 candidates and ships: the four would-be
    candidates as pairs GFW did not match, a broadcasting target and a port boat; the fixture's tracks;
    AIS received at each target."""
    pre = "vessels/cache/v1"
    ours, gfw = [], []
    for i, t in enumerate(FIXTURE["targets"], 1):
        ours.append({"id": f"R00{i}", "lon": t["lon"], "lat": t["lat"], "px": 6, "peak_db": 14.0, "area_m2": 2400,
                     "in_reserve": True, "gfw": f"G00{i}"})
        gfw.append({"id": f"G00{i}", "lon": t["lon"], "lat": t["lat"], "n": 1, "matched": False, "ours": f"R00{i}", "pair_km": 0.1})
    ours += [{"id": "R005", "lon": C[0], "lat": C[1], "px": 12, "peak_db": 21.0, "area_m2": 4800, "in_reserve": True, "gfw": "G005"},
             {"id": "R006", "lon": P[0], "lat": P[1], "px": 9, "peak_db": 16.0, "area_m2": 3600, "in_reserve": True, "gfw": "G006"}]
    gfw += [{"id": "G005", "lon": C[0], "lat": C[1], "n": 1, "matched": True, "ours": "R005", "pair_km": 0.0},
            {"id": "G006", "lon": P[0], "lat": P[1], "n": 1, "matched": False, "ours": "R006", "pair_km": 0.0}]
    presence = json.loads(vessels.s3.objects[f"{pre}/{STAR}_presence.json"])
    for t in FIXTURE["targets"]:
        presence["fixes"] += [[t["lon"] + 0.02, t["lat"], "2026-10-12T00:00Z"], [t["lon"] - 0.02, t["lat"], "2026-10-12T00:00Z"]]
    targets = json.loads(vessels.s3.objects[f"{pre}/{STAR}_targets.json"])
    targets.update(ours=ours, gfw=gfw)
    for key, body in ((f"{STAR}_targets.json", targets), (f"{STAR}_presence.json", presence),
                      (f"{STAR}_replay.json", {"start": "2026-10-11T21:00Z", "end": FIXTURE["sensed"], "tracks": FIXTURE["tracks"]})):
        vessels.s3.put_object(Bucket=BUCKET, Key=f"{pre}/{key}", Body=json.dumps(body))
    vessels.vs.clear_cache()


def test_match_ais_on_the_real_oct_12_numbers_gives_two_candidates_and_two_passed_close(vessels):
    oct12_cache(vessels)
    run(vessels.ais.check_ais_coverage(STAR))
    out = run(vessels.ais.match_ais(STAR))
    assert out["counts"] == {"broadcasting": 1, "port": 1, "unproven": 0, "seen_once": 0, "passed_close": 2, "candidate": 2}
    assert out["say_in_order"] == ["broadcasting", "port", "unproven", "seen_once", "passed_close", "candidate"]
    assert out["say_as"]["passed_close"] == "where a broadcasting ship passed close by"
    # The candidates keep T01 and T02 (west to east); the two set aside are numbered on: T03 and T04.
    assert [c["id"] for c in out["candidates"]] == ["T01", "T02"]
    assert out["passed_close"] == [
        {"id": "T03", "km": 0.18, "minutes": -13, "ship_type": "passenger", "knots": 14.8},
        {"id": "T04", "km": 0.58, "minutes": -14, "ship_type": "passenger", "knots": 15.1}]
    assert out["passed_say"] == "2 more not counted: a broadcasting ship passed close by."
    assert "aside" not in out["passed_say"] and "aside" not in out["say_as"]["passed_close"]
    feats = vessels.s3.json(f"{PRE}targets_{STAR}.geojson")["features"]
    passed = [f["properties"] for f in feats if f["properties"]["status"] == "passed_close"]
    assert [(p["label"], p["passed_km"], p["passed_min"]) for p in passed] == [("T03", 0.18, -13), ("T04", 0.58, -14)]
    # Numbers only on the map layer: no ship type, no words.
    assert all(set(p) <= {"status", "source", "port_km", "label", "pair_km", "peak_db", "heard", "passed_km", "passed_min"}
               for p in passed)
    # The evidence and the tasking take the candidates only.
    ev = run(vessels.ais.gather_evidence(STAR))
    assert [e["id"] for e in ev["evidence"]] == ["T01", "T02"]
    assert run(vessels.ais.gather_evidence(STAR, ["T03"]))["evidence"] == []


def test_the_draft_lists_the_remaining_candidates_and_counts_the_passed_close(vessels):
    from conftest import SESSION as SID
    oct12_cache(vessels)
    ctx = lambda tid: type("C", (), {"tool_use": {"toolUseId": tid}})()   # noqa: E731
    run(vessels.pt.list_passes(tool_context=ctx("tooluse_list")))
    assert run(vessels.dt.decide("read_pass", "newest", STAR, tool_context=ctx("tooluse_read")))["status"] == "noted"
    run(vessels.ais.check_ais_coverage(STAR))
    run(vessels.ais.match_ais(STAR))
    run(vessels.ft.predict_hotspots(STAR))
    assert run(vessels.dt.decide("draft", "most_past_targets", box=1, tool_context=ctx("tooluse_draft")))["status"] == "noted"
    assert "not candidates" in run(vessels.tk.draft_tasking(STAR, 1, candidate_ids=["T03"]))["error"]
    out = run(vessels.tk.draft_tasking(STAR, 1))
    assert out["candidates"] == ["T01", "T02"]
    draft = vessels.s3.json(f"session_data/{SID}/taskings/{out['tasking_id']}.draft.json")
    assert draft["counts"] == {"broadcasting": 1, "port": 1, "unproven": 0, "seen_once": 0, "passed_close": 2, "candidate": 2}
    # The decide facts count the candidates only.
    assert vessels.dt._candidates(vessels.s3.json(f"{PRE}match_{STAR}.json")) == 2


def test_with_no_candidate_left_the_words_drop_more(vessels):
    vs = vessels.vs
    assert vs.passed_say(2, 0) == "2 not counted: a broadcasting ship passed close by."
    assert vs.passed_say(1, 3) == "1 more not counted: a broadcasting ship passed close by."
