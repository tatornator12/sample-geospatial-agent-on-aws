"""The reachable area by water around a synthetic island at the equator. No network."""
import math
import sys
import time
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import reach as rc  # noqa: E402

STEP = 0.01
KM = rc.KM_PER_DEG * STEP           # one cell, km


def open_sea(rows=100, cols=100):
    return rc.WaterGrid(west=-91.0, south=-0.5, step=STEP, water=np.ones((rows, cols), dtype=bool))


def with_wall():
    """A north-south island wall through the middle, open only at its southern end."""
    w = np.ones((100, 100), dtype=bool)
    w[10:100, 50:53] = False
    return rc.WaterGrid(west=-91.0, south=-0.5, step=STEP, water=w)


def test_speed_and_hours_to_km():
    assert rc.reach_km(6, 12) == pytest.approx(133.4, abs=0.1)        # the 2024-03-06 moment
    with pytest.raises(ValueError):
        rc.reach_km(0, 5)


def test_open_water_is_a_disc_of_the_right_size():
    g = open_sea()
    lon, lat = g.centre(50, 50)
    r = rc.by_water(g, lon, lat, max_km=20 * KM)
    assert r.start == (50, 50) and r.snapped_km == 0
    assert r.mask[50, 70] and r.mask[70, 50] and not r.mask[50, 72]
    # 8-connected steps overestimate a diagonal a little, never underestimate it.
    d = r.km[64, 64]
    # (east-west steps shrink with the cosine of the latitude, a few parts in a million here)
    assert 14 * math.sqrt(2) * KM * (1 - 1e-4) <= d <= 14 * 1.09 * math.sqrt(2) * KM


def test_behind_the_island_is_farther_by_water_than_by_air():
    g = with_wall()
    lon, lat = g.centre(80, 40)                     # west of the wall
    r = rc.by_water(g, lon, lat, max_km=400)
    east = g.centre(80, 60)                          # 20 cells east, across the wall
    air = 20 * KM
    water = rc.km_to(r, g, *east)
    assert water is not None and water > 3 * air    # round the southern end and back up
    assert not r.mask[80, 51]                        # never on land
    r2 = rc.by_water(g, lon, lat, max_km=2 * air)
    assert not rc.inside(r2, g, *east)               # in reach by air, out of reach by water


def test_the_reveal_point_inside_or_outside():
    g = open_sea()
    lon, lat = g.centre(50, 50)
    r = rc.by_water(g, lon, lat, max_km=10 * KM)
    assert rc.inside(r, g, *g.centre(55, 55))
    assert not rc.inside(r, g, *g.centre(50, 90))
    assert not rc.inside(r, g, -95.0, 0.0)           # off the grid
    assert rc.km_to(r, g, -95.0, 0.0) is None


def test_a_last_position_on_land_starts_from_the_nearest_water():
    g = with_wall()
    lon, lat = g.centre(60, 51)                      # on the wall
    r = rc.by_water(g, lon, lat, max_km=5 * KM)
    assert g.water[r.start] and r.start in ((60, 49), (60, 53))
    assert 0 < r.snapped_km <= 2.5 * KM
    with pytest.raises(ValueError):
        rc.by_water(g, -95.0, 0.0, 10)


def test_no_corner_cutting_through_land():
    w = np.ones((10, 10), dtype=bool)
    w[5, 4] = False
    w[4, 5] = False                                  # two land cells touching at a corner
    g = rc.WaterGrid(west=0.0, south=0.0, step=STEP, water=w)
    r = rc.by_water(g, *g.centre(4, 4), max_km=100)
    assert r.km[5, 5] > math.sqrt(2) * KM + 1e-9     # it must go round, not through the corner


def test_the_radar_box_runs_in_seconds():
    g = rc.WaterGrid(west=-94.0, south=-2.5, step=STEP, water=np.ones((500, 600), dtype=bool))
    t0 = time.time()
    r = rc.by_water(g, *g.centre(250, 300), max_km=133.4)
    assert time.time() - t0 < 10 and r.mask.sum() > 10_000
