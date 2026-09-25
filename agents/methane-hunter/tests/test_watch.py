"""Methane Watch tools (requirements 8-9): NASA plume metadata, site clusters, TROPOMI tip, EMIT cue."""
import asyncio
import io
import json
from datetime import date

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from conftest import BUCKET, PLUME_ID, PLUME_ID_2, SESSION, footprint, make_plume_bytes, put_plume_list

TOKEN = "test-token-value-xyz"


def _run(coro):
    return asyncio.run(coro)


META_WITH_RATE = {
    "type": "FeatureCollection",
    "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
                  "properties": {"Plume ID": "CH4_PlumeComplex-2534", "UTC Time Observed": "2024-01-31T18:24:59Z",
                                 "Max Plume Concentration (ppm m)": 8131.0,
                                 "Latitude of max concentration": 31.86424, "Longitude of max concentration": -101.7662,
                                 "Wind Speed (m/s)": 4.5397, "Wind Speed Std (m/s)": 0.1068, "Wind Speed Source": "HRRR",
                                 "Emissions Rate Estimate (kg/hr)": 6685.349,
                                 "Emissions Rate Estimate Uncertainty (kg/hr)": 202.3671, "Fetch Length (m)": 1154.8338}}],
}
META_NA = json.loads(json.dumps(META_WITH_RATE))
META_NA["features"][0]["properties"].update({"Wind Speed (m/s)": "NA", "Wind Speed Source": "NA",
                                             "Emissions Rate Estimate (kg/hr)": "NA",
                                             "Emissions Rate Estimate Uncertainty (kg/hr)": "NA", "Fetch Length (m)": "NA"})


@pytest.fixture()
def watch(tools, monkeypatch):
    import importlib
    mod = importlib.import_module("watch_tools")
    return mod


# --- 9.1 NASA plume metadata ----------------------------------------------------------------------

def test_parse_meta_keeps_nasa_numbers_and_turns_na_into_null(tools):
    m = tools.parse_plume_meta(json.dumps(META_WITH_RATE).encode())
    assert m["rate_kg_h"] == pytest.approx(6685.3, abs=0.05) and m["rate_uncertainty_kg_h"] == pytest.approx(202.4, abs=0.05)
    assert m["wind_m_s"] == pytest.approx(4.54, abs=0.005) and m["wind_source"] == "HRRR"
    assert m["fetch_length_m"] == 1155 and (m["peak_lat"], m["peak_lon"]) == (31.86424, -101.7662)
    assert m["max_ppm_m_nasa"] == 8131.0
    na = tools.parse_plume_meta(json.dumps(META_NA).encode())
    assert na["rate_kg_h"] is None and na["wind_m_s"] is None and na["wind_source"] is None and na["fetch_length_m"] is None
    # Hostile or broken values never become numbers.
    bad = json.loads(json.dumps(META_WITH_RATE))
    bad["features"][0]["properties"].update({"Emissions Rate Estimate (kg/hr)": "1e999", "Wind Speed Source": "<script>"})
    b = tools.parse_plume_meta(json.dumps(bad).encode())
    assert b["rate_kg_h"] is None and b["wind_source"] is None
    assert tools.parse_plume_meta(b"not json") == {}


def test_meta_url_is_built_from_the_validated_id(tools):
    assert tools.meta_url(PLUME_ID) == (f"https://{tools.LPDAAC_HOST}/lp-prod-protected/EMITL2BCH4PLM.002/"
                                        f"{PLUME_ID}/{PLUME_ID.replace('CH4PLM_', 'CH4PLMMETA_')}.json")
    with pytest.raises(tools.MethaneError):
        tools.meta_url("../../etc/passwd")


def test_fetch_meta_uses_the_cache_then_lpdaac_and_never_raises(tools, fake_s3, monkeypatch):
    calls = []
    monkeypatch.setattr(tools, "download_url", lambda url, token, *a, **k: calls.append(url) or json.dumps(META_WITH_RATE).encode())
    m = tools.fetch_plume_meta(PLUME_ID, TOKEN, fake_s3)
    assert m["rate_kg_h"] == pytest.approx(6685.3, abs=0.05) and len(calls) == 1
    assert f"methane/cache/ch4plmmeta_{PLUME_ID}.json" in fake_s3.objects
    assert tools.fetch_plume_meta(PLUME_ID, TOKEN, fake_s3)["rate_kg_h"] and len(calls) == 1   # cached

    def boom(*a, **k):
        raise tools.PlumeFetchError("not_found")
    monkeypatch.setattr(tools, "download_url", boom)
    assert tools.fetch_plume_meta(PLUME_ID_2, TOKEN, fake_s3) == {"meta_error": "not_found"}


def test_download_url_refuses_any_host_but_lpdaac(tools):
    with pytest.raises(tools.PlumeFetchError) as e:
        tools.download_url("https://evil.example.com/x.tif", TOKEN)
    assert e.value.reason == "host_not_allowed"
    with pytest.raises(tools.PlumeFetchError):
        tools.download_url(f"http://{tools.LPDAAC_HOST}/x.tif", TOKEN)


def test_triage_carries_nasa_rates_on_the_ranking_and_the_footprints(tools, fake_s3, monkeypatch):
    url = put_plume_list(fake_s3, [footprint(PLUME_ID), footprint(PLUME_ID_2)])
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    bodies = {PLUME_ID: make_plume_bytes(peak=900.0), PLUME_ID_2: make_plume_bytes(peak=2500.0)}
    monkeypatch.setattr(tools, "download_plume", lambda gid, token, *a, **k: bodies[gid])
    metas = {PLUME_ID_2: json.dumps(META_WITH_RATE).encode(), PLUME_ID: json.dumps(META_NA).encode()}
    monkeypatch.setattr(tools, "download_url", lambda url, token, *a, **k: next(v for g, v in metas.items() if g in url))
    out = json.loads(_run(tools.triage_plumes(url)))
    top, second = out["ranked"]
    assert top["granule_id"] == PLUME_ID_2 and top["rate_kg_h"] == pytest.approx(6685.3, abs=0.05)
    assert top["wind_source"] == "HRRR" and second["rate_kg_h"] is None
    fc = json.loads(fake_s3.objects[out["ranked_geometry_s3_url"].split(f"{BUCKET}/", 1)[1]])
    rates = {f["properties"]["granule_id"]: f["properties"].get("rate_kg_h") for f in fc["features"]}
    assert rates[PLUME_ID_2] == pytest.approx(6685.3, abs=0.05) and rates[PLUME_ID] is None
    assert out["summary"]["with_rate"] == 1
    assert TOKEN not in json.dumps(out)


# --- 9.5 site clusters ------------------------------------------------------------------------------

def test_cluster_sites_groups_repeat_detections_deterministically(watch):
    pts = [(31.864, -101.766, "2024-01-31", "a"), (31.870, -101.770, "2023-07-31", "b"),
           (31.866, -101.768, "2024-01-31", "c"), (32.50, -101.50, "2024-02-01", "d")]
    sites = watch.cluster_sites(pts)
    assert [(s["repeat_dates"], s["plumes"], s["first"], s["last"]) for s in sites] == [
        (2, 3, "2023-07-31", "2024-01-31"), (1, 1, "2024-02-01", "2024-02-01")]
    assert watch.cluster_sites(list(reversed(pts))) == sites


def test_watch_areas_resolve_by_exact_name_only(watch):
    key, spec = watch.resolve_watch_area("  South Caspian ")
    assert key == "south caspian" and spec["emit"] is True
    assert watch.resolve_watch_area("west siberia and yamal")[1]["emit"] is False
    for bad in ("caspian", "north korea", "xinjiang", "", None, 7):
        with pytest.raises(watch.MethaneError):
            watch.resolve_watch_area(bad)
    for spec in watch.WATCH_AREAS.values():   # the ISS rule matches the table
        w, s, e, n = spec["bbox"]
        assert spec["emit"] == (s < watch.EMIT_MAX_LAT)


# --- 9.3 TROPOMI ---------------------------------------------------------------------------------

STEM = "S5P_OFFL_L2__CH4____20260910T073351_20260910T091521_46165_03_020901_20260911T231512"


def test_overpass_orbits_pick_the_local_early_afternoon_pass_from_a_listing(watch):
    keys = [f"COGT/OFFL/L2__CH4___/2026/09/10/{STEM}_PRODUCT_methane_mixing_ratio_4326.tif",
            f"COGT/OFFL/L2__CH4___/2026/09/10/{STEM}_PRODUCT_qa_value_4326.tif",
            "COGT/OFFL/L2__CH4___/2026/09/10/S5P_OFFL_L2__CH4____20260910T200000_20260910T214000_46170_03_020901_20260911T231512_PRODUCT_methane_mixing_ratio_4326.tif",
            "COGT/OFFL/L2__CH4___/2026/09/10/../../evil_PRODUCT_methane_mixing_ratio_4326.tif"]
    assert watch.overpass_orbits(keys, date(2026, 9, 10), 59.4) == [f"COGT/OFFL/L2__CH4___/2026/09/10/{STEM}"]
    # West Texas (~20:10 UTC local early afternoon) gets the evening-UTC orbit, not the morning one.
    assert watch.overpass_orbits(keys, date(2026, 9, 10), -100.0) == [
        "COGT/OFFL/L2__CH4___/2026/09/10/S5P_OFFL_L2__CH4____20260910T200000_20260910T214000_46170_03_020901_20260911T231512"]
    assert watch.overpass_orbits(keys, date(2026, 9, 10), 150.0) == []


def test_composite_and_hotspots_find_the_persistent_anomaly(watch):
    rng = np.random.default_rng(0)
    transform = from_origin(52.0, 42.0, 0.035, 0.035)
    days = []
    for d in range(6):
        a = 1940 + rng.normal(0, 3, (60, 80))
        a[30:32, 40:42] += 45                       # persistent hotspot
        a[5, 5] = np.nan if d else 2100             # one-day spike: too few valid days
        if d % 2:
            a[:, 70:] = np.nan                      # clouds on alternate days
        days.append(a)
    med, valid = watch.composite(days)
    anomaly = med - np.nanmedian(med)
    spots = watch.find_hotspots(anomaly, valid, transform, n=3)
    json.dumps(spots)                                # plain Python types: the tool result serializes
    top = spots[0]
    assert top["rank"] == 1 and top["anomaly_ppb"] > 35 and top["valid_days"] == 6
    lon, lat = transform * (40.5, 30.5)
    # Any pixel of the 2 x 2 hotspot block (0.035° pixels).
    assert abs(top["lat"] - lat) <= 0.036 and abs(top["lon"] - lon) <= 0.036 and top["emit_can_look"] is True
    assert all(s["valid_days"] >= watch.HOTSPOT_MIN_DAYS for s in spots)
    assert all(watch.km_between(a["lat"], a["lon"], b["lat"], b["lon"]) >= watch.HOTSPOT_SEPARATION_KM
               for i, a in enumerate(spots) for b in spots[i + 1:])


def test_scan_tropomi_validates_before_any_request(watch, monkeypatch):
    monkeypatch.setattr(watch, "tropomi_s3", lambda: pytest.fail("no request on bad input"))
    assert "error" in json.loads(_run(watch.scan_tropomi(area="north korea")))
    assert "error" in json.loads(_run(watch.scan_tropomi(bbox=[0, 0, 40, 40])))            # too large
    assert "error" in json.loads(_run(watch.scan_tropomi(area="south caspian", days=30)))
    assert "error" in json.loads(_run(watch.scan_tropomi(area="south caspian", end_date="yesterday")))


def test_scan_tropomi_end_to_end_on_synthetic_orbits(watch, fake_s3, monkeypatch):
    listing = {"Contents": [{"Key": f"COGT/OFFL/L2__CH4___/2026/09/10/{STEM}_PRODUCT_methane_mixing_ratio_4326.tif"}]}

    class FakeS5P:
        def list_objects_v2(self, Bucket, Prefix):
            assert Bucket == "meeo-s5p" and Prefix.startswith("COGT/OFFL/L2__CH4___/")
            return listing if Prefix.endswith("2026/09/10/") else {}
    monkeypatch.setattr(watch, "tropomi_s3", lambda: FakeS5P())
    a = np.full((20, 30), 1940.0)
    a[10, 15] = 1990.0
    read = []
    monkeypatch.setattr(watch, "read_tropomi_window", lambda stem, box: read.append(stem) or (a.copy(), from_origin(52, 41.5, 0.35, 0.25)))
    out = json.loads(_run(watch.scan_tropomi(area="south caspian", days=1, end_date="2026-09-10")))
    assert read == [f"COGT/OFFL/L2__CH4___/2026/09/10/{STEM}"]
    assert out["summary"]["background_ppb"] == 1940.0 and out["summary"]["orbits"] == 1
    assert out["anomaly_s3_url"].startswith(f"s3://{BUCKET}/session_data/{SESSION}/methane/tropomi_anomaly_")
    assert out["render"]["colormap"] == "magma" and out["render"]["units"] == "ppb"
    assert out["hotspots"][0]["anomaly_ppb"] == 50.0
    # Warm: same answer from the shared cache, nothing read from TROPOMI, a fresh session copy.
    monkeypatch.setattr(watch, "read_tropomi_window", lambda *a, **k: pytest.fail("should come from the cache"))
    monkeypatch.setenv("AGENT_SESSION_ID", "another-session-0002")
    again = json.loads(_run(watch.scan_tropomi(area="south caspian", days=1, end_date="2026-09-10")))
    assert again["summary"]["source"] == "cache" and again["hotspots"] == out["hotspots"]
    assert "/session_data/another-session-0002/methane/" in again["anomaly_s3_url"]


# --- 9.4 EMIT recent passes -------------------------------------------------------------------------

SCENE = "EMIT_L2B_CH4ENH_002_20260812T060000_2622401_012"
LAT, LON = 37.48, 61.025


def _scene_tifs(peak_pixels: int, value: float, uncert: float):
    """A 0.2° x 0.2° enhancement scene centred on the site, 60 m-ish pixels, and its uncertainty."""
    px = 0.0005
    n = int(0.2 / px)
    enh = np.full((n, n), 50.0, dtype=np.float32)
    enh[:5, :] = -9999
    c = n // 2
    flat = enh[c - 10:c + 10, c - 10:c + 10].reshape(-1)
    flat[:peak_pixels] = value
    enh[c - 10:c + 10, c - 10:c + 10] = flat.reshape(20, 20)
    unc = np.full((n, n), uncert, dtype=np.float32)
    out = []
    for arr in (enh, unc):
        with rasterio.MemoryFile() as mem:
            with mem.open(driver="GTiff", width=n, height=n, count=1, dtype="float32", crs="EPSG:4326",
                          transform=from_origin(LON - 0.1, LAT + 0.1, px, px), nodata=-9999) as ds:
                ds.write(arr, 1)
            out.append(mem.read())
    return out


def test_scene_ids_and_urls_are_validated(watch):
    assert watch.scene_url(SCENE, "CH4UNCERT").endswith(f"/EMITL2BCH4ENH.002/{SCENE}/{SCENE.replace('_CH4ENH_', '_CH4UNCERT_')}.tif")
    for bad in ("EMIT_L2B_CH4ENH_002_x", SCENE + "/../x", None):
        with pytest.raises(watch.MethaneError):
            watch.scene_url(bad, "CH4ENH")
    with pytest.raises(watch.MethaneError):
        watch.scene_url(SCENE, "RFL")


@pytest.mark.parametrize("pixels,value,uncert,verdict,why", [
    (40, 2500.0, 100.0, "candidate", "40 pixels"),
    (3, 2500.0, 100.0, "rejected", "only 3 pixels"),
    (40, 1200.0, 900.0, "rejected", "above 3× their uncertainty"),
])
def test_window_verdicts(watch, pixels, value, uncert, verdict, why):
    enh, unc = _scene_tifs(pixels, value, uncert)
    s = watch.window_stats(enh, unc, LAT, LON)
    assert s["verdict"] == verdict and why in s["reason"]
    assert s["peak_ppm_m"] == pytest.approx(value, abs=0.1)


def test_check_recent_passes_reads_scenes_and_stages_windows(watch, fake_s3, monkeypatch):
    import methane_tools as mt
    monkeypatch.setenv("EARTHDATA_TOKEN", TOKEN)
    monkeypatch.setattr(mt, "archive_latest", lambda client: date(2025, 9, 22))
    seen = []
    monkeypatch.setattr(watch, "_cmr_entries", lambda client, params, limit: seen.append(params) or (
        [{"title": SCENE}, {"title": "EMIT_L2B_CH4ENH_002_20260101T000000_2600001_001"}, {"title": "junk"}], 17))
    strong, weak = _scene_tifs(40, 2500.0, 100.0), _scene_tifs(2, 2500.0, 100.0)
    monkeypatch.setattr(watch, "download_scene_layer",
                        lambda sid, layer, token: (strong if sid == SCENE else weak)[0 if layer == "CH4ENH" else 1])
    out = json.loads(_run(watch.check_recent_passes(LAT, LON)))
    assert seen[0]["short_name"] == "EMITL2BCH4ENH" and seen[0]["temporal"].startswith("2025-01-01T")
    s = out["summary"]
    assert (s["looks"], s["read"], s["candidates"], s["rejected"]) == (17, 2, 1, 1)
    assert out["strongest_candidate"]["date"] == "2026-08-12"
    assert out["strongest_candidate"]["window_s3_url"] == f"s3://{BUCKET}/session_data/{SESSION}/methane/pass_{SCENE}.tif"
    assert TOKEN not in json.dumps(out)
    # Second run: every verdict from the shared cache, no download, same answer.
    monkeypatch.setattr(watch, "download_scene_layer", lambda *a, **k: pytest.fail("should come from the cache"))
    again = json.loads(_run(watch.check_recent_passes(LAT, LON)))
    assert again["summary"]["from_cache"] == 2 and again["summary"]["candidates"] == 1
    assert [p["verdict"] for p in again["passes"]] == [p["verdict"] for p in out["passes"]]


def test_check_recent_passes_says_when_emit_cannot_look(watch, monkeypatch):
    monkeypatch.setattr(watch, "_cmr_entries", lambda *a, **k: pytest.fail("no search north of the ISS"))
    out = json.loads(_run(watch.check_recent_passes(66.0, 76.0)))
    assert out["summary"]["read"] == 0 and "ISS" in out["say"] and "confidence stays low" in out["say"]
