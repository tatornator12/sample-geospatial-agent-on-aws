"""Unit tests for utils/inspection.py: rendering, SCL quality, candidate ranking."""
import io
import json

import geopandas as gpd
import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from shapely.geometry import box

from .conftest import CHIP_CENTER, CHIP_PIXEL_DEG


@pytest.fixture(scope="module")
def inspection():
    import importlib
    return importlib.import_module("utils.inspection")


def _write(path, arrays, dtype, nodata=None, pixel=CHIP_PIXEL_DEG):
    """Write a small EPSG:4326 GeoTIFF centred on the chip centre."""
    count, h, w = arrays.shape
    half_w, half_h = w * pixel / 2, h * pixel / 2
    transform = from_origin(CHIP_CENTER[0] - half_w, CHIP_CENTER[1] + half_h, pixel, pixel)
    with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=count, dtype=dtype,
                       crs="EPSG:4326", transform=transform, nodata=nodata) as dst:
        dst.write(arrays.astype(dtype))
    return path


# --- render_preview: RGB ------------------------------------------------------------------
def test_rgb_scene_renders_to_capped_jpeg_with_grey_nodata(tmp_path, inspection):
    h, w = 1500, 3000  # wider than the cap -> downsampled to 1024 wide
    rgb = np.zeros((3, h, w), dtype=np.uint8)
    rgb[0, :, w // 2:] = 200  # right half red-ish land; left half stays nodata (all zeros)
    rgb[1, :, w // 2:] = 120
    rgb[2, :, w // 2:] = 60
    path = _write(tmp_path / "tci_clipped_test_2026-01-01.tif", rgb, "uint8", nodata=0)

    out = inspection.render_preview(str(path))

    assert out.fmt == "jpeg"
    img = Image.open(io.BytesIO(out.data))
    assert img.format == "JPEG"
    assert max(img.size) == 1024 and img.size == (1024, 512)
    assert out.meta["nodata_pct"] == pytest.approx(50.0, abs=0.5)
    assert out.meta["nodata_treatment"].startswith("flat grey")
    # Left (nodata) side is grey, right side carries the land colour.
    left, right = img.getpixel((100, 256)), img.getpixel((900, 256))
    assert all(abs(c - 128) < 8 for c in left)
    assert right[0] > 180 and right[2] < 90
    assert len(out.data) < 300_000
    assert out.meta["bounds_wgs84"][0] < CHIP_CENTER[0] < out.meta["bounds_wgs84"][2]
    json.loads(out.summary_json(extra="ok"))  # metadata is JSON-serialisable


# --- render_preview: index ------------------------------------------------------------------
def test_ndvi_renders_with_the_maps_ramp_and_transparent_nodata(tmp_path, inspection):
    band = np.full((1, 200, 300), -9999.0, dtype=np.float32)
    band[0, :, :100] = 0.0    # bare -> red end of RdYlGn
    band[0, :, 100:200] = 1.0  # dense vegetation -> green end
    path = _write(tmp_path / "ndvi_clipped_test_2026-01-01.tif", band, "float32", nodata=-9999.0)

    out = inspection.render_preview(str(path))

    assert out.fmt == "png"
    img = Image.open(io.BytesIO(out.data)).convert("RGBA")
    assert img.size == (300, 200)  # under the cap: native size
    red_end, green_end, nodata = img.getpixel((50, 100)), img.getpixel((150, 100)), img.getpixel((250, 100))
    assert red_end[:3] == (0xa5, 0x00, 0x26) and red_end[3] == 255
    assert green_end[:3] == (0x00, 0x68, 0x37) and green_end[3] == 255
    assert nodata[3] == 0
    assert out.meta["style"] == "ndvi" and out.meta["value_range"] == [0.0, 1.0]
    assert out.meta["nodata_pct"] == pytest.approx(100 / 3, abs=0.2)


def test_change_map_uses_reversed_ramp_over_zero_to_half(inspection):
    style = inspection.index_style("s3://b/session_data/x/rasters/change_detection_composite_loc.tif")
    assert style.name == "change" and style.reverse and (style.vmin, style.vmax) == (0.0, 0.5)
    ramp = inspection.build_ramp(style.anchors, style.reverse)
    assert tuple(ramp[0]) == (0x00, 0x68, 0x37)  # no change -> green
    assert tuple(ramp[-1]) == (0xa5, 0x00, 0x26)  # full change -> red
    assert inspection.index_style("s3://b/rasters/tci_clipped_loc_2026-01-01.tif") is None


def test_emit_methane_plume_uses_plasma_over_zero_to_1500(inspection):
    """The Methane Hunter's staged plumes (ch4plm_*.tif) preview in the map's plasma ramp."""
    style = inspection.index_style("s3://b/methane/cache/ch4plm_EMIT_L2B_CH4PLM_002_20240812T190223_002202.tif")
    assert style.name == "ch4" and not style.reverse and (style.vmin, style.vmax) == (0.0, 1500.0)
    ramp = inspection.build_ramp(style.anchors)
    assert tuple(ramp[0]) == (0x0d, 0x08, 0x87)   # background -> deep blue-violet
    assert tuple(ramp[-1]) == (0xf0, 0xf9, 0x21)  # >= 1500 ppm·m -> yellow


def test_methane_watch_rasters_preview_like_the_map(inspection):
    """Raw EMIT pass windows share the plume ramp; the TROPOMI anomaly uses magma over 0-60 ppb."""
    window = inspection.index_style("s3://b/session_data/s/methane/pass_EMIT_L2B_CH4ENH_002_20260812T060000_2622401_012.tif")
    assert window.name == "ch4" and (window.vmin, window.vmax) == (0.0, 1500.0)
    anomaly = inspection.index_style("s3://b/session_data/s/methane/tropomi_anomaly_south_caspian_2026-09-23_14d.tif")
    assert anomaly.name == "tropomi" and (anomaly.vmin, anomaly.vmax) == (0.0, 60.0)
    assert tuple(inspection.build_ramp(anomaly.anchors)[-1]) == (0xfc, 0xfd, 0xbf)


def test_unknown_single_band_gets_percentile_grey_stretch(tmp_path, inspection):
    band = np.linspace(100, 900, 50 * 50, dtype=np.float32).reshape(1, 50, 50)
    path = _write(tmp_path / "elevation_dem.tif", band, "float32")
    out = inspection.render_preview(str(path))
    assert out.fmt == "png" and out.meta["style"] == "grey"
    lo, hi = out.meta["value_range"]
    assert 100 < lo < hi < 900


def test_raster_with_no_valid_pixels_is_an_error(tmp_path, inspection):
    band = np.full((1, 10, 10), -9999.0, dtype=np.float32)
    path = _write(tmp_path / "ndvi_empty.tif", band, "float32", nodata=-9999.0)
    with pytest.raises(ValueError, match="no valid pixels"):
        inspection.render_preview(str(path))


def test_missing_file_raises(inspection):
    with pytest.raises(rasterio.errors.RasterioIOError):
        inspection.render_preview("/nonexistent/scene.tif")


# --- scl_quality ---------------------------------------------------------------------------
def test_scl_quality_counts_only_pixels_inside_the_aoi(tmp_path, inspection):
    # 100x100 SCL: rows 0-9 cloud (9), rows 10-19 shadow (3), rows 20-24 nodata (0),
    # everything else vegetation (4). AOI covers the left half only (columns 0-49).
    scl = np.full((1, 100, 100), 4, dtype=np.uint8)
    scl[0, :10, :] = 9
    scl[0, 10:20, :] = 3
    scl[0, 20:25, :] = 0
    scl[0, :, 50:] = 9  # right half all cloud: must NOT count because it is outside the AOI
    pixel = 0.001
    path = _write(tmp_path / "scl.tif", scl, "uint8", nodata=None, pixel=pixel)
    with rasterio.open(path) as src:
        b = src.bounds
    aoi = gpd.GeoDataFrame(geometry=[box(b.left, b.bottom, b.left + (b.right - b.left) / 2, b.top)], crs="EPSG:4326")

    q = inspection.scl_quality(str(path), aoi)

    assert q["pixels"] == 5000
    assert q["cloud_pct"] == pytest.approx(10.0)
    assert q["shadow_pct"] == pytest.approx(10.0)
    assert q["nodata_pct"] == pytest.approx(5.0)
    assert q["snow_pct"] == 0.0
    assert q["clear_pct"] == pytest.approx(75.0)


def test_scl_quality_outside_scene_is_an_error(tmp_path, inspection):
    scl = np.full((1, 10, 10), 4, dtype=np.uint8)
    path = _write(tmp_path / "scl_small.tif", scl, "uint8", pixel=0.001)
    far_away = gpd.GeoDataFrame(geometry=[box(10, 10, 11, 11)], crs="EPSG:4326")
    with pytest.raises(ValueError):
        inspection.scl_quality(str(path), far_away)


# --- rank_candidates / parse_exclude_dates -------------------------------------------------
IMAGES = [
    {"date": "2026-03-01T10:00:00Z", "cloud_pct": 40.0, "coverage_pct": 100.0},
    {"date": "2026-03-06T10:00:00Z", "cloud_pct": 5.0, "coverage_pct": 100.0},
    {"date": "2026-03-11T10:00:00Z", "cloud_pct": 5.0, "coverage_pct": 60.0},
    {"date": "2026-03-16T10:00:00Z", "cloud_pct": 12.0, "coverage_pct": 100.0},
]


def test_rank_candidates_prefers_low_cloud_then_high_coverage(inspection):
    best, others = inspection.rank_candidates(IMAGES)
    assert best["date"].startswith("2026-03-06")
    assert [o["date"] for o in others] == ["2026-03-11", "2026-03-16", "2026-03-01"]


def test_rank_candidates_skips_excluded_dates(inspection):
    best, others = inspection.rank_candidates(IMAGES, exclude_dates=("2026-03-06", "2026-03-11"))
    assert best["date"].startswith("2026-03-16")
    assert [o["date"] for o in others] == ["2026-03-01"]


def test_rank_candidates_with_everything_excluded(inspection):
    best, others = inspection.rank_candidates(IMAGES, exclude_dates=[i["date"][:10] for i in IMAGES])
    assert best is None and others == []


def test_parse_exclude_dates_accepts_strings_and_lists(inspection):
    assert inspection.parse_exclude_dates("2026-03-06, 2026-03-11T10:00:00Z;2026-03-16") == (
        "2026-03-06", "2026-03-11", "2026-03-16")
    assert inspection.parse_exclude_dates(["2026-03-06"]) == ("2026-03-06",)
    assert inspection.parse_exclude_dates("") == () and inspection.parse_exclude_dates(None) == ()
