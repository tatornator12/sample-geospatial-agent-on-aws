"""Eyes for the agent: render session rasters into images the model can look at, and
measure Sentinel-2 scene quality over the area of interest.

Everything here is pure (no S3, no network): callers hand in a rasterio-openable path
(local file, /vsicurl/ URL) and an AOI GeoDataFrame, and get bytes and numbers back. That
keeps the functions fast to unit-test and keeps the tool layer thin.

Speed: reads go through rasterio `out_shape`, so GDAL serves the request from the COG's
overviews instead of decoding full-resolution blocks — a 10k x 10k scene renders from a
few hundred KB of overview data.

Accuracy: single-band indices are painted with the same value range and colour ramp the
map uses (see react-ui/frontend/src/components/MapView.tsx), so the model and the room
look at the same picture; SCL percentages are computed over the AOI polygon only, not its
bounding box.
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.mask import mask as rio_mask

MAX_EDGE_DEFAULT = 1024

# ColorBrewer anchor colours; matplotlib's (and therefore TiTiler's) ramps of the same name
# are linear interpolations of these anchors, so painting this way matches the map tiles.
_RDYLGN = ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf",
           "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"]
_SPECTRAL = ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf",
             "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"]
_BLUES = ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6",
          "#2171b5", "#08519c", "#08306b"]
_GREYS = ["#000000", "#ffffff"]

# Sentinel-2 scene classification (SCL) classes.
SCL_NODATA = (0,)
SCL_CLOUD = (1, 8, 9, 10)      # saturated/defective, cloud medium, cloud high, thin cirrus
SCL_SHADOW = (2, 3)            # cast shadows, cloud shadows
SCL_SNOW = (11,)


@dataclass(frozen=True)
class IndexStyle:
    name: str
    vmin: float
    vmax: float
    anchors: tuple[str, ...]
    reverse: bool = False


# Order matters: change maps are also produced from indices, so they are matched first.
INDEX_STYLES: tuple[tuple[tuple[str, ...], IndexStyle], ...] = (
    (("change_detection", "change-detection"), IndexStyle("change", 0.0, 0.5, tuple(_RDYLGN), reverse=True)),
    (("ndvi_", "ndvi-"), IndexStyle("ndvi", 0.0, 1.0, tuple(_RDYLGN))),
    (("ndwi_", "ndwi-"), IndexStyle("ndwi", -1.0, 1.0, tuple(_BLUES))),
    (("nbr_", "nbr-", "/nbr."), IndexStyle("nbr", -1.0, 1.0, tuple(_SPECTRAL))),
)


def index_style(name_or_url: str) -> IndexStyle | None:
    """The map's styling for a raster name/URL, or None when it is not a known index."""
    lower = name_or_url.lower()
    for needles, style in INDEX_STYLES:
        if any(n in lower for n in needles):
            return style
    return None


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def build_ramp(anchors: tuple[str, ...], reverse: bool = False) -> np.ndarray:
    """256 x 3 uint8 lookup table linearly interpolated between anchor colours."""
    colours = [_hex_to_rgb(a) for a in (reversed(anchors) if reverse else anchors)]
    x_anchor = np.linspace(0.0, 1.0, len(colours))
    x = np.linspace(0.0, 1.0, 256)
    table = np.stack(
        [np.interp(x, x_anchor, [c[i] for c in colours]) for i in range(3)], axis=1
    )
    return np.round(table).astype(np.uint8)


def colorize(values: np.ndarray, valid: np.ndarray, style: IndexStyle) -> np.ndarray:
    """Map a float band to RGBA with the index's ramp; invalid pixels are transparent."""
    ramp = build_ramp(style.anchors, style.reverse)
    scaled = (values.astype(np.float64) - style.vmin) / (style.vmax - style.vmin)
    idx = np.clip(np.nan_to_num(scaled, nan=0.0) * 255.0, 0, 255).astype(np.uint8)
    rgba = np.zeros(values.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = ramp[idx]
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba


def _out_shape(height: int, width: int, max_edge: int) -> tuple[int, int]:
    longest = max(height, width)
    if longest <= max_edge:
        return height, width
    scale = max_edge / longest
    return max(1, round(height * scale)), max(1, round(width * scale))


@dataclass
class Rendered:
    data: bytes
    fmt: str          # "jpeg" | "png"
    meta: dict

    def summary_json(self, **extra) -> str:
        return json.dumps({**self.meta, **extra})


def render_preview(path: str, max_edge: int = MAX_EDGE_DEFAULT, style_hint: str | None = None) -> Rendered:
    """Render a raster into a small image.

    RGB (>= 3 bands, uint8) -> JPEG, nodata painted flat grey (JPEG has no alpha; grey is
    unambiguous next to real land cover and is stated in the metadata).
    Single band -> PNG through the index ramp when the name is a known index, otherwise a
    grey stretch between the 2nd and 98th percentile. Invalid pixels are transparent.

    Raises ValueError for rasters that cannot be rendered (no valid pixels, odd band counts).
    """
    from PIL import Image

    with rasterio.open(path) as src:
        h, w = _out_shape(src.height, src.width, max_edge)
        nodata = src.nodata
        style = index_style(style_hint or path)

        if src.count >= 3 and src.dtypes[0] == "uint8" and style is None:
            rgb = src.read([1, 2, 3], out_shape=(3, h, w), resampling=Resampling.nearest)
            nd = 0 if nodata is None else nodata
            valid = ~np.all(rgb == nd, axis=0)
            if not valid.any():
                raise ValueError("raster has no valid pixels")
            img = np.moveaxis(rgb, 0, -1).copy()
            img[~valid] = 128
            buf = io.BytesIO()
            Image.fromarray(img).save(buf, format="JPEG", quality=85, optimize=True)
            meta = {"rendered_as": "jpeg", "bands": int(src.count), "dtype": src.dtypes[0],
                    "nodata_treatment": "flat grey"}
        elif src.count >= 1:
            band = src.read(1, out_shape=(h, w), resampling=Resampling.average).astype(np.float64)
            valid = np.isfinite(band)
            if nodata is not None:
                valid &= band != nodata
            if not valid.any():
                raise ValueError("raster has no valid pixels")
            if style is None:
                lo, hi = np.percentile(band[valid], [2, 98])
                hi = hi if hi > lo else lo + 1e-6
                style = IndexStyle("grey", float(lo), float(hi), tuple(_GREYS))
            rgba = colorize(band, valid, style)
            buf = io.BytesIO()
            Image.fromarray(rgba).save(buf, format="PNG", optimize=True)
            meta = {"rendered_as": "png", "bands": int(src.count), "dtype": src.dtypes[0],
                    "style": style.name, "value_range": [style.vmin, style.vmax],
                    "nodata_treatment": "transparent"}
        else:
            raise ValueError("raster has no bands")

        meta.update({
            "width": int(w), "height": int(h),
            "source_width": int(src.width), "source_height": int(src.height),
            "nodata_pct": round(float(100.0 * (~valid).sum() / valid.size), 1),
            "crs": str(src.crs) if src.crs else None,
        })
        if src.crs is not None:
            b = src.bounds
            try:
                from rasterio.warp import transform_bounds
                west, south, east, north = transform_bounds(src.crs, "EPSG:4326", *b)
                meta["bounds_wgs84"] = [round(west, 5), round(south, 5), round(east, 5), round(north, 5)]
            except Exception:
                pass
    return Rendered(buf.getvalue(), meta["rendered_as"], meta)


def scl_quality(scl_path: str, aoi_gdf) -> dict:
    """Sentinel-2 scene-classification percentages over the AOI polygon(s).

    Pixels outside the polygon are excluded (not counted as nodata), so the numbers describe
    the area the analysis will actually use. Percentages sum to 100 (clear + cloud + shadow
    + snow + nodata) up to rounding.
    """
    with rasterio.open(scl_path) as src:
        geoms = [g.__geo_interface__ for g in aoi_gdf.to_crs(src.crs).geometry]
        data, _ = rio_mask(src, geoms, crop=True, filled=False, indexes=1)
    inside = ~np.ma.getmaskarray(data)
    values = np.asarray(data.data)[inside]
    n = int(values.size)
    if n == 0:
        raise ValueError("AOI does not intersect the scene classification raster")

    def pct(classes) -> float:
        return round(float(100.0 * np.isin(values, classes).sum() / n), 1)

    cloud, shadow, snow, nodata = pct(SCL_CLOUD), pct(SCL_SHADOW), pct(SCL_SNOW), pct(SCL_NODATA)
    return {
        "clear_pct": round(max(0.0, 100.0 - cloud - shadow - snow - nodata), 1),
        "cloud_pct": cloud,
        "shadow_pct": shadow,
        "snow_pct": snow,
        "nodata_pct": nodata,
        "pixels": n,
    }


def rank_candidates(images: list[dict], exclude_dates=()) -> tuple[dict | None, list[dict]]:
    """Order scenes the way the selector does and drop excluded dates.

    Returns (best, other_candidates) where other_candidates are the next five as
    {date, cloud_pct, coverage_pct}. Sort: lowest whole-tile cloud, then highest AOI coverage.
    """
    excluded = {d.strip() for d in exclude_dates if d and d.strip()}
    ranked = sorted(images, key=lambda x: (x.get("cloud_pct", 100), -x.get("coverage_pct", 0)))
    survivors = [img for img in ranked if str(img.get("date", ""))[:10] not in excluded]
    if not survivors:
        return None, []
    best = survivors[0]
    others = [
        {"date": str(img.get("date", ""))[:10], "cloud_pct": img.get("cloud_pct"),
         "coverage_pct": img.get("coverage_pct")}
        for img in survivors[1:6]
    ]
    return best, others


def parse_exclude_dates(value) -> tuple[str, ...]:
    """Accept a comma-separated string or a list; return clean YYYY-MM-DD strings."""
    if not value:
        return ()
    if isinstance(value, str):
        parts = value.replace(";", ",").split(",")
    else:
        parts = list(value)
    return tuple(p.strip()[:10] for p in parts if p and p.strip())
