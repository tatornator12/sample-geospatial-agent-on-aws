"""build_replay_case.py's gates (Oct 23, the bars): a Methane Watch take is rejected without its tip
bars, or with a confirmation and no record bars, or with the bars in the wrong order. Pure: no AWS."""
import json

import build_replay_case as brc

CLOSER = "EMIT sees the methane, not its source."
NARRATIVE = f"**Methane Watch brief: x** (draft `brief-20261023T160345-1836c4`, not filed)\n\nNear X: ... {CLOSER}"
D = "s3://bucket/session_data/eval-x/methane/"


def call(name, **inp):
    return {"name": name, "input": json.dumps(inp)}


def tip_bars():
    return call("display_visual", s3_url=f"{D}tipcolumns_37.7625_53.9324.geojson", render={"kind": "columns", "property": "ppb"})


def record_bars():
    return call("display_visual", s3_url=f"{D}cmcolumns_tan-A.geojson", render={"kind": "columns", "property": "ppm_m"})


def follow(record=True, days=40, latest=True):
    return {"reason": "top_spot_stale_switched", "gap_days": 90,
            "followed": {"area": "south caspian", "rank": 3, "latest": {"date": "2026-08-26", "by": "carbon_mapper"} if latest else None,
                         "days_before_tip": days if latest else None},
            "tip_bars": {"file": "tipcolumns_37.7625_53.9324.geojson"},
            "record_bars": {"by": "carbon_mapper", "date": "2026-08-26", "file": "cmcolumns_tan-A.geojson"} if record else None}


BASE = [call("carbon_mapper_plumes", lat=37.7625, lon=53.9324), call("follow_site", lat=37.7625, lon=53.9324, reason="x")]


def test_a_take_with_both_bar_layers_in_order_is_usable():
    assert brc.take_problems(BASE + [tip_bars(), record_bars()], NARRATIVE, follow(), True) == []
    # No confirmation at all: the tip bars alone are the whole beat.
    assert brc.take_problems(BASE + [tip_bars()], NARRATIVE, follow(record=False, latest=False), True) == []


def test_a_take_without_the_tip_bars_or_with_a_confirmation_and_no_record_bars_is_rejected():
    assert "the recorded mission never showed the tip bars" in brc.take_problems(BASE + [record_bars()], NARRATIVE, follow(), True)
    assert "the recorded mission has a confirmation but never showed its record bars" in \
        brc.take_problems(BASE + [tip_bars()], NARRATIVE, follow(), True)
    assert "the followed site has a confirmation within 90 days but no record bars were built" in \
        brc.take_problems(BASE + [tip_bars()], NARRATIVE, follow(record=False), True)
    assert "the record bars were shown before the tip bars" in \
        brc.take_problems(BASE + [record_bars(), tip_bars()], NARRATIVE, follow(), True)
    # A ppm·m columns layer is not the tip bars, whatever its file is called.
    wrong = call("display_visual", s3_url=f"{D}tipcolumns_37.7625_53.9324.geojson", render={"kind": "columns", "property": "ppm_m"})
    assert "the recorded mission never showed the tip bars" in brc.take_problems(BASE + [wrong, record_bars()], NARRATIVE, follow(), True)
    assert "the recorded mission has no follow decision (follow.json)" in brc.take_problems(BASE + [tip_bars()], NARRATIVE, None, True)


def test_the_older_gates_still_hold():
    window = call("inspect_image", s3_url=f"{D}pass_EMIT_L2B_CH4ENH_003_20260926T040000.tif")
    problems = brc.take_problems([call("follow_site"), tip_bars(), window], "no closer, no brief", follow(record=False, latest=False), True)
    assert "the recorded answer has no spoken closer" in problems and "the recorded mission drafted no brief" in problems
    assert "the recorded mission never checked Carbon Mapper" in problems
    assert "the recorded mission looked at an EMIT window and never showed its 3D columns" in problems
    assert brc.take_problems([], CLOSER, None, False) == []          # the Permian case needs none of this
    assert brc.CASES["watch"]["id"] == "methane-watch-bars"           # never an older case's prefix by default
