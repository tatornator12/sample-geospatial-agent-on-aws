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
    python scripts/eval.py --target dev [--dry-run] [--only NAME] [--timeout 600]

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
AGENTCORE_YAML = REPO_ROOT / "geo_agent" / ".bedrock_agentcore.yaml"
DEFAULT_PROMPTS = REPO_ROOT / "scripts" / "golden_prompts.json"

TARGET_AGENTS = {
    "dev": "geospatial_agent_dev",
    "stable": "geospatial_agent_on_aws",
}


def resolve_agent_arn(target: str) -> str:
    """Read the runtime ARN for the target's agent from .bedrock_agentcore.yaml."""
    agent_name = TARGET_AGENTS[target]
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


def stream_invoke(client, arn: str, prompt: str, timeout: int) -> str:
    """Invoke the runtime and return the full decoded stream text."""
    session_id = f"eval-{uuid.uuid4()}-{uuid.uuid4().hex[:8]}"  # >= 33 chars
    response = client.invoke_agent_runtime(
        agentRuntimeArn=arn,
        runtimeSessionId=session_id,
        qualifier="DEFAULT",
        payload=json.dumps({"prompt": prompt}).encode(),
    )
    body = response["response"]
    chunks: list[str] = []
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
    return "".join(chunks)


def run_prompt(client, arn: str, case: dict, timeout: int) -> tuple[bool, str]:
    """Run one golden prompt; returns (passed, detail)."""
    started = time.monotonic()
    try:
        text = stream_invoke(client, arn, case["prompt"], timeout)
    except Exception as e:  # RuntimeClientError, timeout, throttling ...
        return False, f"invoke failed: {type(e).__name__}: {e}"
    elapsed = time.monotonic() - started

    tool_names = [t["name"] for t in extract_tool_calls(text)]
    problems = []

    expected = case.get("expected_tools", [])
    if expected and not is_subsequence(expected, tool_names):
        problems.append(f"expected tool subsequence {expected}, saw {tool_names}")

    for forbidden in case.get("forbidden_text", []):
        if forbidden in text:
            problems.append(f"forbidden text {forbidden!r} present")

    if problems:
        tail = text[-500:].replace("\n", " ")
        return False, "; ".join(problems) + f"\n      stream tail: ...{tail}"
    return True, f"{elapsed:.0f}s, tools: {tool_names}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", required=True, choices=sorted(TARGET_AGENTS))
    parser.add_argument("--prompts", type=Path, default=DEFAULT_PROMPTS)
    parser.add_argument("--only", help="run a single prompt by name")
    parser.add_argument("--timeout", type=int, default=600, help="per-prompt stream timeout (s)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, no AWS calls")
    args = parser.parse_args()

    cases = json.loads(args.prompts.read_text())["prompts"]
    if args.only:
        cases = [c for c in cases if c["name"] == args.only]
        if not cases:
            print(f"No prompt named {args.only!r} in {args.prompts}")
            return 1

    arn = resolve_agent_arn(args.target)
    print(f"Target: {args.target} ({TARGET_AGENTS[args.target]})")
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
    for case in cases:
        ok, detail = run_prompt(client, arn, case, args.timeout)
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {case['name']}: {detail}")
        if not ok:
            failures += 1

    print(f"{len(cases) - failures}/{len(cases)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
