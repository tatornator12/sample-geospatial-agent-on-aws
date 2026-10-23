"""Carbon Mapper's public plume catalogue (carbon_mapper.carbon_mapper_plumes), hermetic.

The catalogue is served from two recorded pages (tests/fixtures/carbonmapper_*_2026-10-22.json, taken
from the live API on 2026-10-22 with the signed image URLs removed) through an httpx MockTransport,
so the real request building runs; S3 is the in-memory fake. The tool must keep only validated
numbers, dates and fixed words, write its numbers-only record for the stage, cache what it read,
fall back to the cache when the API is down, and stay a polite client.
"""
import asyncio
import importlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from conftest import BUCKET, SESSION

FIXTURES = Path(__file__).resolve().parent / "fixtures"
KRASNOVODSK = (39.4379, 53.5730)       # the south Caspian site the orchestrator checked: Tanager plumes in 2026
SHANXI = (37.8938, 113.5625)           # the Oct 22 Shanxi tip: seven coal-mine plumes, 5.1 km away (inside 7 km)


def _run(coro):
    return asyncio.run(coro)


def page(name):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture()
def cm(tools, monkeypatch):
    importlib.import_module("watch_tools")
    return importlib.import_module("carbon_mapper")


@pytest.fixture()
def serve(cm, monkeypatch):
    """Serve recorded pages; returns the list of requests made."""
    requests = []
    state = {"body": None, "status": 200, "fail": None}
    real_client = httpx.Client

    def handler(request: httpx.Request):
        requests.append(request)
        if state["fail"]:
            raise state["fail"]
        body = state["body"](request) if callable(state["body"]) else state["body"]
        return httpx.Response(state["status"], json=body)

    monkeypatch.setattr(cm.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))

    def use(body=None, status=200, fail=None):
        state.update(body=body, status=status, fail=fail)
        return requests
    return use


def test_krasnovodsk_lists_the_tanager_plumes_newest_first_with_numbers_only(cm, serve, fake_s3):
    requests = serve(page("carbonmapper_krasnovodsk_2026-10-22.json"))
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK, radius_km=5)))
    s = out["summary"]
    assert s["count"] == 45 and s["by_instrument"] == {"Tanager-1": 45}
    assert s["latest_date"] == "2026-06-20" and s["source"] == "carbon-mapper"
    # The latest plume: on the newest date, the nearest that carries a rate (the nearest one's is withheld).
    assert s["latest_rate_kg_h"] == 273.1 and s["latest_uncertainty_kg_h"] == 260.9
    assert s["latest_instrument"] == "Tanager-1"
    assert len(out["plumes"]) == 10
    assert [p["date"] for p in out["plumes"]] == sorted((p["date"] for p in out["plumes"]), reverse=True)
    first = out["plumes"][0]
    assert first == {"date": "2026-06-20", "instrument": "Tanager-1", "rate_kg_h": None, "uncertainty_kg_h": None,
                     "distance_km": 2.0, "sector": "oil_gas"}
    assert all(p["distance_km"] <= 5 for p in out["plumes"])
    assert out["say"] == ("Carbon Mapper lists 45 methane plumes within 5 km since 2025-01-01; the latest on 2026-06-20 "
                          "(Tanager-1, about 270 ± 260 kg/h).")
    assert out["attribution"] == "Source: Carbon Mapper (data.carbonmapper.org)"
    # Nothing of the catalogue's own text or links passes through.
    text = json.dumps(out)
    for leaked in ("catalog.carbonmapper.org", "tan2026", "Planet", "1B2", "production", "Signature"):
        assert leaked not in text
    # The stage's record and the map's points, numbers and codes only.
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_39.4379_53.5730.json"])
    dates = rec.pop("dates")
    # The recorded pages carry no image links (removed before they were committed): no image, said so.
    assert rec.pop("image") == {"plume_id": "tan20260620t083638c93s4001-BI", "date": "2026-06-20", "distance_km": 2.0,
                                "instrument": "tanager", "status": "unavailable", "code": "cm_image_no_link"}
    assert out["latest_image"] == {"date": "2026-06-20", "status": "unavailable"}
    assert rec == {"lat": 39.4379, "lon": 53.573, "radius_km": 5.0, "since": "2025-01-01", "count": 45,
                   "latest": "2026-06-20", "rate_kg_h": 273.1, "uncertainty_kg_h": 260.9, "instrument": "tanager",
                   "source": "carbon-mapper", "follow_radius_km": 7.0,
                   "latest_confirmed": {"date": "2026-06-20", "by": "carbon_mapper"}}
    # The record timeline's plumes: every one in the radius, newest first, numbers and codes only.
    assert len(dates) == 45 and dates[0] == {"date": "2026-06-20", "instrument": "tanager", "rate_kg_h": None,
                                             "distance_km": 2.0}
    assert all(set(d) == {"date", "instrument", "rate_kg_h", "distance_km"} for d in dates)
    assert [d["date"] for d in dates] == sorted((d["date"] for d in dates), reverse=True)
    geo = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_39.4379_53.5730.geojson"])
    assert len(geo["features"]) == 45
    assert set(geo["features"][0]["properties"]) == {"date", "rate_kg_h", "instrument"}
    assert out["plumes_geometry_s3_url"] == f"s3://{BUCKET}/session_data/{SESSION}/methane/cmplumes_39.4379_53.5730.geojson"
    assert out["render"]["kind"] == "detections"
    # One polite request: one host, the box as four bbox values, one page, an honest agent (checked
    # 2026-10-23: the catalogue answers it as it answers a browser).
    assert len(requests) == 1
    r = requests[0]
    assert r.url.host == "api.carbonmapper.org" and r.url.path == "/api/v1/catalog/plumes/annotated"
    bbox = [float(v) for v in r.url.params.get_list("bbox")]
    assert len(bbox) == 4 and bbox[0] < KRASNOVODSK[1] < bbox[2] and bbox[1] < KRASNOVODSK[0] < bbox[3]
    assert r.url.params["limit"] == "1000" and r.url.params["offset"] == "0"
    assert r.headers["user-agent"].startswith("agentic-earth-methane-watch/1.0") and "Mozilla" not in r.headers["user-agent"]


def test_shanxi_plumes_beyond_5_km_count_within_one_tropomi_footprint(cm, serve, fake_s3):
    serve(page("carbonmapper_shanxi_2026-10-22.json"))
    out = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI, radius_km=5)))
    assert out["summary"]["count"] == 0 and out["plumes"] == [] and out["summary"]["latest_date"] is None
    assert out["say"] == ("Carbon Mapper lists no methane plume within 5 km since 2025-01-01 "
                          "(it publishes about 30 days after a detection).")
    assert "plumes_geometry_s3_url" not in out and "render" not in out
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.8938_113.5625.json"])
    assert rec["count"] == 0 and rec["latest"] is None and rec["rate_kg_h"] is None
    # The default, one TROPOMI footprint (7 km, approved 2026-10-23 after seeing this case), reaches the
    # seven coal-mine plumes about 5.1 km away (one of them Carbon Mapper's own EMIT plume).
    wider = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI)))
    assert wider["summary"]["radius_km"] == 7.0
    assert wider["summary"]["count"] == 7 and wider["summary"]["by_instrument"] == {"Tanager-1": 6, "EMIT": 1}
    assert {p["sector"] for p in wider["plumes"]} == {"coal_mining"}
    assert wider["latest_confirmed"] == {"date": "2026-06-10", "by": "a Carbon Mapper plume"}
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.8938_113.5625.json"])
    assert rec["latest_confirmed"] == {"date": "2026-06-10", "by": "carbon_mapper"} and len(rec["dates"]) == 7
    assert {d["instrument"] for d in rec["dates"]} == {"tanager", "emit"}


def test_every_field_is_validated_and_free_text_never_passes(cm):
    lat, lon = KRASNOVODSK
    since, today = cm.CM_SINCE, datetime(2026, 10, 22).date()
    good = {"plume_id": "tan20260611t083132c93s4001-A", "gas": "CH4", "status": "published",
            "geometry_json": {"type": "Point", "coordinates": [53.575, 39.44]},
            "scene_timestamp": "2026-06-11T08:31:32.230Z", "instrument": "tan", "emission_auto": 1056.2,
            "emission_uncertainty_auto": 537.3, "sector": "1B2"}
    p = cm.parse_item(good, lat, lon, 5, since, today)
    assert p["instrument"] == "tanager" and p["sector"] == "oil_gas" and p["rate_kg_h"] == 1056.2
    assert p["has_image"] is False                       # no link in the item
    bad = [
        {**good, "gas": "CO2"},
        {**good, "status": "draft"},
        {**good, "plume_id": "<script>alert(1)</script>"},
        {**good, "geometry_json": {"type": "Polygon", "coordinates": [53.575, 39.44]}},
        {**good, "geometry_json": {"type": "Point", "coordinates": ["53.575", 39.44]}},
        {**good, "geometry_json": {"type": "Point", "coordinates": [float("nan"), 39.44]}},
        {**good, "scene_timestamp": "yesterday"},
        {**good, "scene_timestamp": "2024-12-31T23:00:00Z"},           # before the window
        {**good, "scene_timestamp": "2027-01-01T00:00:00Z"},           # in the future
        {**good, "geometry_json": {"type": "Point", "coordinates": [53.70, 39.44]}},   # ~11 km away
        {**good, "instrument": "Tanager 1!"},
        "not an item",
    ]
    assert all(cm.parse_item(b, lat, lon, 5, since, today) is None for b in bad)
    # Fields that are wrong but not fatal are dropped to nothing, never passed on as text.
    odd = cm.parse_item({**good, "sector": "Oil & gas <b>", "instrument": "xyz9", "emission_auto": float("inf"),
                         "emission_uncertainty_auto": 12.0}, lat, lon, 5, since, today)
    assert odd["sector"] is None and odd["instrument"] == "other" and odd["rate_kg_h"] is None
    assert odd["uncertainty_kg_h"] is None
    assert cm.parse_item({**good, "sector": "9Z"}, lat, lon, 5, since, today)["sector"] == "other"
    hidden = cm.parse_item({**good, "hide_emission": True}, lat, lon, 5, since, today)
    assert hidden["rate_kg_h"] is None and hidden["uncertainty_kg_h"] is None
    assert cm.parse_item({**good, "instrument": "emi"}, lat, lon, 5, since, today)["instrument"] == "emit"
    assert cm.parse_item({**good, "instrument": "av3"}, lat, lon, 5, since, today)["instrument"] == "airborne"


def test_the_cache_answers_a_second_call_and_stands_in_when_the_api_is_down(cm, serve, fake_s3):
    requests = serve(page("carbonmapper_krasnovodsk_2026-10-22.json"))
    _run(cm.carbon_mapper_plumes(*KRASNOVODSK))
    again = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert len(requests) == 1 and again["summary"]["source"] == "cache" and again["summary"]["count"] == 58   # within 7 km
    # Age the cache past its TTL, then take the API down: the old record answers, and says so.
    key = cm.cache_key(*KRASNOVODSK, 7.0)
    assert key.startswith("methane/cache/carbonmapper_v3_") and key.endswith("_7km.json")
    cached = json.loads(fake_s3.objects[key])
    cached["fetched_at"] = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    fake_s3.objects[key] = json.dumps(cached).encode()
    serve(fail=httpx.ConnectTimeout("timed out"))
    stale = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert stale["summary"]["source"] == "stale cache" and stale["summary"]["count"] == 58
    assert "could not be reached" in stale["note"]
    # A server error with nothing cached: the check says it is unavailable, and the choice rests on EMIT.
    serve(body={"detail": "boom"}, status=503)
    out = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI)))
    assert "could not be reached" in out["error"] and "boom" not in json.dumps(out)


def test_a_tampered_cache_row_is_dropped(cm, fake_s3, serve):
    serve(fail=httpx.ConnectError("down"))
    key = cm.cache_key(*KRASNOVODSK, 7.0)
    rows = [{"id": "ok-1", "date": "2026-05-01", "lat": 39.44, "lon": 53.57, "instrument": "tanager",
             "rate_kg_h": 900.0, "uncertainty_kg_h": 100.0, "sector": "oil and gas"},   # a v2 word: read as its code
            {"id": "bad-1", "date": "2026-05-02", "lat": 39.44, "lon": 53.57, "instrument": "<img>", "rate_kg_h": 1.0},
            {"id": "bad-2", "date": "2026-05-03", "lat": 39.44, "lon": 53.57, "instrument": "emit", "sector": "Acme Oil Co"}]
    fake_s3.objects[key] = json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat(), "since": "2025-01-01",
                                       "plumes": rows}).encode()
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert out["summary"]["count"] == 2 and "Acme" not in json.dumps(out) and "<img>" not in json.dumps(out)
    assert out["plumes"][0]["sector"] is None and out["plumes"][1]["sector"] == "oil_gas"


def test_paging_stops_at_three_pages(cm, serve):
    one = page("carbonmapper_krasnovodsk_2026-10-22.json")
    item = one["items"][3]

    def body(request):
        offset = int(request.url.params["offset"])
        items = [{**item, "plume_id": f"p{offset + i}"} for i in range(1000)]
        return {"bbox_count": 5000, "items": items}
    requests = serve(body)
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert [r.url.params["offset"] for r in requests] == ["0", "1000", "2000"]
    assert out["summary"]["count"] == 3000 and len(out["plumes"]) == 10


def test_latest_confirmed_compares_the_sites_emit_candidates_with_carbon_mapper(cm, serve, fake_s3):
    serve(page("carbonmapper_krasnovodsk_2026-10-22.json"))
    manifest = {"lat": 39.4380, "lon": 53.5731, "since": "2025-01-01", "passes": [
        {"date": "2026-07-25", "verdict": "rejected", "peak_ppm_m": 2297.2},
        {"date": "2025-11-30", "verdict": "candidate", "peak_ppm_m": 2795.1},
        {"date": "2025-09-25", "verdict": "candidate", "peak_ppm_m": 5121.5}]}
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/passes_39.4380_53.5731.json",
                       Body=json.dumps(manifest).encode())
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert out["emit"] == {"read": 3, "candidates": 2, "latest_candidate": "2025-11-30", "peak_ppm_m": 5121.5}
    assert out["latest_confirmed"] == {"date": "2026-06-20", "by": "a Carbon Mapper plume"}
    assert cm.latest_confirmed({"latest_candidate": "2026-07-01"}, "2026-06-20") == {"date": "2026-07-01", "by": "an EMIT candidate pass"}
    assert cm.latest_confirmed({"latest_candidate": None}, None) is None
    assert cm.latest_confirmed(None, "2026-06-20")["by"] == "a Carbon Mapper plume"
    assert cm.latest_confirmed({"latest_candidate": "2026-06-20"}, "2026-06-20")["by"] == \
        "an EMIT candidate pass and a Carbon Mapper plume"


def test_inputs_are_validated_before_any_request(cm, serve):
    requests = serve(page("carbonmapper_shanxi_2026-10-22.json"))
    for args in ((95, 10), (10, 200), ("37.9", 113.5), (37.9, 113.5, 50), (37.9, 113.5, math.nan)):
        assert "error" in json.loads(_run(cm.carbon_mapper_plumes(*args)))
    assert requests == []


def test_an_unreachable_catalogue_leaves_a_record_the_board_can_say_it_with(cm, serve, fake_s3):
    serve(fail=httpx.ConnectError("down"))
    out = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI)))
    assert "could not be reached" in out["error"]
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.8938_113.5625.json"])
    assert rec["status"] == "unavailable" and "count" not in rec


def test_the_follow_rule_counts_plumes_within_7_km_whatever_the_radius(cm, serve, fake_s3):
    one = page("carbonmapper_shanxi_2026-10-22.json")
    item = one["items"][0]
    # One more plume, newer, 8.5 km north of the site: inside a 10 km search, outside the follow rule.
    far = {**item, "plume_id": "far-1", "scene_timestamp": "2026-08-01T03:00:00Z",
           "geometry_json": {"type": "Point", "coordinates": [SHANXI[1], SHANXI[0] + 8.5 / 111.2]}}
    serve({"bbox_count": len(one["items"]) + 1, "items": one["items"] + [far]})
    wide = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI, radius_km=10)))
    assert wide["summary"]["latest_date"] == "2026-08-01"        # the far plume is listed
    assert wide["latest_confirmed"] == {"date": "2026-06-10", "by": "a Carbon Mapper plume"}   # but not followed
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.8938_113.5625.json"])
    assert rec["latest_confirmed"]["date"] == "2026-06-10" and rec["follow_radius_km"] == 7.0


def test_the_record_lists_at_most_60_plumes(cm):
    rows = [{"date": f"2026-0{1 + i % 9}-1{i % 10}", "instrument": "tanager", "rate_kg_h": 100.0 + i,
             "distance_km": 1.0, "id": f"p{i}", "lat": 0, "lon": 0, "uncertainty_kg_h": None, "sector": None}
            for i in range(80)]
    out = cm.record_dates(cm.newest_first(rows))
    assert len(out) == 60 and all(set(r) == {"date", "instrument", "rate_kg_h", "distance_km"} for r in out)
    assert cm.latest_confirmed_code("2025-08-18", "2026-06-10") == {"date": "2026-06-10", "by": "carbon_mapper"}
    assert cm.latest_confirmed_code("2026-06-10", "2026-06-10") == {"date": "2026-06-10", "by": "both"}
    assert cm.latest_confirmed_code("2026-07-01", None) == {"date": "2026-07-01", "by": "emit"}
    assert cm.latest_confirmed_code(None, None) is None


def test_rates_round_half_up_like_the_stage():
    import importlib
    cm = importlib.import_module("carbon_mapper")
    brief = importlib.import_module("brief_tools")
    assert cm.about(265.0) == 270 and cm.about(264.9) == 260 and cm.about(1513.1) == 1510
    rec = {"radius_km": 5.0, "since": "2025-01-01", "count": 1, "latest": "2026-06-20", "rate_kg_h": 265.0,
           "uncertainty_kg_h": 255.0, "instrument": "tanager"}
    assert "about 270 ± 260 kg/h" in brief.carbon_mapper_line(rec)


# --- the plume image (approved 2026-10-23) ---------------------------------------------------------

PID = "tan20260826t070000c11s4001-A"
PRODUCT = "l3a-ime-ch4-mfa-v3e"
LINK = (f"https://catalog.carbonmapper.org/{PRODUCT}/2026/08/26/{PID}/{PID}_{PRODUCT}_ime-cmf-concentrations.tif"
        "?Expires=1793000000&Signature=abc~def&Key-Pair-Id=K123&c=1")


def utm_plume(width=40, height=30, dtype="float32", count=1, crs="EPSG:32640", value=1200.0, at=(53.93, 37.77)):
    """A synthetic Carbon Mapper concentration raster (not their data): 30 m UTM zone 40N cells near
    37.76 N, 53.93 E, NaN outside a small mask, one 4,000 ppm·m source pixel and a 300 ppm·m fringe."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from pyproj import Transformer
    x0, y0 = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(*at)
    a = np.full((height, width), np.nan, dtype=np.float32)
    if height >= 16 and width >= 20:
        a[10:14, 10:20] = value
        a[11, 12] = 4000.0
        a[15, 10:20] = 300.0
    else:
        a[0, :] = value
    with rasterio.MemoryFile() as mem:
        with mem.open(driver="GTiff", width=width, height=height, count=count, dtype=dtype, crs=crs,
                      transform=from_origin(x0, y0, 30, 30)) as ds:
            for b in range(1, count + 1):
                ds.write(a.astype(dtype), b)
        return mem.read()


@pytest.fixture()
def catalogue(cm, monkeypatch, fake_s3):
    """One plume with an image link 1.5 km from the site; the image host serves `state['tif']`."""
    site = (37.7625, 53.9324)
    item = {"plume_id": PID, "gas": "CH4", "status": "published", "instrument": "tan", "sector": "1B2",
            "geometry_json": {"type": "Point", "coordinates": [53.93, 37.75]},
            "scene_timestamp": "2026-08-26T07:00:00Z", "emission_auto": 800.0, "con_tif": LINK}
    state = {"tif": utm_plume(), "status": 200, "headers": {}, "items": [item], "requests": []}
    real_client = httpx.Client

    def handler(request: httpx.Request):
        state["requests"].append(request)
        if request.url.host == "api.carbonmapper.org":
            return httpx.Response(200, json={"bbox_count": len(state["items"]), "items": state["items"]})
        assert request.url.host == "catalog.carbonmapper.org"
        return httpx.Response(state["status"], content=state["tif"], headers=state["headers"])
    monkeypatch.setattr(cm.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    return site, state


def test_the_newest_plume_is_drawn_from_its_own_image_numbers_only(cm, catalogue, fake_s3, caplog):
    site, state = catalogue
    out = json.loads(_run(cm.carbon_mapper_plumes(*site)))
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.7625_53.9324.json"])
    image = rec["image"]
    assert image["status"] == "ok" and image["file"] == f"cmcolumns_{PID}.geojson" and image["date"] == "2026-08-26"
    assert image["pixels"] == 40 and image["peak_ppm_m"] == 4000.0                # the 300 ppm·m fringe is below 500
    fc = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmcolumns_{PID}.geojson"])
    assert fc["features"][0]["properties"] == {"ppm_m": 4000.0}                    # strongest first
    ring = fc["features"][0]["geometry"]["coordinates"][0]
    assert len(ring) == 5 and ring[0] == ring[-1] and all(53.9 < x < 54.0 and 37.7 < y < 37.8 for x, y in ring)
    # 30 m cells: about 0.00034 degrees of longitude and 0.00027 of latitude here.
    assert 0.0002 < abs(ring[1][0] - ring[0][0]) + abs(ring[1][1] - ring[0][1]) < 0.0006
    assert fake_s3.objects[f"methane/cache/cmimage_v1_{PID}.geojson"] == fake_s3.objects[f"session_data/{SESSION}/methane/cmcolumns_{PID}.geojson"]
    assert out["latest_image"] == {"date": "2026-08-26", "pixels": 40, "peak_ppm_m": 4000.0}
    # The signed link is never returned, stored or logged.
    for text in (json.dumps(out), json.dumps(rec), caplog.text, *[v.decode(errors="ignore") for v in fake_s3.objects.values()]):
        assert "Signature" not in text and "catalog.carbonmapper.org" not in text and "Expires" not in text
    image_req = [r for r in state["requests"] if r.url.host == "catalog.carbonmapper.org"]
    assert len(image_req) == 1 and image_req[0].headers["user-agent"].startswith("agentic-earth-methane-watch/1.0")


def test_the_image_is_cached_by_plume_id_so_an_outage_still_draws(cm, catalogue, fake_s3):
    site, state = catalogue
    _run(cm.carbon_mapper_plumes(*site))
    fake_s3.objects = {k: v for k, v in fake_s3.objects.items() if not k.startswith("session_data/")}
    state["status"] = 503
    state["items"][0]["con_tif"] = None            # and no link either: the cache alone draws it
    _run(cm.carbon_mapper_plumes(*site))
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.7625_53.9324.json"])
    assert rec["image"]["status"] == "ok" and f"session_data/{SESSION}/methane/cmcolumns_{PID}.geojson" in fake_s3.objects
    assert len([r for r in state["requests"] if r.url.host == "catalog.carbonmapper.org"]) == 1


def test_a_list_from_the_cache_fetches_a_fresh_link_for_an_image_it_has_not_drawn(cm, catalogue, fake_s3):
    site, state = catalogue
    _run(cm.carbon_mapper_plumes(*site))
    fake_s3.objects.pop(f"methane/cache/cmimage_v1_{PID}.geojson")
    _run(cm.carbon_mapper_plumes(*site))           # the list is cached (12 h); the link is not
    api = [r for r in state["requests"] if r.url.host == "api.carbonmapper.org"]
    assert len(api) == 2 and f"methane/cache/cmimage_v1_{PID}.geojson" in fake_s3.objects


def test_an_expired_link_is_a_code_and_the_tip_bars_stay(cm, catalogue, fake_s3):
    site, state = catalogue
    state["status"] = 403                          # CloudFront's answer to a link past its Expires
    out = json.loads(_run(cm.carbon_mapper_plumes(*site)))
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.7625_53.9324.json"])
    assert rec["image"]["status"] == "unavailable" and rec["image"]["code"] == "cm_image_http_403"
    assert "file" not in rec["image"] and out["summary"]["count"] == 1 and "error" not in out
    assert not [k for k in fake_s3.objects if "cmimage_" in k or "cmcolumns_" in k]


IMAGES = {
    "huge": lambda cm: b"\0" * (cm.CM_IMAGE_CAP_BYTES + 10),
    "two bands": lambda cm: utm_plume(count=2),
    "uint8": lambda cm: utm_plume(dtype="uint8", value=200),
    "too big": lambda cm: utm_plume(width=1001, height=4),
    "geographic": lambda cm: utm_plume(crs="EPSG:4326"),
    "not a tif": lambda cm: b"not a tif",
    "far away": lambda cm: utm_plume(at=(55.5, 37.77)),        # ~140 km east of the plume's point
}


@pytest.mark.parametrize("image, headers, code", [
    ("huge", {}, "cm_image_too_large"),
    (None, {"content-length": "5000000"}, "cm_image_too_large"),
    ("two bands", {}, "cm_image_not_one_float32_band"),
    ("uint8", {}, "cm_image_not_one_float32_band"),
    ("too big", {}, "cm_image_too_many_pixels"),
    ("geographic", {}, "cm_image_not_projected"),
    ("not a tif", {}, "cm_image_unreadable"),
    ("far away", {}, "cm_image_misplaced"),
])
def test_the_image_caps(cm, catalogue, fake_s3, image, headers, code):
    site, state = catalogue
    if image:
        state["tif"] = IMAGES[image](cm)
    state["headers"] = headers
    _run(cm.carbon_mapper_plumes(*site))
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.7625_53.9324.json"])
    assert rec["image"]["status"] == "unavailable" and rec["image"]["code"] == code


@pytest.mark.parametrize("url", [
    LINK.replace("https://", "http://"),
    LINK.replace("catalog.carbonmapper.org", "catalog.carbonmapper.org.evil.example"),
    LINK.replace("catalog.carbonmapper.org", "user:pw@catalog.carbonmapper.org"),
    LINK.replace("catalog.carbonmapper.org", "catalog.carbonmapper.org:8443"),
    LINK.replace(f"/{PID}/{PID}_", "/tan20260101t000000c11s4001-B/tan20260101t000000c11s4001-B_"),   # another plume
    LINK.replace("_ime-cmf-concentrations.tif", "_plume.png"),
    LINK.replace(f"/{PRODUCT}/2026", "/../2026"),
    None, 42,
])
def test_the_image_link_must_be_that_plume_on_carbon_mappers_host(cm, url):
    assert cm.image_url_ok(LINK, PID)
    assert not cm.image_url_ok(url, PID)
    gao = (f"https://catalog.carbonmapper.org/l3a-ch4-mf-v1/2025/09/01/{PID}/{PID}_l3a-ch4-mf-v1_concentrations.tif?x=1")
    assert cm.image_url_ok(gao, PID)


def test_a_cached_image_is_cleaned_field_by_field(cm):
    dirty = {"features": [
        {"geometry": {"coordinates": [[[53.9, 37.7], [53.91, 37.7], [53.91, 37.71], [53.9, 37.71], [53.9, 37.7]]]},
         "properties": {"ppm_m": 900, "note": "<script>"}},
        {"geometry": {"coordinates": [[["53.9", 37.7]] * 5]}, "properties": {"ppm_m": 900}},
        {"geometry": {"coordinates": [[[53.9, 37.7]] * 5]}, "properties": {"ppm_m": "lots"}}]}
    out = cm.clean_columns(dirty)
    assert len(out["features"]) == 1 and out["features"][0]["properties"] == {"ppm_m": 900.0}


def test_the_latest_confirmation_says_its_days_before_the_tip_and_the_90_day_test(cm, catalogue, fake_s3):
    """The follow rule's facts, said by the tool: days from the latest confirmation to the tip
    window of the watch area holding the site, and whether that is within 90 days."""
    site, _ = catalogue
    out = json.loads(_run(cm.carbon_mapper_plumes(*site)))
    assert out["within_90_days"] is False and "days_before_tip" not in out["latest_confirmed"]   # no tip read yet
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/tip_south_caspian.json",
                       Body=json.dumps({"area": "south caspian", "start": "2026-10-07", "end": "2026-10-21"}).encode())
    out = json.loads(_run(cm.carbon_mapper_plumes(*site)))
    assert out["latest_confirmed"] == {"date": "2026-08-26", "by": "a Carbon Mapper plume", "days_before_tip": 42,
                                       "within_90_days": True}
    assert out["within_90_days"] is True
