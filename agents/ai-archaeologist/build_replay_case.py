#!/usr/bin/env python3
"""Record one live AI Archaeologist turn and turn it into an offline replay case.

    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py                     # the Octagon, on dev
    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py --case great-circle  # the measure beat
    AWS_PROFILE=main ../../.venv/bin/python build_replay_case.py --target stable --prompt "..."

Invokes the runtime once (a fresh session) with the case's prompt, then copies what the room saw
into `use-cases/<id>/` at the repo root, flat:

    config.json        name, question, agent, tool_calls (the streamed tool inputs), assets.layers
    narrative.md       the agent's final answer (the room's line, the record, the closer)
    <layers>           every file display_visual put on the map (Sentinel-2 true colour, the
                       hillshade or local relief copied from the terrain cache, the transect)
    inspections/*      what the agent looked at (the evidence chips)

Every layer is a catalogue site's: the terrain came from `archaeology/cache/v1` (built ahead of
time from USGS 3DEP), so a replay reads nothing live. S3 URLs in the config use the placeholder
bucket `bucket`; the backend maps `s3://bucket/use-cases/<id>/…` to its own bucket. Staging to
S3 is a separate, explicit step (printed at the end).
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import boto3

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402

FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(tif|tiff|geojson|json|png|jpg)$")
CASE_ID_RE = re.compile(r"^archaeologist-[a-z0-9-]{1,50}$")
# The closer names the designation; every star site is a World Heritage component.
CLOSER_RE = re.compile(r"World Heritage", re.I)
FORBIDDEN = ("discovered", "new site", "uncovered", "hidden site")

# The stream carries tool inputs only; the timeline shows one line per step.
RESULTS = {
    "find_known_site": "Site found on the public record",
    "get_rasters": "Sentinel-2 scene fetched",
    "inspect_image": "Looked at the image",
    "display_visual": "Shown on the map",
    "show_terrain": "1 m LiDAR terrain from the cache",
    "measure_profile": "Transect measured on the 1 m DEM",
    "find_similar_sites": "Sites of the same form ranked",
    "reverse_geocode": "Place named",
}

CASES = {
    "octagon": {
        "id": "archaeologist-newark",
        # The stage's "The Octagon, from space" plate (react-ui/frontend/src/utils/stageCopy.ts), word for word.
        "prompt": "Show me the Newark Octagon the way an archaeologist sees it",
        "name": "Newark Earthworks",
        "description": "The Octagon Earthworks from space, then under the grass: 1 m LiDAR shows the eight-sided enclosure and its circle beneath a former golf course",
        "location": "Newark, Ohio",
    },
    "great-circle": {
        "id": "archaeologist-great-circle",
        "prompt": "How big is the Great Circle, and how was it built?",
        "name": "The Great Circle, measured",
        "description": "The Great Circle Earthworks measured across on 1 m LiDAR: 362 m bank to bank, the bank and the interior ditch in metres, beside the record",
        "location": "Newark, Ohio",
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", choices=sorted(CASES), default="octagon")
    parser.add_argument("--id", help="Case id (archaeologist-…); defaults to the preset's")
    parser.add_argument("--prompt", help="Prompt to record; defaults to the preset's")
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", help="Output folder; defaults to use-cases/<id>")
    args = parser.parse_args()

    preset = CASES[args.case]
    case_id = args.id or preset["id"]
    if not CASE_ID_RE.fullmatch(case_id):
        raise SystemExit("case id must look like archaeologist-<lowercase-words> (the backend's scenario id rule)")
    prompt = args.prompt or preset["prompt"]
    out = Path(args.out or REPO_ROOT / "use-cases" / case_id)

    arn = resolve_agent_arn(args.target, "archaeologist")
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording {case_id} on {arn.rsplit('/', 1)[1]} (session {sid[:13]}…)")
    text, _ = stream_invoke(client, arn, prompt, 900, sid)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    narrative = (text[spans[-1][1]:] if spans else text).strip()
    # The room reads this; dashes become commas so the saved copy matches the house style.
    narrative = re.sub(r"\|\s*[\u2013\u2014]\s*\|", "| |", narrative)  # an empty table cell
    narrative = re.sub(r"\s*[\u2013\u2014]\s*", ", ", narrative)
    if not CLOSER_RE.search(narrative):
        raise SystemExit("the recorded answer never names the designation; not a usable replay case")
    low = text.lower()
    bad = [w for w in FORBIDDEN if w in low]
    if bad:
        raise SystemExit(f"the recording uses words the act forbids ({', '.join(bad)}); record it again")
    if not any(t["name"] == "show_terrain" for t in tools):
        raise SystemExit("the recorded turn never showed the LiDAR; not a usable replay case")

    s3 = boto3.client("s3", region_name=args.region)
    # A fresh take replaces the previous one entirely.
    if out.exists():
        shutil.rmtree(out)
    (out / "inspections").mkdir(parents=True, exist_ok=True)
    session_prefix = f"session_data/{sid}/"
    url_re = re.compile(r"^s3://([^/]+)/(.+)$")
    local_for: dict[str, str] = {}  # source key -> file name in the case

    def case_name(key: str) -> str | None:
        # Only this session's files, flat; the terrain copies carry the cache's own names.
        if not key.startswith(session_prefix):
            return None
        base = key.rsplit("/", 1)[-1]
        return base if FILE_RE.match(base) else None

    def fetch(bucket: str, key: str, name: str) -> bool:
        try:
            s3.download_file(bucket, key, str(out / name))
        except Exception as e:  # a missing inspection is decoration, not a failure
            print(f"  (missing) {name}: {type(e).__name__}")
            return False
        print(f"  {name}  <- s3://…/{key[:70]}")
        return True

    bucket = None
    for t in tools:
        params = tool_input(t)
        # The layer itself, and the DEM a hillshade's render hint carries (the stage lights it live).
        render = params.get("render") if isinstance(params.get("render"), dict) else {}
        for url in (params.get("s3_url"), render.get("dem")):
            m = url_re.match(url) if isinstance(url, str) else None
            if not m:
                continue
            bucket = bucket or m.group(1)
            key = m.group(2)
            if key in local_for:
                continue
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

    def rewrite(url: str) -> str | None:
        m = url_re.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{case_id}/{name}" if name else None

    tool_calls, layers, seen = [], [], set()
    for t in tools:
        params = dict(tool_input(t))
        for k in ("s3_url", "geometry_s3_url"):
            if isinstance(params.get(k), str):
                new = rewrite(params[k])
                if new:
                    params[k] = new
                else:
                    params.pop(k)
        if isinstance(params.get("render"), dict) and isinstance(params["render"].get("dem"), str):
            new = rewrite(params["render"]["dem"])
            params["render"] = {**params["render"], **({"dem": new} if new else {})}
            if not new:
                params["render"].pop("dem", None)
        tool_calls.append({"name": t["name"], "params": params, "result": RESULTS.get(t["name"], "Done")})
        if t["name"] == "display_visual" and "s3_url" in params:
            name = params["s3_url"].rsplit("/", 1)[-1]
            if name in seen:
                continue
            seen.add(name)
            layer = {"file": name, "title": str(params.get("title", name))[:120]}
            if isinstance(params.get("render"), dict):
                layer["render"] = params["render"]
            layers.append(layer)
    # The replay lands rasters in the order listed, the first on top: the terrain over the scene.
    # The stage places them that way anyway (a terrain product is a finding); the order makes a
    # recording from before that rule read the same. Geometry keeps its own order.
    def order(layer: dict) -> int:
        f = layer["file"]
        return 0 if f.startswith(("hillshade_", "lrm")) else 1 if f.endswith((".tif", ".tiff")) else 2
    layers.sort(key=order)
    if not any(l["file"].startswith(("hillshade_", "lrm")) for l in layers):
        raise SystemExit("the recorded turn never put the LiDAR on the map; record it again")

    config = {
        "name": preset["name"],
        "description": preset["description"],
        "location": preset["location"],
        "user_question": prompt,
        "agent": "archaeologist",
        "dates": {},
        "scenario_version": "1.1",
        "recorded_from": arn.rsplit("/", 1)[1].rsplit("-", 1)[0],
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }
    (out / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    (out / "narrative.md").write_text(narrative + "\n")
    print(f"Wrote {out.relative_to(REPO_ROOT)}: {len(tool_calls)} tool calls, layers {[l['file'] for l in layers]}")
    print(f"Stage it:  aws s3 sync {out.relative_to(REPO_ROOT)}/ s3://<S3_BUCKET_NAME>/use-cases/{case_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
