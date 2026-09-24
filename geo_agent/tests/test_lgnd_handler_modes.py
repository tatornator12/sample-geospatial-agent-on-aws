"""Unit tests for the lgnd-partition-query Lambda's `embed` and `similar` modes and its
input validation, against the same synthetic partition as test_lgnd_handler.py.

The `change` mode is covered by test_lgnd_handler.py, unchanged; this file proves the new
modes and that no event field reaches DuckDB before it has been validated.
"""
import math
import types

import numpy as np
import pytest

from .conftest import LGND_GEOHASH, LGND_PERIODS, lgnd_base_vectors

FULL_BBOX = {"west": -105.6, "south": 38.9, "east": -105.3, "north": 39.1}
PERIOD_1 = LGND_PERIODS[1]  # (2024, 7): cells 00-29 = u, 30-39 cos 0.6, 40-49 cos 0.1


def _f32(vec: np.ndarray) -> list[float]:
    return [float(x) for x in vec.astype(np.float32)]


def _embed_event(**overrides):
    year, month = PERIOD_1
    event = {"mode": "embed", "geohash": LGND_GEOHASH, "year": year, "month": month, "bbox": FULL_BBOX}
    event.update(overrides)
    return event


def _similar_event(**overrides):
    year, month = PERIOD_1
    u, _ = lgnd_base_vectors()
    event = {
        "mode": "similar",
        "geohash": LGND_GEOHASH,
        "year": year,
        "month": month,
        "bbox": FULL_BBOX,
        "query_embedding": _f32(u),
        "min_similarity": 0.5,
        "limit": 200,
    }
    event.update(overrides)
    return event


# --- embed --------------------------------------------------------------------------------

def test_embed_returns_cells_with_vectors(local_lgnd_handler):
    result = local_lgnd_handler.handler(_embed_event(), None)

    assert "error" not in result, result.get("error")
    assert result["statusCode"] == 200
    assert result["mode"] == "embed"
    assert result["geohash"] == LGND_GEOHASH
    assert result["cells_found"] == 50
    assert len(result["cells"]) == 50
    cell = next(c for c in result["cells"] if c["cell_id"] == "cell_00")
    assert set(cell["bbox"]) == {"xmin", "ymin", "xmax", "ymax"}
    assert len(cell["embedding"]) == 256
    u, _ = lgnd_base_vectors()
    assert np.allclose(cell["embedding"], _f32(u), atol=1e-6)


def test_embed_bbox_filter(local_lgnd_handler):
    """A bbox over columns 0-5 keeps 30 of the 50 cells."""
    narrow = {"west": -105.5, "south": 39.0, "east": -105.45, "north": 39.05}
    result = local_lgnd_handler.handler(_embed_event(bbox=narrow), None)
    assert "error" not in result, result.get("error")
    assert result["cells_found"] == 30
    assert len(result["cells"]) == 30


def test_embed_caps_to_the_cells_nearest_the_bbox_centre(local_lgnd_handler, monkeypatch):
    """Above the cap, only the cells nearest the bbox centre come back, count still reported.

    The cap is exercised by lowering the constant rather than growing the shared fixture.
    """
    monkeypatch.setattr(local_lgnd_handler, "EMBED_CELL_CAP", 4)
    # Interior edges (no cell boundary touched) covering cols 0-3 x rows 0-3; the centre
    # (-105.48, 39.02) is the corner shared by cells 11, 12, 21, 22.
    bbox = {"west": -105.495, "south": 39.005, "east": -105.465, "north": 39.035}
    result = local_lgnd_handler.handler(_embed_event(bbox=bbox), None)

    assert "error" not in result, result.get("error")
    assert result["cells_found"] == 16
    assert sorted(c["cell_id"] for c in result["cells"]) == ["cell_11", "cell_12", "cell_21", "cell_22"]


# --- similar ------------------------------------------------------------------------------

def test_similar_ranks_self_matches_first_then_by_geography(local_lgnd_handler):
    result = local_lgnd_handler.handler(_similar_event(), None)

    assert "error" not in result, result.get("error")
    assert result["mode"] == "similar"
    assert result["cells_compared"] == 50
    cells = result["cells"]
    # 30 cells identical to u (sim 1.0) then 10 at cosine 0.6; the 0.1 cells fall below 0.5.
    assert len(cells) == 40
    assert all(c["similarity"] == pytest.approx(1.0, abs=1e-3) for c in cells[:30])
    assert all(c["similarity"] == pytest.approx(0.6, abs=1e-3) for c in cells[30:])
    assert "embedding" not in cells[0]
    # Ties break south-to-north then west-to-east: cell_00 is the south-west corner.
    assert [c["cell_id"] for c in cells[:3]] == ["cell_00", "cell_01", "cell_02"]
    assert [c["cell_id"] for c in cells[30:33]] == ["cell_30", "cell_31", "cell_32"]


def test_similar_threshold_and_limit(local_lgnd_handler):
    result = local_lgnd_handler.handler(_similar_event(min_similarity=0.9, limit=5), None)
    assert "error" not in result, result.get("error")
    assert result["cells_compared"] == 50
    assert [c["cell_id"] for c in result["cells"]] == [f"cell_0{i}" for i in range(5)]


def test_similar_bbox_filter_limits_what_is_compared(local_lgnd_handler):
    narrow = {"west": -105.5, "south": 39.0, "east": -105.45, "north": 39.05}
    result = local_lgnd_handler.handler(_similar_event(bbox=narrow), None)
    assert "error" not in result, result.get("error")
    assert result["cells_compared"] == 30
    # Columns 0-5 of the u cells (00-29) and of the 0.6 cells (30-39); the 0.1 cells miss 0.5.
    ids = {c["cell_id"] for c in result["cells"]}
    assert ids == {f"cell_{i:02d}" for i in range(40) if i % 10 < 6}


def test_similar_with_a_different_query_finds_a_different_neighbourhood(local_lgnd_handler):
    """Querying with v (orthogonal to u) ranks the cells built mostly from v: 40-49 at
    cos ≈ 0.995, then 30-39 at cos 0.8; the 30 pure-u cells are orthogonal and drop out."""
    _, v = lgnd_base_vectors()
    result = local_lgnd_handler.handler(_similar_event(query_embedding=_f32(v), min_similarity=0.5), None)
    assert "error" not in result, result.get("error")
    assert result["cells_compared"] == 50
    ids = [c["cell_id"] for c in result["cells"]]
    assert ids[:10] == [f"cell_{i}" for i in range(40, 50)]
    assert ids[10:] == [f"cell_{i}" for i in range(30, 40)]
    assert result["cells"][0]["similarity"] == pytest.approx(math.sqrt(1 - 0.1 ** 2), abs=1e-3)
    assert result["cells"][10]["similarity"] == pytest.approx(0.8, abs=1e-3)


def test_similar_missing_partition_returns_envelope(local_lgnd_handler):
    result = local_lgnd_handler.handler(_similar_event(year=2018), None)
    assert result["statusCode"] == 200
    assert result["mode"] == "similar"
    assert result["cells"] == []
    assert result["cells_compared"] == 0
    assert "error" in result


# --- validation: nothing reaches DuckDB ---------------------------------------------------

@pytest.fixture()
def handler_with_no_db(local_lgnd_handler, monkeypatch):
    """The handler with duckdb.connect replaced by a tripwire: any call fails the test."""
    def _explode():
        raise AssertionError("duckdb.connect was called for an invalid event")

    monkeypatch.setattr(local_lgnd_handler, "duckdb", types.SimpleNamespace(connect=_explode))
    return local_lgnd_handler


@pytest.mark.parametrize(
    "event, fragment",
    [
        ({"mode": "drop table", "geohash": "9x", "bbox": FULL_BBOX}, "mode must be one of"),
        (_embed_event(geohash="9x'); DROP TABLE x; --"), "geohash"),
        (_embed_event(geohash="9x/../../etc"), "geohash"),
        (_embed_event(geohash=12), "geohash"),
        (_embed_event(bbox={"west": "-105", "south": 39, "east": -105.3, "north": 39.1}), "bbox.west"),
        (_embed_event(bbox={"west": -105.6, "south": 39.1, "east": -105.3, "north": 38.9}), "south < north"),
        (_embed_event(bbox={"west": -105.6, "south": 38.9, "east": float("nan"), "north": 39.1}), "bbox.east"),
        (_embed_event(bbox=[-105.6, 38.9, -105.3, 39.1]), "bbox must be an object"),
    ],
)
def test_invalid_common_fields_never_open_a_connection(handler_with_no_db, event, fragment):
    result = handler_with_no_db.handler(event, None)
    assert result["statusCode"] == 200
    empty_key = "cells" if "mode" in result else "changed_cells"
    assert result[empty_key] == []
    assert fragment in result["error"]
    assert "Traceback" not in result["error"]


@pytest.mark.parametrize(
    "overrides, fragment",
    [
        ({"year": 1999}, "year must be between"),
        ({"year": "2024"}, "year must be an integer"),
        ({"month": 13}, "month must be between"),
        ({"query_embedding": [0.1] * 255}, "exactly 256"),
        ({"query_embedding": ["1e999"] * 256}, "query_embedding[] must be a number"),
        ({"query_embedding": [float("nan")] * 256}, "finite"),
        ({"query_embedding": [True] * 256}, "must be a number"),
        ({"query_embedding": "[0.1, 0.2]"}, "exactly 256"),
        ({"min_similarity": 1.5}, "min_similarity"),
        ({"limit": 0}, "limit must be between"),
        ({"limit": 10_000}, "limit must be between"),
    ],
)
def test_invalid_similar_fields_return_the_envelope(local_lgnd_handler, monkeypatch, overrides, fragment):
    """Mode-specific fields are validated inside the connection scope; still no SQL runs.

    A subclass of the local connection records every non-SET/LOAD statement executed.
    """
    executed = []
    local_con = local_lgnd_handler.duckdb.connect

    class Spy(local_con):  # type: ignore[misc,valid-type]
        def execute(self, sql, *args):
            head = sql.strip().split(None, 1)[0].lower()
            if head not in ("set", "load"):
                executed.append(sql)
            return super().execute(sql, *args)

    monkeypatch.setattr(local_lgnd_handler, "duckdb", types.SimpleNamespace(connect=Spy))
    result = local_lgnd_handler.handler(_similar_event(**overrides), None)
    assert result["statusCode"] == 200
    assert result["cells"] == []
    assert fragment in result["error"]
    assert executed == []


def test_change_mode_rejects_out_of_range_year_without_sql(local_lgnd_handler):
    """The change path shares the validators: 1999 is now rejected before DuckDB, same envelope."""
    year1, month1 = LGND_PERIODS[0]
    event = {"geohash": LGND_GEOHASH, "year1": year1, "month1": month1, "year2": 1999, "month2": 7,
             "bbox": FULL_BBOX, "min_change_score": 0.15}
    result = local_lgnd_handler.handler(event, None)
    assert result["statusCode"] == 200
    assert result["changed_cells"] == []
    assert "year2 must be between" in result["error"]


def test_float_literal_rendering_is_numeric_only(local_lgnd_handler):
    """The SQL literal is rebuilt from parsed floats; no incoming text survives into it."""
    literal = local_lgnd_handler._float_list_literal([0.5, -1.0, 2.5e-3])
    assert literal == "[0.5, -1.0, 0.0025]::FLOAT[]"
    assert local_lgnd_handler._bbox_filter((-105.6, 38.9, -105.3, 39.1)) == (
        "WHERE bbox.xmin <= -105.3 AND bbox.xmax >= -105.6 AND bbox.ymin <= 39.1 AND bbox.ymax >= 38.9"
    )
    assert math.isfinite(float("0.0025"))
