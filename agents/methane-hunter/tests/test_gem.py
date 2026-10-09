"""Global Energy Monitor's records in the registry check (gem.py): coal mines with their mapped
vents and gas wells, oil and gas fields with operator and owners, in fixed words that name what the
record lists and never a cause; government bodies left out of the sentence.

Hermetic: the three files are written into the in-memory fake S3."""
import asyncio
import importlib
import io
import json

import pytest

from conftest import BUCKET, SESSION

LAT, LON = 35.5111, 112.4429           # the Jincheng site the replay picked


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def ground(tools, monkeypatch, tmp_path):
    importlib.import_module("watch_tools")
    mod = importlib.import_module("ground_tools")
    rg = importlib.import_module("registry")
    gem = importlib.import_module("gem")
    monkeypatch.setattr(rg, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(gem, "CACHE_DIR", tmp_path / "cache")
    return mod


def put(fake_s3, name, rows):
    import pyarrow as pa
    import pyarrow.parquet as pq
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(rows), buf)
    fake_s3.put_object(Bucket=BUCKET, Key=f"methane/registry/gem_2026/{name}.parquet", Body=buf.getvalue())


def point_feature(gid, sub, lon, lat, category="ventilation system"):
    import shapely
    g = shapely.Point(lon, lat)
    return {"gem_id": gid, "mine_name": "Yinjiagou Coal Mine", "category": category, "subcategory": sub,
            "owners": None, "parent": None, "xmin": lon, "ymin": lat, "xmax": lon, "ymax": lat, "wkb": shapely.to_wkb(g)}


def mine(gid, name, lon, lat, owners, parent=None, status="operating", accuracy="exact"):
    return {"gem_id": gid, "name": name, "status": status, "owners": owners, "parent": parent,
            "accuracy": accuracy, "lat": lat, "lon": lon, "ymin": lat}


def test_the_nearest_mine_is_named_with_its_owners_of_record_and_distance(ground, fake_s3):
    put(fake_s3, "mines", [
        mine("M4831", "Shanxi Yinjiagou Coal Mine", LON + 0.02, LAT + 0.01, "Yangtai Yinjiagou Coal Industry Co Ltd (100%)"),
        mine("M4831", "Shanxi Yinjiagou Coal Mine", LON + 0.03, LAT + 0.01, "Yangtai Yinjiagou Coal Industry Co Ltd (100%)",
             status="proposed"),                                                               # a second phase: one mine
        mine("M0001", "Libi Coal Mine", LON - 0.05, LAT, "Jincheng Energy (100%)",
             parent="China Coal (51%); Government of Somewhere (49%)"),
        mine("M0002", "Far Mine", LON + 0.5, LAT, "Nobody (100%)"),                          # 45 km: outside
    ])
    put(fake_s3, "mine_features", [point_feature("M4831", "shaft", LON + 0.005, LAT),
                                   point_feature("M4831", "gas well", LON + 0.004, LAT, "degasification system"),
                                   point_feature("M4831", "gas well", LON - 0.004, LAT, "degasification system"),
                                   point_feature("M4831", "preparation plant", LON, LAT, "other")])   # not methane-related
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))
    assert out["mine_line"] == ("The nearest coal mine on Global Energy Monitor's record is Shanxi Yinjiagou Coal Mine "
                                "(operating), 2.1 km away; owners of record Yangtai Yinjiagou Coal Industry Co Ltd (100%); "
                                "it maps 2 gas wells, 1 ventilation shaft within 2 km; 1 other mine on its record within 10 km.")
    assert out["mines"]["mines_near"] == 2 and "Far Mine" not in json.dumps(out)
    assert "coal" in out["hypothesis_hint"] and "non_oil_gas_source" in out["hypothesis_hint"]
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/registry_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["mine_line"] == out["mine_line"]


def test_governments_are_left_out_of_the_sentence_and_a_boundary_beats_a_point(ground, fake_s3):
    import shapely
    gem = importlib.import_module("gem")
    assert gem.parties("China Coal (51%); Government of Somewhere (49%)") == "China Coal (51%)"
    assert gem.parties("A Co (60%); B Co (40%)") == "A Co (60%), B Co (40%)"
    long = "Spraberry (Trend Area) - Endeavor Energy Resources (Conventional) Oil and Gas Asset (Texas, United States)"
    assert gem.display_name(long) == "Spraberry (Trend Area) - Endeavor Energy Resources (Conventional) Oil and Gas Asset"
    assert gem.parties("Ministry of Energy of Ukraine") is None
    assert gem.display_name("Hassi Messaoud Oil and Gas Field (Algeria)") == "Hassi Messaoud Oil and Gas Field"
    boundary = shapely.box(LON - 0.01, LAT - 0.01, LON + 0.01, LAT + 0.01)
    put(fake_s3, "mines", [mine("M9", "Inside Mine", LON + 0.03, LAT, "Owner Co (100%)", parent="Government of X (100%)")])
    put(fake_s3, "mine_features", [{"gem_id": "M9", "mine_name": "Inside Mine", "category": "mine boundary",
                                    "subcategory": "underground", "owners": None, "parent": None,
                                    "xmin": LON - 0.01, "ymin": LAT - 0.01, "xmax": LON + 0.01, "ymax": LAT + 0.01,
                                    "wkb": shapely.to_wkb(boundary)}])
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))                       # no fields file: no field line
    assert out["mine_line"] == ("Global Energy Monitor maps the site inside the boundary of Inside Mine (operating); "
                                "owners of record Owner Co (100%).")
    assert "Government" not in out["mine_line"]


def test_a_gem_field_with_its_operator_and_owners_and_one_line_when_ogim_names_the_same_field(ground, fake_s3):
    gem = importlib.import_module("gem")
    lat, lon = 31.67, 6.07
    put(fake_s3, "fields", [{"unit_id": "OG1", "name": "Rhourde Field (Algeria)", "status": "operating",
                             "operator": "Sonatrach", "owners": "Sonatrach (51%); Partner SpA (49%)", "located": "point",
                             "ogim_id": None, "lat": lat + 0.03, "lon": lon, "xmin": lon, "ymin": lat + 0.03, "xmax": lon,
                             "ymax": lat + 0.03, "wkb": None}])
    out = json.loads(_run(ground.registry_lookup(lat, lon)))
    assert out["gem_field_line"] == ("The nearest oil and gas field on Global Energy Monitor's record is Rhourde Field "
                                     "(operating), 3.3 km away; operator of record Sonatrach; owners of record "
                                     "Sonatrach (51%), Partner SpA (49%).")
    # The same field in both records: OGIM's line when it has the operator, else GEM's placed by OGIM's outline.
    ogim = {"name": "GOTURDEPE", "operator": None, "inside": True, "distance_km": 0.0}
    g = {"name": "Goturdepe Gas Field", "operator": "Turkmennebit", "status": "operating", "inside": False, "distance_km": 4.0}
    keep, merged = gem.merge_fields(ogim, g)
    assert keep is False and merged["inside"] is True
    assert gem.gem_field_line(merged) == ("Global Energy Monitor's field record places the site inside Goturdepe Gas Field "
                                          "(operating; outline from the OGIM registry); operator of record Turkmennebit.")
    assert gem.merge_fields({"name": "HASSI MESSAOUD", "operator": "SONATRACH", "inside": True},
                            {"name": "Hassi Messaoud Oil and Gas Field", "operator": "Sonatrach"}) == (True, None)


def test_without_gem_files_the_registry_check_stands(ground, fake_s3):
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))
    assert "error" not in out and out["mine_line"] is None and out["gem_field_line"] is None


def test_the_brief_prints_every_registry_sentence_in_order(tools, fake_s3):
    import brief_tools as bt
    prefix = f"session_data/{SESSION}/methane/"
    lines = {"line": "The public registry (OGIM v3.0) lists no oil and gas facility within 2 km; a registry gap is not evidence of an empty site.",
             "mine_line": "The nearest coal mine on Global Energy Monitor's record is X Coal Mine (operating), 2.1 km away; owners of record X Co (100%).",
             "gem_field_line": None}
    fake_s3.put_object(Bucket=BUCKET, Key=f"{prefix}registry_{LAT:.4f}_{LON:.4f}.json", Body=json.dumps({
        "radius_km": 2.0, "listed": 0, "operators_named": 0, "facilities": [], "operators": [], "source": "OGIM v3.0",
        "mines": {"mine": {"name": "X Coal Mine", "status": "operating", "owners": "X Co (100%)", "inside": False,
                           "distance_km": 2.1}}, **lines}).encode())
    checks = bt.find_checks(LAT, LON)
    assert checks["registry"]["mine_line"] == lines["mine_line"] and "gem_field_line" not in checks["registry"]
    md = bt.render_markdown({"title": "t", "place": "p", "lat": LAT, "lon": LON, "watch_area": None, "observations": ["o"],
                             "looks": 1, "candidates": 1, "passes_read": 1, "explanations": [], "confidence": "low",
                             "gaps": ["g"], "next_collection": "n", "checks": checks}, "brief-20260101T000000-abcdef")
    assert [l for l in md.splitlines() if l.startswith("- Check:")] == [f"- Check: {lines['line']}", f"- Check: {lines['mine_line']}"]
