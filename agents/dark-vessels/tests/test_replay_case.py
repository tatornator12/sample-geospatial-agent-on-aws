"""The replay case builder (redesign §3.10, U11, R8.2): every refusal on synthetic streams, the case's
layout (what is copied and where), config.json keeping the tool-use ids and decide's inputs, and the
builder's copies of the agent's rules pinned to the agent's own. No network, no AWS."""
import json
from pathlib import Path

import pytest

import build_replay_case as rc

REPO = Path(__file__).resolve().parents[3]
BUCKET = "test-bucket"
SID = "eval-11111111-2222-3333-4444-555555555555-abcdef12"
SESSION = f"session_data/{SID}/"
URL = f"s3://{BUCKET}/{SESSION}"
P = "s1d-20261012t0018"
QID = "bd152a0f51d3"
CLOSING = "The decision is the officer's; I only draft. Candidates are a reason to look, not accusations."
ANSWER = "\n\n".join([
    "4 candidates on the Oct 12 pass; I drafted box 1 for the next look.",
    "- Read Oct 12 (19% checkable); data from Global Fishing Watch.\n- Candidates T01, T02, T03 and T04: 9 to 41 km from port.",
    "A candidate is a radar target with no broadcast nearby; it is not an accusation.",
    CLOSING,
])


def shown(tid, file, title, render):
    return (tid, "display_visual", {"s3_url": f"{URL}vessels/{file}", "title": title, "render": render})


CLEAN = [
    ("t_list", "list_passes", {}),
    ("t_read", "decide", {"step": "read_pass", "because": "newest_wide", "pass_id": P}),
    ("t_find", "find_pass", {"when": P}),
    ("t_look_radar", "inspect_image", {"s3_url": f"{URL}vessels/radar_{P}.tif", "title": "Radar, Oct 12",
                                       "question": "What does the radar swath show over the reserve?"}),
    shown("t_dv_radar", f"radar_{P}.tif", "Radar, Oct 12", {"kind": "raster", "group": "maritime", "legend": "Radar backscatter"}),
    ("t_detect", "detect_vessels", {"pass_id": P}),
    shown("t_dv_targets", f"targets_{P}.geojson", "Radar targets", {"kind": "points", "group": "maritime"}),
    ("t_cover", "check_ais_coverage", {"pass_id": P}),
    shown("t_dv_heard", f"heard_{P}.geojson", "AIS received", {"kind": "vector", "group": "maritime"}),
    shown("t_dv_unproven", f"unproven_{P}.geojson", "AIS reception unknown", {"kind": "vector", "group": "maritime"}),
    ("t_match", "match_ais", {"pass_id": P}),
    shown("t_dv_targets2", f"targets_{P}.geojson", "Radar targets", {"kind": "points", "group": "maritime"}),
    ("t_evidence", "gather_evidence", {"pass_id": P}),
    ("t_chip", "inspect_image", {"s3_url": f"{URL}vessels/chips/{P}_T04.tif", "title": "Candidate T04 chip, Oct 12"}),
    ("t_hot", "predict_hotspots", {"pass_id": P}),
    shown("t_dv_heat", "hotspots.geojson", "Dark targets seen before", {"kind": "points", "group": "maritime", "property": "v"}),
    shown("t_dv_boxes", "boxes.geojson", "Patrol boxes", {"kind": "vector", "group": "maritime", "label": "label"}),
    ("t_draft", "decide", {"step": "draft", "because": "most_past_targets", "box": 1}),
    ("t_next", "next_look", {"box": 1}),
    shown("t_dv_look", "look_1_2026-10-24T00.geojson", "Next radar look", {"kind": "vector", "group": "maritime"}),
    ("t_task", "draft_tasking", {"pass_id": P, "box": 1, "notes": ["Four candidates seen on the Oct 12 pass, one near this box."]}),
]
FILES = {"passes_t_list.json", f"decision_{QID}_t_read.json", f"decision_{QID}_t_draft.json"}


def stream(calls=CLEAN, answer=ANSWER) -> str:
    """A runtime stream: a sentence, then the calls (each as the stage receives it), then the answer."""
    parts = ["Reading the passes on file."]
    for tid, name, inp in calls:
        parts.append(json.dumps({"toolUseId": tid, "name": name, "input": json.dumps(inp)}))
    return "\n".join(parts) + "\n\n" + answer


def without(*ids):
    return [c for c in CLEAN if c[0] not in ids]


def replaced(tid, **inp):
    return [(t, n, {**i, **inp}) if t == tid else (t, n, i) for t, n, i in CLEAN]


# --- the refusals ----------------------------------------------------------------------------------------

def test_a_clean_take_is_a_usable_case():
    assert rc.refusals(stream(), FILES, set(), QID) == []


@pytest.mark.parametrize("text,files,refused,why", [
    # A word that accuses or identifies, in the answer or in a tool's inputs.
    (stream(answer=ANSWER.replace("4 candidates", "4 poachers")), FILES, set(), "a word that accuses ('poachers')"),
    (stream(replaced("t_task", notes=["Heard as MMSI 123456789 before."])), FILES, set(), "an identifier ('MMSI')"),
    (stream(answer=ANSWER.replace("Candidates T01", "Candidate 412345678 and T01")), FILES, set(), "an identifier ('412345678')"),
    # An em dash in the answer.
    (stream(answer=ANSWER.replace("; I drafted", " \u2014 I drafted")), FILES, set(), "an em dash in the answer"),
    # match_ais with no coverage check of its pass before it.
    (stream(without("t_cover")), FILES, set(), f"match_ais on {P} with no check_ais_coverage of it before"),
    (stream(replaced("t_cover", pass_id="s1d-20260907t1141")), FILES, set(), f"match_ais on {P} with no check_ais_coverage of it before"),
    # No decide at all.
    (stream(without("t_read", "t_draft")), {"passes_t_list.json"}, set(), "no decide"),
    # A streamed decide with no file and no refusal in the transcript (or the transcript unread).
    (stream(), FILES - {f"decision_{QID}_t_draft.json"}, set(), "decide t_draft streamed with no file and no refusal in the transcript"),
    (stream(), FILES - {f"decision_{QID}_t_draft.json"}, None, "decide t_draft streamed with no file and no refusal in the transcript"),
    # detect_vessels or draft_tasking with no accepted decision before it.
    (stream(), FILES - {f"decision_{QID}_t_read.json"}, {"t_read"}, f"detect_vessels on {P} with no accepted read_pass before it"),
    (stream(replaced("t_read", pass_id="s1d-20260930t0018")), FILES, set(), f"detect_vessels on {P} with no accepted read_pass before it"),
    (stream(), FILES - {f"decision_{QID}_t_draft.json"}, {"t_draft"}, "draft_tasking of box 1 with no accepted draft decision before it"),
    (stream(replaced("t_task", box=2)), FILES, set(), "draft_tasking of box 2 with no accepted draft decision before it"),
    # Neither draft_tasking nor decide(stop).
    (stream(without("t_task")), FILES, set(), "neither draft_tasking nor decide(stop)"),
    # No candidate sentence, or no closer at the end.
    (stream(answer=ANSWER.replace("A candidate is a radar target with no broadcast nearby; it is not an accusation.", "Each is a lead.")),
     FILES, set(), "no candidate sentence"),
    (stream(answer=ANSWER.replace(CLOSING, "The decision is the officer's; I only draft.")), FILES, set(), "no closer"),
    (stream(answer=ANSWER + "\n\nAsk me about the boxes."), FILES, set(), "no closer"),
], ids=["accuses", "identifier-in-notes", "nine-digits-in-answer", "em-dash", "match-before-coverage",
        "coverage-of-another-pass", "no-decide", "decide-no-file", "decide-no-transcript", "detect-undecided",
        "detect-another-pass", "draft-refused", "draft-another-box", "no-ending", "no-candidate-sentence",
        "closer-missing", "closer-not-last"])
def test_every_refusal_says_why(text, files, refused, why):
    assert why in rc.refusals(text, files, refused, QID)


def test_a_refused_decide_in_the_transcript_is_part_of_a_usable_take():
    """The gate working (a refusal, then the model decides again) is the honest take, not a broken one."""
    early = ("t_early", "decide", {"step": "read_pass", "because": "newest", "pass_id": P})
    assert rc.refusals(stream([CLEAN[0], early] + CLEAN[1:]), FILES, {"t_early"}, QID) == []
    # With no board (no question id) no decision file can be named, so every decide is unaccounted for.
    assert "decide t_read streamed with no file and no refusal in the transcript" in rc.refusals(stream(), FILES, set(), None)


def test_a_stop_take_ends_but_has_no_candidate_sentence():
    """The stop ending is an ending; its answer carries no candidate sentence (prompt ANSWER block), so
    the builder refuses it and the question is recorded again for a draft take."""
    stop = without("t_draft", "t_next", "t_dv_look", "t_task") + [("t_stop", "decide", {"step": "stop", "because": "no_checked_pass"})]
    answer = "No pass I read could be checked, so there is no tasking.\n\n- Aug 30 (10% checkable).\n\nCandidates are a reason to look, not accusations."
    why = rc.refusals(stream(stop, answer), FILES | {f"decision_{QID}_t_stop.json"}, set(), QID)
    assert why == ["no candidate sentence"]


# --- what the case copies, and where -----------------------------------------------------------------------

KEYS = [f"{SESSION}vessels/{n}" for n in (
    f"radar_{P}.tif", f"targets_{P}.geojson", f"heard_{P}.geojson", f"unproven_{P}.geojson", "hotspots.geojson",
    "boxes.geojson", "look_1_2026-10-24T00.geojson", "hotspots.json", "passes_t_list.json", f"decision_{QID}_t_read.json",
    f"decision_{QID}_t_draft.json", f"chips/{P}_T04.tif", f"chips/{P}_T01.tif", f"coverage_{P}.json", f"match_{P}.json",
    f"evidence_{P}.json", "question.json", f"decision_0123456789ab_t_read.json")] + [
    f"{SESSION}inspections/radar_{P}.png", f"{SESSION}inspections/{P}_T04.png",
    f"{SESSION}taskings/tasking-20261021T225418-f15d06.draft.json", f"{SESSION}taskings/tasking-20261021T225500-aaaaaa.draft.json",
    "session_data/another-session/vessels/hotspots.json"]


def test_the_case_is_laid_out_as_the_sessions_vessels_folder():
    copied = rc.wanted(rc.extract_tool_calls(stream()), KEYS, SESSION, QID)
    assert sorted(copied.values()) == sorted([
        f"radar_{P}.tif", f"targets_{P}.geojson", f"heard_{P}.geojson", f"unproven_{P}.geojson", "hotspots.geojson",
        "boxes.geojson", "look_1_2026-10-24T00.geojson", "hotspots.json", "passes_t_list.json",
        f"decision_{QID}_t_read.json", f"decision_{QID}_t_draft.json", f"chips/{P}_T04.tif",
        f"inspections/radar_{P}.png", f"inspections/{P}_T04.png", "tasking-20261021T225500-aaaaaa.draft.json"])
    # Not the records the stage never reads, a chip nobody inspected, another question's decision, or another session.
    assert not any(k.endswith(("question.json", f"match_{P}.json", f"coverage_{P}.json", f"{P}_T01.tif")) for k in copied)
    assert "session_data/another-session/vessels/hotspots.json" not in copied
    assert rc.case_name(f"{SESSION}vessels/../x.json", SESSION) is None
    assert rc.case_name(f"{SESSION}taskings/x/tasking-20261021T225418-f15d06.draft.json", SESSION) is None


def test_config_keeps_the_tool_use_ids_and_decides_inputs_and_lists_the_map_in_order():
    calls = rc.extract_tool_calls(stream([CLEAN[0], ("t_early", "decide", {"step": "read_pass", "because": "newest", "pass_id": P})] + CLEAN[1:]))
    copied = rc.wanted(calls, KEYS, SESSION, QID)
    config = rc.config_for(calls, copied, {"t_early"}, rc.CASE_ID, "dark_vessels_dev")
    tool_calls = config["tool_calls"]
    assert [c["id"] for c in tool_calls] == [c["toolUseId"] for c in calls]
    decides = [c for c in tool_calls if c["name"] == "decide"]
    assert [c["params"] for c in decides] == [
        {"step": "read_pass", "because": "newest", "pass_id": P},
        {"step": "read_pass", "because": "newest_wide", "pass_id": P},
        {"step": "draft", "because": "most_past_targets", "box": 1}]
    assert decides[0]["result"] == "Refused by the tool" and decides[1]["result"] == "Decision recorded"
    place = "s3://bucket/use-cases/vessels-open-question/"
    chip = next(c for c in tool_calls if c["id"] == "t_chip")
    assert chip["params"]["s3_url"] == f"{place}chips/{P}_T04.tif"
    assert all(not v.startswith(f"s3://{BUCKET}") for c in tool_calls for v in c["params"].values() if isinstance(v, str))
    assert [layer["file"] for layer in config["assets"]["layers"]] == [
        f"radar_{P}.tif", f"targets_{P}.geojson", f"heard_{P}.geojson", f"unproven_{P}.geojson", "hotspots.geojson",
        "boxes.geojson", "look_1_2026-10-24T00.geojson"]
    assert config["assets"]["layers"][0]["render"]["kind"] == "raster"
    assert (config["agent"], config["user_question"], config["recorded_from"]) == ("vessels", rc.PROMPT, "dark_vessels_dev")
    # A session URL the case did not copy is dropped, never left pointing at the session.
    dropped = rc.config_for(calls, {}, set(), rc.CASE_ID, "dark_vessels_dev")["tool_calls"]
    assert all("s3_url" not in c["params"] for c in dropped) and dropped[0]["id"] == "t_list"


def test_identity_in_a_copied_file_is_found(tmp_path):
    (tmp_path / "targets.geojson").write_text(json.dumps({"features": [{"properties": {"label": "T01", "port_km": 9}}]}))
    assert rc.identity_findings(tmp_path) == []
    # config.json's own "name" fields are the case's and the tools'; its calls' inputs are scanned.
    config = rc.config_for(rc.extract_tool_calls(stream()), {}, set(), rc.CASE_ID, "dark_vessels_dev")
    (tmp_path / "config.json").write_text(json.dumps(config))
    assert rc.identity_findings(tmp_path) == []
    config["tool_calls"][-1]["params"]["notes"] = [{"shipname": "x"}]
    (tmp_path / "config.json").write_text(json.dumps(config))
    assert rc.identity_findings(tmp_path) == ["config.json: key shipname"]
    (tmp_path / "config.json").unlink()
    (tmp_path / "match.json").write_text(json.dumps({"targets": [{"ssvid": "x"}]}))
    assert rc.identity_findings(tmp_path) == ["match.json: key ssvid"]


# --- the builder's copies of the agent's rules, and the stage's words ---------------------------------------

def test_the_builders_rules_are_the_agents_and_the_stages(vessels):
    import vessels_config as c
    assert rc.FORBIDDEN.pattern == vessels.tk.FORBIDDEN.pattern and rc.FORBIDDEN.flags == vessels.tk.FORBIDDEN.flags
    assert rc.IDENTIFIER.pattern == vessels.tk.IDENTIFIER.pattern
    assert rc.CANDIDATE_SENTENCE == vessels.vs.CANDIDATE_SENTENCE and rc.CLOSER == c.CLOSER
    assert rc.TOOL_USE_ID_RE.pattern == vessels.vs.TOOL_USE_ID_RE.pattern
    stage = (REPO / "react-ui" / "frontend" / "src" / "utils" / "stageCopy.ts").read_text()
    assert f"prompt: '{rc.PROMPT}'" in stage                                   # the prepared plate, word for word
    gallery = (REPO / "react-ui" / "frontend" / "src" / "pages" / "UseCaseGallery.tsx").read_text()
    assert f"id: '{rc.CASE_ID}'" in gallery and f"name: '{rc.NAME}'" in gallery and f"description: '{rc.DESCRIPTION}'" in gallery
    for text in (rc.NAME, rc.DESCRIPTION, rc.PROMPT):
        assert "\u2014" not in text
