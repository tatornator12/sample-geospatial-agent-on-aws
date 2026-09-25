#!/usr/bin/env python3
"""Runtime chores for promotions: find an ARN, check a runtime's env, register it with the UI.

    python scripts/runtimes.py arn --agent methane --target stable
    python scripts/runtimes.py check-env --agent methane --target stable
    python scripts/runtimes.py register --env frontend-cdk/.env --id methane \
        --agent methane --target stable --label "Methane Hunter" --description "..."

check-env prints only variable NAMES and presence, never values. register rewrites only the
AGENT_RUNTIMES line of a gitignored env file (a backup is written next to it, mode 600): it
sets one entry and keeps "stable" and "dev" first so a fresh browser lands on the live
Earth Analyst. Runtime names and yaml locations come from eval.py's AGENTS registry, so this
talks to the same runtimes as deploy.sh and the eval gate.
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval import AGENTS, resolve_agent_arn  # noqa: E402

REGION = os.environ.get("AWS_REGION", "us-east-1")
# What each runtime must have after a deploy (deploy.sh passes these with --env).
REQUIRED_ENV = {
    "earth": ["S3_BUCKET_NAME", "MODEL_ID", "ARCGIS_MCP_URL", "ARCGIS_MCP_TOKEN"],
    "methane": ["S3_BUCKET_NAME", "MODEL_ID", "ARCGIS_MCP_URL", "ARCGIS_MCP_TOKEN", "EARTHDATA_TOKEN"],
}
ARN_RE = re.compile(r"^arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime/[A-Za-z0-9_-]+$")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
TEXT_RE = re.compile(r"^[\w ,.()·'-]{1,120}$")


def cmd_arn(args) -> int:
    print(resolve_agent_arn(args.target, args.agent))
    return 0


def cmd_check_env(args) -> int:
    import boto3

    arn = resolve_agent_arn(args.target, args.agent)
    runtime_id = arn.rsplit("/", 1)[1]
    r = boto3.client("bedrock-agentcore-control", region_name=REGION).get_agent_runtime(agentRuntimeId=runtime_id)
    env = r.get("environmentVariables") or {}
    missing = [k for k in REQUIRED_ENV[args.agent] if not env.get(k)]
    print(f"{runtime_id}: version {r.get('agentRuntimeVersion')}, status {r.get('status')}")
    print(f"  env keys: {', '.join(sorted(env))}")
    if missing:
        print(f"  MISSING: {', '.join(missing)}")
        return 1
    print(f"  required keys present: {', '.join(REQUIRED_ENV[args.agent])}")
    return 0 if r.get("status") == "READY" else 1


def cmd_register(args) -> int:
    env_path = Path(args.env)
    if not ID_RE.match(args.id):
        raise SystemExit(f"--id must match {ID_RE.pattern}")
    for name in ("label", "description"):
        if not TEXT_RE.match(getattr(args, name)):
            raise SystemExit(f"--{name} has characters outside {TEXT_RE.pattern}")
    arn = resolve_agent_arn(args.target, args.agent)
    if not ARN_RE.match(arn):
        raise SystemExit(f"unexpected ARN shape for {args.agent}/{args.target}")

    lines = env_path.read_text().split("\n")
    index = next((i for i, line in enumerate(lines) if line.startswith("AGENT_RUNTIMES=")), None)
    if index is None:
        raise SystemExit(f"{env_path} has no AGENT_RUNTIMES line")
    raw = lines[index].split("=", 1)[1].strip()
    quote = raw[0] if raw[:1] in ("'", '"') and raw[-1:] == raw[:1] else ""
    runtimes = json.loads(raw[1:-1] if quote else raw)
    if not isinstance(runtimes, dict):
        raise SystemExit("AGENT_RUNTIMES must be a JSON object keyed by agent id")

    entry = {"arn": arn, "label": args.label, "description": args.description}
    if runtimes.get(args.id) == entry:
        print(f"{env_path}: {args.id} already registered ({arn.rsplit('/', 1)[1]})")
        return 0
    runtimes[args.id] = entry
    ordered = {k: runtimes[k] for k in ("stable", "dev") if k in runtimes}
    ordered.update({k: v for k, v in runtimes.items() if k not in ordered})
    value = json.dumps(ordered, separators=(",", ":"), ensure_ascii=False)
    lines[index] = f"AGENT_RUNTIMES={quote}{value}{quote}"

    backup = env_path.with_name(env_path.name + ".bak")
    shutil.copy2(env_path, backup)
    os.chmod(backup, 0o600)
    env_path.write_text("\n".join(lines))
    print(f"{env_path}: registered {args.id} -> {arn.rsplit('/', 1)[1]} (agents: {', '.join(ordered)}; backup {backup.name})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("arn", "check-env", "register"):
        p = sub.add_parser(name)
        p.add_argument("--agent", choices=sorted(AGENTS), default="earth")
        p.add_argument("--target", choices=["dev", "stable"], required=True)
        if name == "register":
            p.add_argument("--env", required=True, help="env file with an AGENT_RUNTIMES line")
            p.add_argument("--id", required=True, help="agent id the UI uses (e.g. methane)")
            p.add_argument("--label", required=True)
            p.add_argument("--description", required=True)
    args = parser.parse_args()
    return {"arn": cmd_arn, "check-env": cmd_check_env, "register": cmd_register}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
