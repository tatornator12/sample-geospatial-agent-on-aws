#!/usr/bin/env python3
"""Record one live Earth Analyst turn and turn it into an offline replay case.

    AWS_PROFILE=main .venv/bin/python scripts/build_earth_replay_case.py --case palisades     # on dev
    AWS_PROFILE=main .venv/bin/python scripts/build_earth_replay_case.py --case places-like
    AWS_PROFILE=main .venv/bin/python scripts/build_earth_replay_case.py --case palisades \\
        --id la-fires-2025-take1 --out /tmp/takes/la-fires-2025-take1 --sid-file /tmp/takes/palisades.sid

Invokes the Earth Analyst runtime once (a fresh session) with the case's prompt (the stage's plate,
word for word), then copies what the room saw into `use-cases/<id>/` at the repo root (or --out), flat:

    config.json        name, question, agent ("stable": Act 1), tool_calls (the streamed tool inputs,
                       each inspect_image with what the agent said it saw), assets.layers
    narrative.md       the agent's final answer
    <layers>           every file display_visual put on the map, with the agent's own names, so two
                       scenes of one place (`tci_clipped_<place>_<date>.tif`) pair for the compare slider
    inspections/*      what the agent looked at (the evidence chips)

Layers are listed index rasters first (oldest first, so the latest lands on top), then true colour
newest first (the after scene on top), then geometries. S3 URLs in the config use the placeholder
bucket `bucket`; the backend maps `s3://bucket/use-cases/<id>/...` to its own. Any other S3 URL a tool
input carried is dropped, never written. Staging to S3 is a separate, explicit step (printed at the
end); check the numbers first with scripts/replay_numbers.py.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from eval import extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402
from replay_case import house_style, saw_by_tool, shown, styled_params, write_sid  # noqa: E402

FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(tif|tiff|geojson|json|png|jpg)$")
CASE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,62}$")
URL_RE = re.compile(r"^s3://([^/]+)/(.+)$")
INDEX_PREFIXES = ("ndvi_", "ndwi_", "nbr_", "dnbr_", "change_detection_")

# The stream carries tool inputs only; the timeline shows one line per step.
RESULTS = {
    "find_address_candidates": "Place found",
    "find_location_boundary": "Boundary candidates found",
    "get_best_geometry": "Boundary chosen",
    "create_bbox_from_coordinates": "Area framed",
    "get_rasters": "Sentinel-2 scene fetched",
    "get_rasters_for_dates": "Sentinel-2 scenes fetched",
    "inspect_image": "Looked at the image",
    "run_bandmath": "Index computed",
    "calculate_environmental_impact": "Impact estimated",
    "calculator": "Calculated",
    "display_visual": "Shown on the map",
    "find_similar_places": "Similar places ranked with Clay embeddings",
    "reverse_geocode": "Place named",
    "protected_area_context": "Protected areas checked",
}

CASES = {
    "palisades": {
        "id": "la-fires-2025",
        # The stage's "Wildfire, Pacific Palisades" plate (react-ui/frontend/src/utils/stageCopy.ts), word for word.
        "prompt": "Assess wildfire damage near Pacific Palisades, Los Angeles in January 2025",
        "name": "LA Palisades Fire",
        "description": "The January 2025 Palisades Fire seen from Sentinel-2: the burn scar in the Normalized Burn Ratio, before and after",
        "location": "Pacific Palisades, Los Angeles",
        "required": ["get_rasters_for_dates", "inspect_image", "run_bandmath", "display_visual"],
    },
    "places-like": {
        "id": "earth-places-like-central-park",
        # The stage's "Places like Central Park" plate, word for word.
        "prompt": "Find places across New York State that look like Central Park",
        "name": "Places like Central Park",
        "description": "Search by example: Clay embeddings rank the places across New York State that look most like Central Park, and the agent looks at its top matches",
        "location": "New York State",
        "required": ["find_similar_places", "inspect_image", "display_visual"],
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


def layer_order(layer: dict) -> tuple:
    """Index rasters (change maps as the run showed them, then one date's oldest first), true colour
    (newest first), then geometries in their own order. Each index lands on top of the one before,
    so the after index sits over the before one and over any change map (the case's finding is the
    after scene, as the before/after cases show it); each scene lands beneath the one before, so
    the after scene sits over the before one."""
    f = layer["file"]
    date = (re.search(r"(\d{4}-\d{2}-\d{2})", f) or [None, ""])[1]
    if f.endswith((".tif", ".tiff")):
        if f.startswith("change_detection_"):
            return (0, 0, "")  # a stable sort keeps the run's order
        if f.startswith(INDEX_PREFIXES):
            return (0, 1, date)
        # Newest first: invert the date's digits so an ascending sort puts the latest scene first.
        return (1, 0, "".join(str(9 - int(c)) if c.isdigit() else c for c in date))
    return (2, 0, "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", choices=sorted(CASES), required=True)
    parser.add_argument("--id", help="Case id (lowercase words and hyphens); defaults to the preset's")
    parser.add_argument("--prompt", help="Prompt to record; defaults to the preset's (the stage plate)")
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", help="Output folder, anywhere; defaults to use-cases/<id>")
    parser.add_argument("--sid-file", help="Also write the take's full session id here (for scripts/replay_numbers.py)")
    parser.add_argument("--stream-file", help="Also write the raw stream here (it names the bucket: keep it out of the repo)")
    args = parser.parse_args()

    preset = CASES[args.case]
    case_id = args.id or preset["id"]
    if not CASE_ID_RE.fullmatch(case_id):
        raise SystemExit("case id must be 3 to 63 lowercase letters, digits and hyphens (the backend's scenario id rule)")
    prompt = args.prompt or preset["prompt"]
    out = Path(args.out or REPO_ROOT / "use-cases" / case_id)

    import boto3  # deferred so --help needs no AWS libraries

    arn = resolve_agent_arn(args.target, "earth")
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording {case_id} on {arn.rsplit('/', 1)[1]} (session {sid[:13]}…)")
    write_sid(args.sid_file, sid)
    text, _ = stream_invoke(client, arn, prompt, 900, sid)
    if args.stream_file:
        Path(args.stream_file).write_text(text)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    # The room reads this; dashes become commas (a range "to") so the saved copy matches the house style.
    narrative = house_style((text[spans[-1][1]:] if spans else text).strip())
    saw = saw_by_tool(text)
    if "Error:" in text:
        raise SystemExit("the recording carries an error; record it again")
    names = [t["name"] for t in tools]
    missing = [n for n in preset["required"] if n not in names]
    if missing:
        raise SystemExit(f"the recorded turn never called {', '.join(missing)}; record it again")
    if not narrative:
        raise SystemExit("the recorded turn has no answer; record it again")

    s3 = boto3.client("s3", region_name=args.region)
    # A fresh take replaces the previous one entirely (a stale layer must never ride along).
    if out.exists():
        shutil.rmtree(out)
    (out / "inspections").mkdir(parents=True, exist_ok=True)
    session_prefix = f"session_data/{sid}/"
    local_for: dict[str, str] = {}  # source key -> file name in the case

    def case_name(key: str) -> str | None:
        # Only this session's files, flat, with the agent's own names.
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
        if t["name"] not in ("display_visual", "inspect_image"):
            continue
        url = tool_input(t).get("s3_url")
        m = URL_RE.match(url) if isinstance(url, str) else None
        if not m or m.group(2) in local_for:
            continue
        bucket = bucket or m.group(1)
        key = m.group(2)
        name = case_name(key)
        if not name or not fetch(m.group(1), key, name):
            continue
        local_for[key] = name
        if t["name"] == "inspect_image":  # the rendering the chip shows (tools._inspection_key)
            stem = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            for ext in ("jpg", "png"):
                if fetch(m.group(1), f"{session_prefix}inspections/{stem}.{ext}", f"inspections/{stem}.{ext}"):
                    break
    if not bucket:
        raise SystemExit("the run put nothing on the map; not a usable replay case")

    def rewrite(url: str) -> str | None:
        m = URL_RE.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{case_id}/{name}" if name else None

    tool_calls, layers, seen = [], [], set()
    for t in tools:
        params = {}
        for k, v in tool_input(t).items():
            if isinstance(v, str) and v.startswith("s3://"):
                v = rewrite(v)  # this case's copy, or dropped: no other bucket's URL is written
                if v is None:
                    continue
            params[k] = v
        params = styled_params(params)
        call = {"name": t["name"], "params": params, "result": RESULTS.get(t["name"], "Done")}
        if t["name"] == "inspect_image" and saw.get(t.get("toolUseId")):
            call["saw"] = saw[t["toolUseId"]]  # what the agent said it saw (the chip's Saw line)
        tool_calls.append(call)
        if t["name"] == "display_visual" and "s3_url" in params:
            name = params["s3_url"].rsplit("/", 1)[-1]
            if name in seen or not name.endswith((".tif", ".tiff", ".geojson")):
                continue
            seen.add(name)
            layer = {"file": name, "title": str(params.get("title", name))[:120]}
            if isinstance(params.get("render"), dict):
                layer["render"] = params["render"]
            layers.append(layer)
    layers.sort(key=layer_order)
    if not any(l["file"].endswith((".tif", ".tiff")) for l in layers) and args.case == "palisades":
        raise SystemExit("the recorded turn never put a scene on the map; record it again")
    if args.case == "places-like" and not any(l["file"].startswith("similar_") for l in layers):
        raise SystemExit("the recorded turn never put the similarity map on the stage; record it again")

    config = {
        "name": preset["name"],
        "description": preset["description"],
        "location": preset["location"],
        "user_question": prompt,
        "agent": "stable",
        "dates": {},
        "scenario_version": "1.1",
        "recorded_from": arn.rsplit("/", 1)[1].rsplit("-", 1)[0],
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }
    body = json.dumps(config, indent=2, ensure_ascii=False) + "\n"
    if bucket in body or bucket in narrative:
        raise SystemExit("the bucket's name would be written into the case; not writing it")
    (out / "config.json").write_text(body)
    (out / "narrative.md").write_text(narrative + "\n")
    print(f"Wrote {shown(out)}: {len(tool_calls)} tool calls, {len(saw)} Saw line(s), "
          f"layers {[l['file'] for l in layers]}")
    print(f"Numbers:   .venv/bin/python scripts/replay_numbers.py --case {shown(out)} --session <sid> --bucket <S3_BUCKET_NAME>")
    print(f"Stage it:  aws s3 sync {shown(out)}/ s3://<S3_BUCKET_NAME>/use-cases/{case_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
