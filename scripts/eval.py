#!/usr/bin/env python3
"""Golden-prompt evaluation against an AgentCore runtime.

Invokes the dev or stable runtime with every prompt in scripts/golden_prompts.json,
extracts the tool calls from the SSE stream with the same brace-matching the UI uses,
and asserts:

  * expected_tools appear as a SUBSEQUENCE of the streamed tool names (extra tools in
    between are fine, order matters);
  * no forbidden_text (e.g. "Error:") appears anywhere in the stream.

Exit code 0 when every prompt passes, 1 otherwise. A runtime crash
(RuntimeClientError-style) is a failure and prints the raw stream tail.

Usage:
    python scripts/eval.py --target dev [--agent earth|methane] [--dry-run] [--only NAME] [--timeout 600]

The runtime ARN is read from geo_agent/.bedrock_agentcore.yaml by agent name
(dev -> geospatial_agent_dev, stable -> geospatial_agent_on_aws), so the script always
talks to the same runtimes as deploy.sh. --dry-run prints the plan without touching AWS.
"""
import argparse
import json
import sys
import time
import uuid
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
        arn = config["agents"][agent_name]["bedrock_agentcore"]["agent_arn"]
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


def is_subsequence(expected: list[str], actual: list[str]) -> bool:
    it = iter(actual)
    return all(name in it for name in expected)


def stream_invoke(client, arn: str, prompt: str, timeout: int) -> tuple[str, list[tuple[int, float]]]:
    """Invoke the runtime; return the full decoded stream text and, per chunk, (char offset, seconds)."""
    session_id = f"eval-{uuid.uuid4()}-{uuid.uuid4().hex[:8]}"  # >= 33 chars
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


def run_prompt(client, arn: str, case: dict, timeout: int) -> tuple[bool, str, dict]:
    """Run one golden prompt; returns (passed, detail, record)."""
    started = time.monotonic()
    try:
        text, marks = stream_invoke(client, arn, case["prompt"], timeout)
    except Exception as e:  # RuntimeClientError, timeout, throttling ...
        record = {"name": case["name"], "passed": False, "seconds": round(time.monotonic() - started, 1),
                  "tools": [], "observations": [], "detail": f"invoke failed: {type(e).__name__}: {e}"}
        return False, record["detail"], record
    elapsed = time.monotonic() - started

    tool_names = [t["name"] for t in extract_tool_calls(text)]
    problems = []

    expected = case.get("expected_tools", [])
    if expected and not is_subsequence(expected, tool_names):
        problems.append(f"expected tool subsequence {expected}, saw {tool_names}")

    for forbidden in case.get("forbidden_text", []):
        if forbidden in text:
            problems.append(f"forbidden text {forbidden!r} present")
    # required_text: phrases the agent must say (e.g. the Methane Hunter's confidence sentence).
    for required in case.get("required_text", []):
        if required not in text:
            problems.append(f"required text {required!r} missing")
    # closer_max_chars: the spoken closing paragraph must fit the stage caption band.
    limit = case.get("closer_max_chars")
    if limit:
        paragraphs = [p.strip() for p in text.strip().split("\n\n") if p.strip()]
        closer = paragraphs[-1] if paragraphs else ""
        if len(closer) > limit:
            problems.append(f"closing paragraph is {len(closer)} chars (> {limit})")
    # closer_endswith: the spoken closing paragraph (the last one) must end with this phrase.
    suffix = case.get("closer_endswith")
    if suffix:
        paragraphs = [p.strip() for p in text.strip().split("\n\n") if p.strip()]
        closer = paragraphs[-1] if paragraphs else ""
        if not closer.endswith(suffix):
            problems.append(f"closing paragraph does not end with {suffix!r}")

    # Characters of prose (everything that is not a tool-call object): a proxy for how much
    # the model wrote, which is what the room waits on at the end of a turn.
    spans = tool_spans(text)
    prose_chars = len(text) - sum(end - start for start, end, _ in spans)
    report_chars, report_seconds = final_report(text, marks, elapsed)
    record = {
        "name": case["name"], "passed": not problems, "seconds": round(elapsed, 1),
        "tools": tool_names, "observations": observations(text),
        "prose_chars": prose_chars, "report_chars": report_chars, "report_seconds": report_seconds,
        # Keep the TAIL: the closer is what matters, and a head cut made complete closers look truncated.
        "report_text": (text[spans[-1][1]:] if spans else text).strip()[-2000:],
        "detail": "; ".join(problems),
    }
    if problems:
        tail = text[-500:].replace("\n", " ")
        return False, "; ".join(problems) + f"\n      stream tail: ...{tail}", record
    return True, (f"{elapsed:.0f}s (final report {report_seconds:.1f}s, {report_chars} chars), "
                  f"tools: {tool_names}"), record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", required=True, choices=["dev", "stable"])
    parser.add_argument("--agent", default="earth", choices=sorted(AGENTS),
                        help="which agent's runtimes and golden prompts (default: earth)")
    parser.add_argument("--prompts", type=Path, default=None, help="default: the agent's golden_prompts.json")
    parser.add_argument("--only", help="run a single prompt by name")
    parser.add_argument("--timeout", type=int, default=600, help="per-prompt stream timeout (s)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, no AWS calls")
    parser.add_argument("--json", type=Path, help="also write a machine-readable report here")
    parser.add_argument("--label", default="", help="free-text label stored in the report (e.g. model id)")
    args = parser.parse_args()
    args.prompts = args.prompts or AGENTS[args.agent]["prompts"]

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
    print(f"Cases:  {len(cases)} from {args.prompts.relative_to(REPO_ROOT)}")

    if args.dry_run:
        for case in cases:
            print(f"  [plan] {case['name']}: expect {case.get('expected_tools', [])}")
        print("Dry run: nothing invoked.")
        return 0

    import boto3  # deferred so --dry-run needs no credentials

    region = arn.split(":")[3]
    client = boto3.client("bedrock-agentcore", region_name=region)

    failures = 0
    records = []
    for case in cases:
        ok, detail, record = run_prompt(client, arn, case, args.timeout)
        records.append(record)
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {case['name']}: {detail}", flush=True)
        for obs in record["observations"]:
            print(f"         sees: {obs[:220]}", flush=True)
        if not ok:
            failures += 1

    print(f"{len(cases) - failures}/{len(cases)} passed", flush=True)
    if args.json:
        args.json.write_text(json.dumps({
            "agent": args.agent, "target": args.target, "arn": arn, "label": args.label,
            "run_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "passed": len(cases) - failures,
            "total": len(cases), "results": records,
        }, indent=1))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
