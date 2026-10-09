"""The public registry check (registry.py, ground_tools.registry_lookup): what OGIM lists near a site,
and the operators of record, in fixed words that state a listing and never a cause.

Hermetic: the cell files are written to a temp dir, S3 is the in-memory fake."""
import asyncio
import importlib
import json

import pytest

from conftest import BUCKET, SESSION

LAT, LON = 31.86424, -101.7662          # a Permian site


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def ground(tools, monkeypatch, tmp_path):
    importlib.import_module("watch_tools")
    mod = importlib.import_module("ground_tools")
    rg = importlib.import_module("registry")
    monkeypatch.setattr(rg, "CACHE_DIR", tmp_path / "cache")
    return mod


def write_cell(fake_s3, rg, cell, rows):
    """A cell file in the bucket, in the columns build_registry.py writes."""
    import pyarrow as pa
    import pyarrow.parquet as pq
    import io
    cols = ["category", "fac_type", "fac_status", "operator", "country", "state_prov", "src_date", "ogim_id",
            "xmin", "ymin", "xmax", "ymax", "diag"]
    table = pa.Table.from_pylist([dict(zip(cols, r if len(r) == len(cols) else [*r, True])) for r in rows])
    buf = io.BytesIO()
    pq.write_table(table, buf)
    fake_s3.put_object(Bucket=BUCKET, Key=rg.cell_key(cell), Body=buf.getvalue())


_ids = iter(range(1000, 10_000))


def well(lon, lat, operator, status="Producing", day="2024-03-01"):
    return ["Oil_and_Natural_Gas_Wells", "Oil well", status, operator, "United States", "Texas", day, next(_ids), lon, lat, lon, lat]


def pipe_piece(ogim_id, x0, y0, x1, y1, operator="Basin Gas Corp", day="2021-01-10"):
    """One chord piece of a pipeline, as build_registry.py writes it: its box and the SW-NE bit."""
    return ["Oil_and_Natural_Gas_Pipelines", "Gathering", None, operator, "United States", "Texas", day, ogim_id,
            min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1), (x1 - x0) * (y1 - y0) >= 0]


def test_cells_and_text_rules(ground):
    import registry as rg
    assert rg.cell_of(-101.77, 31.86) == (-105, 30)
    assert rg.cells_for((-101.78, 31.85, -101.75, 31.87)) == [(-105, 30)]
    assert rg.cells_for((-100.01, 29.99, -99.99, 30.01)) == [(-105, 25), (-105, 30), (-100, 25), (-100, 30)]   # a corner
    assert rg.cell_key((-105, 30)) == "methane/registry/ogim_v3.0/cell=-105_30.parquet"
    assert rg.clean_text("  ACME  <b>Oil</b> & Gas, LLC\n") == "ACME bOil/b & Gas, LLC"
    assert rg.clean_text(None) is None and rg.clean_text("   ") is None
    assert rg.plural(1, "tank battery") == "1 tank battery" and rg.plural(3, "tank battery") == "3 tank batteries"
    assert rg.plural(2, "well") == "2 wells"
    one_year = {"radius_km": 2.0, "listed": 2, "facilities": [{"kind": "pipeline", "count": 2, "nearest_km": 0.3}],
                "operators": [], "operators_named": 0, "unnamed": 2, "source_dates": ["2020-01-01", "2020-06-30"]}
    assert rg.registry_line(one_year) == ("The public registry lists within 2 km: 2 pipelines (0.3 km); "
                                          "no operator on record for any of them; records dated 2020.")
    # A crowded basin: fewer kinds and fewer names until the sentence fits, never a cut name.
    crowded = {"radius_km": 2.0, "listed": 400, "unnamed": 4, "source_dates": ["2020-01-01", "2025-02-01"],
               "facilities": [{"kind": k, "count": 90, "nearest_km": 0.1 * i} for i, k in
                              enumerate(["pipeline", "well", "gathering or processing plant", "compressor station"])],
               "operators": [{"operator": f"A VERY LONG REGISTERED OPERATOR NAME NUMBER {i} HOLDINGS, LLC", "facilities": 50 - i}
                             for i in range(5)], "operators_named": 5}
    line = rg.registry_line(crowded)
    assert len(line) <= rg.LINE_CAP and "NUMBER 0 HOLDINGS, LLC (50 facilities)" in line and "more" in line


def test_chord_distance_reads_the_diagonal_the_bit_names(ground):
    import registry as rg
    lat, lon = 0.0, 0.0
    # The same 0.02-degree box: SW to NE starts at the point; NW to SE passes about 1.57 km away.
    assert rg.chord_distance_km(lat, lon, 0, 0, 0.02, 0.02, True) == 0.0
    assert rg.chord_distance_km(lat, lon, 0, 0, 0.02, 0.02, False) == pytest.approx(1.57, abs=0.02)
    assert rg.chord_distance_km(lat, lon, 0.01, 0, 0.01, 0, True) == pytest.approx(1.11, abs=0.01)   # a point
    assert rg.chord_distance_km(lat, lon, -0.01, -0.01, 0.01, 0.01, None) == 0.0                     # no bit: SW-NE


def test_registry_lookup_counts_by_kind_and_names_operators_of_record_in_the_tools_words(ground, fake_s3):
    import registry as rg
    cell = rg.cell_of(LON, LAT)
    write_cell(fake_s3, rg, cell, [
        well(LON + 0.002, LAT, "Permian Holdings LLC"),
        well(LON + 0.004, LAT, "Permian Holdings LLC", day="2023-11-15"),
        well(LON - 0.003, LAT, "Permian Holdings LLC"),
        well(LON, LAT + 0.006, "Basin Gas Corp", status="Shut-in"),
        well(LON + 0.3, LAT, "Far Away Inc"),                                                   # 28 km: outside
        ["Tank_Battery", "Tank battery", "Active", None, "United States", "Texas", "2022-06-30", 2,
         LON - 0.008, LAT - 0.001, LON - 0.007, LAT],                                             # no operator on record
        pipe_piece(3, LON - 0.01, LAT - 0.01, LON + 0.01, LAT + 0.01),                           # SW-NE chord through the site: 0 km
        pipe_piece(3, LON + 0.01, LAT + 0.01, LON + 0.03, LAT + 0.02),                           # the same pipe again: counted once
        pipe_piece(5, LON, LAT + 0.06, LON + 0.06, LAT, operator="Box Only Pipeline Co"),        # its box covers the site, its chord is 4.3 km off
        ["Oil_and_Natural_Gas_Basins", None, None, "Nobody", None, None, None, 4, LON, LAT, LON, LAT],   # not infrastructure: ignored
    ])
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))
    assert "error" not in out, out
    assert out["listed"] == 6 and out["cells_read"] == 1
    kinds = {f["kind"]: f for f in out["facilities"]}
    assert kinds["well"]["count"] == 4 and kinds["pipeline"]["nearest_km"] == 0.0 and kinds["tank battery"]["count"] == 1
    assert kinds["well"]["statuses"] == {"producing": 3, "shut-in": 1}
    assert [(o["operator"], o["facilities"]) for o in out["operators"]] == [("Permian Holdings LLC", 3), ("Basin Gas Corp", 2)]
    assert out["operators"][1]["kinds"] == ["pipeline", "well"]
    assert out["unnamed"] == 1 and out["source_dates"] == ["2021-01-10", "2024-03-01"]
    assert out["nearest"]["kind"] == "pipeline" and out["nearest"]["operator"] == "Basin Gas Corp"
    assert out["line"] == ("The public registry lists within 2 km: 1 pipeline (0 km), 4 wells (0.2 km), 1 tank battery (0.7 km); "
                           "operators of record: Permian Holdings LLC (3 facilities), Basin Gas Corp (2 facilities); "
                           "1 with no operator on record; records dated 2021 to 2024.")
    assert "Far Away" not in json.dumps(out) and "Nobody" not in json.dumps(out)
    assert "Box Only" not in json.dumps(out)                                    # distance is to the pipe, not its box
    assert "never say 'behind'" in out["hypothesis_hint"]
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/registry_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["listed"] == 6 and rec["line"] == out["line"]


def test_registry_lookup_with_nothing_on_record_says_so_and_fails_soft(ground, fake_s3, monkeypatch):
    import registry as rg
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))                  # no cell file in the bucket at all
    assert out["listed"] == 0 and out["operators"] == [] and out["cells_read"] == 0
    assert out["line"].startswith("The public registry (OGIM v3.0") and "registry gap" in out["line"]
    assert "Do not name anyone" in out["hypothesis_hint"]
    assert "error" in json.loads(_run(ground.registry_lookup(95, LON)))
    assert "error" in json.loads(_run(ground.registry_lookup(LAT, LON, radius_km=50)))
    monkeypatch.setattr(rg, "query_cells", lambda *a: (_ for _ in ()).throw(RuntimeError("duckdb down")))
    write_cell(fake_s3, rg, rg.cell_of(LON, LAT), [well(LON, LAT, "X")])
    assert "registry check is unavailable" in json.loads(_run(ground.registry_lookup(LAT, LON)))["error"]


def test_registry_cell_files_are_cached_on_disk_for_a_day(ground, fake_s3, tmp_path):
    import registry as rg
    cell = rg.cell_of(LON, LAT)
    write_cell(fake_s3, rg, cell, [well(LON, LAT, "X")])
    path = rg.cell_file(cell, fake_s3)
    assert path is not None and path.exists() and path.parent == rg.CACHE_DIR
    reads = len(fake_s3.gets) if hasattr(fake_s3, "gets") else None
    assert rg.cell_file(cell, fake_s3) == path                                  # second call: the disk copy
    if reads is not None:
        assert len(fake_s3.gets) == reads
    assert rg.cell_file((100, 80), fake_s3) is None                            # no file for the open ocean


def test_the_brief_carries_the_registry_line_and_allows_a_company_only_in_the_registrys_words(tools, fake_s3):
    import brief_tools as bt
    prefix = f"session_data/{SESSION}/methane/"
    line = ("The public registry lists within 2 km: 4 wells (0.2 km); operators of record: Permian Holdings LLC (3 facilities); "
            "records dated 2021 to 2024.")
    fake_s3.put_object(Bucket=BUCKET, Key=f"{prefix}registry_{LAT:.4f}_{LON:.4f}.json", Body=json.dumps({
        "radius_km": 2.0, "listed": 4, "operators_named": 1, "facilities": [{"kind": "well", "count": 4, "nearest_km": 0.2}],
        "operators": [{"operator": "Permian Holdings LLC", "facilities": 3, "nearest_km": 0.2}],
        "source_dates": ["2021-01-10", "2024-03-01"], "source": "OGIM v3.0", "line": line}).encode())
    checks = bt.find_checks(LAT, LON)
    assert checks["registry"]["line"] == line and checks["registry"]["operators"][0]["operator"] == "Permian Holdings LLC"
    md = bt.render_markdown({"title": "t", "place": "p", "lat": LAT, "lon": LON, "watch_area": None, "observations": ["o"],
                             "looks": 1, "candidates": 1, "passes_read": 1, "explanations": [], "confidence": "low",
                             "gaps": ["g"], "next_collection": "n", "checks": checks}, "brief-20260101T000000-abcdef")
    assert f"- Check: {line}" in md
    # The company rule: the registry's own words may carry a suffix; the model's free text may not.
    assert bt.check_text("Operators of record: Permian Holdings LLC (3 facilities).") == []
    assert bt.check_text("Permian Holdings LLC runs the pad.") == ["'LLC' names a company outside the registry's words"]
    assert any("owner or operator" in p for p in bt.check_text("The site is operated by Basin Gas Corp."))


def write_field_cell(fake_s3, rg, cell, rows):
    """A field-outline cell in the columns build_registry.build_fields writes."""
    import io
    import pyarrow as pa
    import pyarrow.parquet as pq
    import shapely
    recs = []
    for name, operator, day, poly in rows:
        g = shapely.Polygon(poly)
        x0, y0, x1, y1 = g.bounds
        recs.append({"name": name, "operator": operator, "country": "ALGERIA", "src_date": day, "ogim_id": len(recs) + 1,
                     "xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "wkb": shapely.to_wkb(g)})
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(recs), buf)
    fake_s3.put_object(Bucket=BUCKET, Key=rg.field_cell_key(cell), Body=buf.getvalue())


def test_the_field_the_site_lies_in_is_its_own_sentence_with_its_operator_of_record(ground, fake_s3):
    import registry as rg
    lat, lon = 31.67, 6.07
    cell = rg.cell_of(lon, lat)
    box = lambda x0, y0, x1, y1: [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    write_field_cell(fake_s3, rg, cell, [
        ("HASSI MESSAOUD", "SONATRACH", "2017-06-24", box(lon - 0.3, lat - 0.3, lon + 0.3, lat + 0.3)),     # contains the site
        ("BIG REGION", "SOMEONE ELSE", "2017-06-24", box(lon - 2, lat - 2, lon + 2, lat + 2)),             # contains it too, larger
        ("NEIGHBOUR", None, "2017-06-24", box(lon + 0.02, lat - 0.1, lon + 0.1, lat + 0.1)),               # 1.9 km east
    ])
    write_cell(fake_s3, rg, cell, [well(lon + 0.002, lat, None)])
    out = json.loads(_run(ground.registry_lookup(lat, lon)))
    assert out["field"]["name"] == "HASSI MESSAOUD" and out["field"]["inside"] is True        # the smaller containing field
    assert out["field_line"] == ("The public registry places the site inside the HASSI MESSAOUD oil and gas field; "
                                 "operator of record SONATRACH; record dated 2017.")
    assert "SOMEONE ELSE" not in json.dumps(out)
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/registry_{lat:.4f}_{lon:.4f}.json"])
    assert rec["field_line"] == out["field_line"]
    # Outside every outline: the nearest within 5 km, with its distance; nothing beyond that.
    near = rg.field_at([{"name": "NEIGHBOUR", "operator": None, "country": "ALGERIA", "src_date": "2017-06-24",
                         "wkb": __import__("shapely").to_wkb(__import__("shapely").Polygon(box(lon + 0.02, lat - 0.1, lon + 0.1, lat + 0.1)))}],
                       lat, lon)
    assert near["inside"] is False and near["distance_km"] == 1.9
    assert rg.field_line(near) == ("The public registry's nearest oil and gas field outline is NEIGHBOUR, 1.9 km away; "
                                   "no operator on record; record dated 2017.")
    assert rg.field_line(None) is None


def test_a_missing_field_cell_leaves_the_facility_check_standing(ground, fake_s3):
    import registry as rg
    write_cell(fake_s3, rg, rg.cell_of(LON, LAT), [well(LON, LAT, "Permian Holdings LLC")])
    out = json.loads(_run(ground.registry_lookup(LAT, LON)))
    assert out["listed"] == 1 and out["field"] is None and out["field_line"] is None
