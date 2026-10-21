#!/usr/bin/env python3
"""Golden-prompt evaluation against an AgentCore runtime.

Invokes the dev or stable runtime with every prompt in scripts/golden_prompts.json,
extracts the tool calls from the SSE stream with the same brace-matching the UI uses,
and asserts:

  * expected_tools appear as a SUBSEQUENCE of the streamed tool names (extra tools in
    between are fine, order matters);
  * no forbidden_text (e.g. "Error:") appears anywhere in the stream.

Checks on the tool calls' inputs (Act 3's one question, redesign §3.10). A spec is
{"name": tool, "match": {key: value | [values]}, "contains": "<text>"}: the call's parsed input
has each key equal to the value (or one of the values; an absent key is null), and its raw input
text contains the text.
  * expected_inputs: the specs as a SUBSEQUENCE of the calls;
  * forbidden_inputs: no call matches any spec;
  * expected_before [{first, then}]: every call matching `then` has a `first` match earlier;
    "{pass_id}" in `first` is filled from the `then` call's pass_id;
  * expected_after [{first, then}]: every call matching `first` has a `then` match later;
    "{pass_id}" in `then` is filled from the `first` call's pass_id.
And on the words and the clock:
  * forbidden_prose: phrases (any case) checked on the prose only, the stream minus tool calls;
  * required_text_by_ending {draft: [...], stop: [...]}: the ending is the last of draft_tasking
    ("draft") or decide with step "stop" ("stop"); a run with neither fails;
  * max_seconds: the last turn's wall time; report_max_words: the words of the final report
    (the prose after the last tool call), split on whitespace.

The closing paragraph (closer_*) is the last paragraph of the prose, a tool call counting as a
paragraph break, so a closer streamed right after a tool call is read alone.

Exit code 0 when every prompt passes, 1 otherwise. A runtime crash
(RuntimeClientError-style) is a failure and prints the raw stream tail.

Usage:
    python scripts/eval.py --target dev [--agent earth|methane|archaeologist|vessels] [--dry-run]
                           [--only NAME] [--repeat N] [--timeout 600] [--json PATH]

--repeat N runs each case N times and prints, per case, the distinct paths with a count each, the
median and maximum seconds and the refusals per run (the JSON report's `runs`). A path is the tool
names, decide written as decide(step:because), display_visual left out. Refusals (tool results
carrying an error: a refused decide, the gate, the budget) are counted from the session's
transcript in S3 for an agent with "refusals" set, since the stream carries tool inputs only.

The runtime ARN is read from geo_agent/.bedrock_agentcore.yaml by agent name
(dev -> geospatial_agent_dev, stable -> geospatial_agent_on_aws), so the script always
talks to the same runtimes as deploy.sh. --dry-run prints the plan without touching AWS, and
fails on a malformed input check.
"""
import argparse
import json
import re
import statistics
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# One entry per agent: where its AgentCore config lives, its runtime names per target, and its
# golden prompts. `earth` is the default so every existing invocation keeps working.
AGENTS = {
    "earth": {
        "yaml": REPO_ROOT / "geo_agent" / ".bedrock_agentcore.yaml",
        "targets": {"dev": "geospatial_agent_dev", "stable": "geospatial_agent_on_aws"},
        "prompts": REPO_ROOT / "scripts" / "golden_prompts.json",
    },
    "methane": {
        "yaml": REPO_ROOT / "agents" / "methane-hunter" / ".bedrock_agentcore.yaml",
        "targets": {"dev": "methane_hunter_dev", "stable": "methane_hunter"},
        "prompts": REPO_ROOT / "agents" / "methane-hunter" / "golden_prompts.json",
        # The registry check records its fixed sentence per session; operator names are allowed
        # only inside those exact sentences (see registry_lines).
        "env": {"dev": REPO_ROOT / "agents" / "methane-hunter" / ".env.dev",
                "stable": REPO_ROOT / "agents" / "methane-hunter" / ".env"},
        "registry": True,
    },
    "archaeologist": {
        "yaml": REPO_ROOT / "agents" / "ai-archaeologist" / ".bedrock_agentcore.yaml",
        "targets": {"dev": "ai_archaeologist_dev", "stable": "ai_archaeologist"},
        "prompts": REPO_ROOT / "agents" / "ai-archaeologist" / "golden_prompts.json",
    },
    "vessels": {
        "yaml": REPO_ROOT / "agents" / "dark-vessels" / ".bedrock_agentcore.yaml",
        "targets": {"dev": "dark_vessels_dev", "stable": "dark_vessels"},
        "prompts": REPO_ROOT / "agents" / "dark-vessels" / "golden_prompts.json",
        # The bucket the runtime keeps its session transcript in: the one question's refusals
        # (decide, the gate, the budget) are counted from it (see refusals_in).
        "env": {"dev": REPO_ROOT / "agents" / "dark-vessels" / ".env.dev",
                "stable": REPO_ROOT / "agents" / "dark-vessels" / ".env"},
        "refusals": True,
    },
}

# Backwards-compatible names for the Earth Analyst (scripts/prewarm.py and older callers).
AGENTCORE_YAML = AGENTS["earth"]["yaml"]
DEFAULT_PROMPTS = AGENTS["earth"]["prompts"]
TARGET_AGENTS = AGENTS["earth"]["targets"]


def resolve_agent_arn(target: str, agent: str = "earth") -> str:
    """Read the runtime ARN for the agent's target runtime from its .bedrock_agentcore.yaml."""
    agent_name = AGENTS[agent]["targets"][target]
    AGENTCORE_YAML = AGENTS[agent]["yaml"]  # noqa: N806 (shadows the module default on purpose)
    if not AGENTCORE_YAML.exists():
        raise SystemExit(f"{AGENTCORE_YAML} not found: deploy the {agent} agent's {target} runtime first")
    try:
        import yaml

        config = yaml.safe_load(AGENTCORE_YAML.read_text())
        try:
            arn = config["agents"][agent_name]["bedrock_agentcore"]["agent_arn"]
        except (KeyError, TypeError):
            arn = None  # not deployed yet (e.g. a stable runtime before its first promotion)
    except ModuleNotFoundError:
        # Fallback: scan the agent's block for its agent_arn line.
        arn = None
        in_agent = False
        for line in AGENTCORE_YAML.read_text().splitlines():
            if line.startswith(f"  {agent_name}:"):
                in_agent = True
            elif in_agent and line.startswith("  ") and not line.startswith("   ") and line.strip().endswith(":"):
                in_agent = False  # next top-level agent block
            elif in_agent and "agent_arn:" in line:
                arn = line.split("agent_arn:", 1)[1].strip()
                break
    if not arn:
        raise SystemExit(f"No agent_arn for {agent_name} in {AGENTCORE_YAML}")
    return arn


def extract_tool_calls(text: str) -> list[dict]:
    """Brace-match {"toolUseId": ...} objects, mirroring the UI's parseJsonToolCalls."""
    tools: list[dict] = []
    seen: set[str] = set()
    pos = 0
    while pos < len(text):
        start = text.find('{"toolUseId":', pos)
        if start == -1:
            break
        brace_count = 0
        end = start
        in_string = False
        escape_next = False
        for i in range(start, len(text)):
            char = text[i]
            if escape_next:
                escape_next = False
                continue
            if char == "\\":
                escape_next = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if not in_string:
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        end = i + 1
                        break
        if brace_count == 0 and end > start:
            try:
                obj = json.loads(text[start:end])
                tool_id = obj.get("toolUseId")
                if tool_id and obj.get("name") and tool_id not in seen:
                    seen.add(tool_id)
                    tools.append(obj)
            except json.JSONDecodeError:
                pass  # partial objects are normal mid-stream
            pos = end
        else:
            pos = start + 1
    return tools


def env_value(path: Path, name: str) -> str | None:
    """One KEY=value from an env file (no shell expansion), or None."""
    if not path.exists():
        return None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def registry_lines(s3, bucket: str, session_id: str) -> list[str]:
    """The registry check's fixed sentences recorded in this session (registry_<lat>_<lon>.json).

    Operator names may appear ONLY inside these exact sentences, so the forbidden-text checks run
    on the stream with them removed: a name the agent quotes from the registry passes, the same
    name in the agent's own words fails."""
    prefix = f"session_data/{session_id}/methane/registry_"
    lines: list[str] = []
    try:
        listing = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        for obj in listing.get("Contents", [])[:20]:
            body = json.loads(s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read(200_000))
            for key in ("line", "field_line", "gem_field_line", "mine_line"):   # every registry sentence
                if isinstance(body.get(key), str) and body[key]:
                    lines.append(body[key])
    except Exception as e:  # the gate must not pass on a failed read: no lines means nothing is scrubbed
        print(f"         (registry lines unavailable: {type(e).__name__})", flush=True)
    return lines


def scrub(text: str, lines: list[str]) -> str:
    for line in sorted(lines, key=len, reverse=True):
        text = text.replace(line, " [registry line] ")
    return text


def is_subsequence(expected: list[str], actual: list[str]) -> bool:
    it = iter(actual)
    return all(name in it for name in expected)


def new_session_id() -> str:
    return f"eval-{uuid.uuid4()}-{uuid.uuid4().hex[:8]}"  # >= 33 chars


def stream_invoke(client, arn: str, prompt: str, timeout: int,
                  session_id: str | None = None) -> tuple[str, list[tuple[int, float]]]:
    """Invoke the runtime; return the full decoded stream text and, per chunk, (char offset, seconds).
    Pass session_id to continue a conversation (a two-turn case); otherwise each call is a fresh session."""
    session_id = session_id or new_session_id()
    started = time.monotonic()
    response = client.invoke_agent_runtime(
        agentRuntimeArn=arn,
        runtimeSessionId=session_id,
        qualifier="DEFAULT",
        payload=json.dumps({"prompt": prompt}).encode(),
    )
    body = response["response"]
    chunks: list[str] = []
    marks: list[tuple[int, float]] = []  # where each chunk starts in the text, and when it arrived
    length = 0
    deadline = time.monotonic() + timeout
    for raw_line in body.iter_lines():
        if time.monotonic() > deadline:
            raise TimeoutError(f"stream exceeded {timeout}s")
        line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
        if not line.startswith("data: "):
            continue
        data = line[len("data: "):].strip()
        if not data or data == "[DONE]":
            continue
        # The stream wraps each chunk in JSON quotes; unescape like the backend does.
        if data.startswith('"') and data.endswith('"'):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                data = data[1:-1]
        chunks.append(data)
        marks.append((length, time.monotonic() - started))
        length += len(data)
    return "".join(chunks), marks


def final_report(text: str, marks: list[tuple[int, float]], elapsed: float) -> tuple[int, float]:
    """(chars, seconds) of the prose after the last tool call: what the room waits on at the end."""
    spans = tool_spans(text)
    start = spans[-1][1] if spans else 0
    tail = text[start:]
    chars = len(tail.strip())
    if not chars:
        return 0, 0.0
    first = start + (len(tail) - len(tail.lstrip()))
    began = next((t for offset, t in reversed(marks) if offset <= first), 0.0)
    return chars, round(elapsed - began, 1)


def tool_spans(text: str) -> list[tuple[int, int, str]]:
    """(start, end, name) of every complete tool-call object, in stream order."""
    spans: list[tuple[int, int, str]] = []
    pos = 0
    while pos < len(text):
        start = text.find('{"toolUseId":', pos)
        if start == -1:
            break
        depth, end, in_string, escape = 0, start, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if not in_string:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
        if depth == 0 and end > start:
            try:
                name = json.loads(text[start:end]).get("name", "?")
            except json.JSONDecodeError:
                name = "?"
            spans.append((start, end, name))
            pos = end
        else:
            pos = start + 1
    return spans


def observations(text: str) -> list[str]:
    """What the model said right after each inspect_image call (its 'what I see' sentence)."""
    spans = tool_spans(text)
    out: list[str] = []
    for i, (_, end, name) in enumerate(spans):
        if name != "inspect_image":
            continue
        nxt = spans[i + 1][0] if i + 1 < len(spans) else len(text)
        prose = " ".join(text[end:nxt].split())
        if prose:
            out.append(prose[:400])
    return out


# --- checks on the tool calls' inputs (redesign §3.10) --------------------------------------------------

SPEC_KEYS = {"name", "match", "contains"}
PAIR_CHECKS = ("expected_before", "expected_after")
SPEC_CHECKS = ("expected_inputs", "forbidden_inputs")
PLACEHOLDER = "{pass_id}"


def tool_input(call: dict) -> dict:
    """A streamed call's input as a dict ({} when it is not a JSON object)."""
    raw = call.get("input", "")
    if isinstance(raw, dict):
        return raw
    try:
        obj = json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}
    return obj if isinstance(obj, dict) else {}


def input_text(call: dict) -> str:
    raw = call.get("input", "")
    return raw if isinstance(raw, str) else json.dumps(raw)


def matches(call: dict, spec: dict) -> bool:
    """The call is the spec's tool, each `match` key equals its value (or is one of its values; an
    absent key is None), and its raw input contains `contains`."""
    if spec.get("name") and call.get("name") != spec["name"]:
        return False
    inp = tool_input(call)
    for key, want in (spec.get("match") or {}).items():
        have = inp.get(key)
        if isinstance(want, list):
            if have not in want:
                return False
        elif have != want:
            return False
    contains = spec.get("contains")
    return not contains or contains in input_text(call)


def fill(spec: dict, pass_id) -> dict | None:
    """The spec with "{pass_id}" filled from a call's pass_id; None when it needs one and there is none."""
    text = json.dumps(spec)
    if PLACEHOLDER not in text:
        return spec
    if not isinstance(pass_id, str) or not pass_id:
        return None
    return json.loads(text.replace(PLACEHOLDER, pass_id.replace("\\", "\\\\").replace('"', '\\"')))


def describe(spec: dict) -> str:
    args = [f"{k}={v}" for k, v in (spec.get("match") or {}).items()]
    if spec.get("contains"):
        args.append(f"contains {spec['contains']!r}")
    return f"{spec.get('name', '?')}({', '.join(args)})"


def call_words(call: dict) -> str:
    pid = tool_input(call).get("pass_id")
    return f"{call.get('name')}({pid})" if pid else str(call.get("name"))


def input_problems(case: dict, calls: list[dict]) -> list[str]:
    problems: list[str] = []
    expected = case.get("expected_inputs") or []
    it = iter(calls)
    for spec in expected:
        if not any(matches(c, spec) for c in it):
            problems.append(f"expected inputs: no {describe(spec)} after the ones before it")
            break
    for spec in case.get("forbidden_inputs") or []:
        hits = [c for c in calls if matches(c, spec)]
        if hits:
            problems.append(f"forbidden input {describe(spec)} called")
    for rule in case.get("expected_before") or []:
        for i, call in enumerate(calls):
            if not matches(call, rule["then"]):
                continue
            first = fill(rule["first"], tool_input(call).get("pass_id"))
            if first is None:
                problems.append(f"{call_words(call)} has no pass_id to check {describe(rule['first'])} against")
            elif not any(matches(c, first) for c in calls[:i]):
                problems.append(f"{call_words(call)} has no {describe(first)} before it")
    for rule in case.get("expected_after") or []:
        for i, call in enumerate(calls):
            if not matches(call, rule["first"]):
                continue
            then = fill(rule["then"], tool_input(call).get("pass_id"))
            if then is None:
                problems.append(f"{call_words(call)} has no pass_id to check {describe(rule['then'])} against")
            elif not any(matches(c, then) for c in calls[i + 1:]):
                problems.append(f"{call_words(call)} has no {describe(then)} after it")
    return problems


def case_problems(case: dict) -> list[str]:
    """A golden case's input checks, well formed (the dry run fails on any)."""
    out: list[str] = []

    def spec_ok(spec, where: str) -> None:
        if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or set(spec) - SPEC_KEYS:
            out.append(f"{case.get('name')}: {where} is not {{name, match, contains}}: {spec!r}")
        elif not isinstance(spec.get("match", {}), dict) or not isinstance(spec.get("contains", ""), str):
            out.append(f"{case.get('name')}: {where} has a bad match or contains: {spec!r}")

    for key in SPEC_CHECKS:
        for i, spec in enumerate(case.get(key) or []):
            spec_ok(spec, f"{key}[{i}]")
    for key in PAIR_CHECKS:
        for i, rule in enumerate(case.get(key) or []):
            if not isinstance(rule, dict) or set(rule) != {"first", "then"}:
                out.append(f"{case.get('name')}: {key}[{i}] is not {{first, then}}")
                continue
            spec_ok(rule["first"], f"{key}[{i}].first")
            spec_ok(rule["then"], f"{key}[{i}].then")
    by_ending = case.get("required_text_by_ending")
    if by_ending is not None and (not isinstance(by_ending, dict) or set(by_ending) - {"draft", "stop"}
                                  or not all(isinstance(v, list) for v in by_ending.values())):
        out.append(f"{case.get('name')}: required_text_by_ending is not {{draft: [...], stop: [...]}}")
    for key in ("max_seconds", "report_max_words"):
        if key in case and (not isinstance(case[key], (int, float)) or isinstance(case[key], bool) or case[key] <= 0):
            out.append(f"{case.get('name')}: {key} is not a positive number")
    return out


# --- the words: prose, the closing paragraph, the final report, the ending -------------------------------

def prose(text: str) -> str:
    """The stream minus its tool-call objects, each call standing as a paragraph break."""
    out, last = [], 0
    for start, end, _ in tool_spans(text):
        out.append(text[last:start])
        out.append("\n\n")
        last = end
    out.append(text[last:])
    return "".join(out)


def closing_paragraph(text: str) -> str:
    """The spoken closer: the prose's last paragraph. A tool call is a paragraph break, so a closer
    streamed straight after a call is not joined to the call's JSON (the four-turn draft-tasking flake,
    Oct 21: 298 and 595 'chars' for a 165-character answer)."""
    paragraphs = [p.strip() for p in prose(text).strip().split("\n\n") if p.strip()]
    return paragraphs[-1] if paragraphs else ""


def report_text(text: str) -> str:
    """The final report: the prose after the last tool call."""
    spans = tool_spans(text)
    return (text[spans[-1][1]:] if spans else text).strip()


def ending(calls: list[dict]) -> str | None:
    """How the question ended: the last of draft_tasking ("draft") and decide(step=stop) ("stop")."""
    found = None
    for c in calls:
        if c.get("name") == "draft_tasking":
            found = "draft"
        elif c.get("name") == "decide" and tool_input(c).get("step") == "stop":
            found = "stop"
    return found


def path_of(calls: list[dict]) -> list[str]:
    """The run's path: the tool names, decide as decide(step:because), display_visual left out."""
    out = []
    for c in calls:
        name = c.get("name")
        if name == "display_visual":
            continue
        if name == "decide":
            inp = tool_input(c)
            name = f"decide({inp.get('step', '?')}:{inp.get('because', '?')})"
        out.append(name)
    return out


def evaluate(case: dict, text: str, elapsed: float, quoted: list[str] | None = None) -> tuple[list[str], list[str]]:
    """Every check a case asks for, on one turn's stream; returns (problems, warnings). Pure: no AWS."""
    quoted = quoted or []
    calls = extract_tool_calls(text)
    tool_names = [t["name"] for t in calls]
    problems: list[str] = []

    expected = case.get("expected_tools", [])
    if expected and not is_subsequence(expected, tool_names):
        problems.append(f"expected tool subsequence {expected}, saw {tool_names}")
    # required_tools: each must appear, in any order (tools called in parallel stream in any order).
    missing = [t for t in case.get("required_tools", []) if t not in tool_names]
    if missing:
        problems.append(f"required tools {missing} not called")
    # forbidden_tools: must never be called (e.g. a live search on a replay or refusal turn).
    called = [t for t in case.get("forbidden_tools", []) if t in tool_names]
    if called:
        problems.append(f"forbidden tools {called} called")
    problems += input_problems(case, calls)

    own_words = scrub(text, quoted)
    for forbidden in case.get("forbidden_text", []):
        if forbidden in own_words:
            problems.append(f"forbidden text {forbidden!r} present")
    # forbidden_prose: the agent's words only; a tool input (a file name like unproven_<pass>) is not words.
    words = prose(own_words).lower()
    for phrase in case.get("forbidden_prose", []):
        if phrase.lower() in words:
            problems.append(f"forbidden prose {phrase!r} present")
    # registry_quoted: the registry's sentence must appear in the answer exactly as the tool wrote it.
    if case.get("registry_quoted") and not any(line in text for line in quoted):
        problems.append("no registry line quoted as written" + ("" if quoted else " (none recorded)"))
    # warn_text: wording the prompt forbids but the stage repairs itself (an em dash reads as a
    # comma on the caption band); printed, never a failure.
    warnings = [f"wording {w!r} present" for w in case.get("warn_text", []) if w in text]
    # required_text: phrases the agent must say (e.g. the Methane Hunter's confidence sentence).
    for required in case.get("required_text", []):
        if required not in text:
            problems.append(f"required text {required!r} missing")
    # required_text_by_ending: the one question ends on a draft or on decide(stop), each with its words.
    by_ending = case.get("required_text_by_ending")
    if by_ending:
        end = ending(calls)
        if end is None:
            problems.append("no ending: neither draft_tasking nor decide(step=stop) was called")
        for required in by_ending.get(end, []) if end else []:
            if required not in text:
                problems.append(f"required text {required!r} missing (ending {end})")
    closer = closing_paragraph(text)
    # closer_max_chars: the spoken closing paragraph must fit the stage caption band.
    limit = case.get("closer_max_chars")
    if limit and len(closer) > limit:
        problems.append(f"closing paragraph is {len(closer)} chars (> {limit})")
    # closer_endswith: the spoken closing paragraph (the last one) must end with this phrase.
    suffix = case.get("closer_endswith")
    if suffix and not closer.endswith(suffix):
        problems.append(f"closing paragraph does not end with {suffix!r}")
    # closer_forbidden: phrases the spoken closer must not contain (coordinates: the room hears places).
    for bad in case.get("closer_forbidden", []):
        if bad in closer:
            problems.append(f"closing paragraph contains {bad!r}")
    # max_seconds: the last turn's wall time; report_max_words: the answer's cap, as the prompt states it.
    if case.get("max_seconds") and elapsed > case["max_seconds"]:
        problems.append(f"turn took {elapsed:.1f}s (> {case['max_seconds']}s)")
    cap = case.get("report_max_words")
    n_words = len(report_text(text).split())
    if cap and n_words > cap:
        problems.append(f"final report is {n_words} words (> {cap})")
    return problems, warnings


# --- refusals, from the session's transcript --------------------------------------------------------------

MESSAGE_KEY_RE = re.compile(r"/agents/[^/]+/messages/message_\d+\.json$")
MAX_MESSAGES = 500


def session_messages(s3, bucket: str, session_id: str) -> list[dict] | None:
    """The session's stored messages (Strands' S3SessionManager, prefix "sessions"), or None when
    there are none or they cannot be read: then refusals are not counted, never counted as 0."""
    prefix = f"sessions/session_{session_id}/agents/"
    keys: list[str] = []
    try:
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            listing = s3.list_objects_v2(**kwargs)
            keys += [o["Key"] for o in listing.get("Contents", []) if MESSAGE_KEY_RE.search(o["Key"])]
            token = listing.get("NextContinuationToken") if listing.get("IsTruncated") else None
            if not token or len(keys) >= MAX_MESSAGES:
                break
        messages = []
        for key in keys[:MAX_MESSAGES]:
            body = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
            if isinstance(body, dict):
                messages.append(body)
    except Exception as e:  # a failed read means "not counted", never "no refusals"
        print(f"         (session transcript unavailable: {type(e).__name__})", flush=True)
        return None
    return messages or None


def _is_refusal(result: dict) -> bool:
    if result.get("status") == "error":
        return True
    for item in result.get("content") or []:
        if not isinstance(item, dict):
            continue
        body = item.get("json")
        if body is None and isinstance(item.get("text"), str):
            try:
                body = json.loads(item["text"])
            except json.JSONDecodeError:
                continue
        if isinstance(body, dict) and "error" in body:
            return True
    return False


def refusals_in(messages: list[dict], tool_ids: set[str]) -> list[str]:
    """The tool-use ids, among this turn's, whose result was a refusal (a JSON "error" or an error status)."""
    refused: dict[str, None] = {}
    for stored in messages:
        message = stored.get("message") if isinstance(stored.get("message"), dict) else stored
        for block in message.get("content") or []:
            result = block.get("toolResult") if isinstance(block, dict) else None
            if isinstance(result, dict) and result.get("toolUseId") in tool_ids and _is_refusal(result):
                refused[result["toolUseId"]] = None
    return list(refused)


# --- one case, and the repeat summary --------------------------------------------------------------------

def run_prompt(client, arn: str, case: dict, timeout: int, s3=None, bucket: str | None = None,
               registry: bool = True, count_refusals: bool = False) -> tuple[bool, str, dict]:
    """Run one golden prompt; returns (passed, detail, record). With `s3` and `bucket`, forbidden
    text is checked with the session's registry sentences removed (see registry_lines), and with
    `count_refusals` the turn's refusals are counted from the session's transcript."""
    started = time.monotonic()
    try:
        # setup_prompt: earlier turns in the same session (not checked), so a follow-up is tested as
        # the presenter types it; a string or a list of strings. Timing and checks cover the last turn only.
        session_id = new_session_id()
        setups = case.get("setup_prompt") or []
        for setup in [setups] if isinstance(setups, str) else setups:
            stream_invoke(client, arn, setup, timeout, session_id)
        if setups:
            started = time.monotonic()
        text, marks = stream_invoke(client, arn, case["prompt"], timeout, session_id)
    except Exception as e:  # RuntimeClientError, timeout, throttling ...
        record = {"name": case["name"], "passed": False, "seconds": round(time.monotonic() - started, 1),
                  "tools": [], "observations": [], "path": [], "refusals": None,
                  "detail": f"invoke failed: {type(e).__name__}: {e}"}
        return False, record["detail"], record
    elapsed = time.monotonic() - started

    calls = extract_tool_calls(text)
    tool_names = [t["name"] for t in calls]
    quoted = registry_lines(s3, bucket, session_id) if (registry and s3 is not None and bucket) else []
    problems, warnings = evaluate(case, text, elapsed, quoted)

    refused: list[str] | None = None
    if count_refusals and s3 is not None and bucket:
        messages = session_messages(s3, bucket, session_id)
        if messages is not None:
            names = {c["toolUseId"]: c["name"] for c in calls}
            refused = [names[i] for i in refusals_in(messages, set(names))]

    # Characters of prose (everything that is not a tool-call object): a proxy for how much
    # the model wrote, which is what the room waits on at the end of a turn.
    spans = tool_spans(text)
    prose_chars = len(text) - sum(end - start for start, end, _ in spans)
    report_chars, report_seconds = final_report(text, marks, elapsed)
    record = {
        "name": case["name"], "passed": not problems, "seconds": round(elapsed, 1),
        "tools": tool_names, "observations": observations(text),
        # Tool inputs (what the model asked for), trimmed: enough to debug a retry or a wrong argument.
        "tool_inputs": [{"name": t["name"], "input": str(t.get("input", ""))[:3000]} for t in calls],
        "path": path_of(calls), "ending": ending(calls),
        "refusals": None if refused is None else len(refused), "refused": refused,
        "prose_chars": prose_chars, "report_chars": report_chars, "report_seconds": report_seconds,
        "report_words": len(report_text(text).split()),
        # Keep the TAIL: the closer is what matters, and a head cut made complete closers look truncated.
        "report_text": (text[spans[-1][1]:] if spans else text).strip()[-2000:],
        "detail": "; ".join(problems),
        "warnings": warnings,
        "registry_lines": quoted,
    }
    if problems:
        tail = text[-500:].replace("\n", " ")
        return False, "; ".join(problems) + f"\n      stream tail: ...{tail}", record
    note = f"\n         warn: {'; '.join(warnings)}" if warnings else ""
    return True, (f"{elapsed:.0f}s (final report {report_seconds:.1f}s, {report_chars} chars), "
                  f"tools: {tool_names}{note}"), record


def summarise(records: list[dict]) -> list[dict]:
    """Per case, over its runs: the passes, the median and maximum seconds, the refusals per run, and
    the distinct paths with a count each (most common first)."""
    by_name: dict[str, list[dict]] = {}
    for r in records:
        by_name.setdefault(r["name"], []).append(r)
    out = []
    for name, runs in by_name.items():
        seconds = [r["seconds"] for r in runs]
        paths = Counter(tuple(r.get("path") or []) for r in runs)
        out.append({
            "name": name, "runs": len(runs), "passed": sum(1 for r in runs if r["passed"]),
            "median_seconds": round(statistics.median(seconds), 1), "max_seconds": round(max(seconds), 1),
            "refusals": [r.get("refusals") for r in runs],
            "paths": [{"path": list(p), "count": n} for p, n in paths.most_common()],
        })
    return out


def summary_lines(summary: list[dict]) -> list[str]:
    lines = []
    for s in summary:
        refusals = ", ".join("?" if n is None else str(n) for n in s["refusals"])
        lines.append(f"  {s['name']}: {s['passed']}/{s['runs']} passed; median {s['median_seconds']}s, "
                     f"max {s['max_seconds']}s; refusals per run {refusals}")
        for p in s["paths"]:
            lines.append(f"      {p['count']}x {' > '.join(p['path']) or '(no tools)'}")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", required=True, choices=["dev", "stable"])
    parser.add_argument("--agent", default="earth", choices=sorted(AGENTS),
                        help="which agent's runtimes and golden prompts (default: earth)")
    parser.add_argument("--prompts", type=Path, default=None, help="default: the agent's golden_prompts.json")
    parser.add_argument("--only", help="run a single prompt by name")
    parser.add_argument("--repeat", type=int, default=1, help="run each case N times and summarise the paths")
    parser.add_argument("--timeout", type=int, default=600, help="per-prompt stream timeout (s)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, no AWS calls")
    parser.add_argument("--json", type=Path, help="also write a machine-readable report here")
    parser.add_argument("--label", default="", help="free-text label stored in the report (e.g. model id)")
    args = parser.parse_args(argv)
    args.prompts = args.prompts or AGENTS[args.agent]["prompts"]
    if args.repeat < 1:
        parser.error("--repeat must be 1 or more")

    cases = json.loads(args.prompts.read_text())["prompts"]
    if args.only:
        cases = [c for c in cases if c["name"] == args.only]
        if not cases:
            print(f"No prompt named {args.only!r} in {args.prompts}")
            return 1

    arn = resolve_agent_arn(args.target, args.agent)
    print(f"Agent:  {args.agent}")
    print(f"Target: {args.target} ({AGENTS[args.agent]['targets'][args.target]})")
    print(f"ARN:    {arn}")
    shown = args.prompts.relative_to(REPO_ROOT) if args.prompts.is_relative_to(REPO_ROOT) else args.prompts
    print(f"Cases:  {len(cases)} from {shown}" + (f", each {args.repeat} times" if args.repeat > 1 else ""))

    malformed = [p for case in cases for p in case_problems(case)]
    if args.dry_run:
        times = f" x{args.repeat}" if args.repeat > 1 else ""
        for case in cases:
            setup = " (after a setup turn)" if case.get("setup_prompt") else ""
            print(f"  [plan] {case['name']}{setup}{times}: expect {case.get('expected_tools', [])}")
        for p in malformed:
            print(f"  [malformed] {p}")
        print("Dry run: nothing invoked.")
        return 1 if malformed else 0
    if malformed:
        for p in malformed:
            print(f"  [malformed] {p}")
        return 1

    import boto3  # deferred so --dry-run needs no credentials

    region = arn.split(":")[3]
    client = boto3.client("bedrock-agentcore", region_name=region)
    agent = AGENTS[args.agent]
    env_file = agent.get("env", {}).get(args.target)
    bucket = env_value(env_file, "S3_BUCKET_NAME") if env_file else None
    s3 = boto3.client("s3", region_name=region) if bucket else None
    if agent.get("registry"):
        print(f"Registry lines read from: {bucket or '(no S3_BUCKET_NAME; names are never scrubbed)'}")
    if agent.get("refusals"):
        print("Refusals: counted from the session transcripts" + ("" if bucket else " (no S3_BUCKET_NAME; not counted)"))

    failures = 0
    records = []
    for case in cases:
        for run in range(1, args.repeat + 1):
            ok, detail, record = run_prompt(client, arn, case, args.timeout, s3, bucket,
                                            registry=bool(agent.get("registry")),
                                            count_refusals=bool(agent.get("refusals")))
            record["run"] = run
            records.append(record)
            status = "PASS" if ok else "FAIL"
            which = f" (run {run}/{args.repeat})" if args.repeat > 1 else ""
            refusals = f", refusals {record['refusals']}" if record.get("refusals") is not None else ""
            print(f"  [{status}] {case['name']}{which}: {detail}{refusals}", flush=True)
            for obs in record["observations"]:
                print(f"         sees: {obs[:220]}", flush=True)
            if not ok:
                failures += 1

    summary = summarise(records)
    if args.repeat > 1:
        print("Paths:")
        for line in summary_lines(summary):
            print(line, flush=True)
    print(f"{len(records) - failures}/{len(records)} passed", flush=True)
    if args.json:
        args.json.write_text(json.dumps({
            "agent": args.agent, "target": args.target, "arn": arn, "label": args.label,
            "run_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "repeat": args.repeat, "passed": len(records) - failures,
            "total": len(records), "results": records, "runs": summary,
        }, indent=1))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
