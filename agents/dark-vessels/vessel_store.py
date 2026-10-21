"""Dark Vessels: what every tool shares. The passes on file, the records (the reserve, its ports, the
land), the cache in the project bucket (vessels/cache/v1/ or VESSEL_CACHE_PREFIX, built by
scripts/build_vessel_cache.py),
the session's folder (session_data/<sid>/vessels/), the open question's state, and the fixed
sentences.

The runtime reads only the bucket and the session (and, in next_look, ESA's plan). It never calls
Global Fishing Watch, Planetary Computer or NOAA, and nothing it reads carries a vessel's identity:
the build stripped and scanned every file.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import boto3
import numpy as np
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep

import _paths  # noqa: F401  (shared platform code on sys.path before `import config`)
import config
from predict import Grid

logger = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent
PASSES_PATH = HERE / "data" / "passes_v1.json"
RECORDS_PATH = HERE / "data" / "reserve_v1.geojson"
DEFAULT_CACHE_PREFIX = "vessels/cache/v1"
CACHE_PREFIX_RE = re.compile(r"^vessels/cache/v1[a-z0-9-]*$")


def _cache_prefix() -> str:
    """The cache's prefix: VESSEL_CACHE_PREFIX when it is one (task 9a's rehearsal sets
    vessels/cache/v1r on dev only), else vessels/cache/v1. Only the manifest key follows it; every
    product key comes from the manifest's records."""
    raw = os.environ.get("VESSEL_CACHE_PREFIX", "").strip()
    if not raw:
        return DEFAULT_CACHE_PREFIX
    if CACHE_PREFIX_RE.fullmatch(raw):
        return raw
    logger.warning("VESSEL_CACHE_PREFIX is not a vessel cache prefix; reading %s", DEFAULT_CACHE_PREFIX)
    return DEFAULT_CACHE_PREFIX


CACHE_PREFIX = _cache_prefix()
PLAN_PREFIX = "vessels/cache/plan"
MANIFEST_KEY = f"{CACHE_PREFIX}/manifest.json"
CACHE_TTL_S = 300
PORT_KM = 10.0
PASS_ID_RE = re.compile(r"^s1[a-d]-\d{8}t\d{4}$")
CANDIDATE_ID_RE = re.compile(r"^T\d{2}$")
ATTRIBUTION = "Powered by Global Fishing Watch."
CLAIM_KM = 5.0              # a broadcasting target's hairline to its AIS position at the pass minute
OURS_MATCH_KM = 1.0         # one of our targets with an AIS position this close is broadcasting

# Fixed sentences (the eval checks them word for word).
ON_FILE_ONLY = "I only investigate passes on file."
CANDIDATE_SENTENCE = "A candidate is a radar target with no broadcast nearby; it is not an accusation."
CANNOT_SAY = "I cannot say which, if any, of these it is."
RECEPTION_UNKNOWN = "reception unknown: no AIS there proves nothing"
# gather_evidence's four innocent explanations in one sentence.
SAY_ELSE = "Each could be a small boat, a missed or switched-off AIS, or not a vessel."
OFFICERS_DECISION = "The decision is the officer's; I only draft."

# The open question (design §3.5). The prompt, the tools and the eval read these, so they cannot drift.
CHECKABLE_FLOOR = 0.15      # the standard: a pass speaks only for reserve water it imaged where AIS was received
ANSWER_MAX_WORDS = 120      # the answer's cap, as the eval's report_max_words counts it
PASS_BUDGET = 2             # passes read in one question
MAX_LISTED = 12             # the board's rows
PROMPT_MAX_CHARS = 2000     # the presenter's words kept for `asked`
WIDE_SHARE = 0.5            # newest_wide: a pass that imaged over half the reserve
# How a decision file is keyed. "call": by the call's own toolUseId (strands-agents 1.21.0 gives it
# through @tool(context=True); RUN/strands-check.md, Oct 21). "inputs": by the call's validated
# inputs, the specified fallback for a Strands pin without it.
DECISION_KEYS = "call"
TOOL_USE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
QUESTION_ID_RE = re.compile(r"^[0-9a-f]{12}$")


# --- S3 and the session ------------------------------------------------------------------------

def _s3():
    return boto3.client("s3")


def session_id() -> str:
    return os.environ.get("AGENT_SESSION_ID", config.DEFAULT_SESSION_ID)


def session_prefix() -> str:
    return f"session_data/{session_id()}/"


def vessels_prefix() -> str:
    return f"{session_prefix()}vessels/"


def s3_url(key: str) -> str:
    return f"s3://{config.S3_BUCKET_NAME}/{key}"


def put_json(key: str, body) -> str:
    _s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=json.dumps(body, separators=(",", ":")).encode(),
                     ContentType="application/geo+json" if key.endswith(".geojson") else "application/json")
    return s3_url(key)


def get_json(key: str):
    return json.loads(_s3().get_object(Bucket=config.S3_BUCKET_NAME, Key=key)["Body"].read())


def exists(key: str) -> bool:
    """Whether an object is there (a HEAD: never the body). Any refusal reads as not there."""
    try:
        _s3().head_object(Bucket=config.S3_BUCKET_NAME, Key=key)
        return True
    except Exception:
        return False


def list_keys(prefix: str, limit: int = 200) -> list[str]:
    """The keys under a prefix (one page; a session folder holds a few dozen)."""
    page = _s3().list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=prefix, MaxKeys=limit)
    return [o["Key"] for o in page.get("Contents", [])]


def copy_into_session(src_key: str, dst_key: str, content_type: str = "image/tiff") -> str:
    """A server-side copy of a cached file into the session (the stage reads only session copies)."""
    _s3().copy_object(Bucket=config.S3_BUCKET_NAME, Key=dst_key,
                      CopySource={"Bucket": config.S3_BUCKET_NAME, "Key": src_key},
                      ContentType=content_type, MetadataDirective="REPLACE")
    return s3_url(dst_key)


_cache: dict = {}


def cached(key: str):
    """A cache file, kept in the process for a few minutes (the same pass is read by every tool)."""
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] + CACHE_TTL_S > now:
        return hit[1]
    body = get_json(key)
    _cache[key] = (now, body)
    return body


def manifest() -> dict:
    return cached(MANIFEST_KEY)


def clear_cache() -> None:
    _cache.clear()


# --- the passes on file and the records ---------------------------------------------------------

@lru_cache(maxsize=1)
def on_file() -> dict:
    return json.loads(PASSES_PATH.read_text())


def _sensed_ok(rec) -> bool:
    try:
        parse_t(rec["sensed"])
        return True
    except Exception:
        return False


def passes() -> list[dict]:
    """Every pass on file: the manifest's records, one per id (the build writes each pass's metadata
    and imaged cells there, so a rerun needs no deploy), then the packaged silent vessel's entry for
    the spare, over its manifest record when the build has one."""
    silent = on_file()["silent_vessel"]
    recs = manifest().get("passes", {})
    by_id: dict[str, dict] = {}
    spare = dict(silent)
    for rec in (recs.values() if isinstance(recs, dict) else recs):
        pid = rec.get("pass_id") if isinstance(rec, dict) else None
        if pid == silent["pass_id"]:
            spare = {**rec, **silent}
        elif isinstance(pid, str) and PASS_ID_RE.fullmatch(pid) and pid not in by_id and _sensed_ok(rec):
            by_id[pid] = rec
    return list(by_id.values()) + [spare]


def listed_passes() -> list[dict]:
    """The passes a question chooses from: every pass on file but the silent vessel's spare, newest
    first, at most MAX_LISTED (the board's rows)."""
    spare = on_file()["silent_vessel"]["pass_id"]
    out = [p for p in passes() if p["pass_id"] != spare]
    return sorted(out, key=lambda p: parse_t(p["sensed"]), reverse=True)[:MAX_LISTED]


def pass_entry(pass_id: str) -> dict | None:
    if not isinstance(pass_id, str) or not PASS_ID_RE.fullmatch(pass_id):
        return None
    return next((p for p in passes() if p["pass_id"] == pass_id), None)


def on_file_list() -> list[str]:
    """The passes on file as the agent names them ("Sentinel-1D, Oct 12, 2026")."""
    out = []
    for p in passes():
        d = p["sensed"][:10]
        out.append(f"{p['pass_id']} ({p.get('satellite', 'Sentinel-1')}, {d})")
    return out


def refusal(extra: str = "") -> str:
    return json.dumps({"error": ON_FILE_ONLY + (f" {extra}" if extra else ""), "passes_on_file": on_file_list()})


@lru_cache(maxsize=1)
def records() -> dict:
    rec = json.loads(RECORDS_PATH.read_text())
    reserve = shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))
    ports = [(f["properties"]["name"], tuple(f["geometry"]["coordinates"])) for f in rec["features"]
             if f["properties"]["kind"] == "port"]
    land = unary_union([shape(f["geometry"]) for f in rec["features"] if f["properties"]["kind"] == "land"])
    return {"reserve": reserve, "reserve_prep": prep(reserve), "ports": ports, "land": land}


def km(a, b) -> float:
    p = math.pi / 180
    h = math.sin((b[1] - a[1]) * p / 2) ** 2 + math.cos(a[1] * p) * math.cos(b[1] * p) * math.sin((b[0] - a[0]) * p / 2) ** 2
    return 12742.0176 * math.asin(math.sqrt(min(1.0, h)))


def nearest_port(lon: float, lat: float) -> tuple[str, float]:
    name, xy = min(records()["ports"], key=lambda p: km((lon, lat), p[1]))
    return name, round(km((lon, lat), xy), 1)


def km_to_shore(lon: float, lat: float) -> float:
    """Distance to the nearest land polygon, in km (equirectangular at this latitude; fine at 0°)."""
    d = Point(lon, lat).distance(records()["land"])
    return round(d * 111.2, 1)


def in_reserve(lon: float, lat: float) -> bool:
    return records()["reserve_prep"].contains(Point(lon, lat))


@lru_cache(maxsize=1)
def reserve_grid() -> tuple[Grid, np.ndarray]:
    """The 0.05° grid over the reserve (decision 3) and its water cells (cell centre in the reserve)."""
    step = 0.05
    w, s, e, n = records()["reserve"].bounds
    grid = Grid(round(math.floor(w / step) * step, 2), round(math.floor(s / step) * step, 2),
                round(math.ceil(e / step) * step, 2), round(math.ceil(n / step) * step, 2), step)
    rp = records()["reserve_prep"]
    h, wd = grid.shape
    water = np.array([[rp.contains(Point(grid.west + (c + .5) * step, grid.south + (r + .5) * step)) for c in range(wd)]
                      for r in range(h)])
    return grid, water


def parse_t(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def heads_at(replay: dict, when: datetime, max_gap_h: float = 3.0) -> list[dict]:
    """Every replay track's position at `when`, interpolated between hourly fixes up to `max_gap_h` apart."""
    out = []
    for tr in replay["tracks"]:
        ts = [parse_t(x) for x in tr["t"]]
        if not ts or when < ts[0] - timedelta(minutes=30) or when > ts[-1] + timedelta(hours=1):
            continue
        i = max(0, sum(1 for t in ts if t <= when) - 1)
        lon, lat = tr["c"][i]
        if i + 1 < len(ts) and (ts[i + 1] - ts[i]) <= timedelta(hours=max_gap_h) and ts[i] <= when:
            a = (when - ts[i]) / (ts[i + 1] - ts[i])
            lon = lon + a * (tr["c"][i + 1][0] - lon)
            lat = lat + a * (tr["c"][i + 1][1] - lat)
        minutes = round(min(abs((when - t).total_seconds()) for t in ts) / 60)
        out.append({"lon": lon, "lat": lat, "type": tr.get("type", "unknown"), "fix_minutes": minutes})
    return out


def nearest_head(target: dict, heads: list[dict]) -> tuple[dict | None, float]:
    near = min(heads, key=lambda h: km((target["lon"], target["lat"]), (h["lon"], h["lat"])), default=None)
    return near, (km((target["lon"], target["lat"]), (near["lon"], near["lat"])) if near else math.inf)


def broadcasts(target: dict, near_km: float) -> bool:
    """A target AIS claims: GFW matched it to a broadcast, or it is ours alone with a broadcast within 1 km."""
    return target["status"] != "port" and bool(target.get("gfw_matched") or (target["source"] == "ours" and near_km <= OURS_MATCH_KM))


def fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def point(lon: float, lat: float, **props) -> dict:
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}}


def nice_time(iso: str) -> str:
    """'2026-10-12T00:18:02Z' -> 'Oct 12, 2026 00:18 UTC'."""
    from datetime import datetime
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return f"{t:%b} {t.day}, {t:%Y %H:%M} UTC"


def now() -> datetime:
    """The clock (patched in tests)."""
    return datetime.now(timezone.utc)


# --- the session's records ----------------------------------------------------------------------

def record_key(kind: str, pass_id: str | None = None) -> str:
    """A session record: coverage_<pass>.json, match_<pass>.json, or hotspots.json."""
    return f"{vessels_prefix()}{kind}_{pass_id}.json" if pass_id else f"{vessels_prefix()}{kind}.json"


def get_record(kind: str, pass_id: str | None = None) -> dict | None:
    try:
        body = get_json(record_key(kind, pass_id))
    except Exception:
        return None
    return body if isinstance(body, dict) else None


# --- the turn and the open question (design §3.5) ------------------------------------------------
# The entrypoint starts each turn with the presenter's words (one session's invocations run one at a
# time in one process, as AGENT_SESSION_ID already relies on). list_passes opens a question in the
# session folder (question.json); the question is open only in the turn that opened it.

_turn: dict = {"turn_id": None, "prompt": ""}


def begin_turn(prompt) -> str:
    """A new turn: a fresh turn_id (12 hex characters) and the presenter's words, at most
    PROMPT_MAX_CHARS. Any question opened earlier is closed from here on."""
    _turn["turn_id"] = secrets.token_hex(6)
    _turn["prompt"] = prompt[:PROMPT_MAX_CHARS] if isinstance(prompt, str) else ""
    return _turn["turn_id"]


def current_turn() -> str | None:
    return _turn["turn_id"]


def turn_prompt() -> str:
    return _turn["prompt"]


def question_key() -> str:
    return f"{vessels_prefix()}question.json"


def latest_question() -> dict | None:
    """The session's latest question (question.json), in any turn; None before list_passes runs."""
    try:
        q = get_json(question_key())
    except Exception:
        return None
    if not isinstance(q, dict) or not isinstance(q.get("question_id"), str) or not QUESTION_ID_RE.fullmatch(q["question_id"]):
        return None
    return q


def current_question() -> dict | None:
    """The open question: the latest one, only during the turn whose list_passes opened it."""
    q = latest_question()
    turn = current_turn()
    return q if q is not None and turn is not None and q.get("turn_id") == turn else None


def question_stamp() -> str | None:
    """The question_id records are stamped with: the session's latest question's (None before any)."""
    q = latest_question()
    return q["question_id"] if q else None


def tool_use_id(tool_context) -> str | None:
    """The call's own id from @tool(context=True), when it is a well-formed one."""
    try:
        tid = tool_context.tool_use["toolUseId"]
    except Exception:
        return None
    return tid if isinstance(tid, str) and TOOL_USE_ID_RE.fullmatch(tid) else None


def board_key(call_id: str | None, mode: str | None = None) -> str | None:
    """The stage's copy of the listing: passes_<toolUseId>.json ("call"), passes_on_file.json ("inputs")."""
    if (mode or DECISION_KEYS) == "inputs":
        return f"{vessels_prefix()}passes_on_file.json"
    return f"{vessels_prefix()}passes_{call_id}.json" if call_id and TOOL_USE_ID_RE.fullmatch(call_id) else None


def decision_key(question_id: str, step: str, because: str, subject, call_id: str | None = None,
                 mode: str | None = None) -> str | None:
    """One accepted decision's file: decision_<question_id>_<toolUseId>.json ("call"), or
    decision_<question_id>_<step>_<because>_<subject>.json ("inputs"; subject is the pass id, the
    box, or none). None when the call's id is missing in "call" mode."""
    pre = f"{vessels_prefix()}decision_{question_id}_"
    if (mode or DECISION_KEYS) == "inputs":
        return f"{pre}{step}_{because}_{subject if subject not in (None, '') else 'none'}.json"
    return f"{pre}{call_id}.json" if call_id and TOOL_USE_ID_RE.fullmatch(call_id) else None


def decisions(question: dict | None) -> list[dict]:
    """This question's accepted decisions, oldest first (one file each; never a shared file)."""
    if not question:
        return []
    qid = question["question_id"]
    out = []
    for key in list_keys(f"{vessels_prefix()}decision_{qid}_"):
        try:
            body = get_json(key)
        except Exception:
            continue
        if isinstance(body, dict) and body.get("question_id") == qid:
            out.append(body)
    return sorted(out, key=lambda d: (d.get("n", 0) if isinstance(d.get("n"), int) else 0, str(d.get("at", ""))))


def read_passes(decs: list[dict]) -> list[str]:
    """The passes read in a question (an accepted read_pass each), in the order read; the last is L."""
    return [d["subject"] for d in decs if d.get("step") == "read_pass"]


def require_read(pass_id: str) -> dict | None:
    """The gate on detect_vessels, check_ais_coverage and match_ais: while a question is open, a pass
    is examined only after its read_pass was accepted. With no question open it passes."""
    q = current_question()
    if q is None:
        return None
    read = read_passes(decisions(q))
    if pass_id in read:
        return None
    logger.info("gate: refused %s (no accepted read_pass)", pass_id)
    return {"error": "Announce this pass with decide(read_pass, ...) first.",
            "facts": {"listed": [p["pass_id"] for p in q.get("passes", [])], "read": read}}


# --- does the presenter's question name a pass? (decide's `asked`) -------------------------------

_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_FULL_MON = r"(january|february|march|april|may|june|july|august|september|october|november|december)"
_YEAR = r"(?:,?\s+(\d{4})\b)?"
_MONTH_DAY = re.compile(rf"\b{_MON}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b{_YEAR}", re.I)
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{_MON}\b\.?{_YEAR}", re.I)
# A month alone names a pass only directly after "in", "of", "end of" or "start of", so the verbs
# "may" and "march" never do.
_MONTH_ONLY = re.compile(rf"\b(?:(?:end|start)\s+of|in|of)\s+{_FULL_MON}\b{_YEAR}", re.I)
ASKED_WORDS_MAX = 30


def _month(word: str) -> int:
    return _MONTHS.index(word[:3].lower()) + 1


def names_pass(prompt: str, entry: dict, listed: list[dict]) -> str | None:
    """The words in the presenter's question that name this pass, or None. Case-insensitive, any of:
    its pass id; its ISO date; its month and day in either order ("Sep 7", "7 September", "the 7th
    of September"); or a full month name after "in", "of", "end of" or "start of" when it is the only
    listed pass in that month ("end of August"). A four-digit year in the phrase must be the pass's."""
    if not isinstance(prompt, str) or not prompt:
        return None
    t = parse_t(entry["sensed"])
    for literal in (entry["pass_id"], t.date().isoformat()):
        m = re.search(rf"\b{re.escape(literal)}\b", prompt, re.I)
        if m:
            return m.group(0)[:ASKED_WORDS_MAX]

    def year_ok(y) -> bool:
        return y is None or int(y) == t.year
    for m in _MONTH_DAY.finditer(prompt):
        if _month(m.group(1)) == t.month and int(m.group(2)) == t.day and year_ok(m.group(3)):
            return m.group(0).strip()[:ASKED_WORDS_MAX]
    for m in _DAY_MONTH.finditer(prompt):
        if _month(m.group(2)) == t.month and int(m.group(1)) == t.day and year_ok(m.group(3)):
            return m.group(0).strip()[:ASKED_WORDS_MAX]
    for m in _MONTH_ONLY.finditer(prompt):
        mon, year = _month(m.group(1)), m.group(2)
        if mon != t.month or not year_ok(year):
            continue
        same = [p for p in listed if parse_t(p["sensed"]).month == mon and (year is None or parse_t(p["sensed"]).year == int(year))]
        if [p["pass_id"] for p in same] == [entry["pass_id"]]:
            return m.group(0).strip()[:ASKED_WORDS_MAX]
    return None
