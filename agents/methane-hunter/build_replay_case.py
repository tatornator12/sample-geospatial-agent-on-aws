#!/usr/bin/env python3
"""Record one live Methane Hunter run and turn it into an offline replay case.

    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py            # record on dev, write use-cases/<id>/
    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py --target stable

Invokes the runtime once (a fresh session) with the Act 2 prompt, then copies what the room saw
into `use-cases/<id>/` at the repo root:

    config.json            name, question, agent, tool_calls (the streamed tool inputs), assets.layers
    narrative.md           the agent's final answer (record + spoken closer)
    geometry.geojson       the ranked footprints
    plumes_detected.geojson
    ch4plm_<granule>.tif   the plume raster (from the shared cache)
    <sentinel-2 scene>.tif the ground beneath it
    inspections/*.png|jpg  what the agent looked at (the evidence chips)

S3 URLs in the config use the placeholder bucket `bucket` like the other cases; the backend maps
`s3://bucket/use-cases/<id>/…` to its own bucket. Layers name files, never URLs. Staging to S3 is
a separate, explicit step (printed at the end). Nothing here needs CMR or LP DAAC at replay time.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import boto3

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import AGENTS, extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402

CASE_ID = "methane-permian-2024"
PROMPT = ("Find the strongest methane plume EMIT saw over the Permian Basin in 2024 "
          "and show me what is on the ground beneath it")
FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(tif|tiff|geojson|png|jpg)$")
RESULTS = {  # the stream carries tool inputs only; the timeline shows one line per step
    "search_methane_plumes": "39 plume complexes found in EMIT L2B CH4PLM for 2024",
    "triage_plumes": "39 plumes ranked by peak enhancement",
    "reverse_geocode": "Place named",
    "display_visual": "Shown on the map",
    "show_plume": "Plume raster opened",
    "inspect_image": "Looked at the image",
    "create_bbox_from_coordinates": "3 km frame around the plume centre",
    "get_rasters": "Sentinel-2 scene fetched",
}


def tool_input(tool: dict) -> dict:
    raw = tool.get("input")
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", default=str(REPO_ROOT / "use-cases" / CASE_ID))
    args = parser.parse_args()

    arn = resolve_agent_arn(args.target, "methane")
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording on {arn.rsplit('/', 1)[1]} (session {sid[:13]}…)")
    text, _ = stream_invoke(client, arn, PROMPT, 600, sid)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    narrative = (text[spans[-1][1]:] if spans else text).strip()
    if "EMIT sees the methane, not its source." not in narrative:
        raise SystemExit("the recorded answer has no spoken closer; not a usable replay case")

    s3 = boto3.client("s3", region_name=args.region)
    out = Path(args.out)
    (out / "inspections").mkdir(parents=True, exist_ok=True)
    session_prefix = f"session_data/{sid}/"
    url_re = re.compile(r"^s3://([^/]+)/(.+)$")
    local_for: dict[str, str] = {}  # source key -> file name in the case

    def case_name(key: str) -> str | None:
        base = key.rsplit("/", 1)[-1]
        if key.startswith(session_prefix + "methane/plumes_ranked_"):
            return "geometry.geojson"
        if key.startswith(session_prefix + "methane/plumes_"):
            return "plumes_detected.geojson"
        if key.startswith("methane/cache/ch4plm_") or key.startswith(session_prefix):
            return base if FILE_RE.match(base) else None
        return None

    def fetch(bucket: str, key: str, name: str) -> None:
        s3.download_file(bucket, key, str(out / name))
        print(f"  {name}  <- s3://…/{key[:70]}")

    bucket = None
    for t in tools:
        params = tool_input(t)
        url = params.get("s3_url")
        m = url_re.match(url) if isinstance(url, str) else None
        if not m or m.group(2) in local_for:
            continue
        bucket, key = m.group(1), m.group(2)
        name = case_name(key)
        if not name:
            continue
        fetch(bucket, key, name)
        local_for[key] = name
        if t["name"] == "inspect_image":  # the rendering the chip shows (tools._inspection_key)
            stem = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            for ext in ("png", "jpg"):
                ikey = f"{session_prefix}inspections/{stem}.{ext}"
                try:
                    fetch(bucket, ikey, f"inspections/{stem}.{ext}")
                    break
                except Exception:
                    continue

    def rewrite(url: str) -> str | None:
        m = url_re.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{CASE_ID}/{name}" if name else None

    tool_calls, layers, seen = [], [], set()
    for t in tools:
        params = dict(tool_input(t))
        if isinstance(params.get("s3_url"), str):
            new = rewrite(params["s3_url"])
            if new:
                params["s3_url"] = new
            else:
                params.pop("s3_url")
        for k in ("geometry_s3_url", "plumes_geometry_s3_url"):
            if isinstance(params.get(k), str):
                new = rewrite(params[k])
                params[k] = new if new else f"s3://bucket/use-cases/{CASE_ID}/plumes_detected.geojson"
        tool_calls.append({"name": t["name"], "params": params, "result": RESULTS.get(t["name"], "Done")})
        # Layers: what display_visual put on the map, minus the detected set the ranked one replaced.
        if t["name"] == "display_visual" and "s3_url" in params:
            name = params["s3_url"].rsplit("/", 1)[-1]
            if name in seen or name == "plumes_detected.geojson":
                continue
            seen.add(name)
            layer = {"file": name, "title": str(params.get("title", name))[:120]}
            if isinstance(params.get("render"), dict):
                layer["render"] = params["render"]
            layers.append(layer)

    config = {
        "name": "Permian Basin methane, 2024",
        "description": "The strongest methane plume NASA EMIT saw over the Permian Basin in 2024, and the ground beneath it",
        "location": "Permian Basin, Texas and New Mexico",
        "user_question": PROMPT,
        "agent": "methane",
        "dates": {"window": "2024-01-01/2024-12-31"},
        "scenario_version": "1.0",
        "recorded_from": arn.rsplit("/", 1)[1].rsplit("-", 1)[0],
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }
    (out / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    (out / "narrative.md").write_text(narrative + "\n")
    print(f"Wrote {out.relative_to(REPO_ROOT)}: {len(tool_calls)} tool calls, layers {[l['file'] for l in layers]}")
    if bucket:
        print(f"Stage it:  aws s3 sync {out.relative_to(REPO_ROOT)}/ s3://<S3_BUCKET_NAME>/use-cases/{CASE_ID}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
