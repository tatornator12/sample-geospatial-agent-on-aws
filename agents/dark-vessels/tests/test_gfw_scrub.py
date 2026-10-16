"""The builder's GFW client never hands identity on: the scrub at any depth and in any case, and the
per-process vessel numbers that replace ids. Rows shaped like the Oct 16 probe's. No network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import vessels_gfw as g  # noqa: E402

PRESENCE_ROW = {"callsign": "X", "dataset": "public-global-presence:v3.0", "date": "2026-10-12 00:00",
                "entryTimestamp": "2026-10-12T00:05:00Z", "exitTimestamp": "2026-10-12T00:50:00Z", "flag": "X",
                "geartype": "passenger", "hours": 0.75, "imo": "X", "lat": -0.75, "lon": -90.31, "mmsi": "X",
                "shipName": "X", "vesselId": "id-a", "vesselType": "passenger"}
SAR_ROW = {"date": "2026-10-12", "detections": 1, "geartype": "fishing", "lat": -0.66, "lon": -89.57,
           "vesselIDs": ["id-a", "id-b"]}


def test_scrub_removes_every_identity_field_at_any_depth_and_case():
    out = g.scrub({"entries": [{"public-global-presence:v3.0": [PRESENCE_ROW]}, {"sar": [SAR_ROW]}],
                   "nested": {"SHIPNAME": "X", "registryInfo": [{"ownerName": "X"}], "VesselId": "X"}})
    row = out["entries"][0]["public-global-presence:v3.0"][0]
    assert set(row) == {"dataset", "date", "entryTimestamp", "exitTimestamp", "geartype", "hours", "lat", "lon", "vesselType"}
    assert set(out["entries"][1]["sar"][0]) == {"date", "detections", "geartype", "lat", "lon"}
    assert out["nested"] == {}
    assert "id-a" not in repr(out) and "'X'" not in repr(out)


def test_pseudonymise_numbers_vessels_then_the_scrub_drops_the_ids():
    g._PSEUDO.clear()
    rows = [dict(PRESENCE_ROW), dict(PRESENCE_ROW, vesselId="id-b"), dict(PRESENCE_ROW, date="2026-10-12 01:00")]
    out = g.scrub(g.pseudonymise({"entries": [{"d": rows}]}))["entries"][0]["d"]
    assert [r["k"] for r in out] == [1, 2, 1]                   # the same vessel, the same number
    assert all("vesselId" not in r for r in out) and "id-a" not in repr(out) and "id-b" not in repr(out)
    assert g.pseudonymise({"lat": 0}) == {"lat": 0}            # rows without an id get no number


def test_the_final_scan_fails_a_poisoned_cache_file_and_passes_a_clean_one():
    clean = ('{"pass_id": "s1d-20261012t0018", "scenes": ["S1D_IW_GRDH_1SDV_20261012T001733_20261012T001803_004974_0096A1"],'
             ' "targets": [{"lon": -90.12345, "lat": -0.123456789, "px": 12}], "type": "fishing", "k": 3}')
    assert g.scan_identity(clean) == []                         # a 9-digit decimal part is not an MMSI
    poisoned = clean[:-1] + ', "ShipName": "X", "note": "heard as 123456789 at 00:17"}'
    found = g.scan_identity(poisoned)
    assert "key ShipName" in found and "nine-digit number 123456789" in found
    assert g.scan_identity('{"vesselIDs": []}') == ["key vesselIDs"]
