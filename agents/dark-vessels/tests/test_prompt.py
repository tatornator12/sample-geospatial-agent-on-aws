"""The one open question's prompt (redesign §3.4, §3.14): the blocks it keeps, replaces and deletes,
its pins (no pass, date or box named; no retired words; the standard and the cap quoted from the
store; the ANSWER block's three endings), and the longest legal answer under the cap, built from the
prompt's own templates. The golden prompts' pins are in test_golden.py."""
import re
from datetime import date

import pytest


@pytest.fixture(scope="module")
def prompt():
    import vessels_config as c
    return c.build_prompt("2026-10-23")


def flat(text: str) -> str:
    """The prompt with its line wraps undone, so a quoted template reads as one line."""
    return " ".join(text.split())


# --- the prompt's pins -----------------------------------------------------------------------------------

def test_the_prompt_names_no_pass_no_date_and_no_box(prompt):
    """R2.2: the prompt names no pass, no date and no box."""
    assert not re.search(r"s1[a-d]-\d{8}", prompt, re.I)
    assert not re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b", prompt)
    assert not re.search(r"box [1-3]", prompt, re.I)
    assert "Current date is 2026-10-23" in prompt          # today's date, ISO, is the only date


def test_the_prompt_has_no_workflow_no_arrows_no_em_dash_and_no_retired_words(prompt):
    assert "WORKFLOW" not in prompt and "→" not in prompt and "—" not in prompt and "–" not in prompt
    assert not re.search(r"heard water|unproven|not evidence", prompt, re.I)
    assert not re.search(r"four turns|passes_on_file|FINAL REPORT|CONFIDENCE", prompt)
    # LOOK BEFORE YOU ANALYSE keeps its sentences; the counts live in BUDGET only.
    assert "at most two evidence chips" not in prompt and "At most 4 inspections" not in prompt


def test_the_prompt_quotes_the_standard_and_the_cap_from_the_store(prompt):
    import vessel_store as vs
    import vessels_config as c
    assert c.FLOOR == 15 == round(100 * vs.CHECKABLE_FLOOR) and c.ANSWER_MAX_WORDS == vs.ANSWER_MAX_WORDS == 120
    text = flat(prompt)
    assert f"Under {c.FLOOR}% of the reserve it is too thin" in text
    assert f"ANSWER (at most {c.ANSWER_MAX_WORDS} words in all;" in text


def test_the_blocks_kept_replaced_and_added(prompt):
    text = flat(prompt)
    blocks = ["HARD RULES", "RESPONSE STYLE:", "DISPLAY RIDES ALONG:", "LOOK BEFORE YOU ANALYSE:", "UNITS:",
              "ATTRIBUTION:", "GOAL:", "START:", "THE STANDARD:", "DECISIONS:", "BUDGET:", "STOP:", "ANSWER (",
              "SPARES (only when asked):"]
    positions = [text.index(b) for b in blocks]
    assert positions == sorted(positions)                       # the new blocks sit where WORKFLOW was
    # Rule 1 names list_passes; rule 2 says reception unknown proves nothing.
    assert "Every pass comes from list_passes, find_pass or reachable_area;" in text
    assert "and name the passes from list_passes." in text
    assert "Where AIS reception is unknown, no AIS proves nothing: a target there is never a candidate." in text
    assert "START: when the presenter asks about the reserve, a pass or a date, call list_passes first." in text
    # The titles are placeholders; the spares keep theirs.
    for title in ('"Radar, <date>"', '"Radar targets"', '"AIS received"', '"AIS reception unknown"',
                  '"Dark targets seen before"', '"Patrol boxes"', '"Next radar look"', '"Squid fleet, latest month"',
                  '"Reach by water, <date>"'):
        assert title in text, title
    assert 'call decide("stop", "no_checked_pass"), then write the answer with no draft.' in text
    assert "with no decide and no find_pass" in text


def test_the_prompt_carries_every_fixed_sentence(prompt):
    import vessel_store as vs
    import vessels_config as c
    for sentence in (c.ON_FILE_ONLY, c.CANDIDATE_SENTENCE, c.CANNOT_SAY, c.OFFICERS_DECISION, c.NO_ACCUSE,
                     c.NO_IDENTITY, c.FLEET_NOT_FLAG, c.CLOSER):
        assert sentence in prompt, sentence
    assert vs.SAY_ELSE not in prompt                            # said word for word from gather_evidence


PASS_BULLET = "Read <date> (<c>% checkable); data from Global Fishing Watch."
SET_ASIDE_BULLET = "Read <date> (<c>% checkable) after setting <date2> aside (<c2>%); data from Global Fishing Watch."
CANDIDATES_BULLET = "Candidates <ids>: <a> to <b> km from port."


def templates(prompt) -> dict:
    """The candidates ending's fixed bullet words, as quoted in the prompt."""
    quoted = re.findall(r'"([^"]+)"', endings(prompt)["candidates"]["text"])
    reads = [q for q in quoted if q.startswith("Read <date>")]
    return {"pass": next(q for q in reads if "aside" not in q), "set_aside": next(q for q in reads if "aside" in q),
            "candidates": next(q for q in quoted if q.startswith("Candidates <ids>"))}


def endings(prompt) -> dict:
    """The ANSWER block's three endings: each one's FIRST LINE and its END."""
    block = flat(prompt).split("on how the question ended:", 1)[1].split("The boxes' own record", 1)[0]
    parts = re.split(r" - (?=A draft, with candidates\.|A draft, with no candidates\.|No draft, after)", " " + block)
    out = {}
    for part in (p.strip() for p in parts if p.strip()):
        key = ("candidates" if part.startswith("A draft, with candidates") else
               "none" if part.startswith("A draft, with no candidates") else "stop")
        first = re.search(r'FIRST LINE "([^"]+)"', part).group(1)
        end = re.search(r'END with (?:one paragraph: )?"([^"]+)"', part).group(1)
        out[key] = {"first": first, "end": end, "text": part}
    return out


def test_the_answer_block_has_three_endings(prompt):
    import vessel_store as vs
    import vessels_config as c
    e = endings(prompt)
    assert set(e) == {"candidates", "none", "stop"}
    assert e["candidates"]["first"] == "<n> candidates on the <date> pass; I drafted box <k> for the next look."
    assert e["none"]["first"] == "No candidates on the <date> pass; I drafted box <k> for the next look."
    assert e["stop"]["first"] == "No pass I read could be checked, so there is no tasking."
    assert e["candidates"]["end"] == e["none"]["end"] == f"{c.OFFICERS_DECISION} {c.CLOSER}"
    assert e["stop"]["end"] == c.CLOSER and "alone: no say_else and no candidate sentence" in e["stop"]["text"]
    assert "at most four bullets" in e["candidates"]["text"] and '"and <N> more"' in e["candidates"]["text"]
    assert "say_else, word for word" in e["candidates"]["text"]
    assert '"No candidates on <date> in the <c>% it could check"' in e["none"]["text"]
    # Gate A attempt 1: the pass and candidates bullets have fixed words, so the answer cannot outgrow the cap.
    assert templates(prompt) == {"pass": PASS_BULLET, "set_aside": SET_ASIDE_BULLET, "candidates": CANDIDATES_BULLET}
    assert "the pass, in the words above;" in e["none"]["text"]
    # Attempt 2's first run used the set-aside words for a single pass ("after setting Sep 7 aside").
    assert "or, only if you read another pass first and set it aside," in e["candidates"]["text"]
    for kind in ("candidates", "none"):
        assert "Then the candidate sentence." in e[kind]["text"]
    assert "the forecast's say, word for word" in e["stop"]["text"] and "Global Fishing Watch" in e["stop"]["text"]
    assert vs.ANSWER_MAX_WORDS == 120


def test_the_answer_begins_with_its_first_line_and_dates_have_no_year(prompt):
    """Gate A attempt 1: two answers opened on "---" and one dated its pass with the year, one word each over the cap."""
    text = flat(prompt)
    assert 'begin with the FIRST LINE itself, nothing before it, no heading and no "---";' in text
    assert "A <date> is the month's three letters and the day, with no year." in text
    assert "name the passes from it by date in one sentence, and stop" in text        # no list, so no em dash
    # Rule 2's evidence order (R2.2 allows it) puts both coverage areas on the map before match_ais (M2).
    assert "detect_vessels, check_ais_coverage with both of its areas on the map, match_ais, and only then" in text


def test_the_gone_silent_spare_ends_on_the_closer(prompt):
    """Gate A attempt 1: the spare's answer ended on where the AIS came back on, not on the closer."""
    import vessels_config as c
    text = flat(prompt)
    assert (f'"{c.CANNOT_SAY}"; where its AIS came back on comes after that, and the answer ENDS with one paragraph: '
            f'one short sentence, then "{c.CLOSER}")') in text


# --- the answer cap (§3.14, review L10) ------------------------------------------------------------------

def fill(template: str, *values: str) -> str:
    """Fill a template's placeholders in order of appearance."""
    out = template
    for v in values:
        out = re.sub(r"<[a-z0-9]+>", v, out, count=1)
    assert "<" not in out, out
    return out


def test_the_longest_legal_answer_is_within_the_cap(prompt):
    """Seven candidates, a set-aside pass, the longest say ("September", "100%", "14 times"): 117 words
    split on whitespace, as report_max_words counts, with the four bullet markers. Every line but the
    tools' own sentences comes from the prompt's templates (the first line, the pass and candidates
    bullets, the closing paragraph), so the prompt cannot outgrow the cap. Gate A attempt 1 found the
    bullets written freely at 20 to 25 words, over the cap."""
    import forecast_tools as ft
    import vessel_store as vs
    import vessels_config as c
    e = endings(prompt)["candidates"]
    t = templates(prompt)
    first = e["first"].replace("<n>", "7").replace("<date>", "Sep 30").replace("<k>", "3")
    assert first == "7 candidates on the Sep 30 pass; I drafted box 3 for the next look."
    read = fill(t["set_aside"], "Sep 30", "22", "Aug 30", "10")
    assert read == "Read Sep 30 (22% checkable) after setting Aug 30 aside (10%); data from Global Fishing Watch."
    cands = fill(t["candidates"], "T01, T02, T03, T04 and 3 more", "12", "31")
    say = ft.rolling_say(date(2026, 9, 1), 100, "14")
    lines = [first, "", f"- {read}", f"- {cands}", f"- {vs.SAY_ELSE}", f"- {say}", "", c.CANDIDATE_SENTENCE, "", e["end"]]
    assert [len(x.split()) for x in (first, read, cands, vs.SAY_ELSE, say, c.CANDIDATE_SENTENCE, e["end"])] == [
        15, 16, 14, 15, 22, 15, 16]
    assert len("\n".join(lines).split()) == 117 <= c.ANSWER_MAX_WORDS == vs.ANSWER_MAX_WORDS == 120
    assert len(fill(t["pass"], "Sep 30", "22").split()) == 10                # a single pass read is shorter still
    assert vs.CHECKABLE_FLOOR == 0.15
