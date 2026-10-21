"""The open question (redesign §3.5, §3.14): the turn, list_passes and the question's state, decide's
13 pairs with its common rules and the `asked` matcher, the gate, the two-pass budget, the question
open only in its own turn (review M1), match_ais' standard and its next steps (M2), the stale-record
checks, predict_hotspots(pass_id), draft_tasking's three checks, tasking_status("") and the docstring
pins. FakeS3 (conftest), no network."""
import asyncio
import inspect
import itertools
import json
import re
import types
from datetime import date
from pathlib import Path

import pytest

from conftest import AUG30, BUCKET, NOW, SEP18, SEP30, SEP7, SESSION, SILENT, STAR, manifest_record

PRE = f"session_data/{SESSION}/vessels/"
QUESTION = "Is anyone in the reserve without broadcasting, and where should the patrol look next?"
SPEC = Path(__file__).resolve().parents[3] / ".kiro" / "specs" / "act3-dark-vessels" / "redesign-open-question.md"
_ids = itertools.count(1)


def run(coro):
    return json.loads(asyncio.run(coro))


def ctx(tid: str | None = None):
    return types.SimpleNamespace(tool_use={"toolUseId": tid or f"tooluse_{next(_ids):04d}"})


def ask(v, prompt: str = QUESTION, tid: str | None = None) -> dict:
    """A new turn with the presenter's words, then list_passes (opens the question)."""
    v.vs.begin_turn(prompt)
    return run(v.pt.list_passes(tool_context=ctx(tid)))


def qid(v) -> str:
    return v.vs.latest_question()["question_id"]


def decide(v, step, because, pass_id="", box=0, tid=None) -> dict:
    return run(v.dt.decide(step, because, pass_id, box, tool_context=ctx(tid)))


def decision_files(v) -> list[str]:
    return sorted(k for k in v.s3.objects if k.startswith(f"{PRE}decision_"))


def put(v, key: str, body) -> None:
    v.s3.put_object(Bucket=BUCKET, Key=f"{PRE}{key}", Body=json.dumps(body))


def put_cov(v, pid: str, checkable: float, q: str | None = None) -> None:
    put(v, f"coverage_{pid}.json", {"pass_id": pid, "heard_share": 0.3, "imaged_share": 0.5, "checkable_share": checkable,
                                    "standard": 0.15, "cells": [], "question_id": q or qid(v)})


def put_match(v, pid: str, candidates: int, q: str | None = None, at=(-90.0, -0.5)) -> None:
    targets = [{"status": "candidate", "lon": at[0], "lat": at[1], "label": f"T{i + 1:02d}"} for i in range(candidates)]
    put(v, f"match_{pid}.json", {"pass_id": pid, "targets": targets + [{"status": "broadcasting", "lon": -90.1, "lat": -0.4}],
                                 "question_id": q or qid(v)})


def bx(k: int, share: float, look: str | None = None, near: int | None = None) -> dict:
    row = {"box": k, "share_of_past_dark_targets": share, "bounds": [-91.0 + k, -1.0, -90.8 + k, -0.8],
           "next_look": {"satellite": "S1D", "start": look, "share": 0.5, "text": f"S1-D {look[5:10]} UTC"} if look else None}
    return row | ({"candidates_near": near} if near is not None else {})


def put_hot(v, boxes: list[dict], q: str | None = None) -> None:
    put(v, "hotspots.json", {"boxes": boxes, "check": {}, "rolling": {"total": 1}, "question_id": q or qid(v)})


def add_pass(v, pid: str, sensed: str, like: str = AUG30) -> None:
    """A pass on file in the manifest that passes_v1.json does not list (the rerun adds such passes)."""
    m = v.s3.json("vessels/cache/v1/manifest.json")
    m["passes"][pid] = {**manifest_record(like), "pass_id": pid, "sensed": sensed, "role": "on_file"}
    v.s3.put_object(Bucket=BUCKET, Key="vessels/cache/v1/manifest.json", Body=json.dumps(m))
    v.vs.clear_cache()


def read_and_cover(v, pid: str, because: str = "newest"):
    """decide(read_pass), then the radar, the targets and the coverage check, as the agent does."""
    assert decide(v, "read_pass", because, pid)["status"] == "noted"
    assert "error" not in run(v.pt.find_pass(pid))
    assert "error" not in run(v.pt.detect_vessels(pid))
    return run(v.ais.check_ais_coverage(pid))


# --- the turn -----------------------------------------------------------------------------------

def test_begin_turn_gives_a_new_turn_each_call_and_caps_the_words(vessels):
    a = vessels.vs.begin_turn("first")
    b = vessels.vs.begin_turn("x" * 2500)
    assert re.fullmatch(r"[0-9a-f]{12}", a) and re.fullmatch(r"[0-9a-f]{12}", b) and a != b
    assert vessels.vs.current_turn() == b and len(vessels.vs.turn_prompt()) == 2000
    vessels.vs.begin_turn(None)
    assert vessels.vs.turn_prompt() == ""


# --- the passes on file and list_passes -----------------------------------------------------------

def test_passes_come_from_the_manifest_one_per_id_with_the_spare_appended(vessels):
    add_pass(vessels, "s1d-20261018t0018", "2026-10-18T00:18:02Z")
    ids = [p["pass_id"] for p in vessels.vs.passes()]
    assert "s1d-20261018t0018" in ids and ids[-1] == SILENT and len(ids) == len(set(ids))
    assert vessels.vs.passes()[-1]["gap"]["type"] == "fishing"             # the packaged spare's entry
    # A manifest listing a pass twice (as a list) gives it once.
    m = vessels.s3.json("vessels/cache/v1/manifest.json")
    m["passes"] = list(m["passes"].values()) + [m["passes"][STAR]]
    vessels.s3.put_object(Bucket=BUCKET, Key="vessels/cache/v1/manifest.json", Body=json.dumps(m))
    vessels.vs.clear_cache()
    ids = [p["pass_id"] for p in vessels.vs.passes()]
    assert ids.count(STAR) == 1 and ids.count(SILENT) == 1


def test_list_passes_lists_newest_first_without_the_spare_and_opens_a_question(vessels):
    out = ask(vessels, tid="tooluse_board1")
    rows = out["passes"]
    assert [r["pass_id"] for r in rows] == [STAR, SEP30, SEP18, SEP7, AUG30]
    assert SILENT not in json.dumps(out)
    assert rows[0] == {"pass_id": STAR, "sensed": "2026-10-12T00:18:02Z", "sensed_text": "Oct 12, 2026 00:18 UTC",
                       "days_old": 4, "satellite": "Sentinel-1D", "orbit_state": "ascending", "imaged_share": 0.527,
                       "imaged_pct": 53}
    assert not re.search(r"candidate|heard|checkable|count", json.dumps(rows))   # no answer handed over
    assert out["next_steps"] == "Choose which pass to read and announce it with decide in the same response as find_pass."
    q = vessels.vs.latest_question()
    assert q["turn_id"] == vessels.vs.current_turn() and q["standard"] == 0.15 and q["budget"] == {"passes": 2}
    assert q["decision_keys"] == "call" and q["passes"] == rows and re.fullmatch(r"[0-9a-f]{12}", q["question_id"])
    assert vessels.s3.json(f"{PRE}passes_tooluse_board1.json") == q            # the stage's copy, named for the call


def test_list_passes_opens_a_new_question_each_turn_and_keeps_it_within_one(vessels):
    ask(vessels)
    first = qid(vessels)
    decide(vessels, "read_pass", "newest", STAR)
    run(vessels.pt.list_passes(tool_context=ctx()))                         # again, the same turn
    assert qid(vessels) == first and vessels.vs.read_passes(vessels.vs.decisions(vessels.vs.current_question())) == [STAR]
    assert "error" not in run(vessels.pt.detect_vessels(STAR))              # the accepted decision stands
    ask(vessels)                                                            # a new turn
    assert qid(vessels) != first and vessels.vs.decisions(vessels.vs.current_question()) == []


def test_list_passes_at_most_twelve_rows_and_its_failures(vessels, monkeypatch, caplog):
    for k in range(10):
        add_pass(vessels, f"s1d-202610{13 + k}t0018", f"2026-10-{13 + k}T00:18:02Z")
    rows = ask(vessels)["passes"]
    assert len(rows) == 12 and rows[0]["pass_id"] == "s1d-20261022t0018"
    # No tool-use id: the question opens, the board is not written.
    vessels.vs.begin_turn(QUESTION)
    before = {k for k in vessels.s3.objects if "/passes_" in k}
    assert "passes" in run(vessels.pt.list_passes(tool_context=None))
    assert {k for k in vessels.s3.objects if "/passes_" in k} == before
    # No passes on file but the spare: rule 1's refusal.
    m = vessels.s3.json("vessels/cache/v1/manifest.json")
    m["passes"] = {SILENT: m["passes"][SILENT]}
    vessels.s3.put_object(Bucket=BUCKET, Key="vessels/cache/v1/manifest.json", Body=json.dumps(m))
    vessels.vs.clear_cache()
    assert run(vessels.pt.list_passes(tool_context=ctx()))["error"].startswith(vessels.vs.ON_FILE_ONLY)
    # The manifest unreadable.
    del vessels.s3.objects["vessels/cache/v1/manifest.json"]
    vessels.vs.clear_cache()
    with caplog.at_level("WARNING"):
        assert run(vessels.pt.list_passes(tool_context=ctx())) == {"error": "The passes on file could not be read."}
    assert "could not be read" in caplog.text


# --- find_pass ------------------------------------------------------------------------------------

def test_find_pass_latest_follows_the_newest_pass_on_file(vessels):
    add_pass(vessels, "s1d-20261018t0018", "2026-10-18T00:18:02Z", like=STAR)
    out = run(vessels.pt.find_pass("latest"))
    assert out["pass_id"] == "s1d-20261018t0018" and "role" not in out and "reserve_share" not in out
    assert run(vessels.pt.find_pass(SILENT))["pass_id"] == SILENT          # the spare's pass, by id


# --- decide: the 13 pairs ---------------------------------------------------------------------------

def _fresh(v):
    pass


def _star_thin(v):
    decide(v, "read_pass", "newest", STAR)
    put_cov(v, STAR, 0.09)


def _star_checked(v):
    decide(v, "read_pass", "newest", STAR)
    put_cov(v, STAR, 0.25)


def _star_empty(v):
    _star_checked(v)
    put_match(v, STAR, 0)


def _star_one(v):
    _star_checked(v)
    put_match(v, STAR, 1)


def _named_sep7(v):
    ask(v, "Same question for the Sep 7 pass")


def _boxes(v):
    put_hot(v, [bx(1, 0.4, "2026-10-24T00:17:29Z", 0), bx(2, 0.3, "2026-10-17T00:25:37Z", 2), bx(3, 0.1, None, 1)])


def _boxes_tied(v):
    put_hot(v, [bx(1, 0.4, "2026-10-24T00:17:29Z", 1), bx(2, 0.4, "2026-10-17T00:25:37Z", 1), bx(3, 0.1, "2026-10-17T00:25:37Z", 0)])


def _boxes_no_look(v):
    put_hot(v, [bx(1, 0.4, None, 0), bx(2, 0.3, None, 0), bx(3, 0.1, None, 0)])


def _boxes_one_look(v):
    put_hot(v, [bx(1, 0.4, None, 0), bx(2, 0.3, "2026-10-17T00:25:37Z", 0), bx(3, 0.1, None, 0)])


MATRIX = [
    # (step, because, setup, pass_id or box, accepted)
    ("read_pass", "newest", _fresh, STAR, True),
    ("read_pass", "newest", _fresh, SEP30, False),
    ("read_pass", "widest", _fresh, SEP30, True),                 # tied widest: accepted
    ("read_pass", "widest", _fresh, SEP7, False),
    ("read_pass", "newest_wide", _fresh, STAR, True),
    ("read_pass", "newest_wide", _fresh, SEP30, False),           # a newer pass imaged over half
    ("read_pass", "newest_wide", _fresh, AUG30, False),           # it imaged a third
    ("read_pass", "coverage_thin", _star_thin, AUG30, True),
    ("read_pass", "coverage_thin", _star_checked, SEP30, False),
    ("read_pass", "coverage_thin", _fresh, SEP30, False),         # no pass read yet
    ("read_pass", "no_candidates", _star_empty, SEP30, True),
    ("read_pass", "no_candidates", _star_one, SEP30, False),
    ("read_pass", "asked", _named_sep7, SEP7, True),
    ("read_pass", "asked", _fresh, SEP7, False),                  # the question names no pass
    ("forecast", "coverage_thin", _star_thin, None, True),
    ("forecast", "coverage_thin", _star_checked, None, False),
    ("forecast", "no_candidates", _star_empty, None, True),
    ("forecast", "no_candidates", _star_one, None, False),
    ("draft", "most_past_targets", _boxes, 1, True),
    ("draft", "most_past_targets", _boxes, 2, False),
    ("draft", "most_past_targets", _boxes_tied, 2, True),         # ties accepted
    ("draft", "soonest_look", _boxes, 2, True),
    ("draft", "soonest_look", _boxes, 1, False),
    ("draft", "soonest_look", _boxes_tied, 3, True),              # ties accepted
    ("draft", "soonest_look", _boxes_no_look, 1, False),          # no look planned anywhere
    ("draft", "near_candidates", _boxes, 2, True),
    ("draft", "near_candidates", _boxes, 3, False),
    ("draft", "near_candidates", _boxes_no_look, 1, False),       # no box has any
    ("draft", "only_planned_look", _boxes_one_look, 2, True),
    ("draft", "only_planned_look", _boxes_one_look, 1, False),
    ("draft", "only_planned_look", _boxes, 1, False),             # two boxes have looks
    ("stop", "no_checked_pass", _star_thin, None, True),
    ("stop", "no_checked_pass", _star_checked, None, False),
    ("stop", "no_checked_pass", _fresh, None, False),             # no pass read
]


@pytest.mark.parametrize("step,because,setup,subject,accepted", MATRIX,
                         ids=[f"{s}-{b}-{f.__name__.strip('_')}-{x}-{'ok' if a else 'no'}" for s, b, f, x, a in MATRIX])
def test_decide_matrix_accepts_what_the_records_support_and_writes_nothing_else(vessels, step, because, setup, subject, accepted):
    ask(vessels)
    setup(vessels)
    before = decision_files(vessels)
    out = decide(vessels, step, because, subject if step == "read_pass" else "", subject if step == "draft" else 0)
    after = decision_files(vessels)
    if accepted:
        assert out["status"] == "noted" and len(after) == len(before) + 1
        body = vessels.s3.json(next(k for k in after if k not in before))
        assert (body["question_id"], body["step"], body["because"]) == (qid(vessels), step, because)
        assert body["facts"] == out["facts"]
    else:
        assert "error" in out and "status" not in out and after == before


def test_every_pair_is_in_the_matrix():
    assert {(s, b) for s, b, *_ in MATRIX} == {(s, b) for s, bs in __import__("decide_tools").PAIRS.items() for b in bs}
    assert sum(len(bs) for bs in __import__("decide_tools").PAIRS.values()) == 13


def test_decide_writes_the_facts_the_stage_words_its_lines_from(vessels):
    ask(vessels)
    assert decide(vessels, "read_pass", "newest", STAR)["facts"] == {"pass_id": STAR, "satellite": "Sentinel-1D", "imaged_pct": 53}
    put_cov(vessels, STAR, 0.093)
    assert decide(vessels, "read_pass", "coverage_thin", AUG30)["facts"] == {
        "pass_id": AUG30, "satellite": "Sentinel-1D", "imaged_pct": 34, "from": STAR, "checkable_pct": 9}
    put_cov(vessels, AUG30, 0.1)
    assert decide(vessels, "forecast", "coverage_thin")["facts"] == {"from": AUG30, "checkable_pct": 10}
    assert decide(vessels, "stop", "no_checked_pass")["facts"] == {
        "passes": [{"pass_id": STAR, "checkable_pct": 9}, {"pass_id": AUG30, "checkable_pct": 10}], "standard_pct": 15}
    _boxes(vessels)
    assert decide(vessels, "draft", "most_past_targets", box=1)["facts"] == {"box": 1, "share_pct": 40}
    assert decide(vessels, "draft", "soonest_look", box=2)["facts"] == {"box": 2, "look": "S1-D 10-17 UTC"}
    assert decide(vessels, "draft", "near_candidates", box=2)["facts"] == {"box": 2, "candidates_near": 2}


# --- decide: the common rules, the first read, the retry, the keys ----------------------------------

def test_every_read_pass_must_be_listed_unread_and_within_the_budget(vessels):
    ask(vessels, f"{QUESTION} Compare Sep 30 with Sep 7.")
    for pid in (SILENT, "s1d-20990101t0000"):
        assert "not listed" in decide(vessels, "read_pass", "widest", pid)["error"]
    assert "pass_id" in decide(vessels, "read_pass", "newest", "")["error"]
    assert decide(vessels, "read_pass", "asked", SEP30)["status"] == "noted"
    assert decide(vessels, "read_pass", "asked", SEP30)["error"] == "That pass is already read in this question."
    assert decide(vessels, "read_pass", "asked", SEP7)["status"] == "noted"
    out = decide(vessels, "read_pass", "coverage_thin", STAR)
    assert out["error"] == "Two passes read: go to the forecast." and out["facts"]["read"] == [SEP30, SEP7]
    assert len(decision_files(vessels)) == 2


def test_the_first_read_reasons_are_refused_as_a_second_read(vessels):
    add_pass(vessels, "s1d-20261017t0026", "2026-10-17T00:26:09Z")          # a newer, thin pass on file
    ask(vessels)
    # As a first read: newest is the new thin pass, newest_wide and widest the Oct 12 one.
    assert decide(vessels, "read_pass", "newest", STAR)["error"] == "the records do not support 'newest'"
    assert decide(vessels, "read_pass", "newest_wide", STAR)["status"] == "noted"
    put_cov(vessels, STAR, 0.1)
    for because in ("newest", "widest", "newest_wide"):
        out = decide(vessels, "read_pass", because, "s1d-20261017t0026" if because == "newest" else SEP30)
        assert out["error"] == "That reason is for the first pass; a second read is coverage_thin, no_candidates or asked."
    assert decide(vessels, "read_pass", "coverage_thin", SEP30)["status"] == "noted"


def test_a_refused_reason_then_an_accepted_one_leaves_exactly_one_file(vessels):
    ask(vessels, "Same question for the Sep 7 pass")
    assert "error" in decide(vessels, "read_pass", "widest", SEP7)
    assert decide(vessels, "read_pass", "asked", SEP7)["facts"]["asked_words"] == "Sep 7"
    (only,) = decision_files(vessels)
    assert vessels.s3.json(only)["subject"] == SEP7


def test_the_decision_file_is_named_for_the_call_and_both_key_builders(vessels):
    ask(vessels)
    q = qid(vessels)
    decide(vessels, "read_pass", "newest", STAR, tid="tooluse_AbC123xyz_-Q9")
    key = f"{PRE}decision_{q}_tooluse_AbC123xyz_-Q9.json"
    body = vessels.s3.json(key)
    assert body["tool_use_id"] == "tooluse_AbC123xyz_-Q9" and body["subject"] == STAR and body["n"] == 1
    assert vessels.vs.decision_key(q, "read_pass", "newest", STAR, call_id="tooluse_x") == f"{PRE}decision_{q}_tooluse_x.json"
    assert vessels.vs.decision_key(q, "read_pass", "newest", STAR, call_id="bad id!") is None
    # The "inputs" mode, the specified fallback: keyed by the validated inputs, subject "none" when there is none.
    assert vessels.vs.decision_key(q, "read_pass", "asked", STAR, mode="inputs") == f"{PRE}decision_{q}_read_pass_asked_{STAR}.json"
    assert vessels.vs.decision_key(q, "draft", "soonest_look", 3, mode="inputs") == f"{PRE}decision_{q}_draft_soonest_look_3.json"
    assert vessels.vs.decision_key(q, "stop", "no_checked_pass", "none", mode="inputs") == f"{PRE}decision_{q}_stop_no_checked_pass_none.json"
    assert vessels.vs.board_key("tooluse_x") == f"{PRE}passes_tooluse_x.json" and vessels.vs.board_key("") is None
    assert vessels.vs.board_key(None, mode="inputs") == f"{PRE}passes_on_file.json"
    # The live path is "call" (RUN/strands-check.md); an inputs-mode decision would carry its key.
    assert vessels.vs.DECISION_KEYS == "call"


def test_a_decision_that_cannot_be_recorded_shows_no_line(vessels, monkeypatch, caplog):
    ask(vessels)
    for context in (None, types.SimpleNamespace(tool_use={}), ctx("bad id!"), ctx("x" * 65)):
        with caplog.at_level("WARNING"):
            assert run(vessels.dt.decide("read_pass", "newest", STAR, tool_context=context)) == {
                "error": "The decision could not be recorded."}
    assert decision_files(vessels) == [] and "no tool-use id" in caplog.text
    real = vessels.vs.put_json
    monkeypatch.setattr(vessels.vs, "put_json", lambda key, body: (_ for _ in ()).throw(OSError("s3")) if "decision_" in key else real(key, body))
    assert decide(vessels, "read_pass", "newest", STAR) == {"error": "The decision could not be recorded."}
    assert decision_files(vessels) == []


def test_decide_refuses_unknown_pairs_and_missing_arguments(vessels):
    ask(vessels)
    for step, because, pid, box in (("read", "newest", STAR, 0), ("forecast", "newest", "", 0), ("draft", "soonest_look", "", 0),
                                    ("draft", "soonest_look", "", 4), ("draft", "soonest_look", "", True), (None, "x", "", 0)):
        out = run(vessels.dt.decide(step, because, pid, box, tool_context=ctx()))
        assert "error" in out and out["allowed"]["stop"] == ["no_checked_pass"]
    assert decide(vessels, "draft", "soonest_look", box=1) == {
        "error": "Run predict_hotspots for this question first: the boxes come from it."}
    assert decision_files(vessels) == []


def test_in_a_later_turn_with_no_list_passes_decide_asks_for_it(vessels):
    assert decide(vessels, "read_pass", "newest", STAR) == {"error": "Call list_passes first."}
    ask(vessels)
    decide(vessels, "read_pass", "newest", STAR)
    vessels.vs.begin_turn("And the Sep 30 pass?")
    assert decide(vessels, "read_pass", "asked", SEP30) == {"error": "Call list_passes first."}


def test_a_second_question_never_reads_the_first_ones_records(vessels):
    """A stale coverage record neither validates coverage_thin nor blocks stop."""
    ask(vessels)
    decide(vessels, "read_pass", "newest", STAR)
    put_cov(vessels, STAR, 0.25)                                           # checked, in the first question
    put_cov(vessels, AUG30, 0.09)                                          # thin, in the first question
    ask(vessels, "Same question, end of August")
    decide(vessels, "read_pass", "asked", AUG30)
    # Aug 30's only coverage record is the first question's: it does not make the pass thin here.
    assert decide(vessels, "read_pass", "coverage_thin", SEP30)["error"] == "the records do not support 'coverage_thin'"
    assert decide(vessels, "forecast", "coverage_thin")["error"] == "the records do not support 'coverage_thin'"
    assert decide(vessels, "stop", "no_checked_pass")["error"] == "the records do not support 'no_checked_pass'"
    put_cov(vessels, AUG30, 0.09)                                          # checked in this question, thin
    # Oct 12's checked record from the first question does not block stop: it was not read here.
    assert decide(vessels, "stop", "no_checked_pass")["facts"] == {"passes": [{"pass_id": AUG30, "checkable_pct": 9}],
                                                                   "standard_pct": 15}


# --- asked: the presenter's words -----------------------------------------------------------------

def _row(pid, sensed):
    return {"pass_id": pid, "sensed": sensed}


LISTED = [_row(STAR, "2026-10-12T00:18:02Z"), _row(SEP7, "2026-09-07T11:41:47Z"), _row(AUG30, "2026-08-30T00:26:09Z"),
          _row("s1d-20260512t0018", "2026-05-12T00:18:02Z"), _row("s1d-20260304t0018", "2026-03-04T00:18:02Z")]


@pytest.mark.parametrize("words,pid,named", [
    ("Same question, Sep 7", SEP7, "Sep 7"),
    ("what about 7 September", SEP7, "7 September"),
    ("the 7th of September, please", SEP7, "7th of September"),
    ("and sep. 7th?", SEP7, "sep. 7th"),
    ("on 2026-09-07", SEP7, "2026-09-07"),
    ("read S1D-20260907T1141", SEP7, "S1D-20260907T1141"),
    ("Same question, at the end of August", AUG30, "end of August"),
    ("Sep 7, 2026 again", SEP7, "Sep 7, 2026"),
    ("anyone there in May?", "s1d-20260512t0018", "in May"),
    ("the start of March", "s1d-20260304t0018", "start of March"),
])
def test_asked_names_a_pass_by_its_id_date_month_and_day_or_its_month(words, pid, named):
    import vessel_store as vs
    entry = next(p for p in LISTED if p["pass_id"] == pid)
    assert vs.names_pass(words, entry, LISTED) == named


@pytest.mark.parametrize("words,pid", [
    (QUESTION, SEP7),
    ("Sep 17", SEP7), ("Sep 70", SEP7), ("Oct 7", SEP7), ("September", SEP7),
    ("Sep 7 2025", SEP7), ("7 September 2025", SEP7), ("end of August 2025", AUG30),
    ("August was busy", AUG30),                                            # a bare month names no pass
    ("you may look", "s1d-20260512t0018"), ("May I ask?", "s1d-20260512t0018"),
    ("march on", "s1d-20260304t0018"), ("they march past", "s1d-20260304t0018"),
])
def test_asked_refuses_words_that_do_not_name_the_pass(words, pid):
    import vessel_store as vs
    entry = next(p for p in LISTED if p["pass_id"] == pid)
    assert vs.names_pass(words, entry, LISTED) is None


def test_a_month_names_a_pass_only_while_it_is_the_only_one_that_month():
    import vessel_store as vs
    two = LISTED + [_row("s1d-20260813t0018", "2026-08-13T00:18:02Z")]
    aug30 = next(p for p in two if p["pass_id"] == AUG30)
    assert vs.names_pass("at the end of August", aug30, LISTED) == "end of August"
    assert vs.names_pass("at the end of August", aug30, two) is None
    assert vs.names_pass("Aug 30", aug30, two) == "Aug 30"                 # the day still names it


def test_asked_end_to_end_and_its_words_scanned(vessels, monkeypatch):
    ask(vessels, f"{QUESTION} Same question, end of August")
    out = decide(vessels, "read_pass", "asked", AUG30)
    assert out["status"] == "noted" and out["facts"]["asked_words"] == "end of August"
    ask(vessels, "Same question, end of August")
    assert decide(vessels, "read_pass", "asked", SEP7) == {"error": "The question did not name that pass.",
                                                         "facts": {"listed": [STAR, SEP30, SEP18, SEP7, AUG30]}}
    monkeypatch.setattr(vessels.dt, "FORBIDDEN", re.compile("August"))
    assert decide(vessels, "read_pass", "asked", AUG30)["facts"]["asked_words"] == ""


# --- the gate and the budget ---------------------------------------------------------------------------

def test_the_gate_refuses_a_pass_with_no_accepted_read_pass(vessels, caplog):
    ask(vessels)
    with caplog.at_level("INFO"):
        for tool in (vessels.pt.detect_vessels, vessels.ais.check_ais_coverage, vessels.ais.match_ais):
            out = run(tool(STAR))
            assert out["error"] == "Announce this pass with decide(read_pass, ...) first."
            assert out["facts"] == {"listed": [STAR, SEP30, SEP18, SEP7, AUG30], "read": []}
    assert f"gate: refused {STAR}" in caplog.text
    assert not any(k.startswith(f"{PRE}targets_") or k.startswith(f"{PRE}coverage_") for k in vessels.s3.objects)


def test_with_no_question_open_the_tools_run_as_today(vessels):
    for tool in (vessels.pt.detect_vessels, vessels.ais.check_ais_coverage, vessels.ais.match_ais):
        assert "error" not in run(tool(STAR))                                  # no list_passes in this session


def test_two_passes_read_then_a_third_is_refused_end_to_end(vessels):
    """The thin path: Aug 30 as asked, set aside for coverage, then Oct 12; a third pass is refused by
    decide, find_pass and detect_vessels."""
    ask(vessels, f"{QUESTION} Same question, end of August")
    cov = read_and_cover(vessels, AUG30, because="asked")
    assert cov["checkable_pct"] == 6
    assert run(vessels.ais.match_ais(AUG30))["error"].startswith("This pass can check only 6% of the reserve")
    assert read_and_cover(vessels, STAR, because="coverage_thin")["checkable_pct"] == 25
    assert run(vessels.ais.match_ais(STAR))["counts"]["candidate"] == 1
    assert decide(vessels, "read_pass", "no_candidates", SEP30)["error"] == "Two passes read: go to the forecast."
    assert run(vessels.pt.find_pass(SEP30)) == {"error": "Two passes read: go to the forecast.", "facts": {"read": [AUG30, STAR]}}
    assert run(vessels.pt.detect_vessels(SEP30))["error"] == "Announce this pass with decide(read_pass, ...) first."
    assert run(vessels.pt.find_pass(STAR))["pass_id"] == STAR                  # a pass read stays readable


def test_after_a_two_pass_question_the_spare_runs_in_a_new_turn(vessels):
    """Review M1: the question closes when its turn ends, so the silent-vessel spare's find_pass runs;
    draft_tasking is still held to the latest question, and match_ais and gather_evidence still refuse
    an earlier question's records."""
    ask(vessels, f"{QUESTION} Same question, end of August")
    read_and_cover(vessels, AUG30, because="asked")
    read_and_cover(vessels, STAR, because="coverage_thin")
    run(vessels.ais.match_ais(STAR))
    vessels.vs.begin_turn("Has a vessel gone silent near here?")
    assert run(vessels.ft.reachable_area())["pass_id"] == SILENT
    assert run(vessels.pt.find_pass(SILENT))["pass_id"] == SILENT
    assert "error" not in run(vessels.pt.detect_vessels(SILENT))
    assert decide(vessels, "forecast", "coverage_thin") == {"error": "Call list_passes first."}
    assert run(vessels.tk.draft_tasking(STAR, 1)) == {"error": "Announce the box with decide(draft, ...) first."}
    ask(vessels)                                                           # a second question opens, then its turn ends
    vessels.vs.begin_turn("And the candidates on Oct 12?")
    assert run(vessels.ais.match_ais(STAR)) == {"error": "Run check_ais_coverage again for this question."}
    assert run(vessels.ais.gather_evidence(STAR)) == {"error": "Those records are from an earlier question: read the pass again."}
    assert run(vessels.tk.draft_tasking(STAR, 1)) == {"error": "Announce the box with decide(draft, ...) first."}


# --- coverage, the standard and match_ais' next steps ---------------------------------------------------

def test_the_coverage_is_clipped_to_the_radar_and_counts_a_target_outside_the_swath(vessels):
    """Aug 30 imaged the west of the reserve; its targets lie east of the swath. Each target's cell is
    imaged, so A's received cell is checkable; reserve water outside the radar has neither area."""
    from shapely.geometry import Point, shape
    from conftest import A
    ask(vessels, "Same question, end of August")
    cov = read_and_cover(vessels, AUG30, because="asked")
    assert (cov["imaged_share"], cov["heard_share"], cov["checkable_share"]) == (0.34, 0.351, 0.059)
    heard = shape(vessels.s3.json(f"{PRE}heard_{AUG30}.geojson")["features"][0]["geometry"])
    unknown = shape(vessels.s3.json(f"{PRE}unproven_{AUG30}.geojson")["features"][0]["geometry"])
    assert heard.covers(Point(*A))                                         # its cell's centre is outside the swath
    outside = Point(-89.3, -1.0)                                           # received water the radar did not image
    assert vessels.vs.in_reserve(*outside.coords[0]) and not heard.covers(outside) and not unknown.covers(outside)
    assert heard.intersection(unknown).area < 0.005 * heard.area           # only the drawing's simplification slivers
    record = vessels.s3.json(f"{PRE}coverage_{AUG30}.json")
    assert isinstance(record["heard_share"], float) and record["checkable_share"] == 0.059
    assert record["question_id"] == qid(vessels)


def test_coverage_shares_on_a_small_grid():
    import numpy as np
    import ais_coverage as cv
    from predict import Grid
    grid = Grid(0.0, 0.0, 1.0, 1.0, 0.25)                                  # 4 x 4
    water = np.ones((4, 4), dtype=bool)
    water[3, 3] = False
    heard = np.zeros((4, 4), dtype=bool)
    heard[0:2, :] = True
    imaged = np.zeros((4, 4), dtype=bool)
    imaged[:, 0:2] = True
    with_target = cv.with_target_cells(imaged, grid, [(0.9, 0.1), (5.0, 5.0)])   # one in an unimaged cell, one off the grid
    assert with_target[0, 3] and with_target.sum() == imaged.sum() + 1
    assert cv.coverage_shares(heard, with_target, water) == {"imaged_share": round(9 / 15, 3), "heard_share": round(8 / 15, 3),
                                                             "checkable_share": round(5 / 15, 3)}
    assert cv.cells_shape(imaged, grid).area == pytest.approx(0.5) and cv.cells_shape(np.zeros((4, 4), bool), grid).is_empty


def test_the_imaged_area_must_be_built(vessels, caplog):
    m = vessels.s3.json("vessels/cache/v1/manifest.json")
    del m["passes"][STAR]["imaged_cells"]
    m["passes"][SEP30]["imaged_grid"] = [0, 0, 1, 1, 0.05]
    vessels.s3.put_object(Bucket=BUCKET, Key="vessels/cache/v1/manifest.json", Body=json.dumps(m))
    vessels.vs.clear_cache()
    with caplog.at_level("WARNING"):
        for pid in (STAR, SEP30):
            assert run(vessels.ais.check_ais_coverage(pid)) == {
                "error": f"The imaged area for {pid} is not built (scripts/build_vessel_cache.py --imaged)."}
    assert "no imaged cells" in caplog.text


def test_match_ais_refuses_a_pass_under_the_standard_and_a_stale_record(vessels):
    run(vessels.ais.check_ais_coverage(AUG30))                             # no question: ungated
    assert run(vessels.ais.match_ais(AUG30)) == {
        "error": "This pass can check only 6% of the reserve, under the 15% standard: no target on it can be called a candidate.",
        "checkable_pct": 6, "standard_pct": 15}
    assert not any(k.startswith(f"{PRE}match_") for k in vessels.s3.objects)
    run(vessels.ais.check_ais_coverage(STAR))                              # stamped before any question
    ask(vessels)
    decide(vessels, "read_pass", "newest", STAR)
    assert run(vessels.ais.match_ais(STAR)) == {"error": "Run check_ais_coverage again for this question."}
    run(vessels.ais.check_ais_coverage(STAR))
    out = run(vessels.ais.match_ais(STAR))
    assert out["checkable_share"] == 0.246 and out["say_as"]["unproven"] == "reception unknown"
    assert vessels.s3.json(f"{PRE}match_{STAR}.json")["question_id"] == qid(vessels)


def test_match_ais_next_steps_word_for_word(vessels):
    run(vessels.ais.check_ais_coverage(STAR))
    assert run(vessels.ais.match_ais(STAR))["next_steps"] == (
        "Show the targets (display_visual with targets_s3_url and render) with your next call; then the evidence.")
    run(vessels.ais.check_ais_coverage(SEP18))
    out = run(vessels.ais.match_ais(SEP18))
    assert out["counts"]["candidate"] == 0 and out["next_steps"] == (
        "Show the targets (display_visual with targets_s3_url and render) with your next call. "
        "No candidates on this pass: decide what follows.")


def test_next_steps_name_no_call_order(vessels):
    """Each tool's next steps say what to show or judge, never which investigation call comes next."""
    ask(vessels)
    decide(vessels, "read_pass", "newest", STAR)
    outs = {"find_pass": run(vessels.pt.find_pass(STAR)), "detect_vessels": run(vessels.pt.detect_vessels(STAR)),
            "check_ais_coverage": run(vessels.ais.check_ais_coverage(STAR)), "match_ais": run(vessels.ais.match_ais(STAR)),
            "gather_evidence": run(vessels.ais.gather_evidence(STAR)), "predict_hotspots": run(vessels.ft.predict_hotspots(STAR)),
            "next_look": run(vessels.ft.next_look(1)), "fleet_pattern": run(vessels.ft.fleet_pattern())}
    ask(vessels, "Same question, end of August")                           # a thin pass only: the forecast ends on stop
    read_and_cover(vessels, AUG30, because="asked")
    outs["predict_hotspots (thin)"] = run(vessels.ft.predict_hotspots(AUG30))
    assert outs["detect_vessels"]["next_steps"] == "Show the targets (display_visual with targets_s3_url and render); then the coverage check."
    assert outs["check_ais_coverage"]["next_steps"].endswith("judge this pass against the standard.")
    for name, out in outs.items():
        steps = out["next_steps"]
        assert not re.search(r"(detect_vessels|check_ais_coverage|match_ais|gather_evidence|fleet_pattern|draft_tasking)\(", steps), name
        # The forecast's two endings are its fork, decisions not investigation calls: a box with
        # decide beside next_look, or decide stop.
        fork = steps.replace("announce it with decide in the same response as next_look", "").replace(
            "so there is no box to draft: decide stop, then write the answer", "")
        assert "fleet_pattern" not in steps and "in the same response as" not in fork and "decide" not in fork, name


# --- predict_hotspots(pass_id) ------------------------------------------------------------------------

def test_predict_hotspots_next_steps_name_the_ending_this_questions_records_allow(vessels):
    """Review B1: after thin passes only, the forecast's next steps end on stop, never on a draft (so no
    'Decided: Drafting box k' line precedes a tasking that cannot be drafted); after a checked pass
    they ask for the box. With no question open they read as today."""
    show = "Show the heat and the boxes (display_visual with each render); say the check with say, word for word. "
    draft = show + "Choose which box to draft and announce it with decide in the same response as next_look."
    stop = show + "No pass read in this question could be checked, so there is no box to draft: decide stop, then write the answer."
    assert run(vessels.ft.predict_hotspots())["next_steps"] == draft          # no question open
    # A thin-only question: Aug 30 checks 6%, under the standard, so match_ais never runs on it.
    ask(vessels, "Same question, end of August")
    read_and_cover(vessels, AUG30, because="asked")
    assert decide(vessels, "forecast", "coverage_thin")["status"] == "noted"
    assert run(vessels.ft.predict_hotspots(AUG30))["next_steps"] == stop
    assert decide(vessels, "stop", "no_checked_pass")["status"] == "noted"   # the ending it names is accepted
    # Another question in a new turn: the first one's records count for nothing here.
    ask(vessels)
    assert run(vessels.ft.predict_hotspots())["next_steps"] == stop          # nothing read yet, nothing checked
    read_and_cover(vessels, STAR)                                           # 25%: checked, before match_ais
    assert run(vessels.ft.predict_hotspots(STAR))["next_steps"] == draft
    run(vessels.ais.match_ais(STAR))
    assert run(vessels.ft.predict_hotspots(STAR))["next_steps"] == draft
    # Thin, then checked in the same question: the second pass's match record makes it a draft.
    ask(vessels, "Same question, end of August")
    read_and_cover(vessels, AUG30, because="asked")
    assert run(vessels.ft.predict_hotspots(AUG30))["next_steps"] == stop
    read_and_cover(vessels, STAR, because="coverage_thin")
    run(vessels.ais.match_ais(STAR))
    assert run(vessels.ft.predict_hotspots(STAR))["next_steps"] == draft


def test_predict_hotspots_counts_this_questions_candidates_near_each_box(vessels):
    boxes = run(vessels.ft.predict_hotspots())["boxes"]
    assert all("candidates_near" not in b for b in boxes)                  # no pass, no count
    w, s, e, n = boxes[0]["bounds"]
    near_2 = (boxes[1]["bounds"][2] + 0.03, (boxes[1]["bounds"][1] + boxes[1]["bounds"][3]) / 2)   # about 3 km east of box 2
    targets = [{"status": "candidate", "lon": (w + e) / 2, "lat": (s + n) / 2},
               {"status": "candidate", "lon": near_2[0], "lat": near_2[1]},
               {"status": "candidate", "lon": -89.0, "lat": 1.5},
               {"status": "seen_once", "lon": (w + e) / 2, "lat": (s + n) / 2}]
    ask(vessels)
    put(vessels, f"match_{STAR}.json", {"pass_id": STAR, "targets": targets, "question_id": qid(vessels)})
    out = run(vessels.ft.predict_hotspots(STAR))
    assert [b["candidates_near"] for b in out["boxes"]] == [1, 1, 0]
    assert vessels.s3.json(f"{PRE}hotspots.json")["question_id"] == qid(vessels)
    assert [b["candidates_near"] for b in run(vessels.ft.predict_hotspots(SEP30))["boxes"]] == [0, 0, 0]   # no match record
    put(vessels, f"match_{STAR}.json", {"pass_id": STAR, "targets": targets, "question_id": "0123456789ab"})
    assert [b["candidates_near"] for b in run(vessels.ft.predict_hotspots(STAR))["boxes"]] == [0, 0, 0]    # another question's
    assert run(vessels.ft.predict_hotspots("s1d-20990101t0000"))["error"].startswith(vessels.vs.ON_FILE_ONLY)


def test_each_figure_rides_beside_its_own_layer(vessels):
    out = run(vessels.ft.predict_hotspots(STAR))
    heat = vessels.s3.json(f"{PRE}hotspots.geojson")["features"]
    first = heat[0]["properties"]
    assert first["check_pct"] == 100 and first["check_times"] == 20.0 and first["check_since"] == "2026-07-01"
    assert all("check_pct" not in f["properties"] for f in heat[1:])
    feats = vessels.s3.json(f"{PRE}boxes.geojson")["features"]
    assert [f["properties"]["label"] for f in feats] == ["Box 1", "Box 2", "Box 3"]       # no share on the map
    for f in feats:
        props = f["properties"]
        assert {"boxes_pct", "boxes_times", "boxes_days_hit", "days"} <= set(props)
        assert not {"check_pct", "check_times", "check_since", "share"} & set(props)
        assert "%" not in props["label"]
    assert out["say"] == "Refitted before each radar day since July, the map's top 5% of water held 100% of the dark targets, 20 times chance."
    assert out["say_boxes"] == "Refitted the same way, the three patrol boxes held 100% of the dark targets, 104 times chance."
    assert len(out["say"].split()) == 22 and len(out["say_boxes"].split()) == 17


def test_with_no_radar_days_the_check_is_not_claimed(vessels):
    h = vessels.s3.json("vessels/cache/v1/history_v1.json")
    h["dark"]["rows"] = [r for r in h["dark"]["rows"] if r[0] < "2026-07-01"]
    vessels.s3.put_object(Bucket=BUCKET, Key="vessels/cache/v1/history_v1.json", Body=json.dumps(h))
    vessels.vs.clear_cache()
    out = run(vessels.ft.predict_hotspots())
    assert out["say"] == "No dark targets were found from July 1, 2026, so the map's check cannot be measured."
    assert out["say_boxes"] == out["say"] and out["rolling"]["top_5pct_of_water_held"] is None
    assert vessels.s3.json(f"{PRE}hotspots.geojson")["features"][0]["properties"]["check_pct"] is None


# --- draft_tasking and tasking_status -------------------------------------------------------------------

def _question_to_draft(v, prompt=QUESTION):
    ask(v, prompt)
    read_and_cover(v, STAR)
    run(v.ais.match_ais(STAR))
    run(v.ft.predict_hotspots(STAR))


def test_draft_tasking_holds_to_the_decided_box_in_this_question(vessels):
    _question_to_draft(vessels)
    assert run(vessels.tk.draft_tasking(STAR, 1)) == {"error": "Announce the box with decide(draft, ...) first."}
    decide(vessels, "draft", "most_past_targets", box=1)
    assert run(vessels.tk.draft_tasking(STAR, 2)) == {"error": "You decided box 1."}
    out = run(vessels.tk.draft_tasking(STAR, 1))
    draft = vessels.s3.json(f"session_data/{SESSION}/taskings/{out['tasking_id']}.draft.json")
    # The backend needs a numeric heard_share; the new shares and the rolling check ride beside it.
    assert isinstance(draft["heard_share"], float) and draft["heard_share"] == 0.351
    assert (draft["imaged_share"], draft["checkable_share"]) == (0.527, 0.246)
    assert draft["rolling"]["total"] > 0 and draft["check"]["top_5pct"]["total"] > 0 and draft["box"]["box"] == 1


def test_draft_tasking_refuses_the_first_questions_match_record_in_a_second(vessels):
    _question_to_draft(vessels)
    ask(vessels, "Same question for the Oct 12 pass")
    decide(vessels, "read_pass", "asked", STAR)
    run(vessels.ft.predict_hotspots(STAR))                                 # this question's hotspots
    decide(vessels, "draft", "most_past_targets", box=1)
    assert run(vessels.tk.draft_tasking(STAR, 1)) == {"error": "Those records are from an earlier question: read the pass again."}


def test_tasking_status_with_no_id_reads_the_newest_draft(vessels):
    assert run(vessels.tk.tasking_status("")) == {"error": "No tasking has been drafted in this session."}
    _question_to_draft(vessels)
    decide(vessels, "draft", "most_past_targets", box=1)
    tid = run(vessels.tk.draft_tasking(STAR, 1))["tasking_id"]
    out = run(vessels.tk.tasking_status())
    assert out == {"tasking_id": tid, "status": "draft", "say": "The tasking is a draft; the officer has not filed it."}
    vessels.s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/taskings/{tid}.filed.json",
                          Body=json.dumps({"status": "filed", "filed_at": "2026-10-16T18:05:00Z"}))
    assert run(vessels.tk.tasking_status(""))["say"] == "Yes, it is on file: filed at 18:05 UTC."
    assert run(vessels.tk.tasking_status("../x"))["error"]


# --- the docstring pins (the answer cap is in test_prompt.py, with the prompt's templates) -----------------

def _tool_functions():
    import ais_tools
    import decide_tools
    import forecast_tools
    import pass_tools
    import tasking_tools
    return [pass_tools.list_passes, pass_tools.find_pass, pass_tools.detect_vessels, decide_tools.decide,
            ais_tools.check_ais_coverage, ais_tools.match_ais, ais_tools.gather_evidence, forecast_tools.predict_hotspots,
            forecast_tools.next_look, forecast_tools.fleet_pattern, forecast_tools.reachable_area,
            tasking_tools.draft_tasking, tasking_tools.tasking_status]


def test_no_tool_docstring_carries_a_concrete_pass_id():
    for fn in _tool_functions():
        assert not re.search(r"s1[a-d]-\d{8}", fn.__doc__, re.I), fn.__name__


def test_the_decide_docstring_is_the_designs_neutral_list_in_table_order():
    import decide_tools
    doc = inspect.cleandoc(decide_tools.decide.__doc__)
    spec = SPEC.read_text()
    block = spec.split("**The `decide` docstring**", 1)[1].split("```", 2)[1].strip("\n")
    assert doc == block                                                    # exactly as §3.5
    order = [b for bs in decide_tools.PAIRS.values() for b in bs if b not in ("coverage_thin", "no_candidates")
             or bs is decide_tools.PAIRS["read_pass"]]
    positions = [doc.index(f'"{b}":') for b in order]
    assert positions == sorted(positions)
    for word in ("best", "prefer", "recommended", "usually", "should"):
        assert not re.search(rf"\b{word}\b", doc, re.I)
