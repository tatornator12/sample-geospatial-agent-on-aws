"""search_methane_plumes: extent, window, CMR query and parsing, footprints GeoJSON."""
import asyncio
import json
from datetime import date

import pytest

from conftest import BUCKET, SESSION


class FakeResponse:
    def __init__(self, status_code=200, body=None, hits=0):
        self.status_code = status_code
        self._body = body if body is not None else {"feed": {"entry": []}}
        self.headers = {"cmr-hits": str(hits)}

    def json(self):
        return self._body


class FakeCMR:
    """Serves the recorded page for a search, and a one-entry page for the archive-date probe."""

    def __init__(self, page, hits=None, status=200, latest="2025-09-22T20:49:33.000Z", pages=None):
        self.page, self.status, self.latest = page, status, latest
        self.hits = hits if hits is not None else len(page["feed"]["entry"])
        self.pages = pages
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, params=None):
        self.calls.append(dict(params or {}))
        if params.get("page_size") == 1 and "bounding_box" not in params:
            return FakeResponse(200, {"feed": {"entry": [{"time_start": self.latest}]}}, hits=1686)
        if self.status != 200:
            return FakeResponse(self.status)
        if self.pages is not None:
            return FakeResponse(200, self.pages[params["page_num"] - 1], hits=self.hits)
        return FakeResponse(200, self.page, hits=self.hits)


def _run(coro):
    return asyncio.run(coro)


def _install(tools, monkeypatch, fake):
    monkeypatch.setattr(tools.httpx, "Client", lambda **kw: fake)
    return fake


def test_search_writes_footprints_and_skips_bad_entries(tools, monkeypatch, fake_s3, cmr_page):
    fake = _install(tools, monkeypatch, FakeCMR(cmr_page, hits=39))
    out = json.loads(_run(tools.search_methane_plumes("Permian Basin", start_date="2024-01-01", end_date="2024-12-31")))

    assert "error" not in out, out
    s = out["summary"]
    assert s["count"] == 3 and s["cmr_hits"] == 39
    assert s["skipped"] == {"no_asset": 1, "invalid_id": 1}
    assert (s["start"], s["end"]) == ("2024-01-01", "2024-12-31")
    assert out["plumes_geometry_s3_url"] == (
        f"s3://{BUCKET}/session_data/{SESSION}/methane/plumes_permian_basin_2024-01-01_2024-12-31.geojson")
    fc = json.loads(fake_s3.objects[out["plumes_geometry_s3_url"].split(f"{BUCKET}/", 1)[1]])
    f = fc["features"][0]
    assert f["properties"]["granule_id"] == "EMIT_L2B_CH4PLM_002_20241130T180310_003723"
    assert f["properties"]["acquired"] == "2024-11-30T18:03:10Z" and f["properties"]["tier"] == "detected"
    ring = f["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and -104.5 < ring[0][0] < -101.0 and 30.5 < ring[0][1] < 33.5  # lon, lat order
    assert out["render"]["kind"] == "vector" and out["render"]["group"] == "methane"
    search = [c for c in fake.calls if "bounding_box" in c][0]
    assert search["short_name"] == "EMITL2BCH4PLM"
    assert search["bounding_box"] == "-104.5,30.5,-101.0,33.5"
    assert search["temporal"] == "2024-01-01T00:00:00Z,2024-12-31T23:59:59Z"
    assert search["sort_key"] == "-start_date"
    assert "note" in out  # 39 hits, 3 listed


def test_default_window_ends_at_the_archive_latest_not_today(tools, monkeypatch, cmr_page):
    _install(tools, monkeypatch, FakeCMR(cmr_page))
    out = json.loads(_run(tools.search_methane_plumes("Permian Basin")))
    s = out["summary"]
    assert (s["start"], s["end"], s["archive_latest"]) == ("2024-09-22", "2025-09-22", "2025-09-22")
    assert "most recent plume is 2025-09-22" in s["window"]


def test_window_rules():
    import methane_tools as t
    today = date(2026, 9, 24)
    assert t.resolve_window(None, None, date(2025, 9, 22), today)[:2] == (date(2024, 9, 22), date(2025, 9, 22))
    assert t.resolve_window(None, None, None, today)[:2] == (date(2025, 9, 24), today)
    assert t.resolve_window("2020-01-01", "2024-01-01", None, today)[0] == t.MISSION_START  # clamped
    assert t.resolve_window("2024-01-01", "2030-01-01", None, today)[1] == today           # clamped
    assert t.resolve_window("2024-03-01", None, None, today)[:2] == (date(2024, 3, 1), today)
    for bad in [("2024-13-01", None), ("yesterday", None), ("2024-05-01", "2024-01-01")]:
        with pytest.raises(t.MethaneError):
            t.resolve_window(*bad, None, today)


def test_zero_plumes_is_a_result_with_a_sentence(tools, monkeypatch):
    _install(tools, monkeypatch, FakeCMR({"feed": {"entry": []}}, hits=0))
    out = json.loads(_run(tools.search_methane_plumes("Marcellus", start_date="2023-01-01", end_date="2023-03-31")))
    assert "error" not in out
    assert out["summary"]["count"] == 0
    assert out["say"] == "EMIT recorded no methane plume complexes over Marcellus between 2023-01-01 and 2023-03-31."


def test_cmr_non_200_is_a_json_error(tools, monkeypatch, cmr_page, fake_s3):
    _install(tools, monkeypatch, FakeCMR(cmr_page, status=503))
    out = json.loads(_run(tools.search_methane_plumes("Permian Basin", start_date="2024-01-01", end_date="2024-12-31")))
    assert "HTTP 503" in out["error"] and fake_s3.puts == []


def test_cmr_unreachable_is_a_json_error(tools, monkeypatch):
    class Boom(FakeCMR):
        def get(self, url, params=None):
            raise tools.httpx.ConnectError("no route")
    _install(tools, monkeypatch, Boom({"feed": {"entry": []}}))
    out = json.loads(_run(tools.search_methane_plumes("Permian Basin", start_date="2024-01-01", end_date="2024-12-31")))
    assert "could not be reached" in out["error"]


def test_paging_stops_at_max_results(tools, monkeypatch, cmr_page):
    entry = cmr_page["feed"]["entry"][0]
    pages = []
    for p in range(3):
        page = []
        for i in range(2):
            e = json.loads(json.dumps(entry))
            gid = f"EMIT_L2B_CH4PLM_002_2024112{p}T180310_00{p}00{i}"
            e["title"] = gid
            for link in e["links"]:
                link["href"] = link["href"].replace("EMIT_L2B_CH4PLM_002_20241130T180310_003723", gid)
            page.append(e)
        pages.append({"feed": {"entry": page}})
    fake = _install(tools, monkeypatch, FakeCMR(cmr_page, hits=6, pages=pages))
    monkeypatch.setattr(tools, "CMR_PAGE_SIZE", 2)
    out = json.loads(_run(tools.search_methane_plumes("Permian Basin", start_date="2024-01-01",
                                                      end_date="2024-12-31", max_results=3)))
    assert out["summary"]["count"] == 3
    assert [c["page_num"] for c in fake.calls if "bounding_box" in c] == [1, 2]


@pytest.mark.parametrize("kwargs, fragment", [
    ({"region": "Somewhere Else"}, "not a region I know"),
    ({"region": "Permian Basin, Texas"}, "not a region I know"),          # no substring matching
    ({"region": "x", "bbox": [-101, 30, -104, 33]}, "west < east"),
    ({"region": "x", "bbox": [-101, 30, "e", 33]}, "bbox.east"),
    ({"region": "x", "bbox": [1, 2, 3]}, "bbox must be"),
    ({"region": "x", "geometry_s3_url": "https://evil.example/x.geojson"}, "geometry_s3_url"),
    ({"region": "Permian Basin", "max_results": 0}, "max_results"),
    ({"region": "Permian Basin", "max_results": 5000}, "max_results"),
    ({"region": "Permian Basin", "start_date": "2024/01/01"}, "YYYY-MM-DD"),
])
def test_argument_validation(tools, monkeypatch, cmr_page, fake_s3, kwargs, fragment):
    _install(tools, monkeypatch, FakeCMR(cmr_page))
    out = json.loads(_run(tools.search_methane_plumes(**kwargs)))
    assert fragment in out["error"]
    assert fake_s3.puts == []


def test_pattern_valid_but_impossible_timestamps_are_skipped():
    import methane_tools as t
    feat, reason = t.entry_to_feature({"title": "EMIT_L2B_CH4PLM_002_20241332T180310_000001", "links": [], "polygons": []})
    assert feat is None and reason == "invalid_id"


def test_ring_parsing_rejects_junk():
    import methane_tools as t
    assert t.parse_ring("32.0 -102.0 32.1 -102.0 32.1 -101.9 32.0 -101.9")[0] == [-102.0, 32.0]
    assert t.parse_ring("32.0 -102.0 32.1 -102.0 32.1 -101.9 32.0 -101.9")[-1] == [-102.0, 32.0]  # closed
    assert t.parse_ring("32.0 -102.0 32.1") is None
    assert t.parse_ring("91 0 32.1 -102 32.1 -101.9 32 -101.9") is None
    assert t.parse_ring("nan -102 32.1 -102 32.1 -101.9 32 -101.9") is None
    assert t.parse_ring("a b c d e f g h") is None


def test_download_url_is_built_from_a_validated_id_only():
    import methane_tools as t
    gid = "EMIT_L2B_CH4PLM_002_20240812T190223_002202"
    assert t.tif_url(gid) == (f"https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/"
                              f"EMITL2BCH4PLM.002/{gid}/{gid}.tif")
    for bad in ["EMIT_L2B_CH4PLM_002_20240812T190223_002202/../x", "https://evil/x", "", None, 7,
                "EMIT_L2B_CH4PLM_002_20240812T190223_00220"]:
        with pytest.raises(t.MethaneError):
            t.tif_url(bad)
