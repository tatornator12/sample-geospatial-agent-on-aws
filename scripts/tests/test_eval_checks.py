"""scripts/eval.py's checks on synthetic streams (redesign §3.10, §3.14): expected_inputs,
forbidden_inputs, expected_before and expected_after with {pass_id}, forbidden_prose, max_seconds,
report_max_words, required_text_by_ending, the closing paragraph after a tool call (the four-turn
draft-tasking flake, Oct 21), refusals from a session transcript, and --repeat's summary. No AWS:
the runtime and S3 are fakes."""
import io
import json
import sys
import types

import pytest

import eval as ev

OCT12 = "s1d-20261012t0018"
AUG30 = "s1d-20260830t0026"
SEP30 = "s1d-20260930t0018"
SESSION_URL = "s3://bucket/session_data/eval-x/vessels/"
CLOSER = "Candidates are a reason to look, not accusations."


def call(tid: str, name: str, **inp) -> str:
    """One tool use as the runtime streams it: the input is escaped JSON text."""
    return json.dumps({"toolUseId": tid, "name": name, "input": json.dumps(inp)})


def show(tid: str, kind: str, pid: str) -> str:
    ext = "tif" if kind == "radar" else "geojson"
    return call(tid, "display_visual", s3_url=f"{SESSION_URL}{kind}_{pid}.{ext}", title=kind, render={"kind": "vector"})


def clean_path(pid: str = OCT12, report: str | None = None) -> str:
    """The clean path on one pass, as one stream: every check the open-question case asks for holds."""
    report = report if report is not None else (
        "4 candidates on the Oct 12 pass; I drafted box 3 for the next look.\n\n"
        "- Read Oct 12 (19% checkable); data from Global Fishing Watch.\n"
        "- Refitted before each radar day since July, the map's top 5% of water held 41% of the dark targets.\n\n"
        "A candidate is a radar target with no broadcast nearby; it is not an accusation.\n\n"
        f"The decision is the officer's; I only draft. {CLOSER}")
    return "".join([
        "I'll weigh the passes on file.",
        call("t01", "list_passes"),
        call("t02", "decide", step="read_pass", because="newest_wide", pass_id=pid),
        call("t03", "find_pass", when=pid),
        call("t04", "inspect_image", s3_url=f"{SESSION_URL}radar_{pid}.tif"),
        "The swath covers open water.",
        show("t05", "radar", pid), call("t06", "detect_vessels", pass_id=pid),
        show("t07", "targets", pid), call("t08", "check_ais_coverage", pass_id=pid),
        show("t09", "heard", pid), show("t10", "unproven", pid), call("t11", "match_ais", pass_id=pid),
        show("t12", "targets", pid), call("t13", "gather_evidence", pass_id=pid),
        call("t14", "predict_hotspots", pass_id=pid),
        call("t15", "decide", step="draft", because="near_candidates", box=3), call("t16", "next_look", box=3),
        call("t17", "draft_tasking", pass_id=pid, box=3),
        report,
    ])


def golden(name: str) -> dict:
    cases = json.loads((ev.AGENTS["vessels"]["prompts"]).read_text())["prompts"]
    return next(c for c in cases if c["name"] == name)


def problems(case: dict, text: str, elapsed: float = 60.0) -> list[str]:
    return ev.evaluate(case, text, elapsed)[0]


# --- the input checks -------------------------------------------------------------------------------------

def test_expected_inputs_are_a_subsequence_matched_by_value_list_and_contains():
    text = clean_path()
    ok = {"expected_inputs": [{"name": "decide", "match": {"step": "read_pass"}},
                              {"name": "find_pass", "match": {"when": ["2026-10-12", OCT12]}},
                              {"name": "display_visual", "contains": f"heard_{OCT12}"},
                              {"name": "decide", "match": {"step": "draft", "box": 3}}]}
    assert problems(ok, text) == []
    out_of_order = {"expected_inputs": [{"name": "decide", "match": {"step": "draft"}},
                                        {"name": "decide", "match": {"step": "read_pass"}}]}
    assert problems(out_of_order, text) == ["expected inputs: no decide(step=read_pass) after the ones before it"]
    wrong_value = {"expected_inputs": [{"name": "find_pass", "match": {"when": AUG30}}]}
    assert problems(wrong_value, text) and problems({"expected_inputs": [{"name": "find_pass", "contains": AUG30}]}, text)


def test_an_absent_key_matches_null():
    """tasking-status: tasking_status with no id, or an empty one."""
    spec = {"expected_inputs": [{"name": "tasking_status", "match": {"tasking_id": ["", None]}}]}
    assert problems(spec, call("t1", "tasking_status") + "The tasking is a draft.") == []
    assert problems(spec, call("t1", "tasking_status", tasking_id="") + "x") == []
    assert problems(spec, call("t1", "tasking_status", tasking_id="tasking-20261016T120000-a1b2c3") + "x")


def test_forbidden_inputs_never_match():
    case = {"forbidden_inputs": [{"name": "match_ais", "match": {"pass_id": AUG30}}]}
    assert problems(case, clean_path(OCT12)) == []
    assert problems(case, clean_path(AUG30)) == [f"forbidden input match_ais(pass_id={AUG30}) called"]


def test_expected_before_fills_pass_id_from_the_later_call():
    case = golden("open-question")
    assert [p for p in problems(case, clean_path()) if "before" in p] == []
    # detect_vessels on a pass announced for another one: the decide does not count.
    text = clean_path().replace(call("t02", "decide", step="read_pass", because="newest_wide", pass_id=OCT12),
                                call("t02", "decide", step="read_pass", because="newest_wide", pass_id=SEP30))
    assert f"detect_vessels({OCT12}) has no decide(step=read_pass, pass_id={OCT12}) before it" in problems(case, text)
    # match_ais before the coverage areas are shown.
    text = clean_path().replace(show("t09", "heard", OCT12), "")
    assert f"match_ais({OCT12}) has no display_visual(contains 'heard_{OCT12}') before it" in problems(case, text)
    # draft_tasking with no decide(draft) before it.
    text = clean_path().replace(call("t15", "decide", step="draft", because="near_candidates", box=3), "")
    assert "draft_tasking(" + OCT12 + ") has no decide(step=draft) before it" in problems(case, text)


def test_a_placeholder_with_no_pass_id_to_fill_fails():
    case = {"expected_before": [{"first": {"name": "display_visual", "contains": "heard_{pass_id}"},
                                 "then": {"name": "match_ais"}}]}
    text = show("t1", "heard", OCT12) + call("t2", "match_ais") + "x"
    assert problems(case, text) == ["match_ais has no pass_id to check display_visual(contains 'heard_{pass_id}') against"]


def test_expected_after_shows_the_matched_targets_after_each_match_ais():
    """Review M2: the map reveals the candidates only when the targets are shown after match_ais."""
    case = golden("open-question")
    assert [p for p in problems(case, clean_path()) if "after it" in p] == []
    text = clean_path().replace(show("t12", "targets", OCT12), "")       # only detect's display remains, before
    assert f"match_ais({OCT12}) has no display_visual(contains 'targets_{OCT12}') after it" in problems(case, text)
    # Two passes matched: each needs its own display after it.
    two = (call("a", "match_ais", pass_id=SEP30) + show("b", "targets", SEP30) + call("c", "match_ais", pass_id=OCT12)
           + show("d", "targets", SEP30) + "x")
    rule = {"expected_after": case["expected_after"]}
    assert problems(rule, two) == [f"match_ais({OCT12}) has no display_visual(contains 'targets_{OCT12}') after it"]


# --- the words -------------------------------------------------------------------------------------------

def test_forbidden_prose_reads_the_words_not_the_file_names():
    case = {"forbidden_prose": ["unproven", "heard water", "Filed by the officer"]}
    assert problems(case, clean_path()) == []                            # unproven_<pass> rides in a display input
    assert problems(case, clean_path() + "\n\nUnproven water stays grey.") == ["forbidden prose 'unproven' present"]
    assert "unproven" in clean_path()                                    # forbidden_text could not have checked it


def test_max_seconds_is_the_last_turns_wall_time():
    case = {"max_seconds": 120}
    assert problems(case, clean_path(), 119.9) == []
    assert problems(case, clean_path(), 121.0) == ["turn took 121.0s (> 120s)"]


def test_report_max_words_counts_the_prose_after_the_last_tool_call():
    """The §3.14 sample, seven candidates and a set-aside pass: 116 words with the bullet markers."""
    sample = ("7 candidates on the Sep 30 pass; I drafted box 3 for the next look.\n\n"
              "- Read Sep 30 (22% checkable) after setting Aug 30 aside (10%); data from Global Fishing Watch.\n"
              "- T01, T02, T03, T04 and 3 more, 12 to 31 km from port.\n"
              "- Each could be a small boat, a missed or switched-off AIS, or not a vessel.\n"
              "- Refitted before each radar day since September, the map's top 5% of water held 100% of the dark "
              "targets, 14 times chance.\n\n"
              "A candidate is a radar target with no broadcast nearby; it is not an accusation.\n\n"
              f"The decision is the officer's; I only draft. {CLOSER}")
    assert len(sample.split()) == 116
    case = {"report_max_words": 120}
    text = "a long preamble " * 50 + clean_path(report=sample)            # words before the last call do not count
    assert problems(case, text) == []
    assert problems(case, clean_path(report=sample + " one two three four five")) == ["final report is 121 words (> 120)"]
    assert ev.report_text(call("t1", "list_passes")) == ""


def test_required_text_by_ending_checks_the_ending_the_run_reached():
    case = {"required_text_by_ending": {"draft": ["I drafted box"],
                                        "stop": ["No pass I read could be checked, so there is no tasking."]}}
    assert problems(case, clean_path()) == []
    assert problems(case, clean_path(report="Done.")) == ["required text 'I drafted box' missing (ending draft)"]
    stop = (call("s1", "list_passes") + call("s2", "decide", step="read_pass", because="asked", pass_id=AUG30)
            + call("s3", "check_ais_coverage", pass_id=AUG30) + call("s4", "predict_hotspots")
            + call("s5", "decide", step="stop", because="no_checked_pass")
            + f"No pass I read could be checked, so there is no tasking.\n\n{CLOSER}")
    assert ev.ending(ev.extract_tool_calls(stop)) == "stop" and problems(case, stop) == []
    assert problems(case, stop.replace("could be checked", "was checkable")) == [
        "required text 'No pass I read could be checked, so there is no tasking.' missing (ending stop)"]
    neither = call("n1", "list_passes") + "I could not finish."
    assert problems(case, neither) == ["no ending: neither draft_tasking nor decide(step=stop) was called"]
    # A refused draft_tasking, then decide(stop): the run ended on the stop.
    both = call("b1", "draft_tasking", pass_id=AUG30, box=1) + call("b2", "decide", step="stop", because="no_checked_pass")
    assert ev.ending(ev.extract_tool_calls(both)) == "stop"


def test_the_closing_paragraph_after_a_tool_call_is_read_alone():
    """The Oct 21 flake: the draft turn's answer streamed straight after draft_tasking's JSON, so the
    whole-stream split read a 298-character 'closer' for a 165-character answer."""
    answer = ("The draft covers box 1, all four candidates from the Oct 12 pass, timed to the next radar look at "
              "S1-D Oct 24 00:17 UTC. The decision is the officer's; I only draft.")
    text = call("toolu_1", "draft_tasking", pass_id=OCT12, box=1) + answer
    assert len(answer) == 165 and ev.closing_paragraph(text) == answer
    case = {"closer_max_chars": 240, "closer_endswith": "I only draft.", "closer_forbidden": ["°S"]}
    assert problems(case, text) == []
    # The old split joined the tool JSON to the sentence.
    old = [p.strip() for p in text.strip().split("\n\n") if p.strip()][-1]
    assert len(old) > 240
    # A provocation (no tool) and a closer before a trailing call still read as before.
    assert ev.closing_paragraph(f"I don't accuse vessels.\n\n{CLOSER}") == CLOSER
    assert ev.closing_paragraph(f"Done.\n\n{CLOSER}" + call("t9", "display_visual", s3_url="x")) == CLOSER


def test_the_golden_open_question_passes_on_the_clean_path_and_fails_on_a_retired_word():
    case = golden("open-question")
    assert problems(case, clean_path(), 61.0) == []
    assert "forbidden prose 'heard water' present" in problems(case, clean_path() + " in heard water", 61.0)


def test_the_golden_thin_pass_passes_either_ending():
    case = golden("thin-pass")
    say = "Refitted before each radar day since July, the map's top 5% of water held 41% of the dark targets."
    thin = [call("a1", "list_passes"), call("a2", "decide", step="read_pass", because="asked", pass_id=AUG30),
            call("a3", "find_pass", when=AUG30), call("a4", "detect_vessels", pass_id=AUG30),
            call("a5", "check_ais_coverage", pass_id=AUG30)]
    stop = "".join(thin + [call("a6", "decide", step="forecast", because="coverage_thin"),
                           call("a7", "predict_hotspots"), call("a8", "decide", step="stop", because="no_checked_pass"),
                           f"No pass I read could be checked, so there is no tasking.\n\n- Aug 30: 10% checkable; "
                           f"data from Global Fishing Watch.\n- {say}\n\n{CLOSER}"])
    assert problems(case, stop) == []
    draft = "".join(thin + [call("a6", "decide", step="read_pass", because="coverage_thin", pass_id=SEP30)]) + \
        clean_path(SEP30).split(call("t01", "list_passes"), 1)[1].replace(
            call("t02", "decide", step="read_pass", because="newest_wide", pass_id=SEP30), "")
    assert problems(case, draft) == []
    # match_ais on the thin pass is never allowed.
    assert "forbidden input match_ais(pass_id=" + AUG30 + ") called" in problems(case, stop + call("z", "match_ais", pass_id=AUG30))


# --- refusals, from the session's transcript ---------------------------------------------------------------

def tool_result(tid: str, body, status: str = "success") -> dict:
    return {"toolResult": {"toolUseId": tid, "status": status, "content": [{"text": json.dumps(body)}]}}


def stored(n: int, *blocks) -> dict:
    return {"message": {"role": "user", "content": list(blocks)}, "message_id": n, "redact_message": None}


def test_refusals_in_counts_this_turns_errors_only():
    messages = [
        stored(1, tool_result("old", {"error": "Call list_passes first."})),          # a setup turn's refusal
        stored(3, tool_result("t02", {"error": "the records do not support 'widest'", "facts": {}})),
        stored(5, tool_result("t03", {"pass_id": OCT12})),
        stored(7, tool_result("t06", "boom", status="error")),
        stored(9, {"text": "words"}, tool_result("t08", {"status": "noted"})),
    ]
    assert ev.refusals_in(messages, {"t02", "t03", "t06", "t08"}) == ["t02", "t06"]
    assert ev.refusals_in(messages, set()) == []


class FakeS3:
    def __init__(self, objects: dict, page: int = 2, fail: bool = False):
        self.objects, self.page, self.fail = objects, page, fail

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        if self.fail:
            raise RuntimeError("no")
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        chunk = keys[start:start + self.page]
        more = start + self.page < len(keys)
        return {"Contents": [{"Key": k} for k in chunk], "IsTruncated": more,
                **({"NextContinuationToken": str(start + self.page)} if more else {})}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode())}


def test_session_messages_reads_every_page_and_says_when_it_cannot():
    pre = "sessions/session_eval-1/agents/agent_default/"
    objects = {f"{pre}agent.json": {"agent_id": "default"},
               **{f"{pre}messages/message_{i}.json": stored(i, tool_result(f"t{i}", {"ok": 1})) for i in range(5)},
               "sessions/session_eval-2/agents/agent_default/messages/message_0.json": stored(0)}
    msgs = ev.session_messages(FakeS3(objects), "bucket", "eval-1")
    assert sorted(m["message_id"] for m in msgs) == [0, 1, 2, 3, 4]
    assert ev.session_messages(FakeS3({}), "bucket", "eval-1") is None           # none stored: not counted
    assert ev.session_messages(FakeS3(objects, fail=True), "bucket", "eval-1") is None


# --- --repeat: paths and the summary ---------------------------------------------------------------------

def test_a_path_writes_decide_with_its_step_and_reason_and_drops_display_visual():
    path = ev.path_of(ev.extract_tool_calls(clean_path()))
    assert path == ["list_passes", "decide(read_pass:newest_wide)", "find_pass", "inspect_image", "detect_vessels",
                    "check_ais_coverage", "match_ais", "gather_evidence", "predict_hotspots",
                    "decide(draft:near_candidates)", "next_look", "draft_tasking"]


def test_summarise_lists_distinct_paths_with_counts_seconds_and_refusals():
    a, b = ["list_passes", "decide(read_pass:newest)"], ["list_passes", "decide(read_pass:widest)"]
    records = [{"name": "open-question", "passed": True, "seconds": 60.0, "path": a, "refusals": 0},
               {"name": "open-question", "passed": False, "seconds": 90.5, "path": b, "refusals": 2},
               {"name": "open-question", "passed": True, "seconds": 70.0, "path": a, "refusals": None},
               {"name": "thin-pass", "passed": True, "seconds": 80.0, "path": b, "refusals": 1}]
    s = ev.summarise(records)
    assert s[0] == {"name": "open-question", "runs": 3, "passed": 2, "median_seconds": 70.0, "max_seconds": 90.5,
                    "refusals": [0, 2, None], "paths": [{"path": a, "count": 2}, {"path": b, "count": 1}]}
    assert s[1]["name"] == "thin-pass" and s[1]["runs"] == 1
    lines = ev.summary_lines(s)
    assert lines[0] == "  open-question: 2/3 passed; median 70.0s, max 90.5s; refusals per run 0, 2, ?"
    assert lines[1] == "      2x list_passes > decide(read_pass:newest)"


class FakeRuntime:
    """invoke_agent_runtime as an SSE body; records the session ids it saw."""
    def __init__(self, text: str):
        self.text, self.sessions = text, []

    def invoke_agent_runtime(self, agentRuntimeArn, runtimeSessionId, qualifier, payload):
        self.sessions.append(runtimeSessionId)
        lines = [f"data: {json.dumps(self.text[i:i + 40])}".encode() for i in range(0, len(self.text), 40)]
        return {"response": types.SimpleNamespace(iter_lines=lambda: iter(lines))}


def test_repeat_runs_each_case_n_times_in_fresh_sessions_and_reports_runs(tmp_path, monkeypatch, capsys):
    case = dict(golden("open-question"))
    prompts = tmp_path / "golden.json"
    prompts.write_text(json.dumps({"prompts": [case]}))
    runtime = FakeRuntime(clean_path())
    transcript = FakeS3({})
    fake_boto3 = types.SimpleNamespace(client=lambda svc, region_name=None: runtime if svc == "bedrock-agentcore" else transcript)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setattr(ev, "resolve_agent_arn", lambda target, agent: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x")
    monkeypatch.setattr(ev, "env_value", lambda path, name: "bucket")
    report = tmp_path / "report.json"
    code = ev.main(["--target", "dev", "--agent", "vessels", "--prompts", str(prompts), "--repeat", "3",
                    "--json", str(report)])
    out = capsys.readouterr().out
    assert code == 0, out
    assert len(runtime.sessions) == 3 and len(set(runtime.sessions)) == 3
    assert "[PASS] open-question (run 3/3)" in out and "Paths:" in out and "3/3 passed" in out
    assert "refusals per run ?, ?, ?" in out                     # no transcript stored: not counted, never 0
    data = json.loads(report.read_text())
    assert data["repeat"] == 3 and data["total"] == 3 and len(data["results"]) == 3
    assert data["runs"][0]["paths"][0]["count"] == 3 and data["runs"][0]["refusals"] == [None, None, None]
    assert [r["run"] for r in data["results"]] == [1, 2, 3] and data["results"][0]["ending"] == "draft"


def test_repeat_counts_refusals_from_the_runs_own_transcript(tmp_path, monkeypatch, capsys):
    case = {"name": "x", "prompt": "q"}
    prompts = tmp_path / "golden.json"
    prompts.write_text(json.dumps({"prompts": [case]}))
    runtime = FakeRuntime(clean_path())

    class Transcript(FakeS3):
        def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
            sid = runtime.sessions[-1]
            self.objects = {f"sessions/session_{sid}/agents/agent_default/messages/message_2.json":
                            stored(2, tool_result("t02", {"error": "the records do not support 'newest'"}))}
            return super().list_objects_v2(Bucket, Prefix, ContinuationToken)

    fake_boto3 = types.SimpleNamespace(client=lambda svc, region_name=None: runtime if svc == "bedrock-agentcore" else Transcript({}))
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setattr(ev, "resolve_agent_arn", lambda target, agent: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x")
    monkeypatch.setattr(ev, "env_value", lambda path, name: "bucket")
    report = tmp_path / "report.json"
    assert ev.main(["--target", "dev", "--agent", "vessels", "--prompts", str(prompts), "--repeat", "2",
                    "--json", str(report)]) == 0
    data = json.loads(report.read_text())
    assert data["runs"][0]["refusals"] == [1, 1] and data["results"][0]["refused"] == ["decide"]
    assert "refusals per run 1, 1" in capsys.readouterr().out


# --- the dry run -----------------------------------------------------------------------------------------

def test_the_dry_run_plans_the_repeats_and_fails_a_malformed_check(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ev, "resolve_agent_arn", lambda target, agent: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x")
    monkeypatch.setitem(sys.modules, "boto3", None)                # importing boto3 would fail the test
    good = tmp_path / "good.json"
    good.write_text(json.dumps({"prompts": [golden("open-question"), golden("thin-pass")]}))
    assert ev.main(["--target", "dev", "--agent", "vessels", "--prompts", str(good), "--dry-run", "--repeat", "3"]) == 0
    out = capsys.readouterr().out
    assert "[plan] open-question x3" in out and "Dry run: nothing invoked." in out
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"prompts": [{"name": "b", "prompt": "q", "expected_inputs": [{"tool": "decide"}],
                                            "expected_after": [{"first": {"name": "match_ais"}}],
                                            "required_text_by_ending": {"done": []}, "max_seconds": "soon"}]}))
    assert ev.main(["--target", "dev", "--agent", "vessels", "--prompts", str(bad), "--dry-run"]) == 1
    out = capsys.readouterr().out
    assert out.count("[malformed]") == 4


def test_every_agents_golden_cases_are_well_formed():
    for agent in ev.AGENTS.values():
        for case in json.loads(agent["prompts"].read_text())["prompts"]:
            assert ev.case_problems(case) == [], case["name"]


@pytest.mark.parametrize("repeat", ["0", "-1"])
def test_repeat_must_be_one_or_more(repeat):
    with pytest.raises(SystemExit):
        ev.main(["--target", "dev", "--agent", "vessels", "--repeat", repeat, "--dry-run"])


def test_a_dotted_match_reads_a_nested_field_and_the_mission_must_show_its_columns():
    """Oct 22: the production mission looked at its EMIT candidate's window and never put the 3D
    columns on the map. The golden mission cases now require a display_visual with render.kind
    'columns' after any inspect_image of a pass window (and nothing when no window was looked at)."""
    import json as _json
    from pathlib import Path
    cases = _json.loads((Path(ev.REPO_ROOT) / "agents" / "methane-hunter" / "golden_prompts.json").read_text())["prompts"]
    mission = next(c for c in cases if c["name"] == "watch-mission")
    d = "s3://bucket/session_data/eval-x/methane/"
    window = {"name": "inspect_image", "input": _json.dumps({"s3_url": f"{d}pass_EMIT_L2B_CH4ENH_002_20250925T060520_2526804_019.tif"})}
    flat = {"name": "display_visual", "input": _json.dumps({"s3_url": f"{d}pass_EMIT_L2B_CH4ENH_002_20250925T060520_2526804_019.tif",
                                                             "render": {"kind": "raster", "colormap": "plasma"}})}
    cols = {"name": "display_visual", "input": _json.dumps({"s3_url": f"{d}columns_EMIT_L2B_CH4ENH_002_20250925T060520_2526804_019.geojson",
                                                             "render": {"kind": "columns", "property": "ppm_m"}})}
    as_text = {"name": "display_visual", "input": _json.dumps({"s3_url": f"{d}columns_x.geojson", "render": '{"kind": "columns"}'})}
    # The mission's brief carries the agent's decision (checked on its own below).
    ok = {"name": "draft_brief", "input": _json.dumps({"recommendation": "recommend_new_look",
                                                       "recommendation_reason": "confirmation_older_than_90_days"})}
    assert ev.input_problems(mission, [window, cols, ok]) == []
    assert ev.input_problems(mission, [window, as_text, ok]) == []
    assert ev.input_problems(mission, [cols, window]) != []          # the columns must follow the look
    problems = ev.input_problems(mission, [window, flat])            # the Oct 22 stable mission
    assert any("render.kind=columns" in p for p in problems)
    assert ev.input_problems(mission, [ok]) == []                    # no candidate looked at: nothing to show
    shown_flat = ev.input_problems(mission, [window, flat, cols])     # the flat window is never shown
    assert any("forbidden input display_visual" in p for p in shown_flat)
    assert ev.dotted({"render": {"kind": "columns"}}, "render.kind") == "columns"
    assert ev.dotted({"render": "not json"}, "render.kind") is None and ev.dotted({}, "a.b") is None
    assert ev.case_problems(mission) == []


def test_the_mission_must_carry_the_agents_decision_as_validated_enums():
    """Oct 23 (the record and the decision, approved 2026-10-23): draft_brief's recommendation and
    recommendation_reason are one of the enums, and the record keeps the tool's 'Recommendation:' line."""
    import json as _json
    from pathlib import Path
    cases = _json.loads((Path(ev.REPO_ROOT) / "agents" / "methane-hunter" / "golden_prompts.json").read_text())["prompts"]
    mission = next(c for c in cases if c["name"] == "watch-mission")
    assert "Recommendation:" in mission["required_text"]

    def brief(**decision):
        return {"name": "draft_brief", "input": _json.dumps({"place": "Yangquan, Shanxi, China", **decision})}
    ok = brief(recommendation="recommend_new_look", recommendation_reason="confirmation_older_than_90_days")
    assert ev.input_problems(mission, [ok]) == []
    # A refused first call (no enums) and an accepted second one still pass: the decision was made.
    assert ev.input_problems(mission, [brief(), ok]) == []
    for bad in (brief(), brief(recommendation="recommend_new_look"),
                brief(recommendation="yes", recommendation_reason="confirmation_older_than_90_days"),
                brief(recommendation="no_new_look_needed", recommendation_reason="it is old")):
        assert any("expected inputs: no draft_brief" in p for p in ev.input_problems(mission, [bad]))


# --- the archaeologist's condition survey (decision 10, Oct 22) ----------------------------------------------
TERRAIN_URL = "s3://bucket/session_data/eval-x/terrain/"
SURVEY_REPORT = (
    "**Two of the three sites like the Octagon still show in the ground; one I cannot confirm.**\n\n"
    "- Hopeton Earthworks, 87 km: still shows, ploughed down but traced.\n"
    "- High Bank Works, 93 km: still shows, ploughed down but traced.\n"
    "- Seip Earthworks, 112 km: I cannot confirm, only low, broad rises around the mound.\n\n"
    "At High Bank Works the LiDAR still traces the circle and the octagon. They are already on the World Heritage list.")


def survey_path(seip: str = "cannot_confirm", report: str = SURVEY_REPORT) -> str:
    """The survey as one stream: the matches, then per site its relief, a look and a verdict."""
    parts = [call("s01", "find_similar_sites", site_id="newark-octagon", top_k=3)]
    for i, (site, verdict) in enumerate([("hopeton-earthworks", "visible"), ("high-bank-works", "visible"),
                                         ("seip-earthworks", seip)]):
        url = f"{TERRAIN_URL}lrm03_{site}.tif"
        parts += [call(f"t{i}a", "show_terrain", site_id=site, product="lrm"),
                  call(f"t{i}b", "inspect_image", s3_url=url, title=site), "The walls read as thin red lines.",
                  call(f"t{i}c", "record_condition", site_id=site, verdict=verdict,
                       because="ploughed_but_traced" if verdict == "visible" else "low_relief_only"),
                  call(f"t{i}d", "display_visual", s3_url=url, title=site)]
    return "".join(parts + [report])


def arch_golden(name: str) -> dict:
    cases = json.loads((ev.AGENTS["archaeologist"]["prompts"]).read_text())["prompts"]
    return next(c for c in cases if c["name"] == name)


def test_the_golden_survey_passes_on_a_survey_of_three():
    assert problems(arch_golden("like-this"), survey_path()) == []


def test_the_golden_survey_fails_a_confident_visible_at_seip():
    assert any("forbidden input record_condition" in p for p in problems(arch_golden("like-this"), survey_path("visible")))


def test_the_golden_survey_needs_two_verdicts_and_its_first_line():
    case = arch_golden("like-this")
    one = "".join([call("s01", "find_similar_sites", site_id="newark-octagon"), call("a", "show_terrain", site_id="x"),
                   call("b", "inspect_image", s3_url="s3://b/x.tif"), call("c", "record_condition", site_id="x"),
                   SURVEY_REPORT])
    assert any("expected inputs" in p for p in problems(case, one))
    led_by_a_site = survey_path(report=SURVEY_REPORT.replace("**Two of the three sites like the Octagon", "**Hopeton Earthworks and two more sites like the Octagon"))
    assert any("first line" in p for p in problems(case, led_by_a_site))


def test_report_first_line_drops_emphasis_and_heading_marks():
    assert ev.report_first_line(call("t", "x") + "\n\n## **All three sites like the Octagon still show.**\n\nmore") == \
        "All three sites like the Octagon still show."
    assert ev.report_first_line("") == ""


def test_a_first_line_pattern_that_does_not_compile_is_malformed():
    assert ev.case_problems({"name": "x", "report_first_line_regex": "(unclosed"})


def test_min_accepted_counts_the_calls_the_tool_did_not_refuse():
    case = {"name": "x", "min_accepted": {"record_condition": 2}}
    names = ["find_similar_sites", "record_condition", "record_condition", "record_condition"]
    assert ev.accepted_problems(case, names, []) == []
    assert ev.accepted_problems(case, names, ["record_condition"]) == []
    assert ev.accepted_problems(case, names, ["record_condition", "record_condition"]) == [
        "1 accepted record_condition call(s), fewer than 2"]
    # No transcript: the gate fails rather than pass on attempts.
    assert "not counted" in ev.accepted_problems(case, names, None)[0]
    assert ev.accepted_problems({"name": "y"}, names, None) == []


def test_min_accepted_must_be_tool_counts():
    for bad in ({"record_condition": 0}, {"record_condition": "2"}, ["record_condition"], {"record_condition": True}):
        assert ev.case_problems({"name": "x", "min_accepted": bad})
    assert ev.case_problems({"name": "x", "min_accepted": {"record_condition": 2}}) == []
    assert arch_golden("like-this")["min_accepted"] == {"record_condition": 2}
