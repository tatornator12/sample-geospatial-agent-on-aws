"""Unit tests for _slugify and bbox_around_point (geo_agent/utils/tools.py)."""
import json
import math

import pytest


# --- _slugify -------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Rondônia", "rondonia"),  # accents stripped, not deleted with the letter
        ("São Paulo — Área 51!", "sao_paulo_area_51"),  # punctuation runs collapse to one _
        ("Hyde Park, London", "hyde_park_london"),
        ("  trailing -- punctuation!! ", "trailing_punctuation"),  # no leading/trailing _
        ("UPPER Case 123", "upper_case_123"),  # lowercased, digits kept
    ],
)
def test_slugify_ascii_safe(tools_module, text, expected):
    assert tools_module._slugify(text) == expected


@pytest.mark.parametrize("text", ["", None, "北京", "---", "!!!"])
def test_slugify_degenerate_inputs_fall_back_to_unnamed(tools_module, text):
    assert tools_module._slugify(text) == "unnamed"


def test_slugify_output_is_always_s3_key_safe(tools_module):
    for text in ["Rondônia", "a b\tc", "émigré/route", "x" * 300, "42°21'N"]:
        slug = tools_module._slugify(text)
        assert slug, "slug must never be empty"
        assert all(c.islower() or c.isdigit() or c == "_" for c in slug)


# --- bbox_around_point ----------------------------------------------------------------
EARTH_RADIUS_M = 6378137


def test_bbox_around_point_geometry(tools_module):
    lon, lat, dist = -105.0, 39.0, 2000
    result = json.loads(tools_module.bbox_around_point(lon, lat, dist))

    assert result["type"] == "Feature"
    assert result["geometry"]["type"] == "Polygon"
    assert result["properties"]["center"] == [lon, lat]
    assert result["properties"]["radius_meters"] == dist

    ring = result["geometry"]["coordinates"][0]
    assert len(ring) == 5
    assert ring[0] == ring[-1], "ring must be explicitly closed"

    lat_off = math.degrees(dist / EARTH_RADIUS_M)
    lon_off = math.degrees(dist / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
    lons = sorted({p[0] for p in ring})
    lats = sorted({p[1] for p in ring})
    assert lons == pytest.approx([lon - lon_off, lon + lon_off], abs=1e-7)
    assert lats == pytest.approx([lat - lat_off, lat + lat_off], abs=1e-7)

    # The box is centred on the input point.
    corners = ring[:4]
    assert sum(p[0] for p in corners) / 4 == pytest.approx(lon, abs=1e-7)
    assert sum(p[1] for p in corners) / 4 == pytest.approx(lat, abs=1e-7)


def test_bbox_around_point_accepts_numeric_strings(tools_module):
    result = json.loads(tools_module.bbox_around_point("12.5", "45", "1000"))
    assert result["properties"]["center"] == [12.5, 45.0]
    assert result["properties"]["radius_meters"] == 1000


def test_bbox_around_point_invalid_input_returns_error_json(tools_module):
    result = json.loads(tools_module.bbox_around_point("not-a-number", 39.0))
    assert "error" in result
    assert "Invalid input parameters" in result["error"]
