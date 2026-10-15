"""CFAR on synthetic sea: Sentinel-1-like speckle (gamma-distributed intensity, a few looks) with
targets planted at known places. No network, no files."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cfar  # noqa: E402

LOOKS = 4.4                 # IW GRDH is about 4.4 looks


def sea(h=512, w=512, seed=7, mean_db=-18.0):
    """Speckled sea in dB: intensity ~ Gamma(L, mean/L)."""
    rng = np.random.default_rng(seed)
    mean = 10 ** (mean_db / 10)
    intensity = rng.gamma(LOOKS, mean / LOOKS, size=(h, w))
    return 10 * np.log10(intensity)


def plant(db, row, col, above_db, size=(1, 1)):
    out = db.copy()
    out[row:row + size[0], col:col + size[1]] = np.nanmedian(db) + above_db
    return out


def test_box_sum_matches_brute_force():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(9, 11))
    got = cfar.box_sum(x, 3)
    for r in range(9):
        for c in range(11):
            assert got[r, c] == pytest.approx(x[max(0, r - 1):r + 2, max(0, c - 1):c + 2].sum())
    with pytest.raises(ValueError):
        cfar.box_sum(x, 4)


def test_open_sea_has_no_targets():
    assert cfar.detect(sea(), tile=512) == []


def test_planted_targets_are_found_where_they_are():
    db = plant(sea(), 100, 120, 15.0)                     # a lone bright pixel
    db = plant(db, 300, 400, 13.0, size=(3, 2))           # a small vessel, 3 x 2 px
    found = cfar.detect(db, tile=512)
    assert len(found) == 2
    by_size = sorted(found, key=lambda t: t.px)
    assert (round(by_size[0].row), round(by_size[0].col), by_size[0].px) == (100, 120, 1)
    assert by_size[1].px == 6
    assert by_size[1].row == pytest.approx(301.0) and by_size[1].col == pytest.approx(400.5)
    assert all(t.peak_db >= 6.0 for t in found)
    assert found[0].peak_db >= found[1].peak_db           # strongest first


def test_a_faint_lone_pixel_is_speckle_not_a_target():
    db = plant(sea(), 200, 200, 7.0)                      # above the 6 dB floor, below 8 dB for one pixel
    assert cfar.detect(db, tile=512) == []


def test_a_target_on_a_tile_seam_is_found_once():
    db = plant(sea(), 256, 256, 14.0, size=(2, 2))        # straddles the corner of four 256 px tiles
    found = cfar.detect(db, tile=256)
    assert len(found) == 1
    assert found[0].row == pytest.approx(256.5) and found[0].col == pytest.approx(256.5)
    assert found == cfar.detect(db, tile=4096)            # tiling changes nothing


def test_a_sidelobe_merges_into_the_bright_target_and_a_far_one_stays():
    db = plant(sea(), 250, 250, 28.0, size=(2, 2))        # a platform-bright target
    db = plant(db, 250, 254, 12.0)                        # its ghost, 4 px away, 16 dB fainter
    db = plant(db, 250, 330, 12.0)                        # a real small target, 80 px away
    found = cfar.detect(db, tile=512, guard=11, sidelobe_px=6)
    cols = sorted(round(t.col) for t in found)
    assert cols == [250, 330]


def test_masked_water_and_land_sized_blobs_are_not_targets():
    db = plant(sea(), 100, 100, 15.0)
    valid = np.ones(db.shape, dtype=bool)
    valid[90:110, 90:110] = False                          # the land mask covers it
    assert cfar.detect(db, valid, tile=512) == []
    blob = plant(sea(), 300, 300, 15.0, size=(20, 20))    # 400 px: not a vessel
    assert cfar.detect(blob, tile=512, max_px=200) == []


def test_nodata_is_ignored_and_bad_parameters_refused():
    db = sea()
    db[:, :40] = np.nan                                    # the edge of the swath
    db = plant(db, 200, 41 + 20, 15.0)
    found = cfar.detect(db, tile=512)
    assert [(round(t.row), round(t.col)) for t in found] == [(200, 61)]
    with pytest.raises(ValueError):
        cfar.detect(db, guard=31, train=31)
    with pytest.raises(ValueError):
        cfar.detect(db[0])


def test_too_many_hits_means_no_land_mask():
    # With no threshold, half of a 1024 x 1024 tile is "above its sea": far more than open water has.
    with pytest.raises(ValueError, match="land mask"):
        cfar.detect(sea(1024, 1024), tile=4096, max_px=10**9, floor_db=0.0, k=0.0, single_db=0.0)


def test_amplitude_to_db():
    assert cfar.to_db(np.array([10.0, 100.0])) == pytest.approx([20.0, 40.0])
    assert cfar.to_db(np.array([0.0]))[0] == 0.0          # nodata DN 0 clamps to 1, never -inf
