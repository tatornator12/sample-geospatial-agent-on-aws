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
                           sites, the tip bars, the record bars, Sentinel-2)
    passes_<lat>_<lon>.json + passchip_*.png   the cue step's filmstrip (manifest and frames)
    follow.json            the follow decision (the stage words it and the bars from it)
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
import shutil
import sys
from datetime import date
from pathlib import Path

import boto3

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from eval import AGENTS, extract_tool_calls, new_session_id, resolve_agent_arn, stream_invoke, tool_spans  # noqa: E402,F401
from replay_case import house_style, saw_by_tool, shown, styled_params, write_sid  # noqa: E402

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
    "carbon_mapper_plumes": "Carbon Mapper's public plumes checked",
    "follow_site": "Site followed by the 90-day rule",
    "thermal_anomalies": "VIIRS heat checked",
    "nearby_infrastructure": "Overture Maps checked, by type",
    "registry_lookup": "Public registry checked",
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
        # The bars take (approved 2026-10-23). Never the older cases' ids: those prefixes serve the
        # stable gallery and the earlier takes.
        "id": "methane-watch-bars",
        # The stage's "Methane Watch brief" plate (react-ui/frontend/src/utils/stageCopy.ts), word for word.
        "prompt": "Brief me on the watch areas where methane keeps showing up, and how confident you are.",
        "name": "Methane Watch brief",
        "description": ("One prompt, the whole mission: a global baseline, a TROPOMI tip, EMIT cued on recent "
                        "passes, a self-check, and a draft brief for the analyst"),
        "location": "Methane watch areas",
        "dates": {},
        "needs_brief": True,
    },
}


# The record bars land this long after the tip bars in a replay, so both bar layers stand on the map
# in turn, as they did live (the replay reveals its steps in under 6 s; utils/heldLayers.ts).
RECORD_BARS_HOLD_MS = 6000


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


def shows_columns(t: dict, prop: str | None = None, file: str | None = None) -> bool:
    inp = tool_input(t)
    render = inp.get("render")
    if isinstance(render, str):
        try:
            render = json.loads(render)
        except json.JSONDecodeError:
            render = None
    url = str(inp.get("s3_url", ""))
    return (t["name"] == "display_visual" and isinstance(render, dict) and render.get("kind") == "columns"
            and (prop is None or render.get("property") == prop) and (file is None or url.endswith("/" + file)))


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December")


def fortnight_words(start: str, end: str) -> str | None:
    """'5 to 18 October 2026' (or '25 September to 8 October 2026') for two ISO dates, else None."""
    m1, m2 = (re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", str(d)) for d in (start, end))
    if not m1 or not m2:
        return None
    (y1, mo1, d1), (y2, mo2, d2) = ((int(g) for g in m.groups()) for m in (m1, m2))
    if not (1 <= mo1 <= 12 and 1 <= mo2 <= 12):
        return None
    head = f"{d1}" if (y1, mo1) == (y2, mo2) else f"{d1} {MONTHS[mo1 - 1]}" + ("" if y1 == y2 else f" {y1}")
    return f"{head} to {d2} {MONTHS[mo2 - 1]} {y2}"


def board_description(description: str, tip: dict | None, read_on: str) -> str:
    """The case says which board it recorded: the TROPOMI fortnight, and the day EMIT and Carbon Mapper
    were read (the take's day, which can be later than the fortnight)."""
    words = fortnight_words((tip or {}).get("start", ""), (tip or {}).get("end", ""))
    day = fortnight_words(read_on, read_on)
    if not words or not day:
        return description
    return (f"{description}. Recorded on the TROPOMI fortnight {words}, "
            f"with the EMIT and Carbon Mapper records as read on {day.split(' to ', 1)[1]}")


def take_problems(tools: list[dict], narrative: str, follow: dict | None, needs_brief: bool) -> list[str]:
    """Why a recorded take is not a usable replay case (empty: it is). The Methane Watch take must show
    what the room is told: the tip bars always, and the record bars whenever the followed site has a
    confirmation they were built from."""
    problems = []
    if CLOSER not in narrative:
        problems.append("the recorded answer has no spoken closer")
    if not needs_brief:
        return problems
    if not BRIEF_RE.findall(narrative):
        problems.append("the recorded mission drafted no brief")
    if not any(t["name"] == "carbon_mapper_plumes" for t in tools):
        problems.append("the recorded mission never checked Carbon Mapper")
    # A take that looked at a candidate's window and never showed its columns is a partial mission
    # (the Oct 22 production run).
    looked = [i for i, t in enumerate(tools)
              if t["name"] == "inspect_image" and "/pass_EMIT_" in str(tool_input(t).get("s3_url", ""))]
    if looked and not any(shows_columns(t, "ppm_m") for t in tools[looked[0] + 1:]):
        problems.append("the recorded mission looked at an EMIT window and never showed its 3D columns")
    if not isinstance(follow, dict):
        problems.append("the recorded mission has no follow decision (follow.json)")
        return problems
    tip = (follow.get("tip_bars") or {}).get("file") if isinstance(follow.get("tip_bars"), dict) else None
    tip_at = next((i for i, t in enumerate(tools) if tip and shows_columns(t, "ppb", tip)), None)
    if tip_at is None:
        problems.append("the recorded mission never showed the tip bars")
    record = follow.get("record_bars") if isinstance(follow.get("record_bars"), dict) else None
    latest = (follow.get("followed") or {}).get("latest") if isinstance(follow.get("followed"), dict) else None
    days = (follow.get("followed") or {}).get("days_before_tip") if isinstance(follow.get("followed"), dict) else None
    if latest and record is None and isinstance(days, int) and days <= follow.get("gap_days", 90):
        problems.append("the followed site has a confirmation within 90 days but no record bars were built")
    if record:
        record_at = next((i for i, t in enumerate(tools) if shows_columns(t, None, record.get("file"))), None)
        if record_at is None:
            problems.append("the recorded mission has a confirmation but never showed its record bars")
        elif tip_at is not None and record_at < tip_at:
            problems.append("the record bars were shown before the tip bars")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", choices=sorted(CASES), default="permian")
    parser.add_argument("--id", help="Case id (methane-…); defaults to the preset's")
    parser.add_argument("--prompt", help="Prompt to record; defaults to the preset's")
    parser.add_argument("--target", choices=["dev", "stable"], default="dev")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--out", help="Output folder, anywhere; defaults to use-cases/<id>")
    parser.add_argument("--sid-file", help="Also write the take's full session id here (for scripts/replay_numbers.py)")
    parser.add_argument("--stream-file", help="Also write the raw stream here (it names the bucket: keep it out of the repo)")
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
    write_sid(args.sid_file, sid)
    text, _ = stream_invoke(client, arn, prompt, 900, sid)
    if args.stream_file:
        Path(args.stream_file).write_text(text)
    tools = extract_tool_calls(text)
    spans = tool_spans(text)
    # The room reads this; dashes become commas (a range "to") so the saved copy matches the house style.
    narrative = house_style((text[spans[-1][1]:] if spans else text).strip())
    saw = saw_by_tool(text)
    brief_ids = BRIEF_RE.findall(narrative)
    s3 = boto3.client("s3", region_name=args.region)
    follow = None
    if preset["needs_brief"]:
        urls = [str(tool_input(t).get("s3_url", "")) for t in tools]
        bucket_of = next((m.group(1) for m in map(re.compile(r"^s3://([^/]+)/").match, urls) if m), None)
        try:
            follow = json.loads(s3.get_object(Bucket=bucket_of, Key=f"session_data/{sid}/methane/follow.json")["Body"].read(200_000))
        except Exception as e:
            print(f"  (no follow.json: {type(e).__name__})")
    problems = take_problems(tools, narrative, follow, preset["needs_brief"])
    if problems:
        raise SystemExit("not a usable replay case; record it again: " + "; ".join(problems))

    # A fresh take replaces the previous one entirely: a stale chip, draft or window from an earlier
    # recording must never ride along into the staged case (the stage would list it, or worse, show it).
    if out.exists():
        shutil.rmtree(out)
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

    # The tip board: one manifest per scanned area (the UI derives its name from the call's `area`).
    for t in tools:
        area = tool_input(t).get("area") if t["name"] == "scan_tropomi" else None
        if isinstance(area, str) and re.fullmatch(r"[a-z ]{3,40}", area.strip().lower()):
            name = f"tip_{area.strip().lower().replace(' ', '_')}.json"
            if name not in local_for.values() and fetch(bucket, f"{session_prefix}methane/{name}", name):
                local_for[f"{session_prefix}methane/{name}"] = name

    # Carbon Mapper's record per cued site: the tip board's line (the UI derives the name from the
    # call's lat/lon, like the filmstrip). Its plume points ride along as a layer when shown.
    for t in tools:
        if t["name"] != "carbon_mapper_plumes":
            continue
        params = tool_input(t)
        lat, lon = coord(params.get("lat")), coord(params.get("lon"))
        if lat is None or lon is None:
            continue
        name = f"cmplumes_{lat}_{lon}.json"
        if name not in local_for.values() and fetch(bucket, f"{session_prefix}methane/{name}", name):
            local_for[f"{session_prefix}methane/{name}"] = name

    # The ground-record checks' records (draft_brief embedded them already; kept for completeness).
    for t in tools:
        if t["name"] not in ("thermal_anomalies", "nearby_infrastructure", "registry_lookup"):
            continue
        params = tool_input(t)
        lat, lon = coord(params.get("lat")), coord(params.get("lon"))
        if lat is None or lon is None:
            continue
        kind = {"thermal_anomalies": "thermal", "nearby_infrastructure": "infra", "registry_lookup": "registry"}[t["name"]]
        name = f"{kind}_{lat}_{lon}.json"
        if name not in local_for.values() and fetch(bucket, f"{session_prefix}methane/{name}", name):
            local_for[f"{session_prefix}methane/{name}"] = name

    # The follow decision: the stage words the decision line and the bars' plate lines from it.
    if follow is not None and fetch(bucket, f"{session_prefix}methane/follow.json", "follow.json"):
        local_for[f"{session_prefix}methane/follow.json"] = "follow.json"

    # The draft brief the card shows (never filed in a replay).
    for bid in dict.fromkeys(brief_ids):
        fetch(bucket, f"{session_prefix}briefs/{bid}.draft.json", f"{bid}.draft.json")

    def rewrite(url: str) -> str | None:
        m = url_re.match(url)
        name = local_for.get(m.group(2)) if m else None
        return f"s3://bucket/use-cases/{case_id}/{name}" if name else None

    tool_calls, layers, seen = [], [], set()
    for t in tools:
        params = styled_params(dict(tool_input(t)))
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
        call = {"name": t["name"], "params": params, "result": RESULTS.get(t["name"], "Done")}
        if t["name"] == "inspect_image" and saw.get(t.get("toolUseId")):
            call["saw"] = saw[t["toolUseId"]]  # what the agent said it saw (the chip's Saw line)
        tool_calls.append(call)
        # Layers: what display_visual put on the map, minus the detected set the ranked one replaced.
        if t["name"] == "display_visual" and "s3_url" in params:
            name = params["s3_url"].rsplit("/", 1)[-1]
            if name in seen or name == "plumes_detected.geojson":
                continue
            seen.add(name)
            layer = {"file": name, "title": str(params.get("title", name))[:120]}
            if isinstance(params.get("render"), dict):
                layer["render"] = params["render"]
            # The record bars wait for the tip bars to stand alone first (one bar layer at a time).
            record = (follow or {}).get("record_bars") if isinstance((follow or {}).get("record_bars"), dict) else None
            if record and name == record.get("file"):
                layer["delay_ms"] = RECORD_BARS_HOLD_MS
            layers.append(layer)
    # The replay lands layers in the order listed, as the live run did: the TROPOMI tip first, then
    # the EMIT finding (each methane raster goes on top of the one before), then the ground scene
    # beneath them, whose frame is the one the camera ends on. Geometry keeps its own order.
    def order(layer: dict) -> int:
        f = layer["file"]
        return 0 if f.startswith("tropomi_anomaly_") else 1 if f.startswith(("pass_", "ch4plm_")) else 2
    layers.sort(key=order)

    # The board the take recorded, said plainly: the TROPOMI fortnight (EMIT and Carbon Mapper were read
    # on the day of the take).
    tip = (follow or {}).get("tip") if isinstance((follow or {}).get("tip"), dict) else {}
    dates = dict(preset["dates"])
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(tip.get("start", ""))) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(tip.get("end", ""))):
        dates["tip_window"] = f"{tip['start']}/{tip['end']}"
    config = {
        "name": preset["name"],
        "description": (board_description(preset["description"], tip, date.today().isoformat())
                        if preset["needs_brief"] else preset["description"]),
        "location": preset["location"],
        "user_question": prompt,
        "agent": "methane",
        "dates": dates,
        "scenario_version": "1.1",
        "recorded_from": arn.rsplit("/", 1)[1].rsplit("-", 1)[0],
        "tool_calls": tool_calls,
        "assets": {"layers": layers},
    }
    (out / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    (out / "narrative.md").write_text(narrative + "\n")
    print(f"Wrote {shown(out)}: {len(tool_calls)} tool calls, {films} filmstrip(s), "
          f"briefs {list(dict.fromkeys(brief_ids))}, layers {[l['file'] for l in layers]}")
    print(f"Stage it:  aws s3 sync {shown(out)}/ s3://<S3_BUCKET_NAME>/use-cases/{case_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
