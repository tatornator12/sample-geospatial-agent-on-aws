"""Dark Vessels, the officer's decision (design component 9). The agent drafts a patrol tasking from
the session's own records; the officer chooses and approves it on the map, and the authenticated
backend files it. No tool here files, sends or approves anything."""
from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone

from strands import tool

import vessel_store as vs

TASKING_ID_RE = re.compile(r"^tasking-\d{8}T\d{6}-[0-9a-f]{6}$")
FILED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})")
MAX_NOTES = 3
MAX_NOTE_CHARS = 220
# Language that accuses or identifies has no place in a tasking (requirement 11).
FORBIDDEN = re.compile(r"\b(illegal|illegally|poach\w*|criminal\w*|guilty|caught|smuggl\w*|pirat\w*|culprit\w*|"
                       r"suspect\w*|offender\w*|violat\w*|perpetrat\w*|wrongdo\w*)\b", re.I)
IDENTIFIER = re.compile(r"\b(\d{9}|IMO\s*\d{7}|MMSI\w*|call\s*sign\w*)\b", re.I)


def tasking_prefix() -> str:
    return f"{vs.session_prefix()}taskings/"


def check_text(text: str) -> str | None:
    """The reason a note may not go in a tasking, or None when it may."""
    if FORBIDDEN.search(text):
        return f"'{FORBIDDEN.search(text).group(0)}' accuses; a tasking names candidates, not culprits"
    if IDENTIFIER.search(text):
        return "a tasking never carries a vessel identifier"
    if "—" in text:
        return "no em dashes"
    return None


@tool
async def draft_tasking(pass_id: str, box: int, candidate_ids: list = None, look_start: str = "", notes: list = None) -> str:
    """Draft a patrol tasking for the officer to choose and approve on the map. It is a draft: the
    officer decides; the backend files it only when the officer approves.

    Args:
        pass_id: The pass whose candidates the tasking covers (after match_ais).
        box: The patrol box, 1 to 3 (from predict_hotspots).
        candidate_ids: OPTIONAL ["T01", ...]: the candidates to include; all of them when omitted.
        look_start: OPTIONAL the start (UTC) of one of the box's next looks; the first one when omitted.
        notes: OPTIONAL up to three short sentences for the officer (no accusations, no identifiers).

    Returns: JSON with tasking_id, the draft's summary, and the fixed sentence about the decision.
    """
    if vs.pass_entry(pass_id) is None:
        return vs.refusal()
    # Held to the session's latest question in any turn, so a later re-draft is still held to a decide.
    q = vs.latest_question()
    drafts = [d for d in vs.decisions(q) if d.get("step") == "draft"]
    if not drafts:
        return json.dumps({"error": "Announce the box with decide(draft, ...) first."})
    decided = drafts[-1].get("subject")
    if box != decided or isinstance(box, bool):
        return json.dumps({"error": f"You decided box {decided}."})
    try:
        match = vs.get_json(f"{vs.vessels_prefix()}match_{pass_id}.json")
        hot = vs.get_json(f"{vs.vessels_prefix()}hotspots.json")
        coverage = vs.get_json(f"{vs.vessels_prefix()}coverage_{pass_id}.json")
    except Exception:
        return json.dumps({"error": "Run match_ais and predict_hotspots first: a tasking is drafted from the session's records."})
    if any(r.get("question_id") != q["question_id"] for r in (match, hot, coverage)):
        return json.dumps({"error": "Those records are from an earlier question: read the pass again."})
    chosen = next((b for b in hot["boxes"] if b["box"] == box), None)
    if chosen is None:
        return json.dumps({"error": "box must be one of predict_hotspots' boxes (1 to 3)"})
    cands = [t for t in match["targets"] if t["status"] == "candidate"]
    if candidate_ids:
        if not isinstance(candidate_ids, list) or not all(isinstance(c, str) and vs.CANDIDATE_ID_RE.fullmatch(c) for c in candidate_ids):
            return json.dumps({"error": 'candidate_ids must be like ["T01", "T02"]'})
        unknown = set(candidate_ids) - {t["label"] for t in cands}
        if unknown:
            return json.dumps({"error": f"not candidates on this pass: {sorted(unknown)}"})
        cands = [t for t in cands if t["label"] in candidate_ids]
    look = chosen.get("next_look")
    if look_start:
        if not look or look["start"] != look_start:
            return json.dumps({"error": "look_start must be the box's next look from predict_hotspots or next_look"})
    notes = notes or []
    if not isinstance(notes, list) or len(notes) > MAX_NOTES or not all(isinstance(n, str) for n in notes):
        return json.dumps({"error": f"notes: at most {MAX_NOTES} sentences"})
    for n in notes:
        if len(n) > MAX_NOTE_CHARS:
            return json.dumps({"error": f"each note at most {MAX_NOTE_CHARS} characters"})
        why = check_text(n)
        if why:
            return json.dumps({"error": f"notes: {why}"})
    now = datetime.now(timezone.utc)
    tid = f"tasking-{now:%Y%m%dT%H%M%S}-{secrets.token_hex(3)}"
    counts = {s: sum(t["status"] == s for t in match["targets"]) for s in ("broadcasting", "port", "unproven", "seen_once", "candidate")}
    draft = {
        "tasking_id": tid, "status": "draft", "drafted_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "pass_id": pass_id,
        "pass_sensed": vs.pass_entry(pass_id)["sensed"], "counts": counts, "heard_share": coverage["heard_share"],
        "imaged_share": coverage.get("imaged_share"), "checkable_share": coverage.get("checkable_share"),
        "box": {"box": box, "bounds": chosen["bounds"], "share_of_past_dark_targets": chosen["share_of_past_dark_targets"]},
        "look": look, "check": hot["check"], "rolling": hot.get("rolling"),
        "candidates": [{"id": t["label"], "lon": round(t["lon"], 4), "lat": round(t["lat"], 4), "port": t["port"],
                        "port_km": t["port_km"], "nearest_broadcast_km": t.get("nearest_ais_km")} for t in cands],
        "notes": notes, "sentence": vs.CANDIDATE_SENTENCE, "attribution": vs.ATTRIBUTION,
    }
    url = vs.put_json(f"{tasking_prefix()}{tid}.draft.json", draft)
    return json.dumps({
        "tasking_id": tid, "draft_s3_url": url, "box": box, "candidates": [c["id"] for c in draft["candidates"]],
        "look": look["text"] if look else "no look planned yet", "fixed_sentence": vs.OFFICERS_DECISION,
        "next_steps": f"Write the answer now (at most {vs.ANSWER_MAX_WORDS} words), beginning with its first line: "
                      "nothing before it, no \"---\". Then stop; the map shows the tasking plate and the officer "
                      "decides. Never say it is filed: only tasking_status can say that.",
    })


def newest_draft_id() -> str | None:
    """The session's newest drafted tasking (ids sort by their UTC time)."""
    ids = [k.rsplit("/", 1)[-1][:-len(".draft.json")] for k in vs.list_keys(tasking_prefix()) if k.endswith(".draft.json")]
    ids = [i for i in ids if TASKING_ID_RE.fullmatch(i)]
    return max(ids) if ids else None


@tool
async def tasking_status(tasking_id: str = "") -> str:
    """Whether the officer has filed a tasking (the only way to say a tasking is filed).

    Args:
        tasking_id: OPTIONAL from draft_tasking; the session's newest draft when omitted.

    Returns: JSON with status ("filed" with when, or "draft"), and the sentence to say.
    """
    if tasking_id == "" or tasking_id is None:
        tasking_id = newest_draft_id()
        if tasking_id is None:
            return json.dumps({"error": "No tasking has been drafted in this session."})
    if not isinstance(tasking_id, str) or not TASKING_ID_RE.fullmatch(tasking_id):
        return json.dumps({"error": "tasking_id is like tasking-20261016T120000-a1b2c3"})
    try:
        filed = vs.get_json(f"{tasking_prefix()}{tasking_id}.filed.json")
    except Exception:
        try:
            vs.get_json(f"{tasking_prefix()}{tasking_id}.draft.json")
        except Exception:
            return json.dumps({"error": "No such tasking in this session."})
        return json.dumps({"tasking_id": tasking_id, "status": "draft", "say": "The tasking is a draft; the officer has not filed it."})
    # The plate's filed line is the one place that says who filed it; the agent says only when.
    at = FILED_AT_RE.match(str(filed.get("filed_at") or ""))
    say = f"Yes, it is on file: filed at {at.group(1)} UTC." if at else "Yes, it is on file."
    return json.dumps({"tasking_id": tasking_id, "status": "filed", "filed_at": filed.get("filed_at"), "say": say})
