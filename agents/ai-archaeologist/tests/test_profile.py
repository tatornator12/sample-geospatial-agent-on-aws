"""Measure what it sees (requirement 4): banks, ditches and the span on a synthetic earthwork with
known dimensions, through the pure profile module and through the tool."""
import asyncio
import inspect
import json
import math

import numpy as np
import pytest
from rasterio.warp import transform as warp_transform

import earthwork_profile as ep
from conftest import (BANK_H, BANK_R, CENTRE_UTM, DITCH_D, GROUND_M, SESSION, lonlat, make_dem)

PROFILE_KEY = f"session_data/{SESSION}/terrain/profile_newark-great-circle.geojson"


def _run(coro):
    return asyncio.run(coro)


def test_analyse_finds_both_banks_both_ditches_and_the_span():
    d = np.arange(0, 431, 1.0)
    r = np.abs(d - 215)
    z = GROUND_M + BANK_H * np.exp(-((r - BANK_R) / 6) ** 2) - DITCH_D * np.exp(-((r - 168) / 5) ** 2)
    out = ep.analyse(d, z)
    kinds = [f["kind"] for f in out["features"]]
    assert kinds == ["bank", "ditch", "ditch", "bank"]
    assert out["outer_banks_span_m"] == 2 * BANK_R
    banks = [f for f in out["features"] if f["kind"] == "bank"]
    assert all(abs(f["offset_m"] - BANK_H) < 0.05 for f in banks)
    assert out["baseline_m"] == GROUND_M


def test_the_ends_of_the_line_are_never_a_bank_or_a_ditch():
    # Ground falling away at the east end (the Great Circle's line ends in a slope): the last
    # sample is the lowest in its half-window, but there is no ground past it to call it a ditch.
    d = np.arange(0, 431, 1.0)
    r = np.abs(d - 215)
    z = GROUND_M + BANK_H * np.exp(-((r - BANK_R) / 6) ** 2) - DITCH_D * np.exp(-((r - 168) / 5) ** 2)
    z = z - np.clip(d - 410, 0, None) * 0.06
    z[:6] += np.linspace(1.2, 0, 6)
    out = ep.analyse(d, z)
    assert [f["kind"] for f in out["features"]] == ["bank", "ditch", "ditch", "bank"]
    half = ep.WINDOW_M
    assert all(half <= f["at_m"] <= d[-1] - half for f in out["features"])


def test_too_little_lidar_is_an_error():
    d = np.arange(0, 100, 1.0)
    z = np.full(100, np.nan)
    z[:30] = 263.0
    try:
        ep.analyse(d, z)
    except ValueError as e:
        assert "50 m" in str(e)
    else:
        raise AssertionError("expected a ValueError")


def _synthetic_site(tools, monkeypatch, tmp_path, transect=True):
    path = make_dem(tmp_path / "dem.tif")
    lon, lat = lonlat(*CENTRE_UTM)
    site = dict(tools.catalogue()["newark-great-circle"])
    site["centre"] = {"lat": lat, "lon": lon, "verified": True}
    site["transect"] = ({"coords": [list(lonlat(CENTRE_UTM[0] - 215, CENTRE_UTM[1])),
                                    list(lonlat(CENTRE_UTM[0] + 215, CENTRE_UTM[1]))], "label": "east-west (430 m)"}
                        if transect else None)
    monkeypatch.setattr(tools, "catalogue", lambda: {"newark-great-circle": site})
    monkeypatch.setattr(tools, "_dem_path", lambda sid: str(path))
    tools._manifest_cache.update(at=10**12, body={"version": "v1", "sites": {"newark-great-circle": {
        "bounds": [lon - 0.004, lat - 0.004, lon + 0.004, lat + 0.004], "tiles": []}}})
    return site


def test_measure_profile_reproduces_the_synthetic_ring(tools, fake_s3, monkeypatch, tmp_path):
    _synthetic_site(tools, monkeypatch, tmp_path)
    body = json.loads(_run(tools.measure_profile("newark-great-circle")))
    assert body["transect_verified"] and abs(body["outer_banks_span_m"] - 2 * BANK_R) <= 2
    ditches = [f for f in body["features"] if f["kind"] == "ditch"]
    banks = [f for f in body["features"] if f["kind"] == "bank"]
    assert len(banks) == 2 and len(ditches) == 2
    assert all(abs(f["offset_m"] - BANK_H) < 0.2 for f in banks)
    assert all(abs(f["offset_m"] + DITCH_D) < 0.2 for f in ditches)
    assert body["documented"][0]["value_m"] == 366
    key = f"session_data/{SESSION}/terrain/profile_newark-great-circle.geojson"
    feats = json.loads(fake_s3.objects[key])["features"]
    assert feats[0]["geometry"]["type"] == "LineString" and len(feats) == 5
    assert feats[1]["properties"]["label"].startswith("bank +2.")
    # The line carries the section the stage draws: every metre of a 430 m line, offsets from the
    # baseline, the banks at their height; each mark knows where it sits along the line.
    line = feats[0]["properties"]
    assert line["length_m"] == body["length_m"] and line["baseline_m"] == body["baseline_m"]
    assert line["outer_banks_span_m"] == body["outer_banks_span_m"]
    prof = line["profile"]
    assert 400 <= len(prof) <= 431 and prof[0][0] == 0.0 and prof[-1][0] == body["length_m"]
    assert max(p[1] for p in prof if p[1] is not None) > BANK_H - 0.2
    assert all(abs(f["at_m"] - m["properties"]["at_m"]) < 1e-6 for f, m in zip(body["features"], feats[1:]))


def test_thin_keeps_a_long_line_small_and_marks_gaps():
    d = np.arange(0, 3001, 1.0)
    z = np.full(3001, 250.0)
    z[100:110] = np.nan
    prof = ep.thin(d, z, 250.0)
    assert len(prof) <= ep.MAX_PROFILE_POINTS + 1 and prof[0] == [0.0, 0.0] and prof[-1][0] == 3000.0
    assert any(p[1] is None for p in prof)
    short = ep.thin(np.arange(0, 51, 1.0), np.full(51, 1.5), 1.0)
    assert len(short) == 51 and short[3] == [3.0, 0.5]


def test_without_a_verified_transect_it_crosses_the_centre_east_west(tools, monkeypatch, tmp_path):
    _synthetic_site(tools, monkeypatch, tmp_path, transect=False)
    body = json.loads(_run(tools.measure_profile("newark-great-circle")))
    assert body["transect_verified"] is False and body["transect"].startswith("east-west through the centre")
    assert abs(body["outer_banks_span_m"] - 2 * BANK_R) <= 3
    assert body["line_source"] == "default" and body["bearing"] is None


def test_no_bearing_keeps_the_record_s_verified_line(tools, monkeypatch, tmp_path):
    _synthetic_site(tools, monkeypatch, tmp_path)
    body = json.loads(_run(tools.measure_profile("newark-great-circle")))
    assert body["line_source"] == "verified" and body["bearing"] is None and body["transect"] == "east-west (430 m)"
    assert "record's verified line" in body["next_steps"]


def _utm(coords):
    xs, ys = warp_transform("EPSG:4326", "EPSG:32617", [c[0] for c in coords], [c[1] for c in coords])
    return list(zip(xs, ys))


# The agent's line (decision 9): one of four bearings through the centre, 600 m, never coordinates.
# The azimuth runs from the line's first point to its last (the western end first; N-S from the north).
@pytest.mark.parametrize("code, words, azimuth", [
    ("n-s", "north-south", 180), ("ne-sw", "north-east to south-west", 45),
    ("e-w", "east-west", 90), ("nw-se", "north-west to south-east", 135),
])
def test_each_bearing_crosses_the_ring_through_the_centre(tools, fake_s3, monkeypatch, tmp_path, code, words, azimuth):
    _synthetic_site(tools, monkeypatch, tmp_path)
    body = json.loads(_run(tools.measure_profile("newark-great-circle", code)))
    assert abs(body["length_m"] - tools.DEFAULT_TRANSECT_M) <= 2
    assert abs(body["outer_banks_span_m"] - 2 * BANK_R) <= 3
    assert body["line_source"] == "bearing" and body["bearing"] == code and body["transect_verified"] is False
    assert body["transect"] == f"{words} through the centre (600 m)"
    assert words in body["next_steps"] and "never the code" in body["next_steps"]
    line = json.loads(fake_s3.objects[PROFILE_KEY])["features"][0]
    assert line["properties"]["label"] == body["transect"]
    (x0, y0), (x1, y1) = _utm(line["geometry"]["coordinates"])
    # UTM grid north is within about a degree of true north this far from the zone's meridian.
    got = math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360
    assert abs(got - azimuth) < 1.5
    assert math.hypot((x0 + x1) / 2 - CENTRE_UTM[0], (y0 + y1) / 2 - CENTRE_UTM[1]) < 2


def test_the_nw_se_line_runs_from_its_north_west_end(tools, fake_s3, monkeypatch, tmp_path):
    _synthetic_site(tools, monkeypatch, tmp_path)
    json.loads(_run(tools.measure_profile("newark-great-circle", " NW-SE ")))
    (lon0, lat0), (lon1, lat1) = json.loads(fake_s3.objects[PROFILE_KEY])["features"][0]["geometry"]["coordinates"]
    assert lon0 < lon1 and lat0 > lat1


def test_a_bearing_outside_the_four_is_an_error_and_writes_nothing(tools, fake_s3, monkeypatch, tmp_path):
    _synthetic_site(tools, monkeypatch, tmp_path)
    for bad in ("north-west", "nw\u2013se", "NW SE", "", "<b>nw</b>", 135, [[0, 0], [1, 1]]):
        body = json.loads(_run(tools.measure_profile("newark-great-circle", bad)))
        assert body["error"].startswith("bearing must be one of n-s, ne-sw, e-w, nw-se"), bad
    assert PROFILE_KEY not in fake_s3.objects
    assert json.loads(_run(tools.measure_profile("somewhere-else", "e-w")))["error"] == tools.REFUSAL


def test_a_line_with_no_bank_says_it_cannot_confirm_one(tools, monkeypatch, tmp_path):
    site = _synthetic_site(tools, monkeypatch, tmp_path)
    built = tools.manifest()["sites"]["newark-great-circle"]
    inside = [list(lonlat(*CENTRE_UTM)), list(lonlat(CENTRE_UTM[0] + 150, CENTRE_UTM[1]))]
    body = tools._measure_line(site, built, inside, "inside the ring", False, line_source="bearing")
    assert body["features"] == [] and body["outer_banks_span_m"] is None
    assert tools.NO_BANK == "I cannot confirm a bank on this line." and tools.NO_BANK in body["next_steps"]
    one = [list(lonlat(*CENTRE_UTM)), list(lonlat(CENTRE_UTM[0] + 250, CENTRE_UTM[1]))]
    body = tools._measure_line(site, built, one, "to the east bank", False, line_source="bearing")
    assert [f["kind"] for f in body["features"]] == ["ditch", "bank"] and body["outer_banks_span_m"] is None
    assert "one bank" in body["next_steps"] and tools.NO_BANK not in body["next_steps"]


def test_a_line_must_be_inside_the_frame_and_a_sane_length(tools, monkeypatch, tmp_path):
    site = _synthetic_site(tools, monkeypatch, tmp_path)
    built = tools.manifest()["sites"]["newark-great-circle"]
    a, b = site["transect"]["coords"]
    ok = tools._measure_line(site, built, [a, b], "a test line", False, line_source="default")
    assert "error" not in ok and ok["transect"] == "a test line"
    far = [[a[0] + 1.0, a[1]], [b[0] + 1.0, b[1]]]
    assert "inside the site's frame" in tools._measure_line(site, built, far, "far", False)["error"]
    short = [a, [a[0] + 0.0001, a[1]]]
    assert "50 to 3000 m" in tools._measure_line(site, built, short, "short", False)["error"]
    assert json.loads(_run(tools.measure_profile("somewhere-else")))["error"] == tools.REFUSAL
    # The model can no longer write a line: the tool takes a site and, at most, one of four bearings.
    assert list(inspect.signature(tools.measure_profile).parameters) == ["site_id", "bearing"]
