#!/usr/bin/env python3
"""Check that every number a replay case says came from the tools of the session it was recorded in.

    AWS_PROFILE=main .venv/bin/python scripts/replay_numbers.py --case use-cases/la-fires-2025 \\
        --session "$(cat /tmp/takes/palisades.sid)" --bucket "$B" [--extra "96 km² burnt"] [--dump DIR]

Reads the session the runtimes persist (`S3SessionManager(prefix="sessions")`:
`sessions/session_<sid>/agents/agent_<id>/messages/message_<n>.json`), and collects every number in
the tool RESULTS and in the tool INPUTS (free-text inputs the model writes for the room, a layer's
`title` and `description` and a look's `question`, are checked, not trusted; so is draft_brief, which
only restates the model's observations). Then every number in
what the case shows the room is matched against them:

    narrative.md, the config's `description`, each recorded call's `saw`, each display_visual
    `title` and `description`, and each --extra text (a gallery card's metrics)

A number matches when some source number, times a unit factor (1; m² to km² 1e-6; m² to ha 1e-4;
m² to acres 1/4046.856; fraction to % 100; kg to t 1e-3), rounds to it at the shown decimals (a
whole number ending in zeros, 23,700, at that many zeros). Signs are compared as magnitudes. ISO
dates (and "20 January 2025", "January 2025", "Jan 12", a bare year) must appear in a tool result or input. List markers,
code spans, identifiers (Sentinel-2, CH4, L2B, v1.5, 3D) and years in the prompt are not figures.

Prints each figure with the tool call it came from; exit 1 when any is unmatched. --dump writes the
session's messages (image bytes dropped) and tool_outputs.json (each call's input and result) there.
"""
import argparse
import json
import re
import sys
from pathlib import Path

FACTORS = [(1.0, ""), (1e-6, "m² to km²"), (1e-4, "m² to ha"), (1 / 4046.856, "m² to acres"),
           (100.0, "fraction to %"), (1e-3, "kg to t, m to km")]
MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"])}
MONTH_RE = "|".join(list(MONTHS) + [m[:3] for m in MONTHS])
FREE_TEXT_INPUTS = {"title", "description", "question"}
# Tools that only restate what the model wrote (the brief's observations and gaps): never a source,
# so a figure in the brief is traced to the tool that measured it.
ECHO_TOOLS = {"draft_brief"}
ISO_RE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
COMPACT_RE = re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})T\d{6}")
NUM_RE = re.compile(r"(?<![\w.])[-+−]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d])")
# Not figures: a number inside a name (Sentinel-2, CH4, L2B, B08, v1.5, 3D, OGIM v3.0, Phase 2 stays a figure).
IDENT_RE = re.compile(r"\b[A-Za-z]+-?\d+[A-Za-z0-9]*(?:\.\d+)?\b|\bv\d+(?:\.\d+)*\b|\b\d+D\b|\b\d+[A-Z]{2,}\w*\b")


def strip_images(node):
    """The session JSON without image bytes (they would read as noise numbers)."""
    if isinstance(node, dict):
        return {k: ("<bytes dropped>" if k in ("bytes", "image") else strip_images(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [strip_images(v) for v in node]
    return node


def walk(node, path, out, skip_keys=frozenset()):
    """(value, path) for every number and string under node; JSON inside a string is opened."""
    if isinstance(node, bool):
        return
    if isinstance(node, (int, float)):
        out.append((node, path))
    elif isinstance(node, str):
        s = node.strip()
        if s[:1] in "{[":
            try:
                walk(json.loads(s), path, out, skip_keys)
                return
            except json.JSONDecodeError:
                pass
        out.append((node, path))
    elif isinstance(node, dict):
        for k, v in node.items():
            if k not in skip_keys:
                walk(v, f"{path}.{k}" if path else str(k), out, skip_keys)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{path}[{i}]", out, skip_keys)


def dicts_in(node):
    """Every object under node, JSON inside strings opened (a tool result is JSON in a text block)."""
    if isinstance(node, str) and node.strip()[:1] in "{[":
        try:
            node = json.loads(node)
        except json.JSONDecodeError:
            return
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from dicts_in(v)
    elif isinstance(node, list):
        for v in node:
            yield from dicts_in(v)


def numbers_in(text: str) -> list[float]:
    vals = []
    for m in NUM_RE.finditer(text):
        whole, frac = m.group(1), m.group(2) or ""
        vals.append(float(whole.replace(",", "") + frac))
        if "," in whole:  # "1,2,3" is three numbers too
            vals.extend(float(p) for p in whole.split(","))
    return vals


DAY_MONTH_RE = re.compile(rf"\b(\d{{1,2}})\s+({MONTH_RE})\.?\s+(\d{{4}})\b", re.I)
MONTH_DAY_RE = re.compile(rf"\b({MONTH_RE})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.I)
MONTH_YEAR_RE = re.compile(rf"\b({MONTH_RE})\.?\s+(\d{{4}})\b", re.I)
MONTH_DAY_ONLY_RE = re.compile(rf"\b({MONTH_RE})\.?\s+(\d{{1,2}})\b(?!\d)", re.I)  # "Jan 12": a gallery label
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")


def dates_in(text: str) -> set[str]:
    """ISO, compact (20250820T070851) and written dates ("1 January 2025", "January 1, 2025")."""
    found = {f"{y}-{m}-{d}" for y, m, d in ISO_RE.findall(text)}
    found |= {f"{y}-{m}-{d}" for y, m, d in COMPACT_RE.findall(text)}
    found |= {f"{y}-{month_number(mo):02d}-{int(d):02d}" for d, mo, y in DAY_MONTH_RE.findall(text)}
    found |= {f"{y}-{month_number(mo):02d}-{int(d):02d}" for mo, d, y in MONTH_DAY_RE.findall(text)}
    return found


class Sources:
    """Every number and date the session's tools returned or were given, with where it came from."""

    def __init__(self, calls: list[dict]):
        self.numbers: list[tuple[float, str]] = []
        self.dates: dict[str, str] = {}
        self.years: dict[str, str] = {}  # a year written anywhere in a tool's words ("from 1910 until 2025")
        for c in calls:
            if c["name"] in ECHO_TOOLS:
                continue
            label = f"{c['name']}#{c['n']}"
            # A month a tool names as numbers ({"year": 2025, "month": 7}) is a date the room may hear.
            for d in dicts_in(c.get("result")):
                y, m = d.get("year"), d.get("month")
                if isinstance(y, int) and isinstance(m, int) and 1 <= m <= 12 and 1900 < y < 2100:
                    self.dates.setdefault(f"{y}-{m:02d}", f"{label} result year, month")
            items: list = []
            walk(c.get("input"), "input", items, FREE_TEXT_INPUTS)
            walk(c.get("result"), "result", items)
            for value, path in items:
                where = f"{label} {path}"
                if isinstance(value, str):
                    for d in dates_in(value):
                        self.dates.setdefault(d, where)
                    if value.startswith("s3://"):
                        continue  # a key's ids and dates are not figures
                    for y in YEAR_RE.findall(value):
                        self.years.setdefault(y, where)
                    # A date's parts are not figures ("8 km" never comes from 2024-11-08).
                    for v in numbers_in(COMPACT_RE.sub(" ", ISO_RE.sub(" ", value))):
                        self.numbers.append((v, where))
                else:
                    self.numbers.append((float(value), where))
        # Results before inputs: a figure is better sourced to what a tool returned.
        self.numbers.sort(key=lambda nv: " input" in nv[1])

    def match(self, shown: str) -> str | None:
        # Magnitudes: "2.7 m below" may be -2.7 in the tool, "+108.8 ppb" 108.8.
        digits = shown.strip().lstrip("-+−").replace(",", "")
        value = float(digits)
        decimals = len(digits.split(".")[1]) if "." in digits else 0
        zeros = len(digits) - len(digits.rstrip("0")) if decimals == 0 and value >= 100 else 0
        for factor, unit in FACTORS:
            for src, where in self.numbers:
                x = abs(src) * factor
                if round(x, decimals) == value or (zeros and round(x, -zeros) == value):
                    note = f" ({unit})" if unit else ""
                    return f"{where} = {src:g}{note}"
        return None


def figures(text: str, prompt_years: set[str]) -> list[tuple[str, str]]:
    """(kind, token) for each figure in a text the room sees: ("date", ISO) or ("number", digits)."""
    out: list[tuple[str, str]] = []
    text = re.sub(r"`[^`]*`", " ", text)  # code spans: ids, never figures
    text = re.sub(r"^\s*(?:[-*]|\d+[.)])\s+", " ", text, flags=re.M)  # list markers
    for y, m, d in ISO_RE.findall(text):
        out.append(("date", f"{y}-{m}-{d}"))
    text = ISO_RE.sub(" ", text)
    for d, mo, y in DAY_MONTH_RE.findall(text):
        out.append(("date", f"{y}-{month_number(mo):02d}-{int(d):02d}"))
    text = DAY_MONTH_RE.sub(" ", text)
    for mo, d, y in MONTH_DAY_RE.findall(text):
        out.append(("date", f"{y}-{month_number(mo):02d}-{int(d):02d}"))
    text = MONTH_DAY_RE.sub(" ", text)
    for mo, y in MONTH_YEAR_RE.findall(text):
        if y not in prompt_years:
            out.append(("month", f"{y}-{month_number(mo):02d}"))
    text = MONTH_YEAR_RE.sub(" ", text)
    for mo, d in MONTH_DAY_ONLY_RE.findall(text):
        out.append(("monthday", f"-{month_number(mo):02d}-{int(d):02d}"))
    text = MONTH_DAY_ONLY_RE.sub(" ", text)
    text = IDENT_RE.sub(" ", text)
    for m in NUM_RE.finditer(text):
        token = m.group(0).lstrip("+").replace("−", "-")
        if token.lstrip("-").replace(",", "") in prompt_years:
            continue
        # A bare year ("late 2026") is a date: some tool date must fall in it.
        out.append(("year", token) if re.fullmatch(r"(?:19|20)\d{2}", token) else ("number", token))
    return out


def month_number(name: str) -> int:
    name = name.lower().rstrip(".")
    return next(v for k, v in MONTHS.items() if k == name or k[:3] == name)


def session_calls(s3, bucket: str, sid: str, dump: Path | None) -> tuple[list[dict], int]:
    prefix = f"sessions/session_{sid}/"
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys += [o["Key"] for o in page.get("Contents", []) if re.search(r"/message_\d+\.json$", o["Key"])]
    if not keys:
        raise SystemExit(f"no messages under {prefix}: is the session id right, and did the runtime persist it?")
    keys.sort(key=lambda k: (k.rsplit("/messages/", 1)[0], int(re.search(r"message_(\d+)\.json$", k).group(1))))
    uses: dict[str, dict] = {}
    calls: list[dict] = []
    for key in keys:
        body = strip_images(json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read()))
        if dump:
            dest = dump / "messages" / key.rsplit("/", 1)[-1]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(body, indent=1, ensure_ascii=False))
        for block in (body.get("message") or {}).get("content") or []:
            if "toolUse" in block:
                use = block["toolUse"]
                call = {"n": len(calls) + 1, "name": use.get("name"), "toolUseId": use.get("toolUseId"),
                        "input": use.get("input"), "result": None}
                uses[use.get("toolUseId")] = call
                calls.append(call)
            elif "toolResult" in block:
                res = block["toolResult"]
                call = uses.get(res.get("toolUseId"))
                if call is not None:
                    call["result"] = res.get("content")
                    call["status"] = res.get("status")
    if dump:
        (dump / "tool_outputs.json").write_text(json.dumps(calls, indent=1, ensure_ascii=False))
    return calls, len(keys)


def shown_texts(case: Path, extras: list[str]) -> list[tuple[str, str]]:
    config = json.loads((case / "config.json").read_text())
    texts = [("narrative.md", (case / "narrative.md").read_text())]
    if config.get("description"):
        texts.append(("config description", config["description"]))
    for i, call in enumerate(config.get("tool_calls") or []):
        if isinstance(call.get("saw"), str):
            texts.append((f"tool_calls[{i}] {call['name']} saw", call["saw"]))
        if call.get("name") == "display_visual":
            for k in ("title", "description"):
                v = (call.get("params") or {}).get(k)
                if isinstance(v, str):
                    texts.append((f"tool_calls[{i}] display_visual {k}", v))
    texts += [(f"extra {i + 1}", e) for i, e in enumerate(extras)]
    return texts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--case", type=Path, required=True, help="the case folder (config.json, narrative.md)")
    parser.add_argument("--session", required=True, help="the full session id the case was recorded in")
    parser.add_argument("--bucket", required=True, help="the bucket the runtime persists sessions to")
    parser.add_argument("--extra", action="append", default=[], help="another text the room sees (a gallery metric)")
    parser.add_argument("--dump", type=Path, help="write the session's messages and tool_outputs.json here")
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()

    import boto3  # deferred so --help needs no AWS libraries

    s3 = boto3.client("s3", region_name=args.region)
    calls, n_messages = session_calls(s3, args.bucket, args.session, args.dump)
    sources = Sources(calls)
    config = json.loads((args.case / "config.json").read_text())
    prompt_years = set(re.findall(r"\b(?:19|20)\d{2}\b", config.get("user_question", "")))
    print(f"Session {args.session[:13]}…: {n_messages} messages, {len(calls)} tool calls, "
          f"{len(sources.numbers)} source numbers, {len(sources.dates)} dates")

    unmatched = 0
    for label, text in shown_texts(args.case, args.extra):
        found = figures(text, prompt_years)
        if not found:
            continue
        print(f"\n{label}:")
        for kind, token in found:
            if kind == "date":
                where = sources.dates.get(token)
            elif kind == "month":
                where = next((w for d, w in sources.dates.items() if d.startswith(token)), None)
            elif kind == "monthday":
                where = next((w for d, w in sources.dates.items() if len(d) == 10 and d.endswith(token)), None)
            elif kind == "year":
                where = sources.years.get(token) or next((w for d, w in sources.dates.items() if d.startswith(token)), None)
            else:
                where = sources.match(token)
            mark = "ok " if where else "NO "
            unmatched += 0 if where else 1
            print(f"  {mark} {token:>14}  {where or 'no tool result or input has it'}")
    print(f"\n{'All figures match the tools.' if not unmatched else f'{unmatched} figure(s) not found in the tools.'}")
    return 1 if unmatched else 0


if __name__ == "__main__":
    sys.exit(main())
