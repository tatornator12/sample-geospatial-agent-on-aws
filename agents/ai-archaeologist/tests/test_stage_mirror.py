"""The stage prints the measure step's line from its own tables (react-ui/frontend/src/utils/steps.ts),
never from the model's string; those tables mirror the tool, and this test keeps them in step."""
import re
from pathlib import Path

STEPS_TS = Path(__file__).resolve().parents[3] / "react-ui" / "frontend" / "src" / "utils" / "steps.ts"


def _ts_const(name: str) -> str:
    m = re.search(rf"export const {name}\b[^=]*=\s*(.+?);\n", STEPS_TS.read_text(), re.S)
    assert m, f"{name} not found in steps.ts"
    return m.group(1)


def test_the_stage_knows_the_same_four_bearings(tools):
    keys = re.findall(r"'([a-z-]+)':\s*'", _ts_const("BEARING_LABELS"))
    assert keys == list(tools.BEARINGS)


def test_the_stage_knows_which_sites_have_a_verified_line(tools):
    stage = re.findall(r"'([a-z0-9-]+)'", _ts_const("VERIFIED_TRANSECT_SITES"))
    assert stage == sorted(sid for sid, s in tools.catalogue().items() if s.get("transect"))


# The condition survey's rows (decision 10) name sites and word verdicts from utils/survey.ts.
SURVEY_TS = STEPS_TS.with_name("survey.ts")


def _survey_const(name: str) -> str:
    m = re.search(rf"export const {name}\b[^=]*=\s*(.+?);\n", SURVEY_TS.read_text(), re.S)
    assert m, f"{name} not found in survey.ts"
    return m.group(1)


def test_the_survey_rows_name_every_catalogue_site_by_its_first_published_name(tools):
    pairs = re.findall(r"'([a-z0-9-]+)':\s*'([^']+)'", _survey_const("SITE_NAMES"))
    assert dict(pairs) == {sid: s["names"][0] for sid, s in tools.catalogue().items()}


def test_the_survey_rows_know_the_same_verdicts_and_reasons(tools):
    import survey_tools
    body = _survey_const("SURVEY_PAIRS")
    stage = {v: re.findall(r"'([a-z_]+)'", reasons) for v, reasons in re.findall(r"(\w+):\s*\[([^\]]*)\]", body)}
    assert stage == {v: list(b) for v, b in survey_tools.PAIRS.items()}
    words = re.findall(r"^\s*(\w+):", _survey_const("BECAUSE_WORDS"), re.M)
    assert sorted(words) == sorted(survey_tools.BECAUSE)
