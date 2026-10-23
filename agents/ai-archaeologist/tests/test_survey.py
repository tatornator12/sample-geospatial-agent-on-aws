"""The condition survey (decision 10): record_condition takes enums only, only for this turn's
matches with LiDAR, only after their local relief was inspected this turn, once per site, and an
accepted verdict writes a file of enums and numbers for the stage. A refusal writes nothing."""
import asyncio
import datetime
import importlib
import json
import types

import pytest

from conftest import BUCKET, SESSION

OCTAGON = "newark-octagon"
HOPETON, HIGH_BANK, SEIP = "hopeton-earthworks", "high-bank-works", "seip-earthworks"


def _run(coro):
    return asyncio.run(coro)


def ctx(tid="tooluse_survey01"):
    return types.SimpleNamespace(tool_use={"toolUseId": tid})


@pytest.fixture()
def survey(tools):
    return importlib.import_module("survey_tools")


def _similar(tools, site=OCTAGON, k=3):
    return json.loads(_run(tools.find_similar_sites(site, top_k=k)))


def _look(tools, fake_s3, site_id, product="lrm"):
    """What show_terrain + inspect_image leave in the session: the raster and its saved rendering."""
    body = json.loads(_run(tools.show_terrain(site_id, product)))
    stem = body["s3_url"].rsplit("/", 1)[1].rsplit(".", 1)[0]
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/inspections/{stem}.png", Body=b"\x89PNG")
    return stem


def _record(survey, site_id, verdict="visible", because="ploughed_but_traced", tid="tooluse_survey01"):
    return json.loads(_run(survey.record_condition(site_id, verdict, because, tool_context=ctx(tid))))


def _survey_files(fake_s3):
    return {k: json.loads(v) for k, v in fake_s3.objects.items() if "/archaeology/survey_" in k}


def test_the_octagons_matches_carry_rank_and_lidar(tools):
    body = _similar(tools)
    assert [m["site_id"] for m in body["matches"]] == [HOPETON, HIGH_BANK, SEIP]
    assert [m["rank"] for m in body["matches"]] == [1, 2, 3]
    assert all(m["lidar"] is True for m in body["matches"])
    assert "not the LiDAR" in body["method"] and "record_condition" in body["next_steps"]


def test_an_accepted_verdict_writes_enums_and_numbers_only(tools, survey, fake_s3):
    _similar(tools)
    _look(tools, fake_s3, HOPETON)
    out = _record(survey, HOPETON, "visible", "ploughed_but_traced")
    assert out["status"] == "recorded" and out["recorded_this_turn"] == 1
    files = _survey_files(fake_s3)
    assert list(files) == [f"session_data/{SESSION}/archaeology/survey_tooluse_survey01.json"]
    body = files[f"session_data/{SESSION}/archaeology/survey_tooluse_survey01.json"]
    assert set(body) == {"turn_id", "tool_use_id", "n", "site_id", "verdict", "because", "example_id", "rank", "distance_km"}
    assert body == {**body, "tool_use_id": "tooluse_survey01", "n": 1, "site_id": HOPETON, "verdict": "visible",
                    "because": "ploughed_but_traced", "example_id": OCTAGON, "rank": 1, "distance_km": 87}
    assert body["turn_id"] == tools.current_turn()["turn_id"]


def test_three_sites_three_verdicts_in_order(tools, survey, fake_s3):
    _similar(tools)
    for i, (site, verdict, because) in enumerate([(HOPETON, "visible", "ploughed_but_traced"),
                                                  (HIGH_BANK, "faint", "ploughed_but_traced"),
                                                  (SEIP, "cannot_confirm", "low_relief_only")]):
        _look(tools, fake_s3, site)
        assert _record(survey, site, verdict, because, tid=f"tooluse_{i}")["status"] == "recorded"
    files = sorted(_survey_files(fake_s3).values(), key=lambda b: b["n"])
    assert [(b["site_id"], b["verdict"], b["n"]) for b in files] == [
        (HOPETON, "visible", 1), (HIGH_BANK, "faint", 2), (SEIP, "cannot_confirm", 3)]


@pytest.mark.parametrize("verdict,because", [
    ("seen", "walls_in_relief"), ("visible", "looks_good"), ("visible", "no_form_seen"),
    ("visible", "low_relief_only"), ("faint", "walls_in_relief"), ("cannot_confirm", "walls_in_relief"),
    (["visible"], "walls_in_relief"), ("visible", None), ("Visible", "walls_in_relief"),
])
def test_only_the_fixed_verdicts_and_their_reasons(tools, survey, fake_s3, verdict, because):
    _similar(tools)
    _look(tools, fake_s3, HOPETON)
    out = _record(survey, HOPETON, verdict, because)
    assert "error" in out and not _survey_files(fake_s3)


def test_every_allowed_pair_is_accepted(tools, survey, fake_s3):
    # Mound City (the Octagon's fifth match) has standing walls: its relief is the ±1 m one.
    pairs = [(v, b) for v, bs in survey.PAIRS.items() for b in bs]
    assert set(survey.VERDICTS) == set(survey.PAIRS) and {b for _, b in pairs} == set(survey.BECAUSE)
    for i, (verdict, because) in enumerate(pairs):
        tools.begin_turn()
        _similar(tools, k=5)
        _look(tools, fake_s3, "mound-city-group")
        assert _record(survey, "mound-city-group", verdict, because, tid=f"tooluse_pair{i}")["status"] == "recorded"


def test_ploughed_walls_never_stand_in_relief(tools, survey, fake_s3):
    # The build stretched Hopeton, High Bank and Seip to ±0.3 m: their walls are ploughed down.
    _similar(tools)
    for site in (HOPETON, HIGH_BANK, SEIP):
        _look(tools, fake_s3, site)
        out = _record(survey, site, "visible", "walls_in_relief")
        assert out["error"] == survey.PLOUGHED.format(name=tools.catalogue()[site]["names"][0])
    assert not _survey_files(fake_s3)
    assert _record(survey, HOPETON, "visible", "ploughed_but_traced")["status"] == "recorded"


def test_refused_until_the_sites_local_relief_was_inspected_this_turn(tools, survey, fake_s3):
    _similar(tools)
    assert _record(survey, HOPETON)["error"] == survey.LOOK_FIRST          # nothing looked at
    _look(tools, fake_s3, HOPETON, product="hillshade")
    assert _record(survey, HOPETON)["error"] == survey.LOOK_FIRST          # the hillshade is not the relief
    _look(tools, fake_s3, HIGH_BANK)
    assert _record(survey, HOPETON)["error"] == survey.LOOK_FIRST          # another site's relief
    assert not _survey_files(fake_s3)


def test_an_inspection_from_an_earlier_turn_does_not_count(tools, survey, fake_s3):
    _similar(tools)
    stem = _look(tools, fake_s3, HOPETON)
    key = f"session_data/{SESSION}/inspections/{stem}.png"
    fake_s3.modified[key] -= datetime.timedelta(seconds=survey.CLOCK_SLACK_S + 60)
    assert _record(survey, HOPETON)["error"] == survey.LOOK_FIRST and not _survey_files(fake_s3)


def test_only_this_turns_matches(tools, survey, fake_s3):
    _look(tools, fake_s3, HOPETON)
    assert _record(survey, HOPETON)["error"] == survey.NOT_A_MATCH       # no find_similar_sites yet
    _similar(tools)
    _look(tools, fake_s3, "serpent-mound")
    assert _record(survey, "serpent-mound")["error"] == survey.NOT_A_MATCH  # on the record, not a match
    _look(tools, fake_s3, OCTAGON)
    assert _record(survey, OCTAGON)["error"] == survey.NOT_A_MATCH       # the example itself
    tools.begin_turn()                                                     # a new question
    _look(tools, fake_s3, HOPETON)
    assert _record(survey, HOPETON)["error"] == survey.NOT_A_MATCH       # last turn's matches are gone
    assert not _survey_files(fake_s3)


def test_a_site_off_the_record_gets_the_fixed_refusal(tools, survey, fake_s3):
    _similar(tools)
    for bad in ("lost-city-of-cibola", "../sessions", "", 7, None):
        out = _record(survey, bad)
        assert out["error"] == tools.REFUSAL and "known_sites" in out
    assert not _survey_files(fake_s3)


def test_a_match_without_local_relief_is_skipped_never_judged(tools, survey, fake_s3):
    man = json.loads(fake_s3.objects[tools.MANIFEST_KEY])
    del man["sites"][HIGH_BANK]["products"]["lrm"]
    fake_s3.put_object(Bucket=BUCKET, Key=tools.MANIFEST_KEY, Body=json.dumps(man).encode())
    tools._manifest_cache.clear()
    body = _similar(tools)
    assert {m["site_id"]: m["lidar"] for m in body["matches"]}[HIGH_BANK] is False
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/inspections/lrm03_{HIGH_BANK}.png", Body=b"x")
    out = _record(survey, HIGH_BANK, "cannot_confirm", "no_form_seen")
    assert out["error"] == survey.NO_LIDAR.format(name="High Bank Works") and not _survey_files(fake_s3)


def test_one_verdict_per_site_per_turn(tools, survey, fake_s3):
    _similar(tools)
    _look(tools, fake_s3, HOPETON)
    assert _record(survey, HOPETON, tid="tooluse_a")["status"] == "recorded"
    out = _record(survey, HOPETON, "faint", "low_relief_only", tid="tooluse_b")
    assert out["error"] == survey.ALREADY.format(name="Hopeton Earthworks")
    assert list(_survey_files(fake_s3)) == [f"session_data/{SESSION}/archaeology/survey_tooluse_a.json"]


@pytest.mark.parametrize("context", [None, types.SimpleNamespace(tool_use={}),
                                     types.SimpleNamespace(tool_use={"toolUseId": "../x"}),
                                     types.SimpleNamespace(tool_use={"toolUseId": "a" * 65})])
def test_no_safe_tool_use_id_writes_nothing(tools, survey, fake_s3, context):
    _similar(tools)
    _look(tools, fake_s3, HOPETON)
    out = json.loads(_run(survey.record_condition(HOPETON, "visible", "ploughed_but_traced", tool_context=context)))
    assert out["error"] == survey.NOT_RECORDED and not _survey_files(fake_s3)
    assert HOPETON not in tools.current_turn()["recorded"]


def test_a_failed_write_is_not_a_verdict(tools, survey, fake_s3):
    _similar(tools)
    _look(tools, fake_s3, HOPETON)
    fake_s3.fail_put = True
    assert "error" in _record(survey, HOPETON)
    fake_s3.fail_put = False
    assert _record(survey, HOPETON)["status"] == "recorded"               # the retry is not "already"


# --- the close look: show_terrain(site_id, "lrm", extent="site") ------------------------------------

def _relief(path, half=800):
    """A synthetic local relief on the Great Circle's grid, 2*half metres square at 1 m."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from conftest import CENTRE_UTM
    n = 2 * half
    z = np.random.default_rng(1).normal(0, 0.2, (n, n)).astype("float32")
    with rasterio.open(path, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32", crs="EPSG:32617",
                       transform=from_origin(CENTRE_UTM[0] - half, CENTRE_UTM[1] + half, 1.0, 1.0), nodata=-9999.0) as ds:
        ds.write(z, 1)
    return str(path)


def test_the_site_extent_cuts_the_centre_1200_m_into_the_session(tools, fake_s3, monkeypatch, tmp_path):
    import rasterio
    from rasterio.io import MemoryFile
    src = _relief(tmp_path / "lrm.tif")
    monkeypatch.setattr(tools, "_lrm_path", lambda site_id: src)
    body = json.loads(_run(tools.show_terrain("newark-great-circle", "lrm", extent="site")))
    key = f"session_data/{SESSION}/terrain/lrm_newark-great-circle_site.tif"
    assert body["s3_url"] == f"s3://{BUCKET}/{key}" and "centre 1200 m" in body["extent"]
    assert body["render"]["bounds"] == body["bounds"] and body["render"]["legend"] == "Local relief"
    with MemoryFile(fake_s3.objects[key]) as mem, mem.open() as ds:
        assert (ds.width, ds.height) == (1200, 1200) and ds.res == (1.0, 1.0) and ds.overviews(1) == [2, 4]
        with rasterio.open(src) as full:
            assert ds.read(1)[0, 0] == full.read(1)[200, 200]       # the window's corner, 200 m in
    w, s, e, n = body["bounds"]
    assert 0.0135 < e - w < 0.0145 and 0.0105 < n - s < 0.0112       # about 1.2 km at 40 degrees north
    site = tools.catalogue()["newark-great-circle"]["centre"]
    assert w < site["lon"] < e and s < site["lat"] < n


def test_the_site_extent_is_for_the_relief_only_and_a_bad_extent_is_refused(tools, fake_s3):
    for args in (("newark-great-circle", "hillshade", "site"), ("newark-great-circle", "lrm", "zoom")):
        assert "error" in json.loads(_run(tools.show_terrain(*args)))
    assert not [k for k in fake_s3.objects if k.endswith("_site.tif")]


def test_a_ploughed_sites_relief_carries_its_note(tools, fake_s3):
    assert "ploughed" in json.loads(_run(tools.show_terrain(HOPETON, "lrm")))["relief_note"]
    assert "relief_note" not in json.loads(_run(tools.show_terrain("mound-city-group", "lrm")))


def test_a_close_look_counts_as_the_look(tools, survey, fake_s3):
    _similar(tools)
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/inspections/lrm03_{SEIP}_site.png", Body=b"x")
    assert _record(survey, SEIP, "faint", "low_relief_only")["status"] == "recorded"


def _response(*uses):
    """The assistant message Strands appends before it runs a response's tools."""
    return {"role": "assistant", "content": [{"text": "Looking."}] +
            [{"toolUse": {"toolUseId": f"t{i}", "name": n, "input": inp}} for i, (n, inp) in enumerate(uses)]}


def test_a_verdict_in_the_same_response_as_its_look_is_refused(tools, survey, fake_s3):
    # Strands runs a response's calls one after another: by the time record_condition runs, the
    # look's file is already in S3, but the verdict was chosen before the image came back.
    _similar(tools)
    stem = _look(tools, fake_s3, HOPETON)
    same = _response(("inspect_image", {"s3_url": f"s3://{BUCKET}/session_data/{SESSION}/terrain/{stem}.tif"}),
                     ("record_condition", {"site_id": HOPETON, "verdict": "visible", "because": "ploughed_but_traced"}))
    context = types.SimpleNamespace(tool_use={"toolUseId": "tooluse_same"}, agent=types.SimpleNamespace(messages=[same]))
    out = json.loads(_run(survey.record_condition(HOPETON, "visible", "ploughed_but_traced", tool_context=context)))
    # Its own reason: the image has come back, so judge it next rather than cut and look again.
    assert out["error"] == survey.SAME_RESPONSE.format(name="Hopeton Earthworks") and not _survey_files(fake_s3)
    assert "Do not look again" in out["error"] and out["error"] != survey.LOOK_FIRST
    # The next response, which only judges, is accepted; so is one that looks at another site.
    later = _response(("inspect_image", {"s3_url": f"s3://{BUCKET}/session_data/{SESSION}/terrain/lrm03_{SEIP}_site.tif"}),
                      ("record_condition", {"site_id": HOPETON}))
    context = types.SimpleNamespace(tool_use={"toolUseId": "tooluse_next"}, agent=types.SimpleNamespace(messages=[same, later]))
    out = json.loads(_run(survey.record_condition(HOPETON, "visible", "ploughed_but_traced", tool_context=context)))
    assert out["status"] == "recorded"


def test_looked_in_this_response_reads_only_the_last_assistant_message(survey):
    look = ("inspect_image", {"s3_url": "s3://b/session_data/s/terrain/lrm03_high-bank-works_site.tif"})
    ns = lambda *messages: types.SimpleNamespace(agent=types.SimpleNamespace(messages=list(messages)))
    assert survey.looked_in_this_response(ns(_response(look)), HIGH_BANK)
    assert survey.looked_in_this_response(ns(_response(("inspect_image", {"s3_url": "s3://b/x/lrm_high-bank-works.tif"}))), HIGH_BANK)
    assert not survey.looked_in_this_response(ns(_response(look)), HOPETON)
    assert not survey.looked_in_this_response(ns(_response(look), {"role": "user", "content": []}), HIGH_BANK)
    assert not survey.looked_in_this_response(ns(), HIGH_BANK)
    assert not survey.looked_in_this_response(None, HIGH_BANK)
    assert not survey.looked_in_this_response(ns(_response(("inspect_image", {"s3_url": "s3://b/x/hillshade_high-bank-works.tif"}))), HIGH_BANK)


def test_a_failed_upload_of_the_close_look_is_the_fixed_error(tools, fake_s3, monkeypatch, tmp_path):
    src = _relief(tmp_path / "lrm.tif")
    monkeypatch.setattr(tools, "_lrm_path", lambda site_id: src)
    fake_s3.fail_put = True
    out = json.loads(_run(tools.show_terrain("newark-great-circle", "lrm", extent="site")))
    assert out["error"] == "The site's relief for Great Circle Earthworks could not be cut (RuntimeError)."
