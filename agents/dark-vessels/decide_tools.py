"""Dark Vessels, the decisions (redesign §3.5). The agent announces each choice with decide before it
acts on it: which pass to read, what follows a pass too thin to check or with no candidates, which box
to draft, or that no pass read could be checked. decide checks the reason against this question's
records and the presenter's words and writes one file per accepted call, which the stage prints as a
line; a refused reason writes nothing and returns the facts. The tools downstream refuse a pass or a
box with no accepted decision."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone

from strands import tool

import vessel_store as vs
from tasking_tools import FORBIDDEN, IDENTIFIER

logger = logging.getLogger(__name__)

# Every (step, because) pair, in the table's order (the docstring lists them the same way).
PAIRS = {
    "read_pass": ("newest", "widest", "newest_wide", "coverage_thin", "no_candidates", "asked"),
    "forecast": ("coverage_thin", "no_candidates"),
    "draft": ("most_past_targets", "soonest_look", "near_candidates", "only_planned_look"),
    "stop": ("no_checked_pass",),
}
FIRST_READ = ("newest", "widest", "newest_wide")
NOT_RECORDED = "The decision could not be recorded."
FIRST_READ_ONLY = "That reason is for the first pass; a second read is coverage_thin, no_candidates or asked."
NOT_NAMED = "The question did not name that pass."
TWO_READ = "Two passes read: go to the forecast."
_LOCK = threading.Lock()        # one check-and-write at a time, whatever runs a response's calls


def _pct(share) -> int | None:
    return round(100 * share) if isinstance(share, (int, float)) and not isinstance(share, bool) else None


def _allowed() -> dict:
    return {k: list(v) for k, v in PAIRS.items()}


def _in_question(kind: str, qid: str, pass_id: str | None = None) -> dict | None:
    """A session record (coverage, match, hotspots) only when this question wrote it."""
    rec = vs.get_record(kind, pass_id)
    return rec if rec is not None and rec.get("question_id") == qid else None


def _thin(cov: dict | None) -> bool:
    share = cov.get("checkable_share") if cov else None
    return isinstance(share, (int, float)) and not isinstance(share, bool) and share < vs.CHECKABLE_FLOOR


def _candidates(match: dict | None) -> int | None:
    return None if match is None else sum(t.get("status") == "candidate" for t in match.get("targets", []))


def _scan(words: str) -> str:
    """asked_words is stored only when it carries nothing that accuses or identifies."""
    return "" if FORBIDDEN.search(words) or IDENTIFIER.search(words) else words


def _context(q: dict, read: list[str], qid: str, boxes: list | None = None) -> dict:
    """What a refusal shows the model, so it can decide again: the passes listed and read, the last
    pass read with its checkable share and candidates, the standard, and the boxes for a draft."""
    facts = {"listed": [{"pass_id": p["pass_id"], "sensed": p.get("sensed"), "imaged_pct": p.get("imaged_pct")}
                        for p in q.get("passes", [])],
             "read": read, "standard_pct": _pct(vs.CHECKABLE_FLOOR)}
    if read:
        last = read[-1]
        cov, match = _in_question("coverage", qid, last), _in_question("match", qid, last)
        facts["last_read"] = {"pass_id": last, "checkable_pct": _pct(cov.get("checkable_share")) if cov else None,
                              "candidates": _candidates(match)}
    if boxes is not None:
        facts["boxes"] = [{"box": b.get("box"), "share_pct": _pct(b.get("share_of_past_dark_targets")),
                           "next_look": (b.get("next_look") or {}).get("text"), "candidates_near": b.get("candidates_near", 0)}
                          for b in boxes]
    return facts


def _unsupported(because: str, step: str, facts: dict) -> dict:
    logger.info("decide: refused %s/%s (not supported)", step, because)
    return {"error": f"the records do not support '{because}'", "facts": facts}


def _read_pass(q, qid, read, because, pass_id) -> tuple[dict | None, dict | None]:
    """(facts to write, refusal): the rules every read_pass shares, then the reason's own."""
    listed = q.get("passes", [])
    entry = next((p for p in listed if p["pass_id"] == pass_id), None)
    if entry is None:
        return None, {"error": "That pass is not listed in this question: choose one from list_passes.",
                      "facts": {"listed": [p["pass_id"] for p in listed]}}
    if len(read) >= vs.PASS_BUDGET:
        logger.info("decide: refused read_pass (budget spent)")
        return None, {"error": TWO_READ, "facts": _context(q, read, qid)}
    if pass_id in read:
        logger.info("decide: refused read_pass (already read)")
        return None, {"error": "That pass is already read in this question.", "facts": _context(q, read, qid)}
    if read and because in FIRST_READ:
        logger.info("decide: refused read_pass/%s (a second read)", because)
        return None, {"error": FIRST_READ_ONLY, "facts": _context(q, read, qid)}
    facts = {"pass_id": pass_id, "satellite": entry.get("satellite"), "imaged_pct": entry.get("imaged_pct")}
    share = entry.get("imaged_share") or 0.0
    newest_first = sorted(listed, key=lambda p: vs.parse_t(p["sensed"]), reverse=True)
    last = read[-1] if read else None
    if because == "newest":
        ok = newest_first[0]["pass_id"] == pass_id
    elif because == "widest":
        ok = all((p.get("imaged_share") or 0.0) <= share for p in listed)
    elif because == "newest_wide":
        wide = [p for p in newest_first if (p.get("imaged_share") or 0.0) > vs.WIDE_SHARE]
        ok = bool(wide) and wide[0]["pass_id"] == pass_id
    elif because in ("coverage_thin", "no_candidates"):
        cov = _in_question("coverage", qid, last) if last else None
        if because == "coverage_thin":
            ok = _thin(cov)
        else:
            ok = _candidates(_in_question("match", qid, last) if last else None) == 0
        if ok:
            facts.update({"from": last, "checkable_pct": _pct(cov.get("checkable_share")) if cov else None})
    else:                                   # asked
        words = vs.names_pass(vs.turn_prompt(), entry, listed)
        if words is None:
            logger.info("decide: refused read_pass/asked (not named)")
            return None, {"error": NOT_NAMED, "facts": {"listed": [p["pass_id"] for p in listed]}}
        facts["asked_words"] = _scan(words)
        ok = True
    if not ok:
        return None, _unsupported(because, "read_pass", _context(q, read, qid))
    return facts, None


def _forecast(q, qid, read, because):
    last = read[-1] if read else None
    cov = _in_question("coverage", qid, last) if last else None
    if because == "coverage_thin":
        ok = _thin(cov)
    else:
        ok = _candidates(_in_question("match", qid, last) if last else None) == 0
    if not ok:
        return None, _unsupported(because, "forecast", _context(q, read, qid))
    return {"from": last, "checkable_pct": _pct(cov.get("checkable_share")) if cov else None}, None


def _draft(q, qid, read, because, box):
    hot = _in_question("hotspots", qid)
    if hot is None:
        return None, {"error": "Run predict_hotspots for this question first: the boxes come from it."}
    boxes = hot.get("boxes", [])
    chosen = next((b for b in boxes if b.get("box") == box), None)
    if chosen is None:
        return None, {"error": "box must be one of predict_hotspots' boxes (1 to 3)", "facts": _context(q, read, qid, boxes)}
    looks = [b for b in boxes if b.get("next_look")]
    facts = {"box": box}
    if because == "most_past_targets":
        ok = chosen.get("share_of_past_dark_targets") == max(b.get("share_of_past_dark_targets", 0) for b in boxes)
        facts["share_pct"] = _pct(chosen.get("share_of_past_dark_targets"))
    elif because == "soonest_look":
        first = min((vs.parse_t(b["next_look"]["start"]) for b in looks), default=None)
        ok = first is not None and bool(chosen.get("next_look")) and vs.parse_t(chosen["next_look"]["start"]) == first
        if ok:
            facts["look"] = chosen["next_look"].get("text")
    elif because == "near_candidates":
        near = chosen.get("candidates_near", 0)
        ok = near >= 1 and near == max(b.get("candidates_near", 0) for b in boxes)
        facts["candidates_near"] = near
    else:                                   # only_planned_look
        ok = len(looks) == 1 and looks[0].get("box") == box
    if not ok:
        return None, _unsupported(because, "draft", _context(q, read, qid, boxes))
    return facts, None


def _stop(q, qid, read):
    covs = {p: _in_question("coverage", qid, p) for p in read}
    if not read or not all(_thin(c) for c in covs.values()):
        return None, _unsupported("no_checked_pass", "stop", _context(q, read, qid))
    return {"passes": [{"pass_id": p, "checkable_pct": _pct(covs[p]["checkable_share"])} for p in read],
            "standard_pct": _pct(vs.CHECKABLE_FLOOR)}, None


def _decide(step, because, pass_id, box, tool_context) -> dict:
    q = vs.current_question()
    if q is None:
        return {"error": "Call list_passes first."}
    if not isinstance(step, str) or not isinstance(because, str) or because not in PAIRS.get(step, ()):
        return {"error": "Unknown step or reason.", "allowed": _allowed()}
    if step == "read_pass" and not (isinstance(pass_id, str) and vs.PASS_ID_RE.fullmatch(pass_id)):
        return {"error": "read_pass needs pass_id, a pass from list_passes.", "allowed": _allowed()}
    if step == "draft" and not (isinstance(box, int) and not isinstance(box, bool) and 1 <= box <= 3):
        return {"error": "draft needs box, 1 to 3.", "allowed": _allowed()}
    qid = q["question_id"]
    decs = vs.decisions(q)
    read = vs.read_passes(decs)
    if step == "read_pass":
        facts, refused = _read_pass(q, qid, read, because, pass_id)
        subject = pass_id
    elif step == "forecast":
        (facts, refused), subject = _forecast(q, qid, read, because), "none"
    elif step == "draft":
        (facts, refused), subject = _draft(q, qid, read, because, box), box
    else:
        (facts, refused), subject = _stop(q, qid, read), "none"
    if refused:
        return refused                      # nothing is written on a refusal: the stage relies on it
    call_id = vs.tool_use_id(tool_context)
    key = vs.decision_key(qid, step, because, subject, call_id=call_id)
    if key is None:
        logger.warning("decide: no tool-use id; nothing recorded")
        return {"error": NOT_RECORDED}
    # n orders the question's decisions (the lock makes it a sequence); at is when it was accepted.
    body = {"question_id": qid, "step": step, "because": because, "subject": subject, "facts": facts,
            "n": max((d.get("n", 0) for d in decs if isinstance(d.get("n"), int)), default=0) + 1,
            "at": datetime.now(timezone.utc).isoformat(timespec="microseconds")}
    body.update({"tool_use_id": call_id} if vs.DECISION_KEYS == "call" else {"key": key.rsplit("/", 1)[-1]})
    try:
        vs.put_json(key, body)
    except Exception as e:
        logger.warning("decide: the decision could not be written (%s)", type(e).__name__)
        return {"error": NOT_RECORDED}
    return {"status": "noted", "facts": facts}


@tool(context=True)
async def decide(step: str, because: str, pass_id: str = "", box: int = 0, tool_context=None) -> str:
    """Announce a choice before you act on it. The tool checks the reason against this question's records
    and the presenter's words; a refused reason writes nothing and returns the facts.

    Args:
        step: "read_pass", "forecast", "draft" or "stop".
        because: for read_pass, one of:
            "newest": the newest pass listed;
            "widest": no listed pass imaged more of the reserve;
            "newest_wide": the newest listed pass that imaged over half the reserve;
            "coverage_thin": the last pass read is under the standard;
            "no_candidates": the last pass read had no candidates;
            "asked": the presenter named this pass.
          For forecast: "coverage_thin" or "no_candidates", as above.
          For draft, one of:
            "most_past_targets": the box held the largest share of past dark targets;
            "soonest_look": the box's next planned look starts first;
            "near_candidates": the most of this pass's candidates lie in or near the box;
            "only_planned_look": the only box with a look planned.
          For stop: "no_checked_pass": no pass read could be checked.
        pass_id: for read_pass, the pass you will read.
        box: for draft, 1 to 3.

    Returns: JSON with status "noted" and the facts, or an error with the facts.
    """
    with _LOCK:
        return json.dumps(_decide(step, because, pass_id, box, tool_context))
