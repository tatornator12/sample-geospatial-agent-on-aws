#!/usr/bin/env python3
"""Model bake-off on the dev runtime: same golden prompts, several Bedrock models.

For each model: swap MODEL_ID / BEDROCK_MODEL_ID on the dev runtime with an env-only
update (same image, no rebuild), wait until READY, run scripts/eval.py with a JSON
report, then move on. The original model is restored at the end (also on Ctrl-C).
Prints pass rates, per-prompt seconds and the model's "what I see" sentences side by
side, and writes the raw reports next to each other for the record.

Usage:
    python scripts/bakeoff.py [--models id1 id2 ...] [--only NAME] [--out DIR]

Dev only. The stable runtime is never touched by this script.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import boto3

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import resolve_agent_arn  # noqa: E402

DEFAULT_MODELS = [
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-sonnet-5",
    "us.anthropic.claude-fable-5-1",
]
MODEL_ENV_KEYS = ("MODEL_ID", "BEDROCK_MODEL_ID")


def runtime_id(arn: str) -> str:
    return arn.rsplit("/", 1)[-1]


def get_runtime(control, rid: str) -> dict:
    return control.get_agent_runtime(agentRuntimeId=rid)


def set_model(control, rid: str, current: dict, model_id: str) -> None:
    """Env-only update: everything else copied from the current definition."""
    env = dict(current["environmentVariables"])
    for key in MODEL_ENV_KEYS:
        env[key] = model_id
    control.update_agent_runtime(
        agentRuntimeId=rid,
        agentRuntimeArtifact={"containerConfiguration": {
            "containerUri": current["agentRuntimeArtifact"]["containerConfiguration"]["containerUri"]}},
        roleArn=current["roleArn"],
        networkConfiguration=current["networkConfiguration"],
        protocolConfiguration=current["protocolConfiguration"],
        environmentVariables=env,
    )
    for _ in range(60):
        time.sleep(5)
        status = get_runtime(control, rid)["status"]
        if status == "READY":
            return
        if status.endswith("FAILED"):
            raise RuntimeError(f"runtime update failed: {status}")
    raise TimeoutError("runtime did not become READY within 5 minutes")


def run_eval(model_id: str, only: str | None, out_dir: Path) -> dict:
    report = out_dir / f"{model_id.replace('.', '_').replace(':', '_')}.json"
    cmd = [sys.executable, str(REPO_ROOT / "scripts" / "eval.py"), "--target", "dev",
           "--json", str(report), "--label", model_id]
    if only:
        cmd += ["--only", only]
    print(f"\n=== {model_id} ===", flush=True)
    subprocess.run(cmd, check=False)
    return json.loads(report.read_text())


def print_comparison(reports: list[dict]) -> None:
    names = [r["name"] for r in reports[0]["results"]]
    print("\n" + "=" * 78)
    print("BAKE-OFF SUMMARY (dev runtime, same golden prompts, one pass each)")
    print("=" * 78)
    header = f"{'prompt':26}" + "".join(f"{r['label'].split('.')[-1]:>17}" for r in reports)
    print(header)
    for i, name in enumerate(names):
        cells = []
        for r in reports:
            res = r["results"][i]
            mark = "ok" if res["passed"] else "FAIL"
            cells.append(f"{res['seconds']:>8.0f}s {mark:<5}")
        print(f"{name:26}" + "".join(f"{c:>17}" for c in cells))
    print(f"{'total seconds':26}" + "".join(
        f"{sum(x['seconds'] for x in r['results']):>16.0f}s" for r in reports))
    print(f"{'passed':26}" + "".join(f"{r['passed']}/{r['total']:<14}".rjust(17) for r in reports))
    print(f"{'prose chars (all prompts)':26}" + "".join(
        f"{sum(x.get('prose_chars', 0) for x in r['results']):>17}" for r in reports))

    print("\nWhat each model said after looking (first inspect_image per prompt):")
    for i, name in enumerate(names):
        print(f"\n[{name}]")
        for r in reports:
            obs = r["results"][i]["observations"]
            print(f"  {r['label'].split('.')[-1]:>14}: {obs[0][:330] if obs else '(no inspection)'}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--only", help="run a single golden prompt by name")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "docs" / "bakeoff")
    args = parser.parse_args()

    arn = resolve_agent_arn("dev")
    rid = runtime_id(arn)
    control = boto3.client("bedrock-agentcore-control", region_name=arn.split(":")[3])
    current = get_runtime(control, rid)
    original_model = current["environmentVariables"].get("MODEL_ID")
    print(f"dev runtime: {rid} (version {current['agentRuntimeVersion']}), current model {original_model}")
    args.out.mkdir(parents=True, exist_ok=True)

    reports: list[dict] = []
    try:
        for model_id in args.models:
            print(f"\n--- switching dev to {model_id} ...", flush=True)
            set_model(control, rid, current, model_id)
            reports.append(run_eval(model_id, args.only, args.out))
    finally:
        print(f"\n--- restoring dev to {original_model} ...", flush=True)
        set_model(control, rid, current, original_model)
        final = get_runtime(control, rid)
        print(f"dev runtime version {final['agentRuntimeVersion']}, MODEL_ID={final['environmentVariables']['MODEL_ID']}")

    if reports:
        print_comparison(reports)
        (args.out / "summary.json").write_text(json.dumps(reports, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
