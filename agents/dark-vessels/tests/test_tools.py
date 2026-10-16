"""The agent's tools on a synthetic cache (conftest): the order (no candidate before the coverage
check), every status, the evidence, the predictions with their checks, the next look, the silent
vessel's reach, and the tasking's validator. No network."""
import asyncio
import json
import re
from datetime import datetime, timezone

import pytest

from conftest import A, C, SESSION, SILENT, STAR

PRE = f"session_data/{SESSION}/vessels/"


def run(coro):
    return json.loads(asyncio.run(coro))


def test_the_synthetic_targets_lie_in_the_reserves_water(vessels):
    from conftest import B, D, E, P
    for name, (lon, lat) in dict(A=A, B=B, C=C, D=D, E=E, P=P).items():
        assert vessels.vs.in_reserve(lon, lat), f"{name} is not in the reserve's water"


def test_find_pass_latest_is_the_star_and_copies_its_radar_into_the_session(vessels):
    out = run(vessels.pt.find_pass("latest"))
    assert out["pass_id"] == STAR and out["role"] == "star" and out["sensed_text"] == "Oct 12, 2026 00:18 UTC"
    assert out["render"] == {"kind": "raster", "colormap": "gray", "rescale": [1, 255], "group": "maritime",
                             "legend": "Radar backscatter", "bounds": [-91.33, -2.35, -88.38, 1.6]}
    assert out["s3_url"].endswith(f"{PRE}radar_{STAR}.tif") and (f"vessels/cache/v1/{STAR}_display.tif", f"{PRE}radar_{STAR}.tif") in vessels.s3.copies
    assert run(vessels.pt.find_pass("2024-03-06"))["pass_id"] == SILENT


def test_a_pass_not_on_file_is_refused_with_the_passes_on_file(vessels):
    for when in ("2025-01-01", "yesterday", "s1d-20990101t0000", ""):
        out = run(vessels.pt.find_pass(when)) if when else None
        if out is None:
            continue
        assert out["error"].startswith(vessels.vs.ON_FILE_ONLY)
        assert any(STAR in p for p in out["passes_on_file"])
    assert run(vessels.pt.detect_vessels("../sessions"))["error"].startswith(vessels.vs.ON_FILE_ONLY)


def test_detect_vessels_counts_both_detectors_and_sets_the_port_boats_aside(vessels):
    out = run(vessels.pt.detect_vessels(STAR))
    assert out["counts"] == {"ours": 5, "gfw": 5, "both": 4, "port": 1, "targets": 6}
    layer = vessels.s3.json(f"{PRE}targets_{STAR}.geojson")
    assert {f["properties"]["status"] for f in layer["features"]} == {"detected", "port"}
    assert "candidate" not in json.dumps(out)


def test_nothing_is_a_candidate_before_the_coverage_check(vessels):
    out = run(vessels.ais.match_ais(STAR))
    assert "check_ais_coverage first" in out["error"]


def test_coverage_then_match_gives_every_status_in_order(vessels):
    cov = run(vessels.ais.check_ais_coverage(STAR))
    assert 0 < cov["heard_share"] < 0.2 and cov["unproven_means"] == "not evidence"
    assert vessels.s3.json(f"{PRE}heard_{STAR}.geojson")["features"][0]["properties"]["kind"] == "heard"
    out = run(vessels.ais.match_ais(STAR))
    assert out["counts"] == {"broadcasting": 1, "port": 1, "unproven": 1, "seen_once": 2, "candidate": 1}
    assert out["say_in_order"][0] == "broadcasting" and out["fixed_sentence"] == vessels.vs.CANDIDATE_SENTENCE
    (cand,) = out["candidates"]
    assert cand["id"] == "T01" and cand["port"] == "Baltra" and cand["port_km"] == pytest.approx(37.2, abs=0.5)
    assert 0 < cand["nearest_ais_km"] < 10
    feats = vessels.s3.json(f"{PRE}targets_{STAR}.geojson")["features"]
    by = {f["properties"]["status"]: f for f in feats}
    assert by["candidate"]["properties"]["label"] == "T01"
    assert by["broadcasting"]["properties"]["claim"]                 # the hairline to its AIS position


def test_gather_evidence_brings_the_chip_and_the_innocent_explanations(vessels):
    run(vessels.ais.check_ais_coverage(STAR))
    run(vessels.ais.match_ais(STAR))
    out = run(vessels.ais.gather_evidence(STAR))
    (ev,) = out["evidence"]
    assert ev["id"] == "T01" and ev["chip_s3_url"].endswith(f"{PRE}chips/{STAR}_T01.tif")
    from utils.inspection import index_style
    assert index_style(ev["chip_s3_url"]).name == "radar_chip"      # inspect_image shows the sea dark
    assert ev["nearest_broadcast"]["type"] in ("fishing", "cargo", "passenger") and ev["shore_km"] > 0
    assert {e["id"] for e in out["innocent_explanations"]} == {"small_boat_no_ais", "reception_or_equipment", "transponder_off", "not_a_vessel"}
    assert run(vessels.ais.gather_evidence(STAR, ["X1"]))["error"]
    text = json.dumps(out).lower()
    for word in ("illegal", "poach", "suspect", "mmsi", "flag"):
        assert word not in text


def test_heads_at_interpolates_between_hourly_fixes(vessels):
    from conftest import PASS_TIME, star_replay
    heads = vessels.ais.heads_at(star_replay(), PASS_TIME)
    moving = next(h for h in heads if h["type"] == "passenger")
    # Fixes at 00:00 (C + 0.01) and 01:00 (C + 0.02); the pass at 00:18 is 30% of the way along.
    assert moving["lon"] == pytest.approx(C[0] + 0.013, abs=1e-4) and moving["fix_minutes"] == 18


def test_predict_hotspots_ships_its_measured_check_and_three_boxes(vessels):
    out = run(vessels.ft.predict_hotspots())
    chk = out["check"]
    assert chk["checked_on"] == "2026-07-01 to 2026-10-12" and chk["dark_targets_checked"] > 0
    assert out["say"].startswith("Fitted on everything before July 2026, the top 5% of the water held")
    assert not re.search(r"\d\.\d{2}", out["say"] + json.dumps(chk))                 # numbers the room can hear
    assert len(out["boxes"]) == 3 and out["boxes"][0]["share_of_past_dark_targets"] >= out["boxes"][1]["share_of_past_dark_targets"]
    assert out["heat_render"]["legend"] == "Dark targets seen before" and out["attribution"] == "Powered by Global Fishing Watch."
    heat = vessels.s3.json(f"{PRE}hotspots.geojson")["features"]
    assert heat and max(f["properties"]["v"] for f in heat) == 1.0
    port_cell = [f for f in heat if abs(f["geometry"]["coordinates"][0] + 90.3) < 0.03 and abs(f["geometry"]["coordinates"][1] + 0.76) < 0.03]
    assert not port_cell or max(f["properties"]["v"] for f in port_cell) < 0.5     # the port's boats left out


def test_fleet_pattern_names_the_expected_season_and_the_missed_one(vessels):
    out = run(vessels.ft.fleet_pattern())
    assert out["expected_months"] == [6, 7, 8]
    assert out["seasons"]["2026"] == "missed" and out["seasons"]["2025"] == "came"     # JSON keys are strings
    assert out["where_now"] == "off_peru" and out["latest_month"] == "2026-09"
    assert "in 2026 it did not" in out["say"] and "flag" not in out["say"]
    assert out["say"].endswith("in September 2026 it was off Peru.")


def test_times_chance_reads_aloud():
    import forecast_tools as ft
    assert [ft.times(x) for x in (14.2857, 8.9796, 5.7143, 1.04, 9.97)] == ["14", "9", "5.7", "1", "10"]


def test_next_look_reads_the_plan_and_never_invents_one(vessels, monkeypatch):
    out = run(vessels.ft.next_look())
    assert out["looks"] and out["looks"][0]["start"] >= "2026-10-16" and out["looks"][0]["share"] >= 0.2
    assert out["plan"]["plans"]["s1d"]["name"].startswith("s1d_mp_user_20261016") and out["plan"]["refreshed"] is False
    assert "Run predict_hotspots first" in run(vessels.ft.next_look(2))["error"]
    assert run(vessels.ft.next_look(7))["error"]
    # Past the plan's end (and with the refresh failing, as offline): no look, never an extrapolated orbit.
    monkeypatch.setattr(vessels.ft, "_now", lambda: datetime(2026, 11, 6, tzinfo=timezone.utc))
    monkeypatch.setattr(vessels.ft.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
    vessels.ft._plan_cache.clear()
    assert run(vessels.ft.next_look())["looks"] == []


def test_reachable_area_goes_by_water_and_keeps_the_reveal_for_last(vessels):
    out = run(vessels.ft.reachable_area())
    assert out["pass_id"] == SILENT and out["speed_kn"] == 6.0 and out["hours"] == 12.0 and out["reach_km"] == 133
    assert [t["source"] for t in out["targets_inside"]] == ["gfw"] and out["targets_inside"][0]["km_by_water"] < 60
    assert out["back_on"]["km_from_off"] == pytest.approx(24.4, abs=2) and out["fixed_sentence"] == vessels.vs.CANNOT_SAY
    kinds = [f["properties"]["kind"] for f in vessels.s3.json(f"{PRE}reach_{SILENT}.geojson")["features"]]
    assert kinds[0] == "reach" and kinds[-1] == "on" and "off" in kinds


def test_the_tasking_is_drafted_from_the_records_and_only_the_officer_files_it(vessels):
    assert "match_ais and predict_hotspots first" in run(vessels.tk.draft_tasking(STAR, 1))["error"]
    run(vessels.ais.check_ais_coverage(STAR))
    run(vessels.ais.match_ais(STAR))
    run(vessels.ft.predict_hotspots())
    for bad, why in ((["They are poaching."], "accuses"), (["Heard as 123456789."], "identifier"),
                     (["Look north — fast."], "em dash"), (["x" * 221], "220")):
        assert why in run(vessels.tk.draft_tasking(STAR, 1, notes=bad))["error"]
    assert run(vessels.tk.draft_tasking(STAR, 4))["error"]
    assert "not candidates" in run(vessels.tk.draft_tasking(STAR, 1, candidate_ids=["T09"]))["error"]
    out = run(vessels.tk.draft_tasking(STAR, 1, candidate_ids=["T01"], notes=["Two looks are planned this week."]))
    assert out["fixed_sentence"] == vessels.vs.OFFICERS_DECISION and out["candidates"] == ["T01"]
    tid = out["tasking_id"]
    draft = vessels.s3.json(f"session_data/{SESSION}/taskings/{tid}.draft.json")
    assert draft["status"] == "draft" and draft["counts"]["candidate"] == 1 and draft["box"]["box"] == 1
    assert run(vessels.tk.tasking_status(tid))["status"] == "draft"
    vessels.s3.put_object(Bucket="test-bucket", Key=f"session_data/{SESSION}/taskings/{tid}.filed.json",
                          Body=json.dumps({"status": "filed", "filed_at": "2026-10-16T18:05:00Z"}))
    filed = run(vessels.tk.tasking_status(tid))
    assert filed["status"] == "filed" and filed["say"] == "Filed by the officer. The agent did not file it."
    assert run(vessels.tk.tasking_status("../x"))["error"]
