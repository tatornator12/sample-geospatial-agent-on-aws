"""Unit tests for clip_raster_v2 (geo_agent/utils/raster_utils.py)."""
import json

import pytest
import rasterio
from rasterio.enums import Compression

from .conftest import CHIP_CENTER, CHIP_SIZE


@pytest.fixture()
def clipped(tmp_path, raster_utils_module, cog_chip, aoi_geojson):
    target = tmp_path / "clipped.tif"
    raster_utils_module.clip_raster_v2(str(aoi_geojson), str(cog_chip), str(target))
    return target


def test_clip_keeps_crs(clipped, cog_chip):
    with rasterio.open(cog_chip) as src, rasterio.open(clipped) as out:
        assert out.crs == src.crs
        assert out.crs.to_epsg() == 4326


def test_clip_crops_to_aoi_bounds(clipped, cog_chip, aoi_geojson):
    aoi = json.loads(aoi_geojson.read_text())
    ring = aoi["features"][0]["geometry"]["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]

    with rasterio.open(cog_chip) as src, rasterio.open(clipped) as out:
        assert out.width < CHIP_SIZE and out.height < CHIP_SIZE
        # Output bounds hug the AOI to within one pixel.
        pixel = src.res[0]
        assert out.bounds.left == pytest.approx(min(lons), abs=pixel)
        assert out.bounds.right == pytest.approx(max(lons), abs=pixel)
        assert out.bounds.bottom == pytest.approx(min(lats), abs=pixel)
        assert out.bounds.top == pytest.approx(max(lats), abs=pixel)


def test_clip_preserves_pixel_values(clipped, cog_chip):
    centre = [CHIP_CENTER]
    with rasterio.open(cog_chip) as src, rasterio.open(clipped) as out:
        src_value = next(src.sample(centre))[0]
        out_value = next(out.sample(centre))[0]
        assert out_value == pytest.approx(src_value)
        assert out.dtypes[0] == "float32"


def test_clip_output_is_a_cog(clipped):
    """The output must carry the COG structure: tiled, compressed, GeoTIFF container."""
    with rasterio.open(clipped) as out:
        assert out.driver == "GTiff"  # the COG driver reads back as GTiff
        assert out.compression == Compression.deflate
        block_h, block_w = out.block_shapes[0]
        assert block_h == block_w, "COG output must use square internal tiles"
