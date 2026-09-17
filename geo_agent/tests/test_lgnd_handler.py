"""Unit tests for the lgnd-partition-query Lambda against a synthetic local partition.

The handler's own similarity SQL runs unchanged: MONTHLY_PATH is pointed at a local
directory and the Lambda-only SET/LOAD statements become no-ops (see conftest).
"""
import pytest

from .conftest import LGND_CHANGED_IDS, LGND_EXPECTED_SCORE, LGND_GEOHASH, LGND_PERIODS

FULL_BBOX = {"west": -105.6, "south": 38.9, "east": -105.3, "north": 39.1}


def _event(**overrides):
    (y1, m1), (y2, m2) = LGND_PERIODS
    event = {
        "geohash": LGND_GEOHASH,
        "year1": y1,
        "month1": m1,
        "year2": y2,
        "month2": m2,
        "bbox": FULL_BBOX,
        "min_change_score": 0.15,
    }
    event.update(overrides)
    return event


def test_similarity_query_finds_exactly_the_changed_cells(local_lgnd_handler):
    result = local_lgnd_handler.handler(_event(), None)

    assert "error" not in result, result.get("error")
    assert result["statusCode"] == 200
    assert result["geohash"] == LGND_GEOHASH
    assert result["total_d1"] == 50
    assert result["total_d2"] == 50
    assert result["matched"] == 50

    cells = {c["cell_id"]: c for c in result["changed_cells"]}
    assert sorted(cells) == LGND_CHANGED_IDS
    assert result["above_threshold"] == len(LGND_CHANGED_IDS)

    for cell in cells.values():
        # cosine 0.6 -> change_score (0.9 - 0.6) / 0.4 = 0.75 (float32 tolerance)
        assert cell["change_score"] == pytest.approx(LGND_EXPECTED_SCORE, abs=2e-3)
        assert cell["similarity"] == pytest.approx(0.6, abs=1e-3)
        assert set(cell["bbox"]) == {"xmin", "ymin", "xmax", "ymax"}


def test_artifact_floor_excludes_degenerate_cells(local_lgnd_handler):
    """Cells 40-49 (cosine 0.1) score 1.0 but sit below the 0.30 artifact floor."""
    result = local_lgnd_handler.handler(_event(min_change_score=0.9), None)
    assert "error" not in result, result.get("error")
    assert result["changed_cells"] == []
    assert result["above_threshold"] == 0


def test_threshold_filters_out_moderate_change(local_lgnd_handler):
    result = local_lgnd_handler.handler(_event(min_change_score=0.8), None)
    assert "error" not in result, result.get("error")
    assert result["changed_cells"] == []


def test_bbox_filter_restricts_cells(local_lgnd_handler):
    """A bbox over columns 0-5 keeps 30 of 50 cells and 6 of the 10 changed ones."""
    narrow = {"west": -105.5, "south": 39.0, "east": -105.45, "north": 39.05}
    result = local_lgnd_handler.handler(_event(bbox=narrow), None)

    assert "error" not in result, result.get("error")
    assert result["total_d1"] == 30
    assert result["total_d2"] == 30
    assert result["matched"] == 30
    changed = sorted(c["cell_id"] for c in result["changed_cells"])
    assert changed == [f"cell_{i}" for i in range(30, 36)]


def test_handler_returns_error_payload_instead_of_raising(local_lgnd_handler):
    """A period with no parquet files must produce the graceful error envelope."""
    result = local_lgnd_handler.handler(_event(year2=1999), None)
    assert result["statusCode"] == 200
    assert result["changed_cells"] == []
    assert "error" in result
