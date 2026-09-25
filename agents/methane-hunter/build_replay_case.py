#!/usr/bin/env python3
"""Record one live Methane Hunter run and turn it into an offline replay case.

    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py                  # Permian, on dev
    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py --case watch     # the Methane Watch mission
    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py --case watch --prompt "..." --target stable

Invokes the runtime once (a fresh session) with the case's prompt, then copies what the room saw
into `use-cases/<id>/` at the repo root, flat:

    config.json            name, question, agent, tool_calls (the streamed tool inputs), assets.layers
    narrative.md           the agent's final answer (record + spoken closer)
    <layers>               every file display_visual put on the map (footprints, plume, watch
                           sites, TROPOMI composite, EMIT pass window, 3D columns, Sentinel-2)
    passes_<lat>_<lon>.json + passchip_*.png   the cue step's filmstrip (manifest and frames)
    <brief id>.draft.json  the draft brief (the card reads it; a replay never files it)
    inspections/*.png|jpg  what the agent looked at (the evidence chips)

S3 URLs in the config use the placeholder bucket `bucket` like the other cases; the backend maps
`s3://bucket/use-cases/<id>/…` to its own bucket. Layers name files, never URLs. Staging to S3 is
a separate, explicit step (printed at the end). Nothing here needs CMR, LP DAAC or TROPOMI at
replay time.
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
from eval import AGENTS, extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402,F401

FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(tif|tiff|geojson|json|png|jpg)$")
CHIP_RE = re.compile(r"^passchip_[A-Za-z0-9_.-]{1,120}\.png$")
BRIEF_RE = re.compile(r"draft `(brief-\d{8}T\d{6}-[0-9a-f]{6})`")
CASE_ID_RE = re.compile(r"^methane-[a-z0-9-]{1,56}$")
CLOSER = "EMIT sees the methane, not its source."

# The stream carries tool inputs only; the timeline shows one line per step.
RESULTS = {
    "search_methane_plumes": "Plume complexes found in EMIT L2B CH4PLM",
    "triage_plumes": "Plumes ranked by peak enhancement",
    "reverse_geocode": "Place named",
    "display_visual": "Shown on the map",
    "show_plume": "Plume raster opened",
    "inspect_image": "Looked at the image",
    "create_bbox_from_coordinates": "3 km frame around the site",
    "get_rasters": "Sentinel-2 scene fetched",
    "watch_baseline": "Baseline built from NASA's plume record",
    "scan_tropomi": "TROPOMI composite scanned",
    "check_recent_passes": "Recent EMIT passes judged",
    "site_history": "Site history read",
    "draft_brief": "Brief drafted (not filed)",
}

CASES = {
    "permian": {
        "id": "methane-permian-2024",
        "prompt": ("Find the strongest methane plume EMIT saw over the Permian Basin in 2024 "
                   "and show me what is on the ground beneath it"),
        "name": "Permian Basin methane, 2024",
        "description": "The strongest methane plume NASA EMIT saw over the Permian Basin in 2024, and the ground beneath it",
        "location": "Permian Basin, Texas and New Mexico",
        "dates": {"window": "2024-01-01/2024-12-31"},
        "needs_brief": False,
    },
    "watch": {
        "id": "methane-watch-south-caspian",
        "prompt": ("Brief me on the methane watch areas: where is methane recurring right now, "
                   "and how confident are we?"),
        "name": "Methane Watch brief",
        "description": ("One prompt, the whole mission: a global baseline, a TROPOMI tip, EMIT cued on recent "
                        "passes, a self-check, and a draft brief for the analyst"),
        "location": "Methane watch areas",
        "dates": {},
        "needs_brief": True,
    },
}


def tool_input(tool: dict) -> dict:
    raw = tool.get("input")
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}


def coord(value) -> str | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return f"{v:.4f}" if abs(v) <= 180 else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", choices=sorted(CASES), default="permian")
    parser.add_argument("--id", help="Case id (methane-…); defaults to the preset's")
    parser.add_argument("--prompt", help="Prompt to record; defaults to the preset's")
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", help="Output folder; defaults to use-cases/<id>")
    args = parser.parse_args()

    preset = CASES[args.case]
    case_id = args.id or preset["id"]
    if not CASE_ID_RE.fullmatch(case_id):
        raise SystemExit("case id must look like methane-<lowercase-words> (the backend's scenario id rule)")
    prompt = args.prompt or preset["prompt"]
    out = Path(args.out or REPO_ROOT / "use-cases" / case_id)

    arn = resolve_agent_arn(args.target, "methane")
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording {case_id} on {arn.rsplit('/', 1)[1]} (session {sid[:13]}…)")
    text, _ = stream_invoke(client, arn, prompt, 900, sid)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    narrative = (text[spans[-1][1]:] if spans else text).strip()
    if CLOSER not in narrative:
        raise SystemExit("the recorded answer has no spoken closer; not a usable replay case")
    brief_ids = BRIEF_RE.findall(narrative)
    if preset["needs_brief"] and not brief_ids:
        raise SystemExit("the recorded mission drafted no brief; not a usable Methane Watch case")

    s3 = boto3.client("s3", region_name=args.region)
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

    def fetch(bucket: str, key: str, name: str) -> bool:
        try:
            s3.download_file(bucket, key, str(out / name))
        except Exception as e:  # a missing chip or inspection is decoration, not a failure
            print(f"  (missing) {name}: {type(e).__name__}")
            return False
        print(f"  {name}  <- s3://…/{key[:70]}")
        return True

    bucket = None
    for t in tools:
        params = tool_input(t)
        url = params.get("s3_url")
        m = url_re.match(url) if isinstance(url, str) else None
        if not m:
            continue
        bucket = bucket or m.group(1)
        if m.group(2) in local_for:
            continue
        key = m.group(2)
        name = case_name(key)
        if not name or not fetch(m.group(1), key, name):
            continue
        local_for[key] = name
        if t["name"] == "inspect_image":  # the rendering the chip shows (tools._inspection_key)
            stem = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            for ext in ("png", "jpg"):
                if fetch(m.group(1), f"{session_prefix}inspections/{stem}.{ext}", f"inspections/{stem}.{ext}"):
                    break
    if not bucket:
        raise SystemExit("the run put nothing on the map; not a usable replay case")

    # The filmstrip: each cue's manifest (the UI derives its name from the call's lat/lon) and its chips.
    films = 0
    for t in tools:
        if t["name"] != "check_recent_passes":
            continue
        params = tool_input(t)
        lat, lon = coord(params.get("lat")), coord(params.get("lon"))
        if lat is None or lon is None:
            continue
        name = f"passes_{lat}_{lon}.json"
        if name in local_for.values() or not fetch(bucket, f"{session_prefix}methane/{name}", name):
            continue
        local_for[f"{session_prefix}methane/{name}"] = name
        films += 1
        manifest = json.loads((out / name).read_text())
        for p in manifest.get("passes", []):
            chip = p.get("chip")
            if isinstance(chip, str) and CHIP_RE.fullmatch(chip) and not (out / chip).exists():
                fetch(bucket, f"{session_prefix}methane/{chip}", chip)

    # The draft brief the card shows (never filed in a replay).
    for bid in dict.fromkeys(brief_ids):
        fetch(bucket, f"{session_prefix}briefs/{bid}.draft.json", f"{bid}.draft.json")

    def rewrite(url: str) -> str | None:
        m = url_re.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{case_id}/{name}" if name else None

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
                params[k] = new if new else f"s3://bucket/use-cases/{case_id}/plumes_detected.geojson"
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
    # The replay lands layers in the order listed, as the live run did: the TROPOMI tip first, then
    # the EMIT finding (each methane raster goes on top of the one before), then the ground scene
    # beneath them, whose frame is the one the camera ends on. Geometry keeps its own order.
    def order(layer: dict) -> int:
        f = layer["file"]
        return 0 if f.startswith("tropomi_anomaly_") else 1 if f.startswith(("pass_", "ch4plm_")) else 2
    layers.sort(key=order)

    config = {
        "name": preset["name"],
        "description": preset["description"],
        "location": preset["location"],
        "user_question": prompt,
        "agent": "methane",
        "dates": preset["dates"],
        "scenario_version": "1.1",
        "recorded_from": arn.rsplit("/", 1)[1].rsplit("-", 1)[0],
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }
    (out / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    (out / "narrative.md").write_text(narrative + "\n")
    print(f"Wrote {out.relative_to(REPO_ROOT)}: {len(tool_calls)} tool calls, {films} filmstrip(s), "
          f"briefs {list(dict.fromkeys(brief_ids))}, layers {[l['file'] for l in layers]}")
    print(f"Stage it:  aws s3 sync {out.relative_to(REPO_ROOT)}/ s3://<S3_BUCKET_NAME>/use-cases/{case_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
