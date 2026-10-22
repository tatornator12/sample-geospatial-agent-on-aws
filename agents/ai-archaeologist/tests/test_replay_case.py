"""The replay builder's survey case (decision 10): the stage's plates word for word, the golden case it
must pass, and the verdict files it copies by each call's own id."""
import importlib
import re
from pathlib import Path

STAGE_COPY = Path(__file__).resolve().parents[3] / "react-ui" / "frontend" / "src" / "utils" / "stageCopy.ts"


def _builder():
    return importlib.import_module("build_replay_case")


def test_the_survey_case_records_the_two_plates_and_must_pass_like_this():
    b = _builder()
    case = b.CASES["survey"]
    assert case["id"] == "archaeologist-survey" and b.CASE_ID_RE.fullmatch(case["id"])
    plates = re.findall(r"prompt: '([^']+)'", STAGE_COPY.read_text().split("archaeologist: {", 1)[1].split("vessels: {", 1)[0])
    assert case["setup"] == plates[0] and case["prompt"] == plates[1]
    golden = b.golden_case(case["golden"])
    assert golden["setup_prompt"] == case["setup"] and golden["prompt"] == case["prompt"]
    assert "record_condition" in golden["expected_tools"]


def test_a_verdict_file_is_named_by_its_calls_own_id():
    b = _builder()
    assert b.survey_name({"name": "record_condition", "toolUseId": "tooluse_Ab-1"}) == "survey_tooluse_Ab-1.json"
    assert b.FILE_RE.match(b.survey_name({"name": "record_condition", "toolUseId": "tooluse_Ab-1"}))
    for bad in ({"name": "record_condition", "toolUseId": "../x"}, {"name": "record_condition"},
                {"name": "inspect_image", "toolUseId": "tooluse_1"}):
        assert b.survey_name(bad) is None
    assert b.RESULTS["record_condition"] == "Verdict recorded"
