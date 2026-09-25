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
import re
import secrets
from datetime import datetime, timezone
from typing import Any

import _paths  # noqa: F401
from strands import tool

import config
import methane_tools as mt
from methane_tools import MethaneError, _finite, _int

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
MAX_OBSERVATIONS = 6
MAX_GAPS = 4

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
    (r"\b(Inc|LLC|Ltd|PLC|Corp|Corporation|PJSC|OJSC|JSC|GmbH|S\.A\.)\b\.?", "names a company"),
    (r"\bstate[- ]owned\b|\bministry\b|\bregime\b|\bgovernment\b", "names a government"),
    (r"\b(sabotage|attack|deliberate(ly)?|intentional(ly)?|covert|military|weapon)\b", "asserts intent"),
)
_COMPILED = tuple((re.compile(p, re.IGNORECASE), why) for p, why in FORBIDDEN_PATTERNS)
_CONTROL = re.compile(r"[\x00-\x1f\x7f<>`|]")


def check_text(text: str) -> list[str]:
    """Why a piece of brief text is not allowed (empty list: allowed)."""
    return [f"'{m.group(0)}' {why}" for rx, why in _COMPILED for m in [rx.search(text)] if m]


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


def validate_brief(title, place, lat, lon, watch_area, observations, looks, candidates, passes_read,
                   explanations, confidence, gaps, next_collection) -> dict:
    """The brief as data, or MethaneError naming what to fix."""
    brief = {
        "title": _clean(title, "title", TITLE_MAX),
        "place": _clean(place, "place", 80),
        "lat": round(_finite(lat, "lat", -90, 90), 4),
        "lon": round(_finite(lon, "lon", -180, 180), 4),
        "watch_area": _clean(watch_area, "watch_area", 60, required=False) or None,
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
    problems = []
    for field in ("title", "place", "watch_area", "next_collection"):
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


def render_markdown(brief: dict, brief_id: str) -> str:
    area = f", watch area {brief['watch_area']}" if brief["watch_area"] else ""
    lines = [
        f"**Methane Watch brief: {brief['title']}** (draft `{brief_id}`, not filed)",
        "",
        f"Site: {brief['place']} ({brief['lat']:.4f}, {brief['lon']:.4f}){area}",
        f"Looks: EMIT looked {brief['looks']} times; {brief['candidates']} of {brief['passes_read']} "
        f"recent passes read are candidates.",
        "",
        *[f"- {o}" for o in brief["observations"]],
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
async def draft_brief(title: str, place: str, lat: float, lon: float, observations: list,
                      looks: int, candidates: int, passes_read: int, explanations: list,
                      confidence: str, gaps: list, next_collection: str, watch_area: str = None) -> str:
    """Draft the Methane Watch brief for one site. A DRAFT only: nothing is filed until the analyst decides.

    Every text field is ONE short sentence of at most 220 characters (title 90, place 80); no markdown,
    pipes or angle brackets. Longer text is rejected.

    Args:
        title: Short title, e.g. "Recurring methane, south Caspian site".
        place: The place in words (from reverse_geocode), never an owner or operator.
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
        watch_area: Optional watch-area name.

    Returns: JSON with brief_id, status "draft", markdown (paste it as the record, verbatim),
    draft_s3_url, next_steps. If the text breaks the brief's rules, an error naming the parts to
    rewrite: fix them and call again.
    """
    try:
        brief = validate_brief(title, place, lat, lon, watch_area, observations, looks, candidates, passes_read,
                               explanations, confidence, gaps, next_collection)
    except MethaneError as e:
        return json.dumps({"error": str(e)})
    brief_id = new_brief_id()
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
