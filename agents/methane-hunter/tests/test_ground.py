"""The ground-record checks (ground_tools): VIIRS heat near a site and what Overture Maps maps, by type.

Hermetic: FIRMS and the Overture reads are patched; S3 is the in-memory fake. The checks must never let a name,
operator or free text through, must write their numbers-only record for the brief, and must fail soft.
"""
import asyncio
import importlib
import json
import time

import pytest

from conftest import BUCKET, SESSION

LAT, LON = 39.4741, 53.6435


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def ground(tools, monkeypatch):
    importlib.import_module("watch_tools")
    mod = importlib.import_module("ground_tools")
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    return mod


FIRMS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"


def firms_csv(rows):
    return FIRMS_HEADER + "".join(
        f"{la},{lo},330.1,0.4,0.4,{day},{t},N,VIIRS,n,2.0NRT,290.0,{frp},{dn},{typ}\n" for la, lo, day, t, frp, dn, typ in rows)


# --- thermal_anomalies ------------------------------------------------------------------------------

def test_thermal_counts_nights_within_the_radius_and_records_them(ground, fake_s3, monkeypatch):
    body = firms_csv([
        (LAT + 0.002, LON, "2026-09-20", "2210", 4.2, "N", "2"),
        (LAT + 0.002, LON, "2026-09-21", "2158", 3.9, "N", "2"),
        (LAT, LON + 0.003, "2026-09-25", "2201", 6.0, "N", "2"),
        (LAT, LON, "2026-09-22", "1030", 2.0, "D", "0"),          # daytime: counted, but not a night
        (LAT + 0.5, LON, "2026-09-23", "2200", 50.0, "N", "0"),   # 55 km away: a different fire
    ])
    calls = []

    def fake_get(client, url):
        calls.append(url)
        assert url.startswith("https://firms.modaps.eosdis.nasa.gov/")
        return body if "suomi-npp" in url else FIRMS_HEADER   # the second sensor saw nothing here
    monkeypatch.setattr(ground, "firms_get", fake_get)
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert out["source"] == "firms-7d" and out["nights_checked"] == 7          # no key: the public 7-day files
    assert out["detections"] == 4 and out["nights_with_heat"] == 3 and out["verdict"] == "persistent heat"
    assert out["static_source_detections"] == 3 and out["max_frp_mw"] == 6.0
    assert "3 of 7 nights" in out["line"] and "unlit_flare: 'less likely'" in out["hypothesis_hint"]
    # The two public files were fetched once each and cached for the day; a second call reads the cache.
    assert len(calls) == 2
    again = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert len(calls) == 2 and again["detections"] == 4
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/thermal_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["verdict"] == "persistent heat" and rec["line"] == out["line"]


def test_thermal_with_a_key_uses_the_area_api_and_never_leaks_the_key(ground, monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "abc123secret")
    urls = []
    monkeypatch.setattr(ground, "firms_get", lambda client, url: urls.append(url) or FIRMS_HEADER)
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON, nights=30)))
    assert out["source"] == "firms-api" and out["nights_checked"] == 30 and out["verdict"] == "no heat"
    assert "no heat source" in out["line"] and "flaring was not observed" in out["line"]
    assert len(urls) == 12 and all("/api/area/csv/abc123secret/VIIRS_" in u for u in urls)  # 6 chunks x 2 sensors
    # The area API rejects a day range above 5 ("Invalid day range. Expects [1..5]").
    spans = {int(u.rsplit("/", 2)[1]) for u in urls}
    assert spans == {5}
    assert "abc123secret" not in json.dumps(out)


def test_thermal_fails_soft_and_validates_first(ground, monkeypatch):
    monkeypatch.setattr(ground, "firms_get", lambda *a: (_ for _ in ()).throw(RuntimeError("firms_http_503")))
    out = json.loads(_run(ground.thermal_anomalies(LAT, LON)))
    assert "error" in out and "flare check is unavailable" in out["error"]
    assert "error" in json.loads(_run(ground.thermal_anomalies(95, LON)))
    assert "error" in json.loads(_run(ground.thermal_anomalies(LAT, LON, nights=0)))


# --- nearby_infrastructure (Overture Maps) -------------------------------------------------------------

def row(typ, group, lat, lon, d=0.0005):
    return {"type": typ, "group": group, "xmin": lon - d, "ymin": lat - d, "xmax": lon + d, "ymax": lat + d}


def test_infra_reads_the_watch_area_extract_and_counts_types_only(ground, fake_s3, monkeypatch):
    import overture as ov
    rows = [
        row("storage tank", ov.OIL_GAS, LAT + 0.003, LON),
        row("storage tank", ov.OIL_GAS, LAT + 0.004, LON),
        row("pipeline", ov.OIL_GAS, LAT - 0.01, LON, d=0.2),            # a long way: its box reaches the site
        row("quarry or surface mine", ov.MINING, LAT + 0.012, LON),
        row("power plant", ov.OTHER, LAT, LON - 0.009),
        row("farmland", ov.AGRICULTURE, LAT, LON - 0.009),
        row("storage tank", ov.OIL_GAS, LAT + 0.2, LON),                  # 22 km: outside
        {"type": "<b>Acme</b>", "group": "operators", "xmin": LON, "ymin": LAT, "xmax": LON, "ymax": LAT},  # not a group we know
    ]
    fake_s3.put_object(Bucket=BUCKET, Key=ov.extract_key("south caspian"),
                       Body=json.dumps({"area": "south caspian", "release": ov.RELEASE, "rows": rows}).encode())
    monkeypatch.setattr(ov, "live_rows", lambda *a, **k: pytest.fail("inside a watch area the extract answers"))
    out = json.loads(_run(ground.nearby_infrastructure(LAT, LON)))
    types = {t["type"]: t for t in out["types"]}
    assert types["storage tank"]["count"] == 2 and types["storage tank"]["nearest_km"] == 0.3
    assert types["pipeline"]["nearest_km"] == 0.0 and types["quarry or surface mine"]["count"] == 1
    assert out["groups"]["oil and gas"] == 3 and out["groups"]["mining"] == 1 and out["groups"]["agriculture"] == 1
    assert out["mapped"] == 6 and out["read_from"] == "extract:south caspian"
    assert "Acme" not in json.dumps(out) and "operators" not in json.dumps(out)
    assert out["line"].startswith("Overture Maps shows within 2 km: 1 pipeline (0 km), 2 storage tanks (0.3 km)")
    assert "non_oil_gas_source (mining): 'possible'" in out["hypothesis_hint"] and "storage tanks are mapped" in out["hypothesis_hint"]
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/methane/infra_{LAT:.4f}_{LON:.4f}.json"])
    assert rec["mapped"] == 6


def test_infra_outside_the_watch_areas_reads_overture_live(ground, monkeypatch):
    import overture as ov
    calls = []
    monkeypatch.setattr(ov, "live_rows", lambda box, **k: calls.append(box) or ([row("landfill", ov.WASTE, 48.86, 2.35)], []))
    out = json.loads(_run(ground.nearby_infrastructure(48.86, 2.35)))     # Paris: no watch area
    assert out["read_from"] == "live" and out["groups"]["waste"] == 1 and len(calls) == 1
    w, s, e, n = calls[0]
    assert w < 2.35 < e and s < 48.86 < n
    assert "non_oil_gas_source (landfill): 'possible'" in out["hypothesis_hint"]


def test_infra_nothing_mapped_is_a_gap_not_evidence(ground, monkeypatch):
    import overture as ov
    monkeypatch.setattr(ov, "live_rows", lambda box, **k: ([], []))
    out = json.loads(_run(ground.nearby_infrastructure(48.86, 2.35)))
    assert out["mapped"] == 0 and "mapping gap" in out["line"] and "cannot assess" in out["hypothesis_hint"]


def test_infra_fails_soft_when_overture_cannot_be_read(ground, monkeypatch):
    import overture as ov
    monkeypatch.setattr(ov, "live_rows", lambda box, **k: (_ for _ in ()).throw(RuntimeError("s3 down")))
    out = json.loads(_run(ground.nearby_infrastructure(48.86, 2.35)))
    assert "error" in out and "infrastructure check is unavailable" in out["error"]
    monkeypatch.setattr(ov, "live_rows", lambda box, **k: ([], list(ov.SOURCES)))
    assert "could not be read in time" in json.loads(_run(ground.nearby_infrastructure(48.86, 2.35)))["error"]
    assert "error" in json.loads(_run(ground.nearby_infrastructure(LAT, LON, radius_km=50)))


def test_overture_vocabulary_is_fixed_and_the_query_selects_no_names(ground):
    import overture as ov
    assert ov.classify("base/infrastructure", "utility", "storage_tank") == ("storage tank", ov.OIL_GAS)
    assert ov.classify("base/land_use", "resource_extraction", "mineshaft") == ("mine", ov.MINING)
    assert ov.classify("base/land_use", "developed", "industrial") == ("industrial area", ov.OTHER)
    assert ov.classify("base/land", "wetland", "marsh") == ("wetland", ov.WETLAND)
    assert ov.classify("places/place", "b2b_oil_and_gas_equipment", None) == ("oil and gas business", ov.OIL_GAS)
    assert ov.classify("places/place", "gastropub", None) is None
    assert ov.classify("base/infrastructure", "power", "power_tower") is None
    assert ov.bbox_distance_km(LAT, LON, LON - 1, LAT - 1, LON + 1, LAT + 1) == 0.0
    assert 0.2 < ov.bbox_distance_km(LAT, LON, LON + 0.003, LAT, LON + 0.004, LAT + 0.001) < 0.3
    # The parquet path and the where clause are built from the release and numbers only.
    sql_src = ov._parquet("base/infrastructure")
    assert sql_src == f"read_parquet('s3://overturemaps-us-west-2/release/{ov.RELEASE}/theme=base/type=infrastructure/*', hive_partitioning=1)"
    assert ov._sql_in(("a", "b'c")) == "'a', 'bc'"
    assert ov._parquet("base/infrastructure", ["s3://b/x.parquet", "s3://b/y.parquet"]) == "read_parquet(['s3://b/x.parquet', 's3://b/y.parquet'])"


def test_overture_file_index_opens_only_the_files_that_cover_the_site(ground, fake_s3, monkeypatch):
    """The files are spatially partitioned; the index (built once per release) is what keeps a live
    check inside its budget: a site box opens one or two files, not all 128."""
    import overture as ov
    monkeypatch.setattr(ov, "_INDEX", None)
    assert ov.load_index(fake_s3) is None                      # not built yet: read the whole type
    assert ov.files_for(None, "base/land", (0, 0, 1, 1)) is None

    index = {"base/infrastructure": [["s3://o/infra-a.parquet", -180, -85, -82, 31], ["s3://o/infra-b.parquet", 90, 27, 121, 47],
                                     ["s3://o/infra-c.parquet", 109, 26, 122, 46]],
             "base/land": [["s3://o/land-a.parquet", -180, -85, 0, 85]]}
    fake_s3.put_object(Bucket=BUCKET, Key=ov.index_key(), Body=json.dumps({"release": ov.RELEASE, "files": index}).encode())
    assert ov.load_index(fake_s3) == index
    shanxi = (114.20, 36.93, 114.33, 37.03)
    assert ov.files_for(index, "base/infrastructure", shanxi) == ["s3://o/infra-b.parquet", "s3://o/infra-c.parquet"]
    assert ov.files_for(index, "base/land", shanxi) == []      # nothing to open: the source is skipped
    assert ov.files_for(index, "places/place", shanxi) is None  # a source missing from the index reads the glob

    # live_rows asks each source only for its files and never opens a source with none.
    asked = {}

    class Cursor:
        def close(self):
            pass

        def interrupt(self):
            pass

    monkeypatch.setattr(ov, "connect", lambda: Cursor())
    def query(con, source, box, limit, files=None):
        asked[source] = files
        return []

    monkeypatch.setattr(ov, "query_source", query)
    rows, missed = ov.live_rows(shanxi, budget_s=5, s3=fake_s3)
    assert rows == [] and missed == []
    assert asked == {"base/infrastructure": ["s3://o/infra-b.parquet", "s3://o/infra-c.parquet"],
                     "base/land_use": None, "places/place": None}

    # A stale index (another release) is ignored.
    monkeypatch.setattr(ov, "_INDEX", None)
    fake_s3.put_object(Bucket=BUCKET, Key=ov.index_key(), Body=json.dumps({"release": "2020-01-01.0", "files": index}).encode())
    assert ov.load_index(fake_s3) is None


def test_overture_live_rows_interrupts_a_source_that_outruns_the_budget(ground, monkeypatch):
    import threading
    import overture as ov
    monkeypatch.setattr(ov, "_INDEX", {})                     # an empty index: every source reads its glob
    interrupted = []
    release = threading.Event()

    class Cursor:
        source = None

        def close(self):
            pass

        def interrupt(self):
            interrupted.append(self.source)
            release.set()

    def query(con, source, box, limit, files=None):
        con.source = source
        if source == "base/land":
            release.wait(5)                                      # stuck until interrupted
            raise RuntimeError("interrupted")
        return [{"type": "storage tank", "group": ov.OIL_GAS, "xmin": 0, "ymin": 0, "xmax": 0, "ymax": 0}]

    monkeypatch.setattr(ov, "connect", Cursor)
    monkeypatch.setattr(ov, "query_source", query)
    started = time.time()
    rows, missed = ov.live_rows((0, 0, 1, 1), budget_s=0.6, s3=object())
    assert time.time() - started < 3
    assert len(rows) == 3 and missed == ["base/land"] and interrupted == ["base/land"]
