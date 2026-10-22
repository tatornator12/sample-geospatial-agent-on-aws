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
SHANXI = (37.8938, 113.5625)           # the Oct 22 Shanxi tip: seven coal-mine plumes, all just beyond 5 km


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
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
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
                     "distance_km": 2.0, "sector": "oil and gas"}
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
    assert rec == {"lat": 39.4379, "lon": 53.573, "radius_km": 5.0, "since": "2025-01-01", "count": 45,
                   "latest": "2026-06-20", "rate_kg_h": 273.1, "uncertainty_kg_h": 260.9, "instrument": "tanager",
                   "source": "carbon-mapper"}
    geo = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_39.4379_53.5730.geojson"])
    assert len(geo["features"]) == 45
    assert set(geo["features"][0]["properties"]) == {"date", "rate_kg_h", "instrument"}
    assert out["plumes_geometry_s3_url"] == f"s3://{BUCKET}/session_data/{SESSION}/methane/cmplumes_39.4379_53.5730.geojson"
    assert out["render"]["kind"] == "detections"
    # One polite request: one host, the box as four bbox values, one page, a browser-like agent.
    assert len(requests) == 1
    r = requests[0]
    assert r.url.host == "api.carbonmapper.org" and r.url.path == "/api/v1/catalog/plumes/annotated"
    bbox = [float(v) for v in r.url.params.get_list("bbox")]
    assert len(bbox) == 4 and bbox[0] < KRASNOVODSK[1] < bbox[2] and bbox[1] < KRASNOVODSK[0] < bbox[3]
    assert r.url.params["limit"] == "1000" and r.url.params["offset"] == "0"
    assert r.headers["user-agent"].startswith("Mozilla/5.0")


def test_shanxi_plumes_just_beyond_the_radius_are_not_counted(cm, serve, fake_s3):
    serve(page("carbonmapper_shanxi_2026-10-22.json"))
    out = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI)))
    assert out["summary"]["count"] == 0 and out["plumes"] == [] and out["summary"]["latest_date"] is None
    assert out["say"] == ("Carbon Mapper lists no methane plume within 5 km since 2025-01-01 "
                          "(it publishes about 30 days after a detection).")
    assert "plumes_geometry_s3_url" not in out and "render" not in out
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/cmplumes_37.8938_113.5625.json"])
    assert rec["count"] == 0 and rec["latest"] is None and rec["rate_kg_h"] is None
    # A wider radius reaches the seven coal-mine plumes about 5.1 km away (one Carbon Mapper EMIT plume).
    wider = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI, radius_km=6)))
    assert wider["summary"]["count"] == 7 and wider["summary"]["by_instrument"] == {"Tanager-1": 6, "EMIT": 1}
    assert {p["sector"] for p in wider["plumes"]} == {"coal mining"}


def test_every_field_is_validated_and_free_text_never_passes(cm):
    lat, lon = KRASNOVODSK
    since, today = cm.CM_SINCE, datetime(2026, 10, 22).date()
    good = {"plume_id": "tan20260611t083132c93s4001-A", "gas": "CH4", "status": "published",
            "geometry_json": {"type": "Point", "coordinates": [53.575, 39.44]},
            "scene_timestamp": "2026-06-11T08:31:32.230Z", "instrument": "tan", "emission_auto": 1056.2,
            "emission_uncertainty_auto": 537.3, "sector": "1B2"}
    p = cm.parse_item(good, lat, lon, 5, since, today)
    assert p["instrument"] == "tanager" and p["sector"] == "oil and gas" and p["rate_kg_h"] == 1056.2
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
    assert len(requests) == 1 and again["summary"]["source"] == "cache" and again["summary"]["count"] == 45
    # Age the cache past its TTL, then take the API down: the old record answers, and says so.
    key = cm.cache_key(*KRASNOVODSK, 5.0)
    cached = json.loads(fake_s3.objects[key])
    cached["fetched_at"] = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    fake_s3.objects[key] = json.dumps(cached).encode()
    serve(fail=httpx.ConnectTimeout("timed out"))
    stale = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert stale["summary"]["source"] == "stale cache" and stale["summary"]["count"] == 45
    assert "could not be reached" in stale["note"]
    # A server error with nothing cached: the check says it is unavailable, and the choice rests on EMIT.
    serve(body={"detail": "boom"}, status=503)
    out = json.loads(_run(cm.carbon_mapper_plumes(*SHANXI)))
    assert "could not be reached" in out["error"] and "boom" not in json.dumps(out)


def test_a_tampered_cache_row_is_dropped(cm, fake_s3, serve):
    serve(fail=httpx.ConnectError("down"))
    key = cm.cache_key(*KRASNOVODSK, 5.0)
    rows = [{"id": "ok-1", "date": "2026-05-01", "lat": 39.44, "lon": 53.57, "instrument": "tanager",
             "rate_kg_h": 900.0, "uncertainty_kg_h": 100.0, "sector": "oil and gas"},
            {"id": "bad-1", "date": "2026-05-02", "lat": 39.44, "lon": 53.57, "instrument": "<img>", "rate_kg_h": 1.0},
            {"id": "bad-2", "date": "2026-05-03", "lat": 39.44, "lon": 53.57, "instrument": "emit", "sector": "Acme Oil Co"}]
    fake_s3.objects[key] = json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat(), "since": "2025-01-01",
                                       "plumes": rows}).encode()
    out = json.loads(_run(cm.carbon_mapper_plumes(*KRASNOVODSK)))
    assert out["summary"]["count"] == 2 and "Acme" not in json.dumps(out) and "<img>" not in json.dumps(out)
    assert out["plumes"][0]["sector"] is None


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
