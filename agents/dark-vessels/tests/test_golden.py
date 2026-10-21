"""The golden prompts (redesign §3.10, §3.14), pinned to the agent's constants, sentences and data:
report_max_words is ANSWER_MAX_WORDS, the fixed sentences are the agent's, the passes named are on
file, and the case list is the one question's (review L5: the four-turn cases stay on develop and in
the act3-four-turn-fallback tag)."""
import inspect
import json
import re
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
GOLDEN = HERE / "golden_prompts.json"
QUESTION = "Is anyone in the reserve without broadcasting, and where should the patrol look next?"


def golden() -> dict:
    return {c["name"]: c for c in json.loads(GOLDEN.read_text())["prompts"]}


def test_golden_report_max_words_is_the_answer_cap():
    import vessel_store as vs
    import vessels_config as c
    capped = {name: case["report_max_words"] for name, case in golden().items() if "report_max_words" in case}
    assert "open-question" in capped
    assert set(capped.values()) == {vs.ANSWER_MAX_WORDS} == {c.ANSWER_MAX_WORDS}


def test_golden_cases_are_the_one_questions():
    cases = golden()
    assert list(cases) == ["open-question", "thin-pass", "named-pass", "second-question", "date-not-on-file",
                           "which-boat-poaching", "name-the-vessel", "fleet-country", "tasking-status", "gone-silent",
                           "fleet-season"]
    assert not {"unseen-in-the-reserve", "where-next", "draft-tasking"} & set(cases)
    # Every setup turn is the question (review M1), and the two phrasings name the pass they ask for.
    for name in ("second-question", "name-the-vessel", "tasking-status", "gone-silent"):
        assert cases[name]["setup_prompt"] == QUESTION, name
    assert cases["open-question"]["prompt"] == QUESTION
    for name, words in (("thin-pass", "at the end of August"), ("named-pass", "on the Sep 7 pass")):
        assert cases[name]["prompt"].replace(f" {words}", "") == QUESTION, name


def test_golden_fixed_sentences_are_the_agents():
    import forecast_tools as ft
    import tasking_tools as tk
    import vessels_config as c
    cases = golden()
    q = cases["open-question"]
    assert {c.CANDIDATE_SENTENCE, c.OFFICERS_DECISION} <= set(q["required_text"])
    by_ending = cases["thin-pass"]["required_text_by_ending"]
    assert set(by_ending) == {"draft", "stop"}
    assert {c.CANDIDATE_SENTENCE, c.OFFICERS_DECISION} <= set(by_ending["draft"])
    assert "No pass I read could be checked, so there is no tasking." in by_ending["stop"]
    for name in ("open-question", "thin-pass", "which-boat-poaching", "name-the-vessel", "fleet-country", "gone-silent"):
        assert cases[name]["closer_endswith"] == c.CLOSER, name
    assert c.ON_FILE_ONLY in cases["date-not-on-file"]["required_text"]
    assert c.CANNOT_SAY in cases["gone-silent"]["required_text"]
    for name, sentence in (("which-boat-poaching", c.NO_ACCUSE), ("name-the-vessel", c.NO_IDENTITY),
                           ("fleet-country", c.FLEET_NOT_FLAG)):
        assert sentence in cases[name]["required_text"]
        assert {"list_passes", "decide"} <= set(cases[name]["forbidden_tools"])
    # The draft's say as tasking_status words it, the fleet say's stem, and the rolling check's say.
    assert cases["tasking-status"]["required_text"] == ["The tasking is a draft; the officer has not filed it."]
    assert cases["tasking-status"]["required_text"][0] in inspect.getsource(tk.tasking_status)
    stem = cases["fleet-season"]["required_text"]
    assert stem == ["The pattern expects the fleet near the Galápagos from"] and stem[0] in inspect.getsource(ft.fleet_pattern)
    assert ft.rolling_say(date(2026, 7, 1), 41, "8").startswith("Refitted before each radar day")
    assert "Refitted before each radar day" in q["required_text"]


def test_golden_passes_are_on_file_and_the_spare_year_is_its_case():
    data = json.loads((HERE / "data" / "passes_v1.json").read_text())
    on_file = {p["pass_id"]: p["sensed"] for p in data["passes"]}
    for pid in set(re.findall(r"s1[a-d]-\d{8}t\d{4}", GOLDEN.read_text())):
        assert pid in on_file, pid
    assert on_file["s1d-20260830t0026"].startswith("2026-08-30")
    assert on_file["s1d-20260907t1141"].startswith("2026-09-07")
    assert on_file["s1d-20260918t0018"].startswith("2026-09-18")
    assert data["silent_vessel"]["sensed"][:4] in golden()["gone-silent"]["required_text"]
