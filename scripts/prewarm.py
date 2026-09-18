#!/usr/bin/env python3
"""Pre-warm AgentCore sessions before an act so the first prompt on stage skips the cold start.

Each pre-warmed session gets a trivial, tool-free prompt. The script prints the session id
and a stage URL that adopts it (`/?session=<id>&agent=<agentId>`); open that URL on the
presenter machine and the first real prompt runs in an already-booted session.

Usage:
    python scripts/prewarm.py --target dev [--count 2] [--agent dev] [--ui http://localhost:5173]
    python scripts/prewarm.py --target dev --verify     # also time a second call on the same session

Sessions stay warm only for the runtime's idle window (15 minutes by default), so run this
a few minutes before each act, not an hour before.
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

import boto3

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import TARGET_AGENTS, resolve_agent_arn  # noqa: E402

WARM_PROMPT = "Reply with exactly the word ready. Do not call any tools."


def invoke(client, arn: str, session_id: str) -> tuple[float, float, str]:
    """Returns (seconds to first byte, seconds total, text) for one trivial prompt."""
    t0 = time.monotonic()
    resp = client.invoke_agent_runtime(
        agentRuntimeArn=arn, runtimeSessionId=session_id, qualifier="DEFAULT",
        payload=json.dumps({"prompt": WARM_PROMPT}).encode(),
    )
    first = None
    chunks = []
    for line in resp["response"].iter_lines():
        if first is None:
            first = time.monotonic() - t0
        line = line.decode() if isinstance(line, bytes) else line
        if line.startswith("data: "):
            d = line[6:].strip()
            try:
                d = json.loads(d)
            except json.JSONDecodeError:
                pass
            if isinstance(d, str):
                chunks.append(d)
    return first or 0.0, time.monotonic() - t0, "".join(chunks).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", required=True, choices=sorted(TARGET_AGENTS))
    parser.add_argument("--count", type=int, default=1, help="how many sessions to warm")
    parser.add_argument("--agent", default="", help="agentId the UI should select (AGENT_RUNTIMES key)")
    parser.add_argument("--ui", default="http://localhost:5173", help="stage base URL for the printed links")
    parser.add_argument("--verify", action="store_true", help="time a second call on each warmed session")
    args = parser.parse_args()

    arn = resolve_agent_arn(args.target)
    client = boto3.client("bedrock-agentcore", region_name=arn.split(":")[3])
    print(f"Warming {args.count} session(s) on {args.target} ({TARGET_AGENTS[args.target]})")

    for _ in range(args.count):
        session_id = str(uuid.uuid4())
        ttfb, total, text = invoke(client, arn, session_id)
        ok = "Error:" not in text
        print(f"  session {session_id}: first byte {ttfb:4.1f}s, done {total:4.1f}s, reply {text[:40]!r}"
              + ("" if ok else "  <- ERROR"))
        if args.verify:
            ttfb2, total2, _ = invoke(client, arn, session_id)
            print(f"      warm re-invoke:      first byte {ttfb2:4.1f}s, done {total2:4.1f}s")
        agent_param = f"&agent={args.agent}" if args.agent else ""
        print(f"      open: {args.ui}/?session={session_id}{agent_param}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
