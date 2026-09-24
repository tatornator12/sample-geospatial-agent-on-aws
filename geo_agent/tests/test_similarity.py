"""Unit tests for utils/lgnd_similarity.py and the find_similar_places tool.

No AWS: the Lambda client is a fake that serves canned `embed` / `similar` partition
responses, S3 is the FakeS3 used by the inspect tests, and the geometry download is patched.
The land mask is the real Natural Earth file (an Atlantic cell must be dropped).
"""
import asyncio
import io
import json
import random

import numpy as np
import pytest
from shapely.geometry import Point, box

from utils import lgnd_similarity as sim

# --- canned world -------------------------------------------------------------------------
# The example is a 0.02 x 0.03 deg "park" at (-73.97, 40.78). Its bbox touches nine cells
# (0.0125 deg ~ 1.28 km); only three centres fall inside the park polygon.
PARK = box(-73.98, 40.765, -73.96, 40.795)
CELL = 0.0125


def _cell(cx, cy, cell_id=None):
    b = {"xmin": cx - CELL / 2, "ymin": cy - CELL / 2, "xmax": cx + CELL / 2, "ymax": cy + CELL / 2}
    return {"cell_id": cell_id or f"c_{cx:.4f}_{cy:.4f}", "bbox": b}


PARK_CELLS_INSIDE = [_cell(-73.970, 40.770, "park_a"), _cell(-73.970, 40.7825, "park_b"), _cell(-73.970, 40.790, "park_c")]
PARK_CELLS_OUTSIDE = [_cell(-73.985, 40.770, "city_w"), _cell(-73.955, 40.770, "city_e"),
                      _cell(-73.985, 40.790, "city_nw"), _cell(-73.955, 40.790, "city_ne")]

# Similar-mode candidates across two partitions. Similarities are chosen so the merged
# order is unambiguous and thinning / exclusion have something to do.
FAR_MATCHES = [
    # (cell_id, lon, lat, sim)  -- all on land in New York State
    ("prospect", -73.969, 40.660, 0.97),      # 13 km from the park: kept (> 5 km)
    ("van_cortlandt", -73.887, 40.897, 0.96),
    ("pelham", -73.806, 40.870, 0.955),
    ("pelham_twin", -73.796, 40.872, 0.954),  # < 5 km from pelham: thinned out
    ("bear_mtn", -73.989, 41.312, 0.94),
    ("hudson_valley", -73.95, 41.70, 0.93),
    ("finger_lakes", -76.90, 42.60, 0.92),
    ("adirondack", -74.10, 44.20, 0.91),
]
NEAR_MATCHES = [("next_door", -73.9575, 40.7825, 0.985)]        # 1 km away: excluded by radius
OCEAN_MATCH = [("atlantic", -70.00, 40.00, 0.99)]               # off Long Island: land mask drops it
QUERY_ECHO = [("park_a", -73.970, 40.770, 1.0)]                 # the example itself: excluded by id


def _vec(seed: int) -> list[float]:
    rng = np.random.default_rng(seed)
    v = rng.normal(size=256)
    return [float(x) for x in v / np.linalg.norm(v)]


class FakeLambda:
    """Serves embed cells for the park and two `similar` partitions (dr, dq)."""

    def __init__(self, fail_partitions=(), shuffle_seed=None, embed_cells=None):
        self.calls = []
        self.fail = set(fail_partitions)
        self.shuffle_seed = shuffle_seed
        self.embed_cells = embed_cells if embed_cells is not None else PARK_CELLS_INSIDE + PARK_CELLS_OUTSIDE

    def _similar_cells(self, gh):
        rows = FAR_MATCHES + NEAR_MATCHES + OCEAN_MATCH + QUERY_ECHO
        half = len(rows) // 2
        mine = rows[:half] if gh == "dr" else rows[half:]
        cells = [{"cell_id": cid, "similarity": s, "bbox": _cell(lon, lat)["bbox"]} for cid, lon, lat, s in mine]
        if self.shuffle_seed is not None:
            random.Random(self.shuffle_seed + hash(gh) % 97).shuffle(cells)
        return cells

    def invoke(self, FunctionName, Payload):
        event = json.loads(Payload)
        self.calls.append(event)
        assert FunctionName == "lgnd-partition-query"
        gh = event["geohash"]
        if event["mode"] == "embed":
            body = {"statusCode": 200, "mode": "embed", "geohash": gh, "cells_found": len(self.embed_cells),
                    "cells": [{**c, "embedding": _vec(i)} for i, c in enumerate(self.embed_cells)]}
        elif gh in self.fail:
            body = {"statusCode": 200, "mode": "similar", "geohash": gh, "cells_compared": 0, "cells": [],
                    "error": "IOException: partition unavailable"}
        else:
            assert len(event["query_embedding"]) == 256
            body = {"statusCode": 200, "mode": "similar", "geohash": gh, "cells_compared": 50_000,
                    "cells": self._similar_cells(gh)}
        return {"StatusCode": 200, "Payload": io.BytesIO(json.dumps(body).encode())}


@pytest.fixture()
def two_partitions(monkeypatch):
    """New York spans two geohash partitions in this test world, whatever pygeohash says."""
    monkeypatch.setattr(sim, "_get_geohashes_for_bbox", lambda w, s, e, n: ["dq", "dr"] if (e - w) > 1 else ["dr"])


# --- period + extent ----------------------------------------------------------------------

def test_period_defaults_to_peak_month_and_latest_archive_year():
    year, month, note = sim.resolve_period(40.78, None, None)
    assert (year, month) == (2025, 7)          # July 2026 is past the archive end (2026-04)
    assert "July" in note and "2025" in note
    year, month, _ = sim.resolve_period(-33.9, None, None)
    assert (year, month) == (2026, 1)          # southern peak, January 2026 is inside the archive
    year, month, note = sim.resolve_period(40.78, None, 3)
    assert (year, month) == (2025, 7) and "outside the peak season" in note
    assert sim.resolve_period(40.78, 2021, 8)[:2] == (2021, 8)


@pytest.mark.parametrize("year, month", [(2016, 7), (2026, 7), (2019, 13), (2027, 1)])
def test_period_outside_archive_is_an_error(year, month):
    with pytest.raises(sim.SimilarityError):
        sim.resolve_period(40.0, year, month)


def test_extent_exact_key_or_bbox_only():
    bbox, label = sim.resolve_search_extent("New York", None)
    assert bbox == tuple(float(v) for v in sim.COUNTRY_BBOXES["new york"]) and label == "New York"
    bbox, label = sim.resolve_search_extent("Hudson Valley", "[-74.2, 41.0, -73.5, 42.0]")
    assert bbox == (-74.2, 41.0, -73.5, 42.0) and label == "Hudson Valley"
    with pytest.raises(sim.SimilarityError, match="not a recognized"):
        sim.resolve_search_extent("Hudson Valley, New York", None)     # no substring match
    with pytest.raises(sim.SimilarityError, match="west < east"):
        sim.resolve_search_extent(None, [-73.5, 41.0, -74.2, 42.0])
    with pytest.raises(sim.SimilarityError):
        sim.resolve_search_extent(None, [-73.5, 41.0, "x", 42.0])
    with pytest.raises(sim.SimilarityError):
        sim.resolve_search_extent(None, [-73.5, 41.0, float("inf"), 42.0])


# --- query embedding ----------------------------------------------------------------------

def test_query_embedding_pools_only_cells_inside_the_geometry(two_partitions):
    client = FakeLambda()
    vec, cells = sim.query_embedding(PARK, 2025, 7, client)
    assert [c["cell_id"] for c in cells] == ["park_a", "park_b", "park_c"]
    expected = np.mean([_vec(0), _vec(1), _vec(2)], axis=0)
    expected /= np.linalg.norm(expected)
    assert np.allclose(vec, expected, atol=1e-9)
    assert np.linalg.norm(vec) == pytest.approx(1.0)
    assert client.calls[0]["mode"] == "embed" and client.calls[0]["geohash"] == "dr"


def test_query_embedding_falls_back_to_the_nearest_cell_for_a_point(two_partitions):
    client = FakeLambda()
    vec, cells = sim.query_embedding(Point(-73.984, 40.771), 2025, 7, client)
    assert [c["cell_id"] for c in cells] == ["city_w"]
    assert np.allclose(vec, _vec(3))


def test_query_embedding_errors(two_partitions):
    with pytest.raises(sim.SimilarityError, match="No embedding cells"):
        sim.query_embedding(PARK, 2025, 7, FakeLambda(embed_cells=[]))
    many = [_cell(-73.97 + (i % 10) * CELL, 40.70 + (i // 10) * CELL) for i in range(100)]
    with pytest.raises(sim.SimilarityError, match="max 64"):
        sim.query_embedding(box(-74.05, 40.65, -73.80, 40.90), 2025, 7, FakeLambda(embed_cells=many))


# --- search -------------------------------------------------------------------------------

def _search(client, **overrides):
    kwargs = dict(top_k=10, min_similarity=0.90, exclude_radius_km=5.0, min_separation_km=5.0, client=client)
    kwargs.update(overrides)
    ny = tuple(float(v) for v in sim.COUNTRY_BBOXES["new york"])
    return sim.search_similar(np.asarray(_vec(0)), [{"cell_id": "park_a", "bbox": PARK_CELLS_INSIDE[0]["bbox"]}],
                              (40.78, -73.97), ny, 2025, 7, **kwargs)


def test_search_merges_excludes_masks_thins_and_ranks(two_partitions):
    client = FakeLambda()
    result = _search(client)

    ids = [m["cell_id"] for m in result["matches"]]
    assert "park_a" not in ids           # the example itself
    assert "next_door" not in ids        # inside the 5 km exclusion radius
    assert "atlantic" not in ids         # ocean, land mask
    assert "pelham_twin" not in ids      # thinned: within 5 km of the higher-ranked pelham
    assert ids == ["prospect", "van_cortlandt", "pelham", "bear_mtn", "hudson_valley", "finger_lakes", "adirondack"]
    assert [m["rank"] for m in result["matches"]] == list(range(1, 8))
    first = result["matches"][0]
    assert first["similarity"] == 0.97 and first["distance_km"] == pytest.approx(13.3, abs=0.5)
    assert set(first["bbox"]) == {"west", "south", "east", "north"}
    assert result["cells_compared"] == 100_000 and result["partitions"] == 2 and result["errors"] == []
    # Every partition got the same payload shape, and the vector was sent as 256 floats.
    similar_calls = [c for c in client.calls if c["mode"] == "similar"]
    assert sorted(c["geohash"] for c in similar_calls) == ["dq", "dr"]
    assert all(c["limit"] == 200 and c["min_similarity"] == 0.90 for c in similar_calls)


def test_search_is_deterministic_under_shuffled_partition_output(two_partitions):
    a = _search(FakeLambda(shuffle_seed=1))["matches"]
    b = _search(FakeLambda(shuffle_seed=2))["matches"]
    assert [m["cell_id"] for m in a] == [m["cell_id"] for m in b]
    assert a == b


def test_search_top_k_and_separation_off(two_partitions):
    result = _search(FakeLambda(), top_k=3)
    assert [m["cell_id"] for m in result["matches"]] == ["prospect", "van_cortlandt", "pelham"]
    result = _search(FakeLambda(), min_separation_km=0)
    assert "pelham_twin" in [m["cell_id"] for m in result["matches"]]


def test_search_survives_one_failed_partition_and_reports_it(two_partitions):
    result = _search(FakeLambda(fail_partitions={"dq"}))
    assert result["errors"] == [{"geohash": "dq", "error": "RuntimeError: IOException: partition unavailable"}]
    assert result["cells_compared"] == 50_000
    assert len(result["matches"]) >= 1


def test_search_errors_when_every_partition_fails(two_partitions):
    with pytest.raises(sim.SimilarityError, match="Every partition query failed"):
        _search(FakeLambda(fail_partitions={"dq", "dr"}))


def test_search_clips_matches_to_a_region_polygon(two_partitions):
    """A polygon covering New York City and the Hudson Valley but not the Adirondacks or the
    Finger Lakes keeps only the matches inside it and counts the rest."""
    region = box(-74.30, 40.45, -73.60, 41.80)
    result = _search(FakeLambda(), clip_geometry=region)
    ids = [m["cell_id"] for m in result["matches"]]
    assert ids == ["prospect", "van_cortlandt", "pelham", "bear_mtn", "hudson_valley"]
    assert result["clipped_out"] == 2                      # finger_lakes, adirondack
    assert [m["rank"] for m in result["matches"]] == [1, 2, 3, 4, 5]


def test_search_without_clip_reports_zero_clipped(two_partitions):
    assert _search(FakeLambda())["clipped_out"] == 0


def test_search_refuses_too_many_partitions(monkeypatch):
    monkeypatch.setattr(sim, "_get_geohashes_for_bbox", lambda *a: [f"g{i}" for i in range(21)])
    with pytest.raises(sim.SimilarityError, match="max 20"):
        _search(FakeLambda())


# --- GeoJSON ------------------------------------------------------------------------------

def test_geojson_has_query_and_match_tiers(two_partitions):
    result = _search(FakeLambda(), top_k=2)
    fc = sim.to_geojson([{"cell_id": "park_a", "bbox": PARK_CELLS_INSIDE[0]["bbox"]}], result["matches"], "Central Park")
    tiers = [f["properties"]["tier"] for f in fc["features"]]
    assert tiers == ["query", "match", "match"]
    q = fc["features"][0]["properties"]
    assert q["rank"] is None and q["similarity"] is None and q["example"] == "Central Park"
    m = fc["features"][1]
    assert m["properties"]["rank"] == 1 and m["properties"]["similarity"] == 0.97
    ring = m["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 5


# --- the tool -----------------------------------------------------------------------------

class FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


NYC_REGION = box(-74.30, 40.45, -73.60, 41.80)


@pytest.fixture()
def tool_env(tools_module, monkeypatch, two_partitions):
    import geopandas as gpd
    s3 = FakeS3()
    lam = FakeLambda()
    monkeypatch.setattr(tools_module.boto3, "client", lambda *_a, **_k: s3)
    monkeypatch.setattr(sim, "lambda_client", lambda: lam)

    def fake_download(url):
        geom = NYC_REGION if "region" in url else PARK
        return gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326")

    monkeypatch.setattr(tools_module, "download_geometry_from_s3", fake_download)
    monkeypatch.setenv("AGENT_SESSION_ID", "sess-1234")
    monkeypatch.setattr(tools_module.config, "S3_BUCKET_NAME", "test-bucket")
    return s3, lam


def _run(coro):
    return asyncio.run(coro)


def test_tool_result_shape_and_file_name(tools_module, tool_env):
    s3, _ = tool_env
    out = json.loads(_run(tools_module.find_similar_places(
        "Central Park", "s3://test-bucket/session_data/sess-1234/geometries/central_park.geojson", "New York")))

    assert "error" not in out, out.get("error")
    assert out["similar_geometry_s3_url"] == (
        "s3://test-bucket/session_data/sess-1234/geometries/similar_central_park_new_york_202507.geojson")
    assert len(s3.puts) == 1 and s3.puts[0]["ContentType"] == "application/geo+json"
    body = json.loads(s3.puts[0]["Body"])
    assert body["type"] == "FeatureCollection" and len(body["features"]) == 3 + 7
    s = out["summary"]
    assert (s["year"], s["month"], s["month_name"]) == (2025, 7, "July")
    assert s["query_cells"] == 3 and s["matches_returned"] == 7 and s["partitions"] == 2
    assert out["query"]["cell_ids"] == ["park_a", "park_b", "park_c"]
    assert out["matches"][0]["cell_id"] == "prospect"
    assert "Clay v1.5" in out["method"] and "display_visual" in out["next_steps"]


def test_tool_clips_to_the_region_geometry_when_given(tools_module, tool_env):
    out = json.loads(_run(tools_module.find_similar_places(
        "Central Park", "s3://b/g.geojson", "New York",
        search_geometry_s3_url="s3://b/session_data/s/geometries/polygon_new_york_region.geojson")))
    assert "error" not in out, out.get("error")
    assert out["summary"]["clipped_to_region"] is True and out["summary"]["clipped_out"] == 2
    assert [m["cell_id"] for m in out["matches"]] == ["prospect", "van_cortlandt", "pelham", "bear_mtn", "hudson_valley"]
    assert "inside the New York boundary" in out["interpretation"]
    # A supported name keeps the table's extent; the polygon only clips.
    assert out["summary"]["bbox"] == [float(v) for v in sim.COUNTRY_BBOXES["new york"]]


def test_tool_uses_the_region_geometry_as_extent_for_unsupported_names(tools_module, tool_env):
    out = json.loads(_run(tools_module.find_similar_places(
        "Central Park", "s3://b/g.geojson", "Hudson Valley",
        search_geometry_s3_url="s3://b/session_data/s/geometries/polygon_hudson_region.geojson")))
    assert "error" not in out, out.get("error")
    assert out["summary"]["bbox"] == [-74.30, 40.45, -73.60, 41.80]
    assert out["summary"]["search_region"] == "Hudson Valley"
    assert out["similar_geometry_s3_url"].endswith("similar_central_park_hudson_valley_202507.geojson")


def test_tool_rejects_a_non_s3_region_geometry(tools_module, tool_env):
    out = json.loads(_run(tools_module.find_similar_places(
        "Central Park", "s3://b/g.geojson", "New York", search_geometry_s3_url="https://x/y.geojson")))
    assert "search_geometry_s3_url must be an s3://" in out["error"]
    assert tool_env[0].puts == []


def test_tool_slugifies_names_in_the_key(tools_module, tool_env):
    out = json.loads(_run(tools_module.find_similar_places(
        "Parc de la Tête d'Or/../x", "s3://b/g.geojson", "Hudson Valley", search_bbox=[-74.2, 41.0, -73.5, 42.0])))
    assert "error" not in out, out.get("error")
    key = out["similar_geometry_s3_url"].split("/geometries/")[1]
    assert key == "similar_parc_de_la_tete_d_or_x_hudson_valley_202507.geojson"
    assert ".." not in key and "/" not in key


@pytest.mark.parametrize("kwargs, fragment", [
    ({"search_region": "Hudson Valley, New York"}, "not a recognized"),
    ({"search_region": "New York", "top_k": 0}, "top_k"),
    ({"search_region": "New York", "top_k": 500}, "top_k"),
    ({"search_region": "New York", "min_similarity": 2}, "min_similarity"),
    ({"search_region": "New York", "year": 2030}, "year"),
    ({"search_region": "New York", "search_bbox": [1, 2, 3]}, "search_bbox"),
    ({"search_region": "New York", "geometry_s3_url": "https://evil.example/x.geojson"}, "s3://"),
])
def test_tool_argument_errors_are_json_not_exceptions(tools_module, tool_env, kwargs, fragment):
    args = {"location": "Central Park", "geometry_s3_url": "s3://b/g.geojson"}
    args.update(kwargs)
    out = json.loads(_run(tools_module.find_similar_places(**args)))
    assert fragment in out["error"]
    assert tool_env[0].puts == []


def test_tool_no_cells_is_a_json_error(tools_module, tool_env, monkeypatch):
    monkeypatch.setattr(sim, "lambda_client", lambda: FakeLambda(embed_cells=[]))
    out = json.loads(_run(tools_module.find_similar_places("Atlantis", "s3://b/g.geojson", "New York")))
    assert "No embedding cells" in out["error"]
