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
import time
from pathlib import Path

import boto3

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import evaluate, extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402
from replay_case import house_style, saw_by_tool, shown, styled_params, write_sid  # noqa: E402

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
    "record_condition": "Verdict recorded",
    "reverse_geocode": "Place named",
}
TOOL_USE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

CASES = {
    "octagon": {
        "id": "archaeologist-newark",
        # The stage's "The Octagon, from space" plate (react-ui/frontend/src/utils/stageCopy.ts), word for word.
        "prompt": "Show me the Newark Octagon the way an archaeologist sees it",
        "name": "Newark Earthworks",
        "description": "The Octagon Earthworks from space, then under the grass: 1 m LiDAR shows the eight-sided enclosure and its circle beneath a former golf course",
        "location": "Newark, Ohio",
        # The live turn shows the true colour first and the LiDAR later; the replay holds the
        # hillshade this long so the room sees the scene from space alone first (stage review D10).
        "hold_terrain_ms": 8000,
    },
    "survey": {
        "id": "archaeologist-survey",
        # The stage's "Where else, like this" plate after "The Octagon, from space" (decision 10): the
        # setup turn runs first in the same session and is not recorded; the take must pass the
        # golden like-this case, so the replay is a passing dev session.
        "setup": "Show me the Newark Octagon the way an archaeologist sees it",
        "prompt": "Where else did they build like this?",
        "golden": "like-this",
        "name": "Sites like the Octagon, surveyed",
        "description": "The agent looks at the 1 m LiDAR of the recorded sites that share the Octagon's form and judges whether each still shows in the ground",
        "location": "Ohio",
    },
    "great-circle": {
        "id": "archaeologist-great-circle",
        # The stage's "Measure the Great Circle" plate, word for word (stage review D10: not "how was it built?").
        "prompt": "Measure the Great Circle: how wide is it, how high is the bank, how deep is the ditch?",
        "name": "The Great Circle, measured",
        "description": "The Great Circle Earthworks measured across on 1 m LiDAR: 362 m bank to bank, the bank and the interior ditch in metres, beside the record",
        "location": "Newark, Ohio",
    },
}


def golden_case(name: str) -> dict:
    """A case from this agent's golden prompts, by name."""
    cases = json.loads((HERE / "golden_prompts.json").read_text())["prompts"]
    return next(c for c in cases if c["name"] == name)


def survey_name(tool: dict) -> str | None:
    """The file a record_condition call wrote when its verdict was accepted (survey_tools.survey_key)."""
    tid = tool.get("toolUseId")
    if tool.get("name") != "record_condition" or not isinstance(tid, str) or not TOOL_USE_ID_RE.fullmatch(tid):
        return None
    return f"survey_{tid}.json"


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
    parser.add_argument("--out", help="Output folder, anywhere; defaults to use-cases/<id>")
    parser.add_argument("--sid-file", help="Also write the take's full session id here (for scripts/replay_numbers.py)")
    parser.add_argument("--stream-file", help="Also write the raw stream here (it names the bucket: keep it out of the repo)")
    parser.add_argument("--hold-terrain-ms", type=int, default=None,
                        help="Hold the terrain layer this long when a true-colour layer is also listed "
                             "(0 to 15000; default 8000 for octagon, 0 otherwise)")
    args = parser.parse_args()

    preset = CASES[args.case]
    case_id = args.id or preset["id"]
    if not CASE_ID_RE.fullmatch(case_id):
        raise SystemExit("case id must look like archaeologist-<lowercase-words> (the backend's scenario id rule)")
    prompt = args.prompt or preset["prompt"]
    out = Path(args.out or REPO_ROOT / "use-cases" / case_id)
    hold_ms = preset.get("hold_terrain_ms", 0) if args.hold_terrain_ms is None else args.hold_terrain_ms
    if not 0 <= hold_ms <= 15000:
        raise SystemExit("--hold-terrain-ms must be 0 to 15000 (the backend drops anything else)")

    arn = resolve_agent_arn(args.target, "archaeologist")
    sid = new_session_id()
    client = boto3.client("bedrock-agentcore", region_name=args.region)
    print(f"Recording {case_id} on {arn.rsplit('/', 1)[1]} (session {sid[:13]}…)")
    write_sid(args.sid_file, sid)
    if preset.get("setup") and not args.prompt:
        print(f"  setup turn (not recorded): {preset['setup']}")
        stream_invoke(client, arn, preset["setup"], 900, sid)
    started = time.monotonic()
    text, _ = stream_invoke(client, arn, prompt, 900, sid)
    elapsed = time.monotonic() - started
    if preset.get("golden") and not args.prompt:
        problems, _ = evaluate(golden_case(preset["golden"]), text, elapsed)
        if problems:
            raise SystemExit(f"the take fails the golden {preset['golden']} case ({'; '.join(problems)}); record it again")
    if args.stream_file:
        Path(args.stream_file).write_text(text)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    # The room reads this; dashes become commas (a range "to") so the saved copy matches the house style.
    narrative = house_style((text[spans[-1][1]:] if spans else text).strip())
    saw = saw_by_tool(text)
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
    # The survey's verdicts: one file per accepted record_condition, named by its call's id (a refused
    # call wrote none). The stage reads them beside the case's layers, under the same names.
    surveyed = 0
    for t in tools:
        name = survey_name(t)
        if name and fetch(bucket, f"{session_prefix}archaeology/{name}", name):
            surveyed += 1
    if preset.get("golden") == "like-this" and surveyed < 2:
        raise SystemExit(f"the take recorded {surveyed} verdict(s); the survey needs two or more")

    def rewrite(url: str) -> str | None:
        m = url_re.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{case_id}/{name}" if name else None

    tool_calls, layers, seen = [], [], set()
    for t in tools:
        params = styled_params(dict(tool_input(t)))
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
        call = {"name": t["name"], "params": params, "result": RESULTS.get(t["name"], "Done")}
        # The call keeps its own id (the stage finds a verdict's file by it; ChatSidebar RECORDED_ID).
        if isinstance(t.get("toolUseId"), str) and TOOL_USE_ID_RE.fullmatch(t["toolUseId"]):
            call = {"id": t["toolUseId"], **call}
        if t["name"] == "inspect_image" and saw.get(t.get("toolUseId")):
            call["saw"] = saw[t["toolUseId"]]  # what the agent said it saw (the chip's Saw line)
        tool_calls.append(call)
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
    # The true colour stands alone first, as it did live: the stage lands the terrain after delay_ms.
    if hold_ms and any(l["file"].startswith("tci_") for l in layers):
        for l in layers:
            if l["file"].startswith(("hillshade_", "lrm")):
                l["delay_ms"] = hold_ms

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
    print(f"Wrote {shown(out)}: {len(tool_calls)} tool calls, layers {[l['file'] for l in layers]}"
          + (f", terrain held {hold_ms} ms" if any("delay_ms" in l for l in layers) else ""))
    print(f"Stage it:  aws s3 sync {shown(out)}/ s3://<S3_BUCKET_NAME>/use-cases/{case_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
