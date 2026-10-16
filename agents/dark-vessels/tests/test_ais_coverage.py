"""The coverage rule (design decision 3) on synthetic traffic near the equator, and the drawn shape's
agreement with it. No network."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from shapely.geometry import Point, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ais_coverage as cv  # noqa: E402
from predict import Grid  # noqa: E402

PASS = datetime(2026, 10, 12, 0, 17, tzinfo=timezone.utc)
H0 = PASS.replace(minute=0)                                     # the pass's own hour
GRID = Grid(west=-91.0, south=-1.0, east=-89.0, north=1.0, step=0.05)   # 40 x 40 cells
KM = cv.KM_PER_DEG                                              # km per degree at the equator


def fix(lon, lat, hours=0):
    return cv.Fix(lon, lat, H0 + timedelta(hours=hours))


def centre(r, c):
    return GRID.west + (c + 0.5) * GRID.step, GRID.south + (r + 0.5) * GRID.step


def test_two_vessels_in_the_same_hour_make_the_water_heard():
    heard = cv.heard_cells([fix(-90.0, 0.0), fix(-89.95, 0.02)], GRID, PASS)
    r, c = GRID.cell(-90.0, 0.0)
    assert heard[r, c]
    assert not heard[0, 0]                                       # more than 30 km from both
    # Every heard cell's centre is within 30 km of both vessels.
    for rr, cc in zip(*np.nonzero(heard)):
        lon, lat = centre(rr, cc)
        for v in ((-90.0, 0.0), (-89.95, 0.02)):
            assert np.hypot((lon - v[0]) * KM, (lat - v[1]) * KM) <= 30.0 + 1e-6


def test_one_vessel_is_never_enough_even_every_hour():
    fixes = [fix(-90.0, 0.0, h) for h in range(-3, 4)]
    assert not cv.heard_cells(fixes, GRID, PASS).any()


def test_the_same_vessel_twice_in_an_hour_counts_once():
    rows = [("a", H0 + timedelta(minutes=5), -90.0, 0.0), ("a", H0 + timedelta(minutes=40), -89.98, 0.0)]
    fixes = cv.fixes_from_tracks(rows, PASS)
    assert fixes == [cv.Fix(-90.0, 0.0, H0)]                     # its first position that hour, no key
    assert not cv.heard_cells(fixes, GRID, PASS).any()
    # A second vessel that hour does make it heard.
    fixes = cv.fixes_from_tracks(rows + [("b", H0 + timedelta(minutes=10), -90.01, 0.01)], PASS)
    assert len(fixes) == 2 and cv.heard_cells(fixes, GRID, PASS).any()


def test_two_vessels_in_different_hours_are_not_proof():
    fixes = [fix(-90.0, 0.0, -1), fix(-90.0, 0.0, 1)]
    assert not cv.heard_cells(fixes, GRID, PASS).any()


def test_the_30_km_edge():
    r, c = 20, 20
    lon, lat = centre(r, c)
    near = [fix(lon + 29.9 / KM, lat), fix(lon - 29.9 / KM, lat)]
    far = [fix(lon + 30.1 / KM, lat), fix(lon - 30.1 / KM, lat)]
    assert cv.heard_cells(near, GRID, PASS)[r, c]
    assert not cv.heard_cells(far, GRID, PASS)[r, c]


def test_the_three_hour_edge():
    pair = lambda t: [cv.Fix(-90.0, 0.0, t), cv.Fix(-90.01, 0.0, t)]  # noqa: E731
    assert cv.heard_cells(pair(PASS - timedelta(hours=3)), GRID, PASS).any()
    assert cv.heard_cells(pair(PASS + timedelta(hours=3)), GRID, PASS).any()
    assert not cv.heard_cells(pair(PASS - timedelta(hours=3, minutes=1)), GRID, PASS).any()
    rows = [("a", PASS + timedelta(hours=3, minutes=1), -90.0, 0.0), ("b", PASS + timedelta(hours=3, minutes=1), -90.01, 0.0)]
    assert cv.fixes_from_tracks(rows, PASS) == []


def test_water_mask_and_share():
    water = np.zeros(GRID.shape, dtype=bool)
    water[:, :20] = True                                         # the western half is the reserve
    heard = cv.heard_cells([fix(-90.0, 0.0), fix(-90.0, 0.01)], GRID, PASS, water=water)
    assert not heard[:, 20:].any() and heard[:, :20].any()
    assert cv.heard_share(heard, water) == heard.sum() / water.sum()
    assert cv.heard_share(heard, np.zeros(GRID.shape, dtype=bool)) == 0.0
    r, c = GRID.cell(-90.03, 0.0)
    assert cv.is_heard(heard, GRID, -90.03, 0.0) == bool(heard[r, c])
    assert not cv.is_heard(heard, GRID, -95.0, 0.0)              # off the grid


def block():
    heard = np.zeros(GRID.shape, dtype=bool)
    heard[10:20, 10:20] = True                                   # a 0.5 deg square of heard water
    heard[14, 20] = True                                         # and one heard cell sticking out
    return heard


def test_the_drawn_shape_is_one_rounded_piece_inside_the_reserve():
    heard = block()
    reserve = box(-91.0, -1.0, -89.6, 1.0)
    g = cv.drawn_shape(heard, GRID, within=reserve)
    assert g.geom_type == "Polygon" and not g.interiors          # no seams, no holes
    assert reserve.covers(g)
    cells = box(*GRID.bounds(10, 10, size=10))
    assert abs(g.area - cells.area) / cells.area < 0.05         # rounding moves the edge, not the area


def test_agree_puts_back_and_cuts_the_targets_own_cells():
    heard = block()
    g = cv.drawn_shape(heard, GRID)
    w, s, e, n = GRID.bounds(10, 10, size=10)
    corner = (w + 0.002, s + 0.002)                              # heard cell, rounded off the drawing
    stub = centre(14, 20)                                        # the lone heard cell, opened away
    notch = (e + 0.01, GRID.south + 15 * GRID.step + 0.001)      # unproven, just outside the block
    g2 = g.union(box(e, s, e + 0.03, n))                         # pretend closing spilled over it
    targets = [corner, stub, notch, centre(15, 15)]
    assert set(cv.disagreements(g2, heard, GRID, targets)) >= {corner, notch}
    m = cv.agree(g2, heard, GRID, targets)
    assert cv.disagreements(m.shape, heard, GRID, targets) == []
    assert GRID.cell(*corner) in m.added and GRID.cell(*notch) in m.removed
    assert m.shape.covers(Point(*corner)) and not m.shape.covers(Point(*notch))
    assert cv.agree(m.shape, heard, GRID, targets).added == ()   # already agrees: nothing changes


def test_nothing_heard_draws_nothing():
    g = cv.drawn_shape(np.zeros(GRID.shape, dtype=bool), GRID)
    assert g.is_empty
    m = cv.agree(g, np.zeros(GRID.shape, dtype=bool), GRID, [(-90.0, 0.0)])
    assert m.shape.is_empty and m.added == () and m.removed == ()
