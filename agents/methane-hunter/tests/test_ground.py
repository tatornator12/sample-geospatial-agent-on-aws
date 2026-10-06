"""The ground-record checks (ground_tools): VIIRS heat near a site and what OpenStreetMap maps, by type.

Hermetic: FIRMS and Overpass are patched; S3 is the in-memory fake. The checks must never let a name,
operator or free text through, must write their numbers-only record for the brief, and must fail soft.
"""
import asyncio
import importlib
import json
import time

import pytest

from conftest import BUCKET, SESSION

LAT, LON = 39.4741, 53.6435


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def ground(tools, monkeypatch):
    importlib.import_module("watch_tools")
    mod = importlib.import_module("ground_tools")
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    return mod


FIRMS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"


def firms_csv(rows):
    return FIRMS_HEADER + "".join(
        f"{la},{lo},330.1,0.4,0.4,{day},{t},N,VIIRS,n,2.0NRT,290.0,{frp},{dn},{typ}\n" for la, lo, day, t, frp, dn, typ in rows)


# --- thermal_anomalies ------------------------------------------------------------------------------

def test_thermal_counts_nights_within_the_radius_and_records_them(ground, fake_s3, monkeypatch):
    body = firms_csv([
        (LAT + 0.002, LON, "2026-09-20", "2210", 4.2, "N", "2"),
        (LAT + 0.002, LON, "2026-09-21", "2158", 3.9, "N", "2"),
        (LAT, LON + 0.003, "2026-09-25", "2201", 6.0, "N", "2"),
        (LAT, LON, "2026-09-22", "1030", 2.0, "D", "0"),          # daytime: counted, but not a night
        (LAT + 0.5, LON, "2026-09-23", "2200", 50.0, "N", "0"),   # 55 km away: a different fire
    ])
    calls = []

    def fake_get(client, url):
        calls.append(url)
        assert url.startswith("https://firms.modaps.eosdis.nasa.gov/")
        return body if "suomi-npp" in url else FIRMS_HEADER   # the second sensor saw nothing here
    monkeypatch.setattr(ground, "firms_get", fake_get)
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert out["source"] == "firms-7d" and out["nights_checked"] == 7          # no key: the public 7-day files
    assert out["detections"] == 4 and out["nights_with_heat"] == 3 and out["verdict"] == "persistent heat"
    assert out["static_source_detections"] == 3 and out["max_frp_mw"] == 6.0
    assert "3 of 7 nights" in out["line"] and "unlit_flare: 'less likely'" in out["hypothesis_hint"]
    # The two public files were fetched once each and cached for the day; a second call reads the cache.
    assert len(calls) == 2
    again = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert len(calls) == 2 and again["detections"] == 4
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/thermal_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["verdict"] == "persistent heat" and rec["line"] == out["line"]


def test_thermal_with_a_key_uses_the_area_api_and_never_leaks_the_key(ground, monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "abc123secret")
    urls = []
    monkeypatch.setattr(ground, "firms_get", lambda client, url: urls.append(url) or FIRMS_HEADER)
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON, nights=30)))
    assert out["source"] == "firms-api" and out["nights_checked"] == 30 and out["verdict"] == "no heat"
    assert "no heat source" in out["line"] and "flaring was not observed" in out["line"]
    assert len(urls) == 6 and all("/api/area/csv/abc123secret/VIIRS_" in u for u in urls)   # 3 chunks x 2 sensors
    assert "abc123secret" not in json.dumps(out)


def test_thermal_fails_soft_and_validates_first(ground, monkeypatch):
    monkeypatch.setattr(ground, "firms_get", lambda *a: (_ for _ in ()).throw(RuntimeError("firms_http_503")))
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert "error" in out and "flare check is unavailable" in out["error"]
    assert "error" in json.loads(_run(ground.thermal_anomalies(95, LON)))
    assert "error" in json.loads(_run(ground.thermal_anomalies(LAT, LON, nights=0)))


# --- nearby_infrastructure --------------------------------------------------------------------------

def osm(elements):
    return [{"type": "node", "id": i, **e} for i, e in enumerate(elements)]


def test_infra_counts_types_only_and_drops_every_name(ground, fake_s3, monkeypatch):
    elements = osm([
        {"lat": LAT + 0.003, "lon": LON, "tags": {"man_made": "petroleum_well", "operator": "Acme Oil LLC", "name": "Well 7"}},
        {"lat": LAT + 0.004, "lon": LON, "tags": {"man_made": "petroleum_well", "operator": "Acme Oil LLC"}},
        {"lat": LAT, "lon": LON + 0.006, "tags": {"man_made": "flare", "name": "Flare A"}},
        {"center": {"lat": LAT - 0.01, "lon": LON}, "tags": {"man_made": "pipeline", "operator": "Pipeco"}},
        {"center": {"lat": LAT + 0.012, "lon": LON}, "tags": {"landuse": "quarry", "resource": "coal", "name": "Big Mine"}},
        {"center": {"lat": LAT, "lon": LON - 0.009}, "tags": {"power": "plant", "plant:source": "gas", "owner": "State Co"}},
        {"center": {"lat": LAT, "lon": LON - 0.009}, "tags": {"landuse": "farmland"}},
        {"lat": LAT + 0.2, "lon": LON, "tags": {"man_made": "petroleum_well"}},            # 22 km: outside
        {"lat": LAT, "lon": LON, "tags": {"shop": "bakery", "name": "Nobody's Bakery"}},    # not a category
    ])
    monkeypatch.setattr(ground, "fetch_overpass", lambda lat, lon, r: elements)
    out = json.loads(_run(ground.nearby_infrastructure(LAT, LON)))
    types = {r["type"]: r for r in out["types"]}
    assert types["well"]["count"] == 2 and types["well"]["nearest_km"] == 0.3
    assert types["flare stack"]["count"] == 1 and types["coal mine"]["count"] == 1 and types["gas power plant"]["group"] == "oil and gas"
    assert out["groups"]["oil and gas"] == 5 and out["groups"]["coal"] == 1 and out["groups"]["agriculture"] == 1
    assert out["mapped"] == 7
    blob = json.dumps(out)
    for leaked in ("Acme", "Pipeco", "Well 7", "Flare A", "Big Mine", "State Co", "Bakery", "operator", "name"):
        assert leaked not in blob, leaked
    assert out["line"].startswith("OpenStreetMap maps within 2 km: 2 wells (0.3 km)")
    assert "a flare stack is mapped" in out["hypothesis_hint"] and "non_oil_gas_source (coal): 'possible'" in out["hypothesis_hint"]
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/infra_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["mapped"] == 7 and "Acme" not in json.dumps(rec)
    # The shared cache keeps only allowlisted tags and positions, so a re-read cannot resurface a name.
    cache = json.loads(fake_s3.objects[f"methane/cache/osm_{LAT:.4f}_{LON:.4f}_2km.json"])
    assert "Acme" not in json.dumps(cache) and cache["elements"][0]["tags"] == {"man_made": "petroleum_well"}
    monkeypatch.setattr(ground, "fetch_overpass", lambda *a: pytest.fail("should come from the cache"))
    assert json.loads(_run(ground.nearby_infrastructure(LAT, LON)))["source"] == "cache"


def test_infra_nothing_mapped_is_a_gap_not_evidence(ground, monkeypatch):
    monkeypatch.setattr(ground, "fetch_overpass", lambda lat, lon, r: [])
    out = json.loads(_run(ground.nearby_infrastructure(LAT, LON)))
    assert out["mapped"] == 0 and "mapping gap" in out["line"] and "cannot assess" in out["hypothesis_hint"]


def test_infra_fails_soft_when_overpass_is_down(ground, monkeypatch):
    monkeypatch.setattr(ground, "fetch_overpass", lambda *a: (_ for _ in ()).throw(RuntimeError("overpass_504")))
    out = json.loads(_run(ground.nearby_infrastructure(LAT, LON)))
    assert "error" in out and "infrastructure check is unavailable" in out["error"]
    assert "error" in json.loads(_run(ground.nearby_infrastructure(LAT, LON, radius_km=50)))


def test_overpass_gives_up_within_its_budget(ground, monkeypatch):
    """Every server busy: the check fails soft inside the budget, never stalling the agent's stream."""
    import httpx

    class Busy:
        def __init__(self, *a, **k):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def post(self, url, **k):
            raise httpx.ReadTimeout("busy")
    monkeypatch.setattr(ground.httpx, "Client", Busy)
    monkeypatch.setattr(ground.time, "sleep", lambda s: None)
    started = time.monotonic()
    with pytest.raises(httpx.ReadTimeout):
        ground.fetch_overpass(LAT, LON, 2.0)
    assert time.monotonic() - started < 2


def test_overpass_query_is_built_from_numbers_only(ground):
    q = ground.OVERPASS_QUERY.format(timeout=25, r=2000, lat="39.47410", lon="53.64350", cap=400)
    assert "around:2000,39.47410,53.64350" in q and "out tags center 400;" in q
    assert ground.classify({"man_made": "flare", "operator": "X"}) == ("flare stack", "oil and gas")
    assert ground.classify({"landuse": "quarry", "resource": "Coal"}) == ("coal mine", "coal")
    assert ground.classify({"power": "plant", "plant:source": "coal"}) == ("coal power plant", "coal")
    assert ground.classify({"power": "plant", "plant:source": "<script>"}) == ("power plant", "other industry")
    assert ground.classify({"name": "x"}) is None and ground.classify(None) is None
