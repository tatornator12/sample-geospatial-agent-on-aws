"""The agent's tools on a synthetic cache (conftest): the order (no candidate before the coverage
check), every status, the evidence, the predictions with their checks, the next look, the silent
vessel's reach, and the tasking's validator. No network."""
import asyncio
import json
import re
import types
from datetime import datetime, timezone

import pytest

from conftest import A, C, SESSION, SILENT, STAR

PRE = f"session_data/{SESSION}/vessels/"


def run(coro):
    return json.loads(asyncio.run(coro))


def ctx(tid: str):
    return types.SimpleNamespace(tool_use={"toolUseId": tid})


def test_the_synthetic_targets_lie_in_the_reserves_water(vessels):
    from conftest import B, D, E, P
    for name, (lon, lat) in dict(A=A, B=B, C=C, D=D, E=E, P=P).items():
        assert vessels.vs.in_reserve(lon, lat), f"{name} is not in the reserve's water"


def test_find_pass_latest_is_the_newest_pass_and_copies_its_radar_into_the_session(vessels):
    out = run(vessels.pt.find_pass("latest"))
    assert out["pass_id"] == STAR and out["sensed_text"] == "Oct 12, 2026 00:18 UTC"
    # There is no star: no role, and the share is the one the pass imaged, not its footprint's.
    assert "role" not in out and "reserve_share" not in out and out["imaged_share"] == 0.527
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
    assert out["counts"] == {"ours": 5, "gfw": 5, "both": 4, "port": 1, "claimed_by_ais": 1, "targets": 6}
    layer = vessels.s3.json(f"{PRE}targets_{STAR}.geojson")
    assert {f["properties"]["status"] for f in layer["features"]} == {"detected", "port"}
    assert "candidate" not in json.dumps(out)
    # The claim beat (before coverage): the broadcast that accounts for C, its hairline's far end;
    # the targets left alone carry nothing that calls them dark.
    claimed = [f for f in layer["features"] if f["properties"].get("claimed")]
    assert len(claimed) == 1 and claimed[0]["geometry"]["coordinates"][0] == pytest.approx(C[0], abs=0.01)
    assert claimed[0]["properties"]["claim"] and all("label" not in f["properties"] for f in layer["features"])


def test_nothing_is_a_candidate_before_the_coverage_check(vessels):
    out = run(vessels.ais.match_ais(STAR))
    assert "check_ais_coverage first" in out["error"]


def test_coverage_then_match_gives_every_status_in_order(vessels):
    cov = run(vessels.ais.check_ais_coverage(STAR))
    assert (cov["imaged_share"], cov["heard_share"], cov["checkable_share"]) == (0.527, 0.351, 0.246)
    assert cov["standard"] == 0.15 and cov["checkable_pct"] == 25 and cov["unexplained"] == {"received": 3, "unknown": 1}
    assert cov["unproven_means"] == "reception unknown: no AIS there proves nothing"
    # The room's words: AIS received and reception unknown, never heard water, unproven or not evidence.
    assert (cov["heard_render"]["legend"], cov["unproven_render"]["legend"]) == ("AIS received", "AIS reception unknown")
    assert cov["rule"].startswith("received: ")
    assert not re.search(r"heard water|unproven|not evidence|could be heard", cov["rule"] + cov["unproven_means"], re.I)
    heard_props = vessels.s3.json(f"{PRE}heard_{STAR}.geojson")["features"][0]["properties"]
    # The stage quotes the tool's shares, never its own measure.
    assert heard_props == {"kind": "heard", "share": 0.351, "imaged": 0.527, "checkable": 0.246, "standard": 0.15}
    out = run(vessels.ais.match_ais(STAR))
    assert out["counts"] == {"broadcasting": 1, "port": 1, "unproven": 1, "seen_once": 2, "candidate": 1}
    assert out["say_in_order"][0] == "broadcasting" and out["fixed_sentence"] == vessels.vs.CANDIDATE_SENTENCE
    assert set(out["say_as"]) == set(out["say_in_order"]) and out["say_as"]["unproven"] == "reception unknown"
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
    assert out["say_else"] == "Each could be a small boat, a missed or switched-off AIS, or not a vessel."
    assert len(out["say_else"].split()) == 15 and "being received" in out["confidence"]
    assert not re.search(r"\bheard\b|unproven|not evidence", out["confidence"] + json.dumps(out["innocent_explanations"]))
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
    rolling = out["rolling"]
    assert (rolling["since"], rolling["until"]) == ("2026-07-01", "2026-10-12") and rolling["dark_targets"] > 0
    assert 0 < rolling["days_hit"] <= rolling["radar_days"]
    assert out["say"].startswith("Refitted before each radar day since July, the map's top 5% of water held")
    assert out["say_boxes"].startswith("Refitted the same way, the three patrol boxes held")
    assert "check" not in out                                    # the room hears the rolling check only
    assert not re.search(r"\d\.\d{2}", out["say"] + out["say_boxes"] + json.dumps(rolling))   # numbers the room can hear
    record = vessels.s3.json(f"{PRE}hotspots.json")
    assert record["check"]["top_5pct"]["total"] > 0 and record["rolling"]["total"] == rolling["dark_targets"]   # the hold-out kept
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


def test_next_look_refreshes_a_stale_plan_through_the_chain(vessels, monkeypatch):
    """Over 24 h old, the runtime asks ESA itself: the listing's chain (here one long plan, the short
    newest one already over) is fetched, merged and named; the looks come from it."""
    from conftest import FIXTURES, PLAN_FIXTURE
    listing = (f'<a href="/documents/d/sentinel/s1d_mp_user_20261012t184114_20261018t204800">short, over</a>'
               f'<a href="/documents/d/sentinel/{PLAN_FIXTURE[:-4]}">long</a>').encode()
    asked = []

    class Reply:
        def __init__(self, body):
            self.body = body

        def read(self):
            return self.body

    def urlopen(req, timeout=None):
        url = getattr(req, "full_url", req)
        asked.append(url)
        return Reply(listing if url == vessels.ft.LISTING else (FIXTURES / PLAN_FIXTURE).read_bytes())

    monkeypatch.setattr(vessels.ft, "_now", lambda: datetime(2026, 10, 19, 20, tzinfo=timezone.utc))
    monkeypatch.setattr(vessels.ft.urllib.request, "urlopen", urlopen)
    vessels.ft._plan_cache.clear()
    out = run(vessels.ft.next_look())
    assert out["plan"]["refreshed"] is True and out["plan"]["plans"]["s1d"]["name"] == PLAN_FIXTURE[:-4]
    assert asked == [vessels.ft.LISTING, f"{vessels.ft.HOST}/documents/d/sentinel/{PLAN_FIXTURE[:-4]}"]
    assert out["looks"] and out["looks"][0]["start"] >= "2026-10-19T20"


def test_next_look_reads_a_cached_chain(vessels, fake_s3):
    """latest.json from warm_vessels names a chain per satellite; each file is read and merged."""
    from conftest import BUCKET, PLAN_FIXTURE
    key = f"vessels/cache/plan/{PLAN_FIXTURE[:-4]}.kml"
    fake_s3.put_object(Bucket=BUCKET, Key="vessels/cache/plan/latest.json", Body=json.dumps({
        "fetched_at": "2026-10-16T17:30:00Z", "plans": {"s1d": {
            "key": key, "name": PLAN_FIXTURE[:-4], "period": ["2026-10-16T17:54:23Z", "2026-11-05T20:02:00Z"],
            "chain": [{"key": key, "name": PLAN_FIXTURE[:-4], "period": ["2026-10-16T17:54:23Z", "2026-11-05T20:02:00Z"]}]}}}))
    vessels.ft._plan_cache.clear()
    out = run(vessels.ft.next_look())
    assert out["looks"] and out["plan"]["refreshed"] is False and out["plan"]["plans"]["s1d"]["name"] == PLAN_FIXTURE[:-4]


def test_reachable_area_goes_by_water_and_keeps_the_reveal_for_last(vessels):
    out = run(vessels.ft.reachable_area())
    assert out["pass_id"] == SILENT and out["speed_kn"] == 6.0 and out["hours"] == 12.0 and out["reach_km"] == 133
    assert [t["source"] for t in out["targets_inside"]] == ["gfw"] and out["targets_inside"][0]["km_by_water"] < 60
    assert out["back_on"]["km_from_off"] == pytest.approx(24.4, abs=2) and out["fixed_sentence"] == vessels.vs.CANNOT_SAY
    kinds = [f["properties"]["kind"] for f in vessels.s3.json(f"{PRE}reach_{SILENT}.geojson")["features"]]
    assert kinds[0] == "reach" and kinds[-1] == "on" and "off" in kinds


def test_the_tasking_is_drafted_from_the_records_and_only_the_officer_files_it(vessels):
    # One question: the pass and the box announced with decide, the records written in it.
    vessels.vs.begin_turn("Is anyone in the reserve without broadcasting, and where should the patrol look next?")
    run(vessels.pt.list_passes(tool_context=ctx("tooluse_list")))
    assert run(vessels.dt.decide("read_pass", "newest", STAR, tool_context=ctx("tooluse_read")))["status"] == "noted"
    run(vessels.ais.check_ais_coverage(STAR))
    run(vessels.ais.match_ais(STAR))
    run(vessels.ft.predict_hotspots(STAR))
    assert "decide(draft" in run(vessels.tk.draft_tasking(STAR, 1))["error"]
    assert run(vessels.dt.decide("draft", "most_past_targets", box=1, tool_context=ctx("tooluse_draft")))["status"] == "noted"
    for bad, why in ((["They are poaching."], "accuses"), (["Heard as 123456789."], "identifier"),
                     (["Look north — fast."], "em dash"), (["x" * 221], "220")):
        assert why in run(vessels.tk.draft_tasking(STAR, 1, notes=bad))["error"]
    assert run(vessels.tk.draft_tasking(STAR, 4))["error"] == "You decided box 1."
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
    # The filed sentence lives on the plate only; the agent says when, never who.
    assert filed["status"] == "filed" and filed["say"] == "Yes, it is on file: filed at 18:05 UTC."
    vessels.s3.put_object(Bucket="test-bucket", Key=f"session_data/{SESSION}/taskings/{tid}.filed.json",
                          Body=json.dumps({"status": "filed"}))
    assert run(vessels.tk.tasking_status(tid))["say"] == "Yes, it is on file."
    assert run(vessels.tk.tasking_status("../x"))["error"]


# --- display_visual: only files this session wrote ------------------------------------------------

def test_display_visual_passes_a_file_the_session_wrote(vessels):
    import display_tools
    url = vessels.vs.put_json(f"{vessels.vs.vessels_prefix()}fleet_2026-10.geojson", {"type": "FeatureCollection", "features": []})
    out = json.loads(asyncio.run(display_tools.display_visual(url, "Squid fleet")))
    assert out == {"status": "success"}


def test_display_visual_refuses_a_mistyped_file_and_names_the_one_meant(vessels):
    import display_tools
    url = vessels.vs.put_json(f"{vessels.vs.vessels_prefix()}fleet_2026-10.geojson", {"type": "FeatureCollection", "features": []})
    out = json.loads(asyncio.run(display_tools.display_visual(url.replace("2026-10", "2026_10"), "Squid fleet")))
    assert "not in this session" in out["error"]
    assert out["did_you_mean"] == url
    # Nothing like it: refused without a guess.
    out = json.loads(asyncio.run(display_tools.display_visual(url.replace("fleet_2026-10", "boxes_v2"), "Boxes")))
    assert "did_you_mean" not in out and "not in this session" in out["error"]


def test_display_visual_leaves_files_outside_the_session_to_the_stage(vessels):
    import display_tools
    out = json.loads(asyncio.run(display_tools.display_visual("s3://test-bucket/use-cases/vessels-galapagos/boxes.geojson", "Boxes")))
    assert out == {"status": "success"}
