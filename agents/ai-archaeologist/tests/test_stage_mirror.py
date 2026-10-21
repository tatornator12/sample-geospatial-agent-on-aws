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
