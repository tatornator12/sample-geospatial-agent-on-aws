"""triage_plumes and show_plume: stats, ranking, cache, failures, token handling."""
import asyncio
import json
import math

import pytest

from conftest import (BUCKET, PLUME_BASE, PLUME_ID, PLUME_ID_2, PLUME_ID_3, PLUME_PEAK, PLUME_PX,
                       PLUME_VALID, SESSION, footprint, make_plume_bytes, put_plume_list)

TOKEN = "test-token-value-xyz"


def _run(coro):
    return asyncio.run(coro)


def _patch_download(tools, monkeypatch, payloads: dict, calls=None):
    """payloads: granule id -> bytes, or a PlumeFetchError reason string to raise."""
    def fake_download(gid, token, *a, **k):
        if calls is not None:
            calls.append((gid, token))
        v = payloads[gid]
        if isinstance(v, str):
            raise tools.PlumeFetchError(v)
        return v
    monkeypatch.setattr(tools, "download_plume", fake_download)


# --- stats -------------------------------------------------------------------------------------

def test_plume_stats_are_exact_on_the_synthetic_plume():
    import methane_tools as t
    s = t.plume_stats(make_plume_bytes(), center_lat=32.24)
    assert s["max_ppm_m"] == pytest.approx(PLUME_PEAK, abs=0.05)
    expected_mean = (PLUME_PEAK + PLUME_BASE * (PLUME_VALID - 1)) / PLUME_VALID
    assert s["mean_ppm_m"] == pytest.approx(expected_mean, abs=0.05)
    assert s["plume_pixels"] == PLUME_VALID
    px_km2 = (PLUME_PX * 111.320 * math.cos(math.radians(32.24))) * (PLUME_PX * 110.574)
    assert s["plume_area_km2"] == pytest.approx(PLUME_VALID * px_km2, abs=0.01)


def test_background_pixels_count_as_valid_but_not_as_plume():
    import methane_tools as t
    s = t.plume_stats(make_plume_bytes(noise=1000), center_lat=32.24)
    assert s["valid_pixels"] == PLUME_VALID + 1000
    assert s["plume_pixels"] == PLUME_VALID                      # only >= 500 ppm·m
    assert s["mean_ppm_m"] == pytest.approx((PLUME_PEAK + PLUME_BASE * (PLUME_VALID - 1)) / PLUME_VALID, abs=0.05)
    assert s["enhanced_threshold_ppm_m"] == 500.0
    s = t.plume_stats(make_plume_bytes(peak=450.0, base=300.0), center_lat=32.24)
    assert s["plume_pixels"] == 0 and s["plume_area_km2"] == 0 and s["mean_ppm_m"] is None
    assert s["max_ppm_m"] == pytest.approx(450.0, abs=0.05)


def test_plume_stats_reject_garbage_and_empty_rasters():
    import methane_tools as t
    with pytest.raises(t.PlumeFetchError) as e:
        t.plume_stats(b"<html>Data Not Available</html>")
    assert e.value.reason == "not_a_geotiff"
    with pytest.raises(t.PlumeFetchError) as e:
        t.plume_stats(make_plume_bytes(valid=0))
    assert e.value.reason == "no_valid_pixels"


# --- triage --------------------------------------------------------------------------------------

def test_triage_ranks_stages_and_writes_the_ranked_footprints(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2, lon=-103.0), footprint(PLUME_ID_3, lon=-101.5)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    calls = []
    _patch_download(tools, monkeypatch, {
        PLUME_ID: make_plume_bytes(peak=900.0),
        PLUME_ID_2: make_plume_bytes(peak=2500.0),
        PLUME_ID_3: make_plume_bytes(peak=1200.0),
    }, calls)

    out = json.loads(_run(tools.triage_plumes(url, top_n=2)))
    assert "error" not in out, out
    assert [r["granule_id"] for r in out["ranked"]] == [PLUME_ID_2, PLUME_ID_3]
    assert [r["rank"] for r in out["ranked"]] == [1, 2]
    top = out["ranked"][0]
    assert top["max_ppm_m"] == pytest.approx(2500.0, abs=0.05)
    assert top["plume_s3_url"] == f"s3://{BUCKET}/methane/cache/ch4plm_{PLUME_ID_2}.tif"
    assert set(top["bbox"]) is not None and len(top["bbox"]) == 4
    s = out["summary"]
    assert (s["triaged"], s["failed"], s["downloaded"], s["from_cache"]) == (3, 0, 3, 0)
    # every plume staged unchanged to the shared cache, with the token only used for downloads
    for gid in (PLUME_ID, PLUME_ID_2, PLUME_ID_3):
        assert f"methane/cache/ch4plm_{gid}.tif" in fake_s3.objects
    assert {tok for _, tok in calls} == {TOKEN}
    # ranked footprints: tiers + stats, written next to the input
    assert out["ranked_geometry_s3_url"] == url.replace("/plumes_", "/plumes_ranked_")
    fc = json.loads(fake_s3.objects[out["ranked_geometry_s3_url"].split(f"{BUCKET}/", 1)[1]])
    tiers = {f["properties"]["granule_id"]: (f["properties"]["tier"], f["properties"]["rank"]) for f in fc["features"]}
    assert tiers == {PLUME_ID_2: ("ranked", 1), PLUME_ID_3: ("ranked", 2), PLUME_ID: ("detected", 3)}
    assert out["render_raster"]["colormap"] == "plasma" and out["render_raster"]["rescale"] == [0, 1500]
    assert TOKEN not in json.dumps(out)


def test_ties_break_by_pixels_then_granule_id(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2), footprint(PLUME_ID_3)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    _patch_download(tools, monkeypatch, {
        PLUME_ID: make_plume_bytes(peak=1000.0, valid=200),
        PLUME_ID_2: make_plume_bytes(peak=1000.0, valid=300),
        PLUME_ID_3: make_plume_bytes(peak=1000.0, valid=200),
    })
    out = json.loads(_run(tools.triage_plumes(url)))
    assert [r["granule_id"] for r in out["ranked"]] == [PLUME_ID_2, PLUME_ID_3, PLUME_ID]  # 300 px, then ids


def test_cached_plumes_are_read_from_s3_without_the_token(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID)])
    fake_s3.objects[f"methane/cache/ch4plm_{PLUME_ID}.tif"] = make_plume_bytes()
    calls = []
    _patch_download(tools, monkeypatch, {PLUME_ID: "token_missing"}, calls)
    out = json.loads(_run(tools.triage_plumes(url)))
    assert "error" not in out
    assert out["summary"]["from_cache"] == 1 and out["summary"]["downloaded"] == 0
    assert calls == []


def test_partial_failure_ranks_the_rest_and_lists_reasons(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2), footprint(PLUME_ID_3)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    _patch_download(tools, monkeypatch, {PLUME_ID: make_plume_bytes(), PLUME_ID_2: "size_cap", PLUME_ID_3: "not_found"})
    out = json.loads(_run(tools.triage_plumes(url)))
    assert [r["granule_id"] for r in out["ranked"]] == [PLUME_ID]
    assert out["summary"]["errors"] == [
        {"granule_id": PLUME_ID_3, "reason": "not_found"},
        {"granule_id": PLUME_ID_2, "reason": "size_cap"},
    ] or sorted(e["reason"] for e in out["summary"]["errors"]) == ["not_found", "size_cap"]


def test_token_missing_is_a_clear_error_without_secrets(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2)])
    monkeypatch.setattr(tools, "download_plume", lambda gid, token, *a, **k: (_ for _ in ()).throw(
        tools.PlumeFetchError("token_missing" if not token else "token_rejected")))
    out = json.loads(_run(tools.triage_plumes(url)))
    assert "Earthdata token is missing or expired" in out["error"]
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    out = json.loads(_run(tools.triage_plumes(url)))
    assert "Earthdata token is missing or expired" in out["error"]
    assert TOKEN not in json.dumps(out)


def test_all_failed_for_other_reasons_names_them(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    _patch_download(tools, monkeypatch, {PLUME_ID: "http_500"})
    out = json.loads(_run(tools.triage_plumes(url)))
    assert "No plume could be read (http_500)" in out["error"]


def test_unexpected_exceptions_are_reduced_to_a_type_name(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)

    def boom(gid, token, *a, **k):
        if gid == PLUME_ID:
            raise RuntimeError(f"Authorization: Bearer {token}")  # must never be echoed
        return make_plume_bytes()
    monkeypatch.setattr(tools, "download_plume", boom)
    out = json.loads(_run(tools.triage_plumes(url)))
    assert out["summary"]["errors"] == [{"granule_id": PLUME_ID, "reason": "RuntimeError"}]
    assert TOKEN not in json.dumps(out)


@pytest.mark.parametrize("url", [
    f"s3://{BUCKET}/session_data/other-session/methane/plumes_x.geojson",
    f"s3://{BUCKET}/session_data/{SESSION}/methane/../../other/plumes_x.geojson",
    f"s3://other-bucket/session_data/{SESSION}/methane/plumes_x.geojson",
    f"s3://{BUCKET}/session_data/{SESSION}/methane/plumes_x.tif",
    f"s3://{BUCKET}/session_data/{SESSION}/rasters/plumes_x.geojson",
    "https://evil.example/plumes_x.geojson",
    None,
])
def test_triage_only_reads_this_sessions_plume_lists(tools, url):
    out = json.loads(_run(tools.triage_plumes(url)))
    assert "plumes_geometry_s3_url must be" in out["error"]


def test_triage_ignores_invalid_ids_in_the_list_and_dedupes(tools, monkeypatch, fake_s3):
    bad = footprint("EMIT_L2B_CH4PLM_002_../../x")
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID), bad])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    calls = []
    _patch_download(tools, monkeypatch, {PLUME_ID: make_plume_bytes()}, calls)
    out = json.loads(_run(tools.triage_plumes(url)))
    assert out["summary"]["triaged"] == 1 and [c[0] for c in calls] == [PLUME_ID]


def test_triage_caps_the_number_of_plumes(tools, monkeypatch, fake_s3):
    ids = [f"EMIT_L2B_CH4PLM_002_20240812T190223_{i:06d}" for i in range(5)]
    url = put_plume_list(fake_s3, [footprint(g) for g in ids])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    monkeypatch.setattr(tools, "MAX_TRIAGE", 3)
    _patch_download(tools, monkeypatch, {g: make_plume_bytes() for g in ids})
    out = json.loads(_run(tools.triage_plumes(url)))
    assert out["summary"]["triaged"] == 3 and out["summary"]["truncated_to"] == 3


def test_top_n_bounds(tools, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID)])
    for bad in (0, 51, "3", True):
        assert "top_n" in json.loads(_run(tools.triage_plumes(url, top_n=bad)))["error"]


# --- download ------------------------------------------------------------------------------------

class _FakeStream:
    def __init__(self, status=200, chunks=(b"abc",), scheme="https"):
        self.status_code, self._chunks = status, chunks
        self.url = type("U", (), {"scheme": scheme})()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_bytes(self):
        yield from self._chunks


class _FakeHttp:
    def __init__(self, stream, seen):
        self._stream, self._seen = stream, seen

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def stream(self, method, url, headers=None):
        self._seen.append((method, url, dict(headers or {})))
        return self._stream


def _patch_http(tools, monkeypatch, stream):
    seen, kwargs = [], []
    monkeypatch.setattr(tools.httpx, "Client", lambda **kw: (kwargs.append(kw), _FakeHttp(stream, seen))[1])
    return seen, kwargs


def test_download_sends_the_token_to_lpdaac_only_and_follows_redirects_safely(tools, monkeypatch):
    seen, kwargs = _patch_http(tools, monkeypatch, _FakeStream(chunks=(b"ab", b"cd")))
    assert tools.download_plume(PLUME_ID, TOKEN) == b"abcd"
    method, url, headers = seen[0]
    assert url.startswith("https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/")
    assert headers == {"Authorization": f"Bearer {TOKEN}"}
    assert kwargs[0]["follow_redirects"] is True and kwargs[0]["max_redirects"] == 5


@pytest.mark.parametrize("stream, reason", [
    (_FakeStream(status=401), "token_rejected"),
    (_FakeStream(status=403), "token_rejected"),
    (_FakeStream(status=404), "not_found"),
    (_FakeStream(status=502), "http_502"),
    (_FakeStream(scheme="http"), "insecure_redirect"),
    (_FakeStream(chunks=(b"x" * 600, b"x" * 600)), "size_cap"),
])
def test_download_failure_reasons(tools, monkeypatch, stream, reason):
    _patch_http(tools, monkeypatch, stream)
    with pytest.raises(tools.PlumeFetchError) as e:
        tools.download_plume(PLUME_ID, TOKEN, cap_bytes=1000)
    assert e.value.reason == reason


def test_download_refuses_without_a_token_and_before_any_request(tools, monkeypatch):
    seen, _ = _patch_http(tools, monkeypatch, _FakeStream())
    with pytest.raises(tools.PlumeFetchError) as e:
        tools.download_plume(PLUME_ID, "")
    assert e.value.reason == "token_missing" and seen == []


# --- show_plume ----------------------------------------------------------------------------------

def test_show_plume_finds_a_triaged_plume(tools, monkeypatch, fake_s3):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    _patch_download(tools, monkeypatch, {PLUME_ID: make_plume_bytes(peak=900.0), PLUME_ID_2: make_plume_bytes(peak=2500.0)})
    json.loads(_run(tools.triage_plumes(url)))
    out = json.loads(_run(tools.show_plume(PLUME_ID_2)))
    assert out["rank"] == 1 and out["acquired_date"] == "2024-08-12"
    assert out["plume_s3_url"] == f"s3://{BUCKET}/methane/cache/ch4plm_{PLUME_ID_2}.tif"
    assert out["render"]["kind"] == "raster" and out["max_ppm_m"] == pytest.approx(2500.0, abs=0.05)


def test_show_plume_requires_triage_and_a_valid_id(tools, fake_s3):
    assert "run triage_plumes first" in json.loads(_run(tools.show_plume(PLUME_ID)))["error"]
    assert "granule_id must look like" in json.loads(_run(tools.show_plume("../../etc")))["error"]


def test_cache_key_is_derived_from_a_validated_id(tools):
    assert tools.cache_key(PLUME_ID) == f"methane/cache/ch4plm_{PLUME_ID}.tif"
    with pytest.raises(tools.MethaneError):
        tools.cache_key("../x")
