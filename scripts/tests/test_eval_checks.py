"""scripts/eval.py's closing paragraph on synthetic streams: a closer streamed straight after a tool
call is read alone (the four-turn draft-tasking flake, Oct 21). No AWS."""
import json

import eval as ev

OCT12 = "s1d-20261012t0018"
CLOSER = "Candidates are a reason to look, not accusations."


def call(tid: str, name: str, **inp) -> str:
    """One tool use as the runtime streams it: the input is escaped JSON text."""
    return json.dumps({"toolUseId": tid, "name": name, "input": json.dumps(inp)})


def test_the_closing_paragraph_after_a_tool_call_is_read_alone():
    """The Oct 21 flake: the draft turn's answer streamed straight after draft_tasking's JSON, so the
    whole-stream split read a 298-character 'closer' for a 165-character answer."""
    answer = ("The draft covers box 1, all four candidates from the Oct 12 pass, timed to the next radar look at "
              "S1-D Oct 24 00:17 UTC. The decision is the officer's; I only draft.")
    text = call("toolu_1", "draft_tasking", pass_id=OCT12, box=1) + answer
    assert len(answer) == 165 and ev.closing_paragraph(text) == answer
    # The old split joined the tool JSON to the sentence.
    old = [p.strip() for p in text.strip().split("\n\n") if p.strip()][-1]
    assert len(old) > 240
    # A provocation (no tool) and a closer before a trailing call still read as before.
    assert ev.closing_paragraph(f"I don't accuse vessels.\n\n{CLOSER}") == CLOSER
    assert ev.closing_paragraph(f"Done.\n\n{CLOSER}" + call("t9", "display_visual", s3_url="x")) == CLOSER
