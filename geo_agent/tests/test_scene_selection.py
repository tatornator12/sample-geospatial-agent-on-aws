"""Scene selection facts in get_filtered_images / get_rasters: exclude_dates, candidates,
AOI quality wiring, and the result JSON. STAC, S3 and clipping are patched; no network."""
import importlib
import json

import geopandas as gpd
import pytest
from shapely.geometry import box


CANDIDATES = [
    {"date": "2026-03-01T10:00:00Z", "cloud_pct": 40.0, "coverage_pct": 100.0, "tile_id": "T1",
     "tci": "https://x/t1_0301/TCI.tif", "thumbnail": "https://x/t1/0301/preview.jpg", "scl": "https://x/t1_0301/SCL.tif", "red": "https://x/t1_0301/B04.tif"},
    {"date": "2026-03-06T10:00:00Z", "cloud_pct": 5.0, "coverage_pct": 100.0, "tile_id": "T1",
     "tci": "https://x/t1_0306/TCI.tif", "thumbnail": "https://x/t1/0306/preview.jpg", "scl": "https://x/t1_0306/SCL.tif", "red": "https://x/t1_0306/B04.tif"},
    {"date": "2026-03-16T10:00:00Z", "cloud_pct": 12.0, "coverage_pct": 100.0, "tile_id": "T1",
     "tci": "https://x/t1_0316/TCI.tif", "thumbnail": "https://x/t1/0316/preview.jpg", "scl": None, "red": "https://x/t1_0316/B04.tif"},
]


@pytest.fixture()
def sentinel(monkeypatch):
    mod = importlib.import_module("utils.sentinel_utils")
    monkeypatch.setattr(mod, "get_all_images_from_gdf", lambda *a, **k: [dict(c) for c in CANDIDATES])
    monkeypatch.setattr(mod, "get_raster_crs", lambda _href: "EPSG:4326")
    monkeypatch.setattr(mod, "clip_raster_v2", lambda mask_file, raster_file, target_file, crop_to_aoi=True: open(target_file, "wb").close())
    monkeypatch.setattr(mod, "scl_quality", lambda scl_path, aoi: {
        "clear_pct": 62.0, "cloud_pct": 30.0, "shadow_pct": 5.0, "snow_pct": 0.0, "nodata_pct": 3.0, "pixels": 100})

    class FakeS3:
        def upload_file(self, local, bucket, key):
            pass

    monkeypatch.setattr(mod.boto3, "client", lambda *_a, **_k: FakeS3())
    monkeypatch.setattr(mod.config, "S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("AGENT_SESSION_ID", "sess-x")
    return mod


@pytest.fixture()
def aoi():
    return gpd.GeoDataFrame(geometry=[box(-105.01, 38.99, -104.99, 39.01)], crs="EPSG:4326")


def test_best_scene_and_candidates_without_exclusions(sentinel, aoi):
    (result,) = sentinel.get_filtered_images(aoi, bands=["red"], location="Test Town", current_date_str="2026-03-20")
    assert result["date"].startswith("2026-03-06")
    assert [c["date"] for c in result["candidates"]] == ["2026-03-16", "2026-03-01"]
    assert result["candidates"][0] == {"date": "2026-03-16", "cloud_pct": 12.0, "coverage_pct": 100.0}
    assert result["aoi_quality"]["clear_pct"] == 62.0
    assert result["tci_s3_url"] == "s3://test-bucket/session_data/sess-x/rasters/tci_clipped_test_town_2026-03-06.tif"
    assert result["red_s3_url"].endswith("/red_clipped_test_town_2026-03-06.tif")


def test_exclude_dates_moves_to_the_next_ranked_scene(sentinel, aoi):
    (result,) = sentinel.get_filtered_images(aoi, bands=["red"], location="Test Town",
                                             current_date_str="2026-03-20", exclude_dates=("2026-03-06",))
    assert result["date"].startswith("2026-03-16")
    assert [c["date"] for c in result["candidates"]] == ["2026-03-01"]
    assert result["aoi_quality"] is None  # that scene has no SCL asset


def test_all_scenes_excluded_returns_empty(sentinel, aoi):
    out = sentinel.get_filtered_images(aoi, bands=["red"], location="Test Town", current_date_str="2026-03-20",
                                       exclude_dates=("2026-03-01", "2026-03-06", "2026-03-16"))
    assert out == []


def test_scl_failure_does_not_fail_the_fetch(sentinel, aoi, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("SCL unreachable")
    monkeypatch.setattr(sentinel, "scl_quality", boom)
    (result,) = sentinel.get_filtered_images(aoi, bands=["red"], location="Test Town", current_date_str="2026-03-20")
    assert result["aoi_quality"] is None and result["tci_s3_url"]


def test_result_json_exposes_aoi_facts_and_candidates(tools_module):
    payload = tools_module._raster_result_json({
        "date": "2026-03-06T10:00:00Z", "tci_s3_url": "s3://b/tci.tif", "red_s3_url": "s3://b/red.tif",
        "cloud_pct": 5.0, "tile_id": "T1", "coverage_pct": 100.0,
        "aoi_quality": {"clear_pct": 62.0, "cloud_pct": 30.0, "shadow_pct": 5.0, "snow_pct": 0.0, "nodata_pct": 3.0},
        "candidates": [{"date": "2026-03-16", "cloud_pct": 12.0, "coverage_pct": 100.0}],
    }, "Test Town")
    json.dumps(payload)
    assert payload["date_used"] == "2026-03-06"
    assert payload["aoi_clear_pct"] == 62.0
    assert payload["aoi_cloud_pct"] == 35.0  # clouds + shadow, the number the prompt's rule uses
    assert payload["aoi_nodata_pct"] == 3.0
    assert payload["candidates"][0]["date"] == "2026-03-16"


def test_result_json_without_scl_has_null_facts(tools_module):
    payload = tools_module._raster_result_json({"date": "2026-03-06T10:00:00Z", "aoi_quality": None}, "x")
    assert payload["aoi_clear_pct"] is None and payload["aoi_cloud_pct"] is None
    assert payload["aoi_nodata_pct"] is None and payload["candidates"] == []
