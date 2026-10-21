"""The replay-case tooling in scripts/: what a recorded case says the agent saw (replay_case), the
words it shows in the house style, the Earth builder's layer order, and the numbers check
(replay_numbers) that every figure a case shows came from the tools."""
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_earth_replay_case as earth  # noqa: E402
import replay_case  # noqa: E402
import replay_numbers  # noqa: E402


def call(tool_id: str, name: str, **inp) -> str:
    return json.dumps({"toolUseId": tool_id, "name": name, "input": inp})


def test_saw_is_the_prose_after_each_look_until_the_next_call():
    text = (call("t1", "get_rasters") + "Fetched." + call("t2", "inspect_image", title="a")
            + "The hillsides are burnt grey. Now computing NBR." + call("t3", "run_bandmath")
            + call("t4", "inspect_image") + call("t5", "display_visual"))
    saw = replay_case.saw_by_tool(text)
    assert saw == {"t2": "The hillsides are burnt grey. Now computing NBR."}  # t4: nothing said


def test_looks_taken_together_split_a_list_of_the_same_length_in_order():
    text = (call("a", "inspect_image") + call("b", "inspect_image")
            + "Both are clear:\n- **West Point:** dense canopy by the river.\n- **Lake George:** a town by a lake.\n"
            + call("c", "display_visual"))
    assert replay_case.saw_by_tool(text) == {"a": "**West Point:** dense canopy by the river.",
                                             "b": "**Lake George:** a town by a lake."}
    # Not one item per look: the whole block stays with the last look, as the live stage shows it.
    text = call("a", "inspect_image") + call("b", "inspect_image") + "Both are clear and green." + call("c", "x")
    assert replay_case.saw_by_tool(text) == {"b": "Both are clear and green."}


def test_house_style_drops_em_and_en_dashes():
    assert replay_case.house_style("Central Park \u2014 Example Area") == "Central Park, Example Area"
    assert replay_case.house_style("1910\u20132025") == "1910 to 2025"
    assert replay_case.house_style("| \u2014 |") == "| |"
    styled = replay_case.styled_params({"title": "A \u2014 B", "s3_url": "s3://x/a\u2014b.tif", "radius_meters": 640})
    assert styled == {"title": "A, B", "s3_url": "s3://x/a\u2014b.tif", "radius_meters": 640}


def test_earth_layers_after_index_and_after_scene_on_top():
    files = ["point_bbox_x.geojson", "tci_clipped_x_2024-11-08.tif", "tci_clipped_x_2025-01-12.tif",
             "nbr_clipped_x_2025-01-12.tif", "nbr_clipped_x_2024-11-08.tif",
             "change_detection_x_2024-11-08_to_2025-01-12.tif"]
    ordered = [l["file"] for l in sorted(({"file": f} for f in files), key=earth.layer_order)]
    assert ordered == ["change_detection_x_2024-11-08_to_2025-01-12.tif", "nbr_clipped_x_2024-11-08.tif",
                       "nbr_clipped_x_2025-01-12.tif", "tci_clipped_x_2025-01-12.tif",
                       "tci_clipped_x_2024-11-08.tif", "point_bbox_x.geojson"]


def sources(*calls):
    return replay_numbers.Sources([{"n": i + 1, **c} for i, c in enumerate(calls)])


def text_result(obj) -> list:
    return [{"text": json.dumps(obj)}]


def test_a_figure_matches_a_tool_number_at_its_shown_precision_and_units():
    src = sources({"name": "run_bandmath", "input": {"date_str": "2025-01-12"},
                   "result": text_result({"high_severity_area_m2": 81475200.0, "high_severity_percentage": 31.9165})},
                  {"name": "calculate_environmental_impact", "input": {}, "result": text_result({"burn_co2_tons": 691.09})})
    assert src.match("8,147.5")  # m² to ha
    assert src.match("81.5")  # m² to km²
    assert src.match("31.9")
    assert src.match("691")
    assert src.match("20,100") is not None  # 81475200 m² = 20,133 acres, at the shown hundreds
    assert src.match("46.1") is None
    assert src.dates.get("2025-01-12")


def test_free_text_inputs_and_the_brief_are_not_sources():
    src = sources({"name": "display_visual", "input": {"title": "Burn 96 km²"}, "result": text_result({"status": "ok"})},
                  {"name": "draft_brief", "input": {"observations": ["peak 5121.5"]}, "result": text_result({"markdown": "5121.5"})})
    assert src.match("96") is None
    assert src.match("5,121.5") is None


def test_figures_skip_identifiers_list_markers_code_and_prompt_years():
    found = replay_numbers.figures(
        "1. Sentinel-2 and Clay v1.5 over 3D columns, `brief-20261021T214447-82c95f`, January 2025: "
        "46.1 km² on 20 January 2025, last look 2026-08-17, open since January 1, 2025, built 1910 to 2025.",
        {"2025"})
    assert ("number", "46.1") in found
    assert ("date", "2025-01-20") in found and ("date", "2026-08-17") in found and ("date", "2025-01-01") in found
    assert ("year", "1910") in found
    assert not any(tok in ("2", "1.5", "3", "1") for _, tok in found)
    assert ("month", "2025-01") not in found  # "January 2025" is the prompt's own month
    # A gallery label's "Jan 12" is a day some tool date must fall on.
    assert replay_numbers.figures("High severity, Jan 12", set()) == [("monthday", "-01-12")]


def test_a_year_and_month_in_a_result_is_a_month_the_room_may_hear():
    src = sources({"name": "find_similar_places", "input": {},
                   "result": text_result({"summary": {"year": 2025, "month": 7, "cells_compared": 190329}})})
    assert src.dates.get("2025-07")
    assert src.match("190,329")
