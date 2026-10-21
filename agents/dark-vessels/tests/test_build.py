"""The cache build for the open question (task 2, §3.6): imaged cells sampled from a synthetic COG,
the --imaged backfill that only adds fields, --prefix validation and the rehearsal prefix, --backup
and --restore, the rerun's on-file rule, the rest file's --newest flag and its bucket, and
warm_vessels.py --check. FakeS3 only, no network."""
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from rasterio.transform import from_origin
from shapely.geometry import box, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import ais_coverage as cv  # noqa: E402
import build_vessel_cache as bvc  # noqa: E402
import list_vessel_passes as lvp  # noqa: E402
import publish_vessel_rest as pvr  # noqa: E402
import warm_vessels as wv  # noqa: E402
from conftest import BUCKET, NOW, SILENT, STAR, FakeS3, star_replay  # noqa: E402

V1 = "vessels/cache/v1"
V1R = "vessels/cache/v1r"
NEWER = "s1d-20261018t0018"
PX = 0.01                   # the synthetic display's pixel, degrees
CUT_LON = -90.5             # imaged west of this (a 0.05 deg cell edge, so no centre sits on it)
HOLE = (-91.5, -0.5)        # a 0.1 deg block reading 0 (land and its margin)


@pytest.fixture()
def grid_water():
    reserve, _, _ = bvc.records()
    return bvc.reserve_grid(reserve)


def oct16_manifest(s3) -> None:
    """The manifest as the Oct 16 build left it, before --imaged: the star's and the silent vessel's
    records with no metadata or imaged cells (the shared fixture carries them, for the tools)."""
    m = s3.json(f"{V1}/manifest.json")
    m["passes"] = {pid: {k: v for k, v in m["passes"][pid].items() if k in ("pass_id", "bounds", "products", "chips")}
                   for pid in (STAR, SILENT)}
    s3.put_object(Bucket=BUCKET, Key=f"{V1}/manifest.json", Body=json.dumps(m))


@pytest.fixture()
def fake_s3(fake_s3):
    oct16_manifest(fake_s3)
    return fake_s3


@pytest.fixture(autouse=True)
def keep_prefix(monkeypatch):
    """main() moves the build's PREFIX with --prefix; every test gets the default back."""
    monkeypatch.setattr(bvc, "PREFIX", bvc.PREFIX)


def synthetic_display(grid):
    """uint8 over the grid's box less its western 0.5 deg: 200 west of CUT_LON, 0 east of it and in HOLE."""
    west = grid.west + 0.5
    w, h = int(round((grid.east - west) / PX)), int(round((grid.north - grid.south) / PX))
    lon = west + (np.arange(w) + 0.5) * PX
    lat = grid.north - (np.arange(h) + 0.5) * PX
    LON, LAT = np.meshgrid(lon, lat)
    disp = np.where(LON < CUT_LON, 200, 0).astype(np.uint8)
    disp[(LON >= HOLE[0]) & (LON < HOLE[0] + 0.1) & (LAT >= HOLE[1]) & (LAT < HOLE[1] + 0.1)] = 0
    return disp, from_origin(west, grid.north, PX, PX)


def expected_imaged(grid, water):
    hh, ww = grid.shape
    out = np.zeros(grid.shape, dtype=bool)
    for r in range(hh):
        for c in range(ww):
            lon, lat = grid.west + (c + 0.5) * grid.step, grid.south + (r + 0.5) * grid.step
            in_hole = HOLE[0] <= lon < HOLE[0] + 0.1 and HOLE[1] <= lat < HOLE[1] + 0.1
            out[r, c] = water[r, c] and grid.west + 0.5 <= lon < CUT_LON and not in_hole
    return out


def cog_bytes(tmp_path, grid) -> bytes:
    disp, transform = synthetic_display(grid)
    path = tmp_path / "display.tif"
    bvc.write_cog(path, disp, transform, 0, {"PASS": "synthetic"})
    return path.read_bytes()


def on_file_doc() -> dict:
    return json.loads(bvc.PASSES.read_text())


def newer_entry() -> dict:
    return {"pass_id": NEWER, "role": "on_file", "satellite": "Sentinel-1D", "sensed": "2026-10-18T00:18:02Z",
            "orbit_state": "ascending", "relative_orbit": 128, "scenes": ["S1D_IW_GRDH_synthetic"], "reserve_share": 0.24}


def products(prefix: str, pid: str) -> dict:
    return {k: {"key": f"{prefix}/{pid}_{k}.{'tif' if k in ('vv', 'display') else 'json'}", "bytes": 1}
            for k in ("vv", "display", "targets", "presence", "replay")}


# --- the imaged cells ----------------------------------------------------------------------------

def test_cell_runs_round_trip():
    cells = np.zeros((3, 8), dtype=bool)
    cells[0, 2:5] = True
    cells[0, 7] = True
    cells[2, :] = True
    assert cv.cell_runs(cells) == [[0, 2, 5], [0, 7, 8], [2, 0, 8]]
    rng = np.random.default_rng(3)
    for _ in range(20):
        m = rng.random((9, 11)) > 0.5
        assert (cv.cells_from_runs(cv.cell_runs(m), m.shape) == m).all()


def test_imaged_mask_samples_the_display_at_each_cell_centre(tmp_path, grid_water):
    """Display > 0 at the centre: off the raster, east of the cut and in the hole are not imaged."""
    import rasterio
    grid, water = grid_water
    path = tmp_path / "d.tif"
    path.write_bytes(cog_bytes(tmp_path, grid))
    with rasterio.open(path) as ds:
        assert ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
        got = bvc.imaged_mask(ds.read(1), ds.transform, grid, water)
    want = expected_imaged(grid, water)
    assert (got == want).all()
    assert 0 < got.sum() < water.sum()
    fields = bvc.imaged_fields(got, grid, water)
    assert fields["imaged_share"] == round(want.sum() / water.sum(), 3)
    assert (cv.cells_from_runs(fields["imaged_cells"], grid.shape) == want).all()
    assert fields["imaged_grid"] == [grid.west, grid.south, grid.east, grid.north, 0.05]


def test_summarise_writes_the_metadata_and_imaged_cells(grid_water):
    grid, water = grid_water
    reserve, _, _ = bvc.records()
    entry = next(e for e in on_file_doc()["passes"] if e["pass_id"] == STAR)
    imaged = expected_imaged(grid, water)
    rec = bvc.summarise(entry, [-91.3, -2.3, -88.4, 1.6], [], [1.0, 2.0], [], [], [], 0, {}, reserve, 1.0, imaged)
    assert (rec["satellite"], rec["orbit_state"], rec["relative_orbit"]) == ("Sentinel-1D", "ascending", 33)
    assert rec["imaged_share"] == round(imaged.sum() / water.sum(), 3)
    assert (cv.cells_from_runs(rec["imaged_cells"], grid.shape) == imaged).all()
    assert rec["counts"]["heard_share"] == 0.0


def test_imaged_backfill_reads_the_bucket_and_only_adds_fields(fake_s3, monkeypatch, tmp_path, grid_water):
    grid, water = grid_water
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    tif = cog_bytes(tmp_path, grid)
    for pid in (STAR, SILENT):
        fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/{pid}_display.tif", Body=tif)
    before = dict(fake_s3.objects)
    assert bvc.main(["--imaged", "--dry-run", "--bucket", BUCKET]) == 0
    assert fake_s3.objects == before                                      # the dry run writes nothing
    assert bvc.main(["--imaged", "--bucket", BUCKET]) == 0
    assert set(fake_s3.objects) == set(before)
    assert [k for k in before if fake_s3.objects[k] != before[k]] == [f"{V1}/manifest.json"]
    old, new = json.loads(before[f"{V1}/manifest.json"]), fake_s3.json(f"{V1}/manifest.json")
    assert {k: v for k, v in new.items() if k != "passes"} == {k: v for k, v in old.items() if k != "passes"}
    added = {"satellite", "orbit_state", "relative_orbit", "imaged_share", "imaged_cells", "imaged_grid"}
    for pid, rec in old["passes"].items():
        assert {k: new["passes"][pid][k] for k in rec} == rec                # every old field as it was
        assert set(new["passes"][pid]) - set(rec) == added
        assert (cv.cells_from_runs(new["passes"][pid]["imaged_cells"], grid.shape) == expected_imaged(grid, water)).all()
    assert new["passes"][STAR]["relative_orbit"] == 33 and new["passes"][SILENT]["satellite"] == "Sentinel-1A"


# --- the prefix ----------------------------------------------------------------------------------

@pytest.mark.parametrize("prefix", [V1, V1R, "vessels/cache/v1-rehearsal"])
def test_prefix_accepts_the_runtime_rule(prefix):
    assert bvc.valid_prefix(prefix) == prefix


@pytest.mark.parametrize("prefix", ["vessels/cache/v2", "vessels/cache/v1/", "vessels/cache/v1/../plan", "vessels/cache/V1R",
                                    "vessels/cache/v1r/x", "", "s3://b/vessels/cache/v1"])
def test_prefix_refuses_anything_else_before_any_write(prefix, fake_s3, monkeypatch):
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    before = dict(fake_s3.objects)
    with pytest.raises(SystemExit):
        bvc.main(["--prefix", prefix, "--backup", "2026-10-21", "--bucket", BUCKET])
    assert fake_s3.objects == before and fake_s3.copies == []


def test_seed_copies_only_the_manifest_and_never_writes_over_one(fake_s3, monkeypatch):
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    with pytest.raises(SystemExit):
        bvc.main(["--seed-from", V1, "--bucket", BUCKET])                  # no --prefix: v1 itself
    assert bvc.main(["--prefix", V1R, "--seed-from", V1, "--dry-run", "--bucket", BUCKET]) == 0
    assert fake_s3.copies == []
    assert bvc.main(["--prefix", V1R, "--seed-from", V1, "--bucket", BUCKET]) == 0
    assert fake_s3.copies == [(f"{V1}/manifest.json", f"{V1R}/manifest.json")]
    assert fake_s3.objects[f"{V1R}/manifest.json"] == fake_s3.objects[f"{V1}/manifest.json"]
    with pytest.raises(SystemExit):
        bvc.main(["--prefix", V1R, "--seed-from", V1, "--bucket", BUCKET])
    assert len(fake_s3.copies) == 1


class UploadS3(FakeS3):
    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None):
        self.put_object(Bucket=Bucket, Key=Key, Body=Path(Filename).read_bytes())


def test_upload_writes_only_under_the_prefix_and_refuses_records_for_another(tmp_path, monkeypatch):
    from conftest import seed as seed_cache
    s3 = UploadS3()
    seed_cache(s3)
    oct16_manifest(s3)
    s3.copy_object(Bucket=BUCKET, Key=f"{V1R}/manifest.json", CopySource={"Bucket": BUCKET, "Key": f"{V1}/manifest.json"})
    monkeypatch.setattr(bvc, "_s3", lambda: s3)
    out = tmp_path / "out"
    out.mkdir()
    (out / f"{NEWER}_targets.json").write_text("{}")
    v1_before = {k: v for k, v in s3.objects.items() if k.startswith(f"{V1}/")}
    monkeypatch.setattr(bvc, "PREFIX", V1R)
    with pytest.raises(SystemExit):                                       # records built for v1
        bvc.upload(out, BUCKET, {NEWER: {"products": products(V1, NEWER)}}, None, None)
    assert f"{V1R}/{NEWER}_targets.json" not in s3.objects
    assert bvc.upload(out, BUCKET, {NEWER: {"pass_id": NEWER, "products": products(V1R, NEWER)}}, None, None) == 0
    assert {k: v for k, v in s3.objects.items() if k.startswith(f"{V1}/")} == v1_before
    manifest = s3.json(f"{V1R}/manifest.json")
    assert manifest["passes"][NEWER]["products"]["vv"]["key"] == f"{V1R}/{NEWER}_vv.tif"
    assert manifest["passes"][STAR]["products"]["vv"]["key"] == f"{V1}/{STAR}_vv.tif"   # seeded records keep v1
    assert f"{V1R}/{NEWER}_targets.json" in s3.objects
    monkeypatch.setattr(bvc, "PREFIX", V1)
    with pytest.raises(SystemExit):                                       # records built for v1r, upload to v1
        bvc.upload(out, BUCKET, {NEWER: {"products": products(V1R, NEWER)}}, None, None)


# --- backup and restore --------------------------------------------------------------------------

def test_backup_copies_the_four_files_and_refuses_an_existing_folder(fake_s3, monkeypatch):
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/rest_v1.json", Body=b'{"version":1}')
    folder = f"{V1}/backup-2026-10-21"
    assert bvc.main(["--backup", "2026-10-21", "--dry-run", "--bucket", BUCKET]) == 0
    assert fake_s3.copies == [] and not any(k.startswith(folder) for k in fake_s3.objects)
    assert bvc.main(["--backup", "2026-10-21", "--bucket", BUCKET]) == 0
    names = ("manifest.json", "history_v1.json", "fleet_v1.json", "rest_v1.json")
    assert fake_s3.copies == [(f"{V1}/{n}", f"{folder}/{n}") for n in names]
    for n in names:
        assert fake_s3.objects[f"{folder}/{n}"] == fake_s3.objects[f"{V1}/{n}"]
    with pytest.raises(SystemExit):
        bvc.main(["--backup", "2026-10-21", "--bucket", BUCKET])
    assert len(fake_s3.copies) == 4
    for bad in ("2026-13-01", "21-10-2026", "2026-10-21/x", "latest"):
        with pytest.raises(SystemExit):
            bvc.main(["--backup", bad, "--bucket", BUCKET])
    assert len(fake_s3.copies) == 4


def test_restore_copies_back_and_deletes_nothing(fake_s3, monkeypatch):
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/rest_v1.json", Body=b'{"version":1}')
    assert bvc.main(["--backup", "2026-11-05", "--bucket", BUCKET]) == 0
    saved = {n: fake_s3.objects[f"{V1}/{n}"] for n in ("manifest.json", "rest_v1.json", "history_v1.json")}
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/manifest.json", Body=b'{"version":"v1","passes":{}}')
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/rest_v1.json", Body=b'{"version":1,"bucket":"x"}')
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/{NEWER}_vv.tif", Body=b"II*\x00new")
    keys = set(fake_s3.objects)
    with pytest.raises(SystemExit):
        bvc.main(["--restore", "2026-11-04", "--bucket", BUCKET])          # no such backup
    assert bvc.main(["--restore", "2026-11-05", "--dry-run", "--bucket", BUCKET]) == 0
    assert fake_s3.objects[f"{V1}/rest_v1.json"] == b'{"version":1,"bucket":"x"}'
    assert bvc.main(["--restore", "2026-11-05", "--bucket", BUCKET]) == 0
    for n, body in saved.items():
        assert fake_s3.objects[f"{V1}/{n}"] == body
    assert set(fake_s3.objects) == keys                                   # the new pass's file stays
    assert not hasattr(fake_s3, "delete_object")


def test_one_cache_action_at_a_time(fake_s3, monkeypatch):
    monkeypatch.setattr(bvc, "_s3", lambda: fake_s3)
    with pytest.raises(SystemExit):
        bvc.main(["--backup", "2026-10-21", "--imaged", "--bucket", BUCKET])
    assert fake_s3.copies == []


# --- the rerun's on-file rule ----------------------------------------------------------------------

def stac_item(sid: str, platform: str, orbit: int, state: str, when: str, geom, mode: str = "IW") -> dict:
    return {"id": sid, "geometry": mapping(geom),
            "properties": {"platform": platform, "sat:relative_orbit": orbit, "sat:orbit_state": state,
                           "datetime": when, "sar:instrument_mode": mode}}


def test_the_on_file_rule_adds_the_newest_wide_passes_and_keeps_the_rest():
    reserve, _, _ = bvc.records()
    w, s, e, n = reserve.bounds
    whole, west = box(w, s, e, n), box(w, s, w + (e - w) * 0.35, n)
    sliver = box(w, s, w + 0.3, s + 0.6)
    items = [stac_item("a1", "sentinel-1d", 106, "ascending", "2026-10-17T00:25:40Z", west),
             stac_item("a2", "sentinel-1d", 106, "ascending", "2026-10-17T00:26:30Z", west),   # same pass, second frame
             stac_item("b", "sentinel-1d", 128, "ascending", "2026-10-18T00:18:02Z", whole),
             stac_item("c", "sentinel-1c", 40, "descending", "2026-10-19T11:40:00Z", whole, mode="EW"),
             stac_item("d", "sentinel-1d", 55, "descending", "2026-10-16T11:41:47Z", sliver),
             stac_item("f", "sentinel-1d", 33, "ascending", "2026-10-24T00:18:02Z", whole),     # after GFW's radar day
             stac_item("g", "sentinel-1d", 55, "descending", "2026-10-05T11:41:47Z", whole),    # older than the newest on file
             stac_item("h", "sentinel-1d", 33, "ascending", "2026-10-12T00:18:02Z", whole)]     # the star, on file
    passes = lvp.passes_from(lvp.iw_only(items), reserve)
    assert "s1c-20261019t1140" not in {p["pass_id"] for p in passes}
    on_file = on_file_doc()
    last_day = datetime(2026, 10, 19).date()
    two = lvp.pick_new(passes, on_file, 2, 0.2, last_day)
    assert [p["pass_id"] for p in two] == ["s1d-20261018t0018", "s1d-20261017t0026"]
    assert two[1]["scenes"] == ["a1", "a2"] and 0.2 <= two[1]["reserve_share"] < 0.5
    assert [p["pass_id"] for p in lvp.pick_new(passes, on_file, 1, 0.2, last_day)] == ["s1d-20261018t0018"]
    assert lvp.pick_new(passes, on_file, 6, 0.99, last_day) == [p for p in two if p["reserve_share"] >= 0.99]
    out = lvp.appended(on_file, two, 0.2)
    assert out["passes"][:len(on_file["passes"])] == on_file["passes"]
    assert out["silent_vessel"] == on_file["silent_vessel"]
    new = out["passes"][len(on_file["passes"]):]
    assert [x["pass_id"] for x in new] == ["s1d-20261017t0026", "s1d-20261018t0018"]
    assert {x["role"] for x in new} == {"on_file"}
    assert sum(x["role"] == "star" for x in out["passes"]) == 1
    assert {"satellite", "sensed", "orbit_state", "relative_orbit", "scenes"} <= set(new[0])
    assert "coverage" not in new[0] and "gfw" not in new[0]                # no candidate filter ran
    json.dumps(out)


def test_append_needs_newest_and_the_flags_go_together():
    with pytest.raises(SystemExit):
        lvp.main(["--append"])
    with pytest.raises(SystemExit):
        lvp.main(["--newest", "2"])
    with pytest.raises(SystemExit):
        lvp.main(["--append", "--newest", "0"])


# --- the rest file ---------------------------------------------------------------------------------

@pytest.fixture()
def rest_cache(fake_s3, monkeypatch, tmp_path):
    """The fake cache with roles, a newer pass on file (built), and a passes file that lists only
    the built passes: the star, the newer pass and the silent vessel's."""
    doc = on_file_doc()
    doc["passes"] = [e for e in doc["passes"] if e["pass_id"] == STAR] + [newer_entry()]
    passes_path = tmp_path / "passes_v1.json"
    passes_path.write_text(json.dumps(doc))
    manifest = fake_s3.json(f"{V1}/manifest.json")
    manifest["passes"][STAR]["role"] = "star"
    manifest["passes"][SILENT]["role"] = "silent_vessel"
    manifest["passes"][NEWER] = {"pass_id": NEWER, "role": "on_file", "products": products(V1, NEWER), "chips": {}}
    newer_replay = dict(star_replay(), tracks=star_replay()["tracks"][:1])
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/{NEWER}_replay.json", Body=json.dumps(newer_replay))
    fake_s3.put_object(Bucket=BUCKET, Key=f"{V1}/manifest.json", Body=json.dumps(manifest))
    for mod in (pvr, wv):
        monkeypatch.setattr(mod, "_s3", lambda: fake_s3)
        monkeypatch.setattr(mod, "PASSES", passes_path)
    return fake_s3, passes_path


def test_rest_default_is_the_star_with_the_bucket(rest_cache):
    s3, _ = rest_cache
    assert pvr.main(["--dry-run", "--bucket", BUCKET]) == 0
    assert f"{V1}/rest_v1.json" not in s3.objects
    assert pvr.main(["--bucket", BUCKET]) == 0
    rest = s3.json(f"{V1}/rest_v1.json")
    assert rest["bucket"] == BUCKET
    assert rest["pass"] == {"pass_id": STAR, "satellite": "Sentinel-1D", "sensed": "2026-10-12T00:18:02Z",
                            "orbit_state": "ascending"}
    assert len(rest["replay"]["tracks"]) == len(star_replay()["tracks"])
    assert set(rest) == {"version", "pass", "replay", "reserve", "ports", "islands", "passes", "attribution", "bucket"}


def test_rest_newest_is_the_newest_pass_on_file_with_the_bucket(rest_cache):
    s3, _ = rest_cache
    assert pvr.main(["--newest", "--bucket", BUCKET]) == 0
    rest = s3.json(f"{V1}/rest_v1.json")
    assert rest["pass"]["pass_id"] == NEWER and rest["bucket"] == BUCKET
    assert len(rest["replay"]["tracks"]) == 1


@pytest.mark.parametrize("bad", ["Test_Bucket", "ab", "-bucket", "bucket-"])
def test_rest_refuses_a_bucket_the_stage_would_refuse(rest_cache, bad):
    s3, _ = rest_cache
    with pytest.raises(SystemExit):
        pvr.main(["--bucket", bad])
    assert f"{V1}/rest_v1.json" not in s3.objects


# --- warm_vessels.py --check -------------------------------------------------------------------------

@pytest.fixture()
def checkable(rest_cache, monkeypatch, grid_water):
    """Everything --check reads, clear: every product, imaged cells on every pass, a rest file."""
    s3, _ = rest_cache
    grid, water = grid_water
    monkeypatch.setattr(wv, "_now", lambda: NOW)
    manifest = s3.json(f"{V1}/manifest.json")
    for rec in manifest["passes"].values():
        rec.update(bvc.imaged_fields(expected_imaged(grid, water), grid, water), counts={"candidates_both": 0})
        for p in rec["products"].values():
            s3.objects.setdefault(p["key"], b"x")
    s3.put_object(Bucket=BUCKET, Key=f"{V1}/manifest.json", Body=json.dumps(manifest))
    assert pvr.main(["--bucket", BUCKET]) == 0
    return s3


def put_rest(s3, **changes):
    rest = s3.json(f"{V1}/rest_v1.json")
    for k, v in changes.items():
        if v is None:
            rest.pop(k, None)
        else:
            rest[k] = v
    s3.put_object(Bucket=BUCKET, Key=f"{V1}/rest_v1.json", Body=json.dumps(rest))


def test_check_is_clear_with_imaged_cells_and_a_bucket(checkable, capsys):
    assert wv.main(["--check", "--bucket", BUCKET]) == 0
    out = capsys.readouterr().out
    assert "all clear" in out and f"bucket {BUCKET}" in out


@pytest.mark.parametrize("bucket", [None, "", "Bad_Bucket", 7])
def test_check_fails_on_a_rest_file_without_a_good_bucket(checkable, capsys, bucket):
    put_rest(checkable, bucket=bucket)
    assert wv.main(["--check", "--bucket", BUCKET]) == 1
    assert "FAIL rest_v1.json: no bucket" in capsys.readouterr().out


def test_check_fails_with_no_rest_file(checkable, capsys):
    del checkable.objects[f"{V1}/rest_v1.json"]
    assert wv.main(["--check", "--bucket", BUCKET]) == 1
    assert "FAIL rest_v1.json: unreadable" in capsys.readouterr().out


def test_check_fails_on_a_pass_without_imaged_cells(checkable, capsys):
    manifest = checkable.json(f"{V1}/manifest.json")
    del manifest["passes"][STAR]["imaged_cells"]
    checkable.put_object(Bucket=BUCKET, Key=f"{V1}/manifest.json", Body=json.dumps(manifest))
    assert wv.main(["--check", "--bucket", BUCKET]) == 1
    assert f"FAIL {STAR}: no imaged cells" in capsys.readouterr().out


def test_check_newest_fails_unless_the_rest_is_the_newest_pass(checkable, capsys):
    assert wv.main(["--check", "--newest", "--bucket", BUCKET]) == 1
    assert f"is not the newest on file ({NEWER})" in capsys.readouterr().out
    assert pvr.main(["--newest", "--bucket", BUCKET]) == 0
    assert wv.main(["--check", "--newest", "--bucket", BUCKET]) == 0
    with pytest.raises(SystemExit):
        wv.main(["--newest", "--bucket", BUCKET])


# --- the runtime's prefix --------------------------------------------------------------------------

def test_vessel_cache_prefix_follows_the_variable_only_when_it_is_one(monkeypatch, caplog):
    import vessel_store as vs
    monkeypatch.delenv("VESSEL_CACHE_PREFIX", raising=False)
    assert vs._cache_prefix() == V1
    monkeypatch.setenv("VESSEL_CACHE_PREFIX", V1R)
    assert vs._cache_prefix() == V1R
    for bad in ("vessels/cache/v2", "vessels/cache/v1/../plan", "session_data/x"):
        monkeypatch.setenv("VESSEL_CACHE_PREFIX", bad)
        with caplog.at_level("WARNING"):
            assert vs._cache_prefix() == V1
    assert "not a vessel cache prefix" in caplog.text
    assert vs.CACHE_PREFIX_RE.pattern == bvc.PREFIX_RE.pattern
    assert vs.MANIFEST_KEY == f"{vs.CACHE_PREFIX}/manifest.json"


def test_deploy_passes_the_prefix_only_on_dev():
    text = (Path(bvc.AGENT) / "deploy.sh").read_text()
    assert '"${cache_env[@]}"' in text
    assert 'cache_env=(--env "VESSEL_CACHE_PREFIX=${VESSEL_CACHE_PREFIX}")' in text
    assert '[ "${DEPLOY_TARGET}" != "dev" ]' in text
    assert "^vessels/cache/v1[a-z0-9-]*$" in text
