#!/usr/bin/env python3
"""Record the Dark Vessels open question once and turn it into an offline replay case (redesign §3.10).

    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py          # the one question, on dev

Invokes the runtime once (a fresh session) with the stage's prepared question, word for word, and
refuses a take the design refuses (record it again). A usable take is copied into
`use-cases/vessels-open-question/` at the repo root (U11: the id stays across re-records), laid out
as the session's own vessels folder, so the stage reads it the way it reads a live session:

    config.json                  name, question, agent, tool_calls (each with its tool-use id and its
                                 streamed inputs, decide's included), assets.layers
    narrative.md                 the agent's answer
    radar_<pass>.tif             the radar display COGs
    targets_, heard_, unproven_<pass>.geojson   the targets and both coverage areas
    hotspots.geojson, boxes.geojson, look_*.geojson, hotspots.json   the forecast and the next look
    passes_<list_passes id>.json, decision_<question>_<decide id>.json   the board and the decisions
    chips/<pass>_<T>.tif, inspections/*.png   the chips and what the agent looked at
    <tasking id>.draft.json      the tasking draft (a replay never files it; the plate is inert)

S3 URLs in the config use the placeholder bucket `bucket` like the other cases; the backend maps
`s3://bucket/use-cases/<id>/...` to its own bucket. Staging to S3 is a separate, explicit step
(printed at the end), into the case's own prefix only. Nothing here needs GFW, Planetary Computer
or the runtime at replay time.

Refused takes (each one says why): a word that accuses or identifies, in the answer or a tool's
inputs, or an identity field in a copied file; an em dash in the answer; a match_ais with no
check_ais_coverage of its pass before it; no decide, or a streamed decide with neither a file nor a
refusal in the session's transcript; a detect_vessels or draft_tasking with no accepted decision
before it; neither draft_tasking nor decide(stop); no candidate sentence or no closer.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import ending, extract_tool_calls, report_text, tool_input  # noqa: E402
from vessels_gfw import scan_identity  # noqa: E402

CASE_ID = "vessels-open-question"
# The stage's prepared plate (react-ui/frontend/src/utils/stageCopy.ts), word for word (U1).
PROMPT = "Is anyone in the reserve without broadcasting, and where should the patrol look next?"
# The gallery card's words (redesign §3.8.5), so the case and its card agree.
NAME = "Dark Vessels, Galápagos: one open question"
DESCRIPTION = ("One question about the Galápagos Marine Reserve: the agent weighs the radar passes on file, "
               "checks whether AIS reception there is good enough, chooses what to check next, and drafts a "
               "patrol tasking for the officer. Candidates, never accusations.")

# The agent's own rules and sentences, copied here because the builder runs without the runtime's
# dependencies (strands); tests/test_replay_case.py pins each one to the agent's module.
FORBIDDEN = re.compile(r"\b(illegal|illegally|poach\w*|criminal\w*|guilty|caught|smuggl\w*|pirat\w*|culprit\w*|"
                       r"suspect\w*|offender\w*|violat\w*|perpetrat\w*|wrongdo\w*)\b", re.I)       # tasking_tools.FORBIDDEN
IDENTIFIER = re.compile(r"\b(\d{9}|IMO\s*\d{7}|MMSI\w*|call\s*sign\w*)\b", re.I)                 # tasking_tools.IDENTIFIER
CANDIDATE_SENTENCE = "A candidate is a radar target with no broadcast nearby; it is not an accusation."
CLOSER = "Candidates are a reason to look, not accusations."
EM_DASH = "\u2014"

TOOL_USE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
QUESTION_ID_RE = re.compile(r"^[0-9a-f]{12}$")
TASKING_DRAFT_RE = re.compile(r"(tasking-\d{8}T\d{6}-[0-9a-f]{6})\.draft\.json$")
# What the stage reads from a session's vessels folder, by the tools' own names.
VESSEL_FILE_RE = re.compile(r"^(radar_s1[a-d]-\d{8}t\d{4}\.tif|(targets|heard|unproven)_s1[a-d]-\d{8}t\d{4}\.geojson|"
                            r"hotspots\.geojson|boxes\.geojson|look_\d_[0-9T-]+\.geojson|hotspots\.json|"
                            r"passes_[A-Za-z0-9_-]{1,64}\.json|decision_[0-9a-f]{12}_[A-Za-z0-9_-]{1,64}\.json)$")
CHIP_RE = re.compile(r"^s1[a-d]-\d{8}t\d{4}_T\d{2}\.tif$")
URL_RE = re.compile(r"^s3://([^/]+)/(.+)$")

# The stream carries tool inputs only; the transcript shows one line per call.
RESULTS = {
    "list_passes": "The passes on file listed",
    "decide": "Decision recorded",
    "find_pass": "Radar pass found",
    "inspect_image": "Looked at the image",
    "display_visual": "Shown on the map",
    "detect_vessels": "Targets found on the water",
    "check_ais_coverage": "Checked where AIS was received",
    "match_ais": "Targets matched to broadcasts",
    "gather_evidence": "Evidence chips cut",
    "predict_hotspots": "Where to look next, predicted",
    "next_look": "The next radar look found",
    "draft_tasking": "Tasking drafted (not filed)",
}
REFUSED_RESULT = "Refused by the tool"


def _id(call: dict) -> str | None:
    tid = call.get("toolUseId")
    return tid if isinstance(tid, str) and TOOL_USE_ID_RE.fullmatch(tid) else None


def _strings(value):
    """Every string inside a tool's inputs, except S3 URLs (file names are the tools', not words)."""
    if isinstance(value, str):
        if not value.startswith("s3://"):
            yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def question_id(board: dict | None) -> str | None:
    qid = board.get("question_id") if isinstance(board, dict) else None
    return qid if isinstance(qid, str) and QUESTION_ID_RE.fullmatch(qid) else None


def decision_name(qid: str | None, call: dict) -> str | None:
    """A decide call's file in the session's vessels folder ("call" keys, vessel_store.decision_key)."""
    tid = _id(call)
    return f"decision_{qid}_{tid}.json" if qid and tid and call.get("name") == "decide" else None


def board_name(calls: list[dict]) -> str | None:
    """The board the stage loads: the latest list_passes call's own file."""
    last = next((c for c in reversed(calls) if c.get("name") == "list_passes"), None)
    tid = _id(last) if last else None
    return f"passes_{tid}.json" if tid else None


def refusals(text: str, files: set[str], refused_ids: set[str] | None, qid: str | None) -> list[str]:
    """Why a take is not a usable replay case (empty when it is). Pure: the stream, the names in the
    session's vessels folder, the tool-use ids its transcript shows refused (None: transcript
    unread) and the question's id from the board."""
    calls = extract_tool_calls(text)
    narrative = report_text(text)
    refused = refused_ids or set()
    why: list[str] = []

    # Words that accuse or identify, in the answer or in any tool's inputs.
    words = [narrative] + [s for c in calls for s in _strings(tool_input(c))]
    for pattern, what in ((FORBIDDEN, "a word that accuses"), (IDENTIFIER, "an identifier")):
        hit = next((m.group(0) for w in words for m in [pattern.search(w)] if m), None)
        if hit:
            why.append(f"{what} ({hit!r})")
    if EM_DASH in narrative:
        why.append("an em dash in the answer")

    # Coverage before every match, on the same pass.
    covered: set[str] = set()
    for c in calls:
        pid = tool_input(c).get("pass_id")
        if c.get("name") == "check_ais_coverage":
            covered.add(pid)
        elif c.get("name") == "match_ais" and pid not in covered:
            why.append(f"match_ais on {pid} with no check_ais_coverage of it before")

    # Every decide either wrote its file or was refused; the reads and the draft were decided first.
    decides = [c for c in calls if c.get("name") == "decide"]
    if not decides:
        why.append("no decide")
    accepted: list[dict] = []
    for c in calls:
        name, inp = c.get("name"), tool_input(c)
        if name == "decide":
            file = decision_name(qid, c)
            if file and file in files:
                accepted.append(inp)
            elif _id(c) not in refused:
                why.append(f"decide {_id(c)} streamed with no file and no refusal in the transcript")
        elif name == "detect_vessels":
            if not any(d.get("step") == "read_pass" and d.get("pass_id") == inp.get("pass_id") for d in accepted):
                why.append(f"detect_vessels on {inp.get('pass_id')} with no accepted read_pass before it")
        elif name == "draft_tasking":
            if not any(d.get("step") == "draft" and d.get("box") == inp.get("box") for d in accepted):
                why.append(f"draft_tasking of box {inp.get('box')} with no accepted draft decision before it")

    if ending(calls) is None:
        why.append("neither draft_tasking nor decide(stop)")
    if CANDIDATE_SENTENCE not in narrative:
        why.append("no candidate sentence")
    paragraphs = [p.strip() for p in narrative.split("\n\n") if p.strip()]
    if not paragraphs or not paragraphs[-1].endswith(CLOSER):
        why.append("no closer")
    return why


def case_name(key: str, session_prefix: str) -> str | None:
    """Where one of the session's files goes in the case (None: not one the stage shows)."""
    if not key.startswith(session_prefix):
        return None
    rest = key[len(session_prefix):]
    if rest.startswith("vessels/chips/"):
        base = rest[len("vessels/chips/"):]
        return f"chips/{base}" if CHIP_RE.fullmatch(base) else None
    if rest.startswith("vessels/"):
        base = rest[len("vessels/"):]
        return base if "/" not in base and VESSEL_FILE_RE.fullmatch(base) else None
    if rest.startswith("inspections/"):
        base = rest[len("inspections/"):]
        return f"inspections/{base}" if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(png|jpg)", base) else None
    m = TASKING_DRAFT_RE.search(rest)
    return f"{m.group(1)}.draft.json" if rest.startswith("taskings/") and m and "/" not in rest[len("taskings/"):] else None


def wanted(calls: list[dict], session_keys: list[str], session_prefix: str, qid: str | None) -> dict[str, str]:
    """The session's keys the case copies, with their names in the case: every file a call showed or
    inspected, the inspections behind the chips, the board, every decision of the question, the
    boxes' record and the tasking draft."""
    keys = set(session_keys)
    out: dict[str, str] = {}
    for c in calls:
        url = tool_input(c).get("s3_url")
        m = URL_RE.match(url) if isinstance(url, str) else None
        if not m:
            continue
        name = case_name(m.group(2), session_prefix)
        if name and m.group(2) in keys:
            out[m.group(2)] = name
        if c.get("name") == "inspect_image":
            stem = m.group(2).rsplit("/", 1)[-1].rsplit(".", 1)[0]
            for ext in ("png", "jpg"):
                key = f"{session_prefix}inspections/{stem}.{ext}"
                if key in keys:
                    out[key] = f"inspections/{stem}.{ext}"
                    break
    vessels = f"{session_prefix}vessels/"
    named = [n for n in [board_name(calls), "hotspots.json"] + [decision_name(qid, c) for c in calls] if n]
    for n in named:
        if f"{vessels}{n}" in keys:
            out[f"{vessels}{n}"] = n
    drafts = sorted(k for k in keys if k.startswith(f"{session_prefix}taskings/") and TASKING_DRAFT_RE.search(k))
    if drafts:
        out[drafts[-1]] = case_name(drafts[-1], session_prefix)
    return out


def config_for(calls: list[dict], copied: dict[str, str], refused_ids: set[str], case_id: str, recorded_from: str) -> dict:
    """config.json: each call with its tool-use id and inputs (session URLs pointed at the case's
    placeholder, any other URL dropped), and the map's layers in the order display_visual showed them."""
    placeholder = f"s3://bucket/use-cases/{case_id}/"
    tool_calls, layers, seen = [], [], set()
    for c in calls:
        params = dict(tool_input(c))
        url = params.get("s3_url")
        if isinstance(url, str):
            m = URL_RE.match(url)
            name = copied.get(m.group(2)) if m else None
            if name:
                params["s3_url"] = placeholder + name
            else:
                params.pop("s3_url")
        tid = _id(c)
        result = REFUSED_RESULT if tid in refused_ids else RESULTS.get(c.get("name"), "Done")
        tool_calls.append({"id": tid, "name": c.get("name"), "params": params, "result": result})
        if c.get("name") == "display_visual" and "s3_url" in params:
            name = params["s3_url"][len(placeholder):]
            if name in seen or "/" in name:
                continue
            seen.add(name)
            layer = {"file": name, "title": str(params.get("title", name))[:120]}
            if isinstance(params.get("render"), dict):
                layer["render"] = params["render"]
            layers.append(layer)
    return {
        "name": NAME,
        "description": DESCRIPTION,
        "location": "Galápagos Marine Reserve",
        "user_question": PROMPT,
        "agent": "vessels",
        "dates": {},
        "scenario_version": "1.1",
        "recorded_from": recorded_from,
        "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }


def identity_findings(out: Path) -> list[str]:
    """Anything in the case's text files that could identify a vessel (vessels_gfw.scan_identity).
    config.json's own fields ("name" is the case's and each call's tool) are the case's, so only its
    calls' inputs are scanned there."""
    found = []
    for p in sorted(out.rglob("*")):
        if p.suffix not in (".json", ".geojson", ".md") or not p.is_file():
            continue
        text = p.read_text()
        if p.relative_to(out) == Path("config.json"):
            text = json.dumps([c.get("params") for c in json.loads(text).get("tool_calls", [])])
        found += [f"{p.relative_to(out)}: {f}" for f in scan_identity(text)]
    return found


def main() -> int:
    import boto3
    from eval import refusals_in, resolve_agent_arn, session_messages, stream_invoke, new_session_id

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", help="Output folder; defaults to use-cases/vessels-open-question")
    args = parser.parse_args()
    out = Path(args.out or REPO_ROOT / "use-cases" / CASE_ID)

    arn = resolve_agent_arn(args.target, "vessels")
    runtime = arn.rsplit("/", 1)[1].rsplit("-", 1)[0]
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording {CASE_ID} on {runtime} (session {sid[:13]}...)")
    text, _ = stream_invoke(client, arn, PROMPT, 900, sid)
    calls = extract_tool_calls(text)
    bucket = next((m.group(1) for c in calls for u in [tool_input(c).get("s3_url")]
                   for m in [URL_RE.match(u) if isinstance(u, str) else None] if m), None)
    if not bucket:
        raise SystemExit("the run put nothing on the map; record it again")

    s3 = boto3.client("s3", region_name=args.region)
    session_prefix = f"session_data/{sid}/"
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=session_prefix):
        keys += [o["Key"] for o in page.get("Contents", [])]
    vessels = f"{session_prefix}vessels/"
    files = {k[len(vessels):] for k in keys if k.startswith(vessels)}
    board_file = board_name(calls)
    board = None
    if board_file and board_file in files:
        board = json.loads(s3.get_object(Bucket=bucket, Key=f"{vessels}{board_file}")["Body"].read())
    qid = question_id(board)
    messages = session_messages(s3, bucket, sid)
    ids = {i for i in (_id(c) for c in calls) if i}
    refused = set(refusals_in(messages, ids)) if messages is not None else None

    why = refusals(text, files, refused, qid)
    if why:
        print("Refused take (session " + sid[:13] + "...):")
        for w in why:
            print(f"  - {w}")
        raise SystemExit("not a usable replay case; record it again")

    copied = wanted(calls, keys, session_prefix, qid)
    # A fresh take replaces the previous one entirely: nothing from an earlier recording rides along.
    if out.exists():
        shutil.rmtree(out)
    for key, name in sorted(copied.items(), key=lambda kv: kv[1]):
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, key, str(out / name))
        print(f"  {name}")
    config = config_for(calls, copied, refused or set(), CASE_ID, runtime)
    (out / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    (out / "narrative.md").write_text(report_text(text) + "\n")
    found = identity_findings(out)
    if found:
        shutil.rmtree(out)
        raise SystemExit("an identity field in the copied files; record it again: " + "; ".join(found[:5]))

    path = [c["name"] if c["name"] != "decide" else f"decide({c['params'].get('step')}:{c['params'].get('because')})"
            for c in config["tool_calls"] if c["name"] != "display_visual"]
    print(f"Wrote {out.relative_to(REPO_ROOT)}: {len(config['tool_calls'])} tool calls, question {qid}, "
          f"refusals {len(refused or ())}, ending {ending(calls)}, layers {[l['file'] for l in config['assets']['layers']]}")
    print(f"Path: {' > '.join(path)}")
    print(f"Stage it:  aws s3 sync {out.relative_to(REPO_ROOT)}/ s3://<S3_BUCKET_NAME>/use-cases/{CASE_ID}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
