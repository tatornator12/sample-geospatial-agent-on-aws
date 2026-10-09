"""The Methane Watch brief (requirement 10): a structured DRAFT, never a filed product.

The model fills the fields; this tool decides what a brief may say:
  - explanations come only from a fixed list and are always hypotheses (assessment is one of
    "possible", "less likely", "cannot assess": never "confirmed" or "likely");
  - free text is bounded and checked for phrasing that states a cause as fact, names an owner or
    operator, or asserts intent; a failing draft is returned with the offending phrases so the
    model rewrites it;
  - confidence is about the OBSERVATION (does methane recur at this site); confidence in any single
    explanation is fixed at low without a ground or aircraft check;
  - the draft is written to session_data/<sid>/briefs/<brief_id>.draft.json. No tool files a
    brief: that is the analyst's decision, made in the UI and executed by the backend.
"""
from __future__ import annotations

import json
import logging
import math
import re
import secrets
from datetime import datetime, timezone
from typing import Any

import _paths  # noqa: F401
from strands import tool

import config
import methane_tools as mt
from methane_tools import MethaneError, _finite, _int

logger = logging.getLogger("methane_tools")

EXPLANATIONS: dict[str, str] = {
    "routine_venting": "Routine venting",
    "equipment_failure_or_leak": "Equipment failure or leak",
    "maintenance_blowdown": "Maintenance blowdown",
    "unlit_flare": "Unlit or malfunctioning flare",
    "non_oil_gas_source": "Non-oil-and-gas source (landfill, coal, agriculture)",
    "infrastructure_damage": "Infrastructure damage (cause unknown)",
}
ASSESSMENTS = ("possible", "less likely", "cannot assess")
CONFIDENCE = ("low", "moderate", "high")
SINGLE_EXPLANATION_CONFIDENCE = "low without a ground or aircraft check"

TEXT_MAX = 220
TITLE_MAX = 90
PLACE_MAX = 64          # "Recurring methane near " + the place stays inside TITLE_MAX
MAX_OBSERVATIONS = 6
MAX_GAPS = 4
_NEAR = re.compile(r"^(near|close to|around|by)\s+", re.IGNORECASE)
_COORDS = re.compile(r"\d+\.\d+|°")

# Phrasing a brief never uses: a cause stated as fact, ownership, or intent. Checked on every free
# text field (case-insensitive). Explanations are named only through the fixed list above.
FORBIDDEN_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\b(is|was|are|were) (caused|produced|emitted|released) by\b", "states a cause as fact"),
    (r"\bcaused by\b", "states a cause as fact"),
    (r"\b(is|was|are|were) (a|an|the) (leak|blowdown|vent(ing)?|flare|rupture)\b", "states an explanation as fact"),
    (r"\b(confirmed|definitely|certainly|clearly) (a |an |the )?(leak|venting|blowdown|flare|damage|sabotage|attack)\b",
     "states an explanation as fact"),
    (r"\b(operated|owned|run|controlled) by\b", "names an owner or operator"),
    (r"\bbelongs? to\b", "names an owner or operator"),
    # A company's name may appear only as the registry check's own words ("operators of record: …"),
    # which the tool writes; the model's free text must not bring one in as cause or owner.
    (r"\b(Inc|LLC|Ltd|PLC|Corp|Corporation|PJSC|OJSC|JSC|GmbH|S\.A\.)\b\.?", "names a company outside the registry's words"),
    (r"\bstate[- ]owned\b|\bministry\b|\bregime\b|\bgovernment\b", "names a government"),
    (r"\b(sabotage|attack|deliberate(ly)?|intentional(ly)?|covert|military|weapon)\b", "asserts intent"),
)
_COMPILED = tuple((re.compile(p, re.IGNORECASE), why) for p, why in FORBIDDEN_PATTERNS)
_CONTROL = re.compile(r"[\x00-\x1f\x7f<>`|]")


_REGISTRY_WORDS = re.compile(r"\boperators? of record\b", re.IGNORECASE)


def check_text(text: str) -> list[str]:
    """Why a piece of brief text is not allowed (empty list: allowed). A company's name is allowed in
    one place only: text that quotes the registry ("operators of record: …", the tool's own words)."""
    problems = []
    for rx, why in _COMPILED:
        m = rx.search(text)
        if m and not (why.startswith("names a company") and _REGISTRY_WORDS.search(text)):
            problems.append(f"'{m.group(0)}' {why}")
    return problems


def _clean(value: Any, name: str, limit: int = TEXT_MAX, required: bool = True) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str) or not value.strip():
        raise MethaneError(f"{name} must be a non-empty string")
    text = " ".join(value.split())
    if len(text) > limit:
        raise MethaneError(f"{name} is longer than {limit} characters")
    if _CONTROL.search(text):
        raise MethaneError(f"{name} contains characters a brief does not use (markup, pipes, control characters)")
    return text


def _list(value: Any, name: str, max_items: int) -> list[str]:
    if not isinstance(value, list) or not value:
        raise MethaneError(f"{name} must be a non-empty list of strings")
    if len(value) > max_items:
        raise MethaneError(f"{name} has more than {max_items} items")
    return [_clean(v, f"{name}[{i}]") for i, v in enumerate(value)]


def _watch_areas() -> dict:
    from watch_tools import WATCH_AREAS   # deferred: watch_tools is the heavier module
    return WATCH_AREAS


def watch_area_label(value: Any) -> str | None:
    """The watch area as the stage names it ("Shanxi and Ordos coal basins (China)"), from its key
    or its label; any other text is kept as given (bounded)."""
    text = _clean(value, "watch_area", 60, required=False)
    if not text:
        return None
    low = text.lower()
    for key, spec in _watch_areas().items():
        if low in (key, spec["label"].lower()):
            return spec["label"]
    return text


def check_place(place: str) -> list[str]:
    """Why `place` is not the geocoder's place name. The site's place comes from reverse_geocode
    (town, region, country); the watch area that tipped it is a separate field, so a site near
    Xinxiang, Henan is never titled after the Shanxi basin box it was found in."""
    low = place.lower()
    if "watch" in low:
        return ["names the watch area; give the reverse_geocode place only (town, region, country)"]
    for spec in _watch_areas().values():
        phrase = re.sub(r"\s*\(.*\)$", "", spec["label"]).lower()
        if len(phrase.split()) >= 2 and (phrase in low or phrase.rstrip("s") in low):
            return [f"names the watch area ('{phrase}'); give the reverse_geocode place only (town, region, country)"]
    if _COORDS.search(place):
        return ["gives coordinates; name the place in words (lat and lon are separate fields)"]
    return []


def compose_title(place: str, confidence: str, candidates: int) -> str:
    """The brief's title, written by the tool: what the evidence supports, then where. Recurrence
    needs the moderate or high rule; one EMIT candidate is a candidate; none is only a tip."""
    if confidence in ("high", "moderate"):
        lead = "Recurring methane"
    elif candidates > 0:
        lead = "Methane candidate"
    else:
        lead = "Unconfirmed methane tip"
    return f"{lead} near {place}"


def validate_brief(place, lat, lon, watch_area, observations, looks, candidates, passes_read,
                   explanations, confidence, gaps, next_collection) -> dict:
    """The brief as data, or MethaneError naming what to fix."""
    place = _NEAR.sub("", _clean(place, "place", PLACE_MAX + 10)).strip(" ,")
    brief = {
        "place": _clean(place, "place", PLACE_MAX),
        "lat": round(_finite(lat, "lat", -90, 90), 4),
        "lon": round(_finite(lon, "lon", -180, 180), 4),
        "watch_area": watch_area_label(watch_area),
        "observations": _list(observations, "observations", MAX_OBSERVATIONS),
        "looks": _int(looks, "looks", 0, 10000),
        "candidates": _int(candidates, "candidates", 0, 1000),
        "passes_read": _int(passes_read, "passes_read", 0, 1000),
        "gaps": _list(gaps, "gaps", MAX_GAPS),
        "next_collection": _clean(next_collection, "next_collection"),
    }
    if brief["candidates"] > brief["passes_read"]:
        raise MethaneError("candidates cannot exceed passes_read")
    if confidence not in CONFIDENCE:
        raise MethaneError(f"confidence must be one of {', '.join(CONFIDENCE)}")
    brief["confidence"] = confidence
    brief["title"] = compose_title(brief["place"], confidence, brief["candidates"])
    if not isinstance(explanations, list) or len(explanations) < 2:
        raise MethaneError("explanations must list at least two hypotheses from the fixed list")
    seen, rows = set(), []
    for i, e in enumerate(explanations):
        if not isinstance(e, dict):
            raise MethaneError(f"explanations[{i}] must be an object")
        eid = e.get("id")
        if eid not in EXPLANATIONS:
            raise MethaneError(f"explanations[{i}].id must be one of: {', '.join(EXPLANATIONS)}")
        if eid in seen:
            raise MethaneError(f"explanation {eid} is listed twice")
        seen.add(eid)
        assessment = e.get("assessment")
        if assessment not in ASSESSMENTS:
            raise MethaneError(f"explanations[{i}].assessment must be one of: {', '.join(ASSESSMENTS)}")
        rows.append({"id": eid, "label": EXPLANATIONS[eid], "assessment": assessment,
                     "next_check": _clean(e.get("next_check"), f"explanations[{i}].next_check")})
    brief["explanations"] = rows
    problems = [f"place: {p}" for p in check_place(brief["place"])]
    for field in ("place", "watch_area", "next_collection"):
        if brief[field]:
            problems += [f"{field}: {p}" for p in check_text(brief[field])]
    for field in ("observations", "gaps"):
        for i, text in enumerate(brief[field]):
            problems += [f"{field}[{i}]: {p}" for p in check_text(text)]
    for i, row in enumerate(rows):
        problems += [f"explanations[{i}].next_check: {p}" for p in check_text(row["next_check"])]
    if problems:
        raise MethaneError("Rewrite these parts of the brief: " + "; ".join(problems[:8]))
    return brief


CHECK_RADIUS_KM = 2.0
_CHECK_KEY = re.compile(r"^(thermal|infra|registry)_(-?\d+\.\d{4})_(-?\d+\.\d{4})\.json$")


_PASSES_KEY = re.compile(r"^passes_(-?\d+\.\d{4})_(-?\d+\.\d{4})\.json$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def find_passes(lat: float, lon: float) -> dict | None:
    """The newest pass record check_recent_passes wrote for this site this session (nearest within
    2 km): its window start and the passes read and judged candidates. None when there is none."""
    s3 = mt._s3()
    best = None
    try:
        listing = s3.list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=f"{mt.session_prefix()}passes_")
        for obj in listing.get("Contents", []):
            m = _PASSES_KEY.fullmatch(obj["Key"].rsplit("/", 1)[-1])
            if not m:
                continue
            d = math.hypot((float(m[1]) - lat) * 110.574, (float(m[2]) - lon) * 111.320 * math.cos(math.radians(lat)))
            if d <= CHECK_RADIUS_KM and (best is None or d < best[0]):
                best = (d, obj["Key"])
        if best is None:
            return None
        body = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=best[1])["Body"].read(500_000))
        passes = [p for p in body.get("passes") or [] if isinstance(p, dict)]
        since = body.get("since")
        if not passes or not isinstance(since, str) or not _DAY.fullmatch(since):
            return None
        cands = [p for p in passes if p.get("verdict") == "candidate"]
        return {"since": since, "read": len(passes), "candidates": len(cands),
                "candidate_dates": len({p.get("date") for p in cands if p.get("date")})}
    except Exception as e:  # an addition to the brief, never a reason to fail it
        logger.warning("passes lookup failed: %s", type(e).__name__)
        return None


def find_checks(lat: float, lon: float) -> dict:
    """The ground-record checks run for this site this session (ground_tools), nearest within 2 km.

    Read from the tools' own records, never from the model, so the brief carries the tools' numbers.
    Empty when a check was not run.
    """
    s3 = mt._s3()
    prefix = mt.session_prefix()
    found: dict[str, tuple[float, dict]] = {}
    try:
        for kind in ("thermal", "infra", "registry"):
            listing = s3.list_objects_v2(Bucket=config.S3_BUCKET_NAME, Prefix=f"{prefix}{kind}_")
            for obj in listing.get("Contents", []):
                m = _CHECK_KEY.fullmatch(obj["Key"].rsplit("/", 1)[-1])
                if not m:
                    continue
                d = math.hypot((float(m[2]) - lat) * 110.574, (float(m[3]) - lon) * 111.320 * math.cos(math.radians(lat)))
                if d <= CHECK_RADIUS_KM and (kind not in found or d < found[kind][0]):
                    body = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=obj["Key"])["Body"].read(200_000))
                    if isinstance(body, dict) and isinstance(body.get("line"), str):
                        found[kind] = (d, body)
    except Exception as e:  # the checks are an addition to the brief, never a reason to fail it
        logger.warning("checks lookup failed: %s", type(e).__name__)
    out = {}
    if "thermal" in found:
        t = found["thermal"][1]
        out["thermal"] = {k: t.get(k) for k in ("nights_checked", "detections", "nights_with_heat", "max_frp_mw",
                                                 "static_source_detections", "verdict", "source", "line")}
    if "infra" in found:
        i = found["infra"][1]
        out["infrastructure"] = {"radius_km": i.get("radius_km"), "mapped": i.get("mapped"), "groups": i.get("groups"),
                                 "types": [{k: r.get(k) for k in ("type", "count", "nearest_km")} for r in (i.get("types") or [])[:6]],
                                 "line": i.get("line")}
    if "registry" in found:
        g = found["registry"][1]
        out["registry"] = {"radius_km": g.get("radius_km"), "listed": g.get("listed"), "operators_named": g.get("operators_named"),
                           "facilities": [{k: r.get(k) for k in ("kind", "count", "nearest_km")} for r in (g.get("facilities") or [])[:6]],
                           "operators": [{k: r.get(k) for k in ("operator", "facilities", "nearest_km")} for r in (g.get("operators") or [])[:3]],
                           "source_dates": g.get("source_dates"), "source": g.get("source"), "line": g.get("line")}
        f = g.get("field")
        if isinstance(f, dict) and isinstance(g.get("field_line"), str):
            out["registry"]["field"] = {k: f.get(k) for k in ("name", "operator", "inside", "distance_km", "src_date")}
            out["registry"]["field_line"] = g["field_line"]
        m = (g.get("mines") or {}).get("mine") if isinstance(g.get("mines"), dict) else None
        if isinstance(m, dict) and isinstance(g.get("mine_line"), str):
            out["registry"]["mine"] = {k: m.get(k) for k in ("name", "status", "owners", "parent", "inside", "distance_km")}
            out["registry"]["mine_line"] = g["mine_line"]
        gf = g.get("gem_field")
        if isinstance(gf, dict) and isinstance(g.get("gem_field_line"), str):
            out["registry"]["gem_field"] = {k: gf.get(k) for k in ("name", "status", "operator", "owners", "inside", "distance_km")}
            out["registry"]["gem_field_line"] = g["gem_field_line"]
    return out


# The registry check's sentences, in the order the brief and the card print them.
REGISTRY_LINES = ("line", "field_line", "gem_field_line", "mine_line")


def render_markdown(brief: dict, brief_id: str) -> str:
    area = f"; tipped by the {brief['watch_area']} watch area" if brief["watch_area"] else ""
    since = f" since {brief['passes_since']}" if brief.get("passes_since") else ""
    checks = brief.get("checks") or {}
    check_lines = [f"- Check: {c['line']}" for c in (checks.get("thermal"), checks.get("infrastructure"))
                   if c and c.get("line")]
    registry = checks.get("registry") or {}
    check_lines += [f"- Check: {registry[k]}" for k in REGISTRY_LINES if registry.get(k)]
    lines = [
        f"**Methane Watch brief: {brief['title']}** (draft `{brief_id}`, not filed)",
        "",
        f"Site: near {brief['place']} ({brief['lat']:.4f}, {brief['lon']:.4f}){area}.",
        f"Looks: {brief['candidates']} of {brief['passes_read']} passes read{since} are candidates; "
        f"EMIT looked {brief['looks']} times in all.",
        "",
        *[f"- {o}" for o in brief["observations"]],
        *check_lines,
        "",
        "| Hypothesis (unconfirmed) | Assessment | What would confirm or rule it out |",
        "|---|---|---|",
        *[f"| {r['label']} | {r['assessment']} | {r['next_check']} |" for r in brief["explanations"]],
        "",
        f"Confidence that methane recurs at this site: {brief['confidence']}. "
        f"Confidence in any single explanation: {SINGLE_EXPLANATION_CONFIDENCE}.",
        f"Gaps: {'; '.join(brief['gaps'])}.",
        f"Next collection: {brief['next_collection']}",
        "",
        "Status: DRAFT, awaiting the analyst's decision.",
    ]
    return "\n".join(lines)


def new_brief_id(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"brief-{now:%Y%m%dT%H%M%S}-{secrets.token_hex(3)}"


@tool
async def draft_brief(place: str, lat: float, lon: float, observations: list,
                      looks: int, candidates: int, passes_read: int, explanations: list,
                      confidence: str, gaps: list, next_collection: str, watch_area: str = None) -> str:
    """Draft the Methane Watch brief for one site. A DRAFT only: nothing is filed until the analyst decides.

    Every text field is ONE short sentence of at most 220 characters (place 64); no markdown, pipes
    or angle brackets. Longer text is rejected. The tool writes the title itself from the place and
    the confidence ("Recurring methane near Xinxiang, Henan, China").

    Args:
        place: The site's place exactly as reverse_geocode gave it: town, region, country (e.g.
            "Xinxiang, Henan, China"). Never the watch area or a basin, never coordinates, never an
            owner or operator; the watch area goes in watch_area.
        lat, lon: The site in degrees.
        observations: 2-6 short sentences, every number from a tool result (ppm·m, ppb, dates, counts).
        looks: How many times EMIT looked (site_history.looks).
        candidates: Candidate passes (check_recent_passes.summary.candidates).
        passes_read: Passes read (check_recent_passes.summary.read).
        explanations: 2-6 objects {"id", "assessment", "next_check"}; id from: routine_venting,
            equipment_failure_or_leak, maintenance_blowdown, unlit_flare, non_oil_gas_source,
            infrastructure_damage; assessment one of "possible", "less likely", "cannot assess";
            next_check: the evidence that would confirm or rule it out.
        confidence: "low" | "moderate" | "high": confidence that methane RECURS at this site.
        gaps: 1-4 things the data cannot show (coverage, the post-2024 plume product gap, ...).
        next_collection: The recommended next look (another EMIT pass, aircraft, ground inspection).
        watch_area: The watch area whose scan tipped this site (its key, e.g. "shanxi coal basin").

    Returns: JSON with brief_id, status "draft", markdown (paste it as the record, verbatim),
    draft_s3_url, next_steps. If the text breaks the brief's rules, an error naming the parts to
    rewrite: fix them and call again.
    """
    try:
        brief = validate_brief(place, lat, lon, watch_area, observations, looks, candidates, passes_read,
                               explanations, confidence, gaps, next_collection)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    brief_id = new_brief_id()
    passes = find_passes(brief["lat"], brief["lon"])
    if passes:   # the pass counts and their window come from the tool's own record, not the model
        brief.update(candidates=passes["candidates"], passes_read=passes["read"], passes_since=passes["since"])
        brief["title"] = compose_title(brief["place"], brief["confidence"], brief["candidates"])
    brief["checks"] = find_checks(brief["lat"], brief["lon"])
    markdown = render_markdown(brief, brief_id)
    record = {"brief_id": brief_id, "status": "draft", "created": datetime.now(timezone.utc).isoformat(),
              "session_id": mt._session_id(), "brief": brief, "markdown": markdown}
    key = f"session_data/{mt._session_id()}/briefs/{brief_id}.draft.json"
    mt._s3().put_object(Bucket=config.S3_BUCKET_NAME, Key=key, Body=json.dumps(record).encode(),
                        ContentType="application/json")
    return json.dumps({
        "brief_id": brief_id, "status": "draft", "markdown": markdown,
        "draft_s3_url": f"s3://{config.S3_BUCKET_NAME}/{key}",
        "next_steps": ("Paste `markdown` verbatim as the record, then the line \"Decision: analyst's.\", then the "
                       "closing paragraph. Call no other tool. Never say the brief is filed or sent."),
    })


BRIEF_ID_RE = re.compile(r"^brief-\d{8}T\d{6}-[0-9a-f]{6}$")


@tool
async def brief_status(brief_id: str) -> str:
    """Whether a brief was filed by the analyst. The ONLY source for saying a brief is filed.

    Args:
        brief_id: e.g. brief-20260925T201500-a1b2c3 (from draft_brief).

    Returns: JSON with status "filed" (with filed_at), "draft" (not filed yet) or "not_found".
    """
    if not isinstance(brief_id, str) or not BRIEF_ID_RE.fullmatch(brief_id):
        return json.dumps({"error": "brief_id must look like brief-20260925T201500-a1b2c3"})
    s3 = mt._s3()
    prefix = f"session_data/{mt._session_id()}/briefs/{brief_id}"
    try:
        filed = json.loads(s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{prefix}.filed.json")["Body"].read(100_000))
        return json.dumps({"brief_id": brief_id, "status": "filed", "filed_at": filed.get("filed_at"),
                           "say": "The analyst filed this brief."})
    except s3.exceptions.NoSuchKey:
        pass
    try:
        s3.get_object(Bucket=config.S3_BUCKET_NAME, Key=f"{prefix}.draft.json")
        return json.dumps({"brief_id": brief_id, "status": "draft",
                           "say": "This brief is still a draft: the analyst has not filed it."})
    except s3.exceptions.NoSuchKey:
        return json.dumps({"brief_id": brief_id, "status": "not_found",
                           "say": "There is no brief with that id in this session."})
