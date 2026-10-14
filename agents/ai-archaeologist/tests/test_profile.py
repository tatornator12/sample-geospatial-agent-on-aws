"""Measure what it sees (requirement 4): banks, ditches and the span on a synthetic earthwork with
known dimensions, through the pure profile module and through the tool."""
import asyncio
import json

import numpy as np

import earthwork_profile as ep
from conftest import (BANK_H, BANK_R, CENTRE_UTM, DITCH_D, GROUND_M, SESSION, lonlat, make_dem)


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


def test_a_given_transect_must_be_inside_the_frame_and_a_sane_length(tools, monkeypatch, tmp_path):
    site = _synthetic_site(tools, monkeypatch, tmp_path)
    a, b = site["transect"]["coords"]
    ok = json.loads(_run(tools.measure_profile("newark-great-circle", json.dumps([a, b]))))
    assert "error" not in ok and ok["transect"] == "the given transect"
    far = [[a[0] + 1.0, a[1]], [b[0] + 1.0, b[1]]]
    assert "inside the site's frame" in json.loads(_run(tools.measure_profile("newark-great-circle", far)))["error"]
    short = [a, [a[0] + 0.0001, a[1]]]
    assert "50 to 3000 m" in json.loads(_run(tools.measure_profile("newark-great-circle", short)))["error"]
    assert "must be [[lon, lat]" in json.loads(_run(tools.measure_profile("newark-great-circle", [[1, 2]])))["error"]
    assert json.loads(_run(tools.measure_profile("somewhere-else")))["error"] == tools.REFUSAL
