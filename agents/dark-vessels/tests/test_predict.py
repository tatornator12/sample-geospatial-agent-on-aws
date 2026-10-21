"""The hotspot map and its check, on synthetic history: dark targets that keep coming back to two
fishing grounds, plus noise spread over the water. No network."""
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import predict as p  # noqa: E402

GRID = p.Grid(west=-92.0, south=-1.0, east=-90.0, north=1.0, step=0.1)     # 20 x 20 cells
GROUNDS = [(-91.55, 0.35), (-90.45, -0.65)]


def history(seed=3, years=(2023, 2024, 2025, 2026), per_year=60, noise=20):
    rng = np.random.default_rng(seed)
    out = []
    for y in years:
        for i in range(per_year):
            lon, lat = GROUNDS[i % 2]
            out.append(p.Detection(lon + rng.normal(0, 0.03), lat + rng.normal(0, 0.03), date(y, 1, 1) + timedelta(days=int(rng.integers(0, 300)))))
        for _ in range(noise):
            out.append(p.Detection(rng.uniform(-92, -90), rng.uniform(-1, 1), date(y, 6, 1)))
    return out


def test_grid_cells_and_bounds():
    assert GRID.shape == (20, 20)
    assert GRID.cell(-92.0, -1.0) == (0, 0)
    assert GRID.cell(-90.05, 0.95) == (19, 19)
    assert GRID.cell(-89.99, 0.0) is None and GRID.cell(-91.0, 1.0) is None
    assert GRID.bounds(19, 0) == (-92.0, 0.9, -91.9, 1.0)
    assert GRID.bounds(0, 0, size=3) == (-92.0, -1.0, -91.7, -0.7)


def test_surface_counts_by_window_and_spreads():
    dets = [p.Detection(-91.95, -0.95, date(2024, 5, 1), 2), p.Detection(-91.95, -0.95, date(2026, 1, 1))]
    assert p.surface(dets, GRID).sum() == 3
    assert p.surface(dets, GRID, before=date(2026, 1, 1)).sum() == 2
    assert p.surface(dets, GRID, after=date(2026, 1, 1)).sum() == 1
    spread = p.surface(dets, GRID, spread=1)
    assert spread[0, 0] == pytest.approx(3 / 9) and spread[1, 1] == pytest.approx(3 / 9) and spread[2, 2] == 0
    water = np.ones(GRID.shape, dtype=bool)
    water[0, 0] = False
    assert p.surface(dets, GRID, water=water).sum() == 0


def test_the_map_predicts_the_held_out_year_far_better_than_chance():
    checks = p.backtest(history(), GRID, cut=date(2026, 1, 1))
    by = {c.share: c for c in checks}
    assert by[0.01].total == 80                                    # 60 on the grounds + 20 noise in 2026
    assert by[0.05].hit > 0.6 and by[0.05].lift > 10               # the grounds are in the top 5%
    assert all(c.held <= c.total for c in checks)
    assert [c.held for c in checks] == sorted(c.held for c in checks)   # more water never holds less
    assert by[0.10].as_dict()["share_of_water"] == 0.10


def test_with_no_pattern_the_check_says_chance():
    rng = np.random.default_rng(11)
    flat = [p.Detection(rng.uniform(-92, -90), rng.uniform(-1, 1), date(2023 + int(i % 4), 3, 1)) for i in range(4000)]
    by = {c.share: c for c in p.backtest(flat, GRID, cut=date(2026, 1, 1))}
    assert 0.5 < by[0.10].lift < 1.6


def test_top_mask_takes_the_share_of_the_water_only():
    score = np.arange(400, dtype=float).reshape(20, 20)
    water = np.zeros((20, 20), dtype=bool)
    water[:10] = True                                              # the north half is land
    m = p.top_mask(score, 0.1, water)
    assert m.sum() == 20 and not (m & ~water).any()
    assert m[9].all()                                              # the best water row


def test_the_rolling_check_holds_the_grounds_far_better_than_chance():
    dets = history()
    rc = p.rolling_check(dets, GRID, since=date(2026, 1, 1), until=date(2027, 1, 1), box_cells=3)
    days_2026 = {d.day for d in dets if d.day.year == 2026}
    assert rc.days == len(days_2026) and rc.total == 80                 # every 2026 dark target, day by day
    assert rc.hit > 0.6 and rc.lift > 10 and rc.days_hit > rc.days / 2
    # The boxes' own figure: drawn from each day's refit, a smaller share of water, a record of its own.
    assert rc.boxes_share == pytest.approx(27 / 400) and rc.boxes_held > 0 and rc.boxes_lift > 10   # three 3 x 3 boxes
    assert 0 < rc.boxes_days_hit <= rc.days
    d = rc.as_dict()
    assert {"held", "total", "days", "days_hit", "lift", "boxes_held", "boxes_days_hit", "boxes_lift"} <= set(d)


def test_with_no_pattern_the_rolling_check_says_chance():
    rng = np.random.default_rng(11)
    flat = [p.Detection(rng.uniform(-92, -90), rng.uniform(-1, 1), date(2023, 1, 1) + timedelta(days=int(rng.integers(0, 1460))))
            for _ in range(6000)]
    rc = p.rolling_check(flat, GRID, since=date(2026, 7, 1), until=date(2026, 10, 1), share=0.10, box_cells=3)
    assert rc.total > 300 and 0.5 < rc.lift < 1.6 and rc.boxes_lift < 3


def test_each_refit_is_the_maps_own_fit_on_everything_before_the_day():
    dets = history(per_year=20, noise=6)
    since, until = date(2026, 3, 1), date(2026, 9, 1)
    rc = p.rolling_check(dets, GRID, since=since, until=until, spread=1)
    held = total = days = 0
    for day in sorted({d.day for d in dets if since <= d.day < until}):
        score = p.surface(dets, GRID, before=day, spread=1)
        today = p.surface(dets, GRID, before=day + timedelta(days=1), after=day)
        held += int(round(today[p.top_mask(score, 0.05)].sum()))
        total += int(round(today.sum()))
        days += 1
    assert (rc.held, rc.total, rc.days) == (held, total, days)
    empty = p.rolling_check(dets, GRID, since=date(2030, 1, 1), until=date(2030, 2, 1))
    assert (empty.days, empty.total, empty.lift, empty.boxes_lift) == (0, 0, 0.0, 0.0)


def test_the_rolling_check_is_quick_at_the_real_size():
    """The live cache: about 400 dark rows since 2023 and 16 to 20 radar days in the window, on the
    reserve's 0.05 deg grid (90 x 83). One check is about 20 refits, each with patrol_boxes."""
    import time
    grid = p.Grid(west=-92.7, south=-2.1, east=-88.55, north=2.4, step=0.05)
    water = np.ones(grid.shape, dtype=bool)
    water[:10] = False
    rng = np.random.default_rng(5)
    dets = [p.Detection(float(rng.uniform(-92.6, -88.6)), float(rng.uniform(-1.5, 2.3)),
                        date(2023, 1, 1) + timedelta(days=int(rng.integers(0, 1380)))) for _ in range(360)]
    dets += [p.Detection(float(rng.uniform(-91.0, -90.0)), float(rng.uniform(-1.0, 0.0)), date(2026, 7, 1) + timedelta(days=5 * k))
             for k in range(20) for _ in range(2)]
    t0 = time.perf_counter()
    rc = p.rolling_check(dets, grid, since=date(2026, 7, 1), until=date(2026, 10, 13), spread=1, water=water, box_cells=4)
    elapsed = time.perf_counter() - t0
    assert rc.days >= 20 and elapsed < 1.0, f"{rc.days} radar days in {elapsed:.2f} s"


def test_patrol_boxes_take_the_grounds_without_overlap():
    score = p.surface(history(), GRID, before=date(2026, 1, 1))
    boxes = p.patrol_boxes(score, GRID, size=3, k=3)
    assert len(boxes) == 3
    first, second = boxes[0], boxes[1]
    for (lon, lat) in GROUNDS:
        assert any(b.bounds[0] <= lon <= b.bounds[2] and b.bounds[1] <= lat <= b.bounds[3] for b in boxes[:2])
    assert first.share_of_history >= second.share_of_history >= boxes[2].share_of_history
    assert first.share_of_history + second.share_of_history > 0.7

    def overlap(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
    assert not any(overlap(a.bounds, b.bounds) for i, a in enumerate(boxes) for b in boxes[i + 1:])
    assert p.patrol_boxes(np.zeros(GRID.shape), GRID, size=3) == []
