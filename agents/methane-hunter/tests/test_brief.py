"""draft_brief (requirement 10): fixed explanations, bounded text, no stated causes, draft only."""
import asyncio
import json

import pytest

from conftest import BUCKET, SESSION


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def brief(tools):
    import importlib
    return importlib.import_module("brief_tools")


def good(**over):
    args = dict(
        title="Recurring methane, south Caspian site",
        place="near Hazar, Balkan Region",
        lat=39.4741, lon=53.6435, watch_area="south caspian",
        observations=["TROPOMI: +122.9 ppb above the area's median over 14 days, seen on 6 days.",
                      "EMIT: 4 of 4 recent passes are candidates; peak 9,144.0 ppm·m on 2025-08-01."],
        looks=11, candidates=4, passes_read=4,
        explanations=[
            {"id": "routine_venting", "assessment": "possible", "next_check": "Repeat EMIT passes at different hours."},
            {"id": "equipment_failure_or_leak", "assessment": "possible", "next_check": "Aircraft survey to localise the point."},
            {"id": "non_oil_gas_source", "assessment": "less likely", "next_check": "Land-cover check for landfill or coal."},
        ],
        confidence="moderate",
        gaps=["EMIT cannot see between passes", "NASA's plume product is nearly empty after 2024"],
        next_collection="Next EMIT overpass and an aircraft survey.",
    )
    args.update(over)
    return args


def test_a_good_brief_is_drafted_to_the_session_and_rendered(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good())))
    assert out["status"] == "draft" and out["brief_id"].startswith("brief-")
    key = f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"
    assert out["draft_s3_url"] == f"s3://{BUCKET}/{key}"
    record = json.loads(fake_s3.objects[key])
    assert record["status"] == "draft" and record["brief"]["confidence"] == "moderate"
    md = out["markdown"]
    assert "| Equipment failure or leak | possible |" in md and "(unconfirmed)" in md
    assert "Confidence in any single explanation: low without a ground or aircraft check." in md
    assert "DRAFT, awaiting the analyst's decision" in md and "not filed" in md
    assert "Call no other tool" in out["next_steps"]
    # Nothing under briefs/ except the draft: the tool never files.
    assert [k for k in fake_s3.objects if "/briefs/" in k] == [key]


@pytest.mark.parametrize("field,text,why", [
    ("observations", ["The methane was caused by a broken valve."], "states a cause as fact"),
    ("observations", ["This is a leak at the compressor."], "states an explanation as fact"),
    ("observations", ["Confirmed leak on 2025-08-01."], "states an explanation as fact"),
    ("place", "site operated by a national company", "names an owner or operator"),
    ("place", "Balkan Gas Corp. field", "names a company"),
    ("title", "Plume at the state-owned field", "names a government"),
    ("next_collection", "Assess possible sabotage.", "asserts intent"),
    ("gaps", ["The government does not report emissions."], "names a government"),
])
def test_forbidden_phrasing_is_rejected_with_the_reason(brief, fake_s3, field, text, why):
    out = json.loads(_run(brief.draft_brief(**good(**{field: text}))))
    assert why in out["error"] and "Rewrite" in out["error"]
    assert not any("/briefs/" in k for k in fake_s3.objects)


def test_explanations_come_only_from_the_fixed_list_as_hypotheses(brief):
    bad_id = good(explanations=[{"id": "sabotage", "assessment": "possible", "next_check": "x"},
                                {"id": "routine_venting", "assessment": "possible", "next_check": "x"}])
    assert "must be one of" in json.loads(_run(brief.draft_brief(**bad_id)))["error"]
    confirmed = good(explanations=[{"id": "routine_venting", "assessment": "confirmed", "next_check": "x"},
                                   {"id": "unlit_flare", "assessment": "possible", "next_check": "x"}])
    assert "assessment must be one of" in json.loads(_run(brief.draft_brief(**confirmed)))["error"]
    one = good(explanations=[{"id": "routine_venting", "assessment": "possible", "next_check": "x"}])
    assert "at least two" in json.loads(_run(brief.draft_brief(**one)))["error"]
    twice = good(explanations=[{"id": "unlit_flare", "assessment": "possible", "next_check": "x"}] * 2)
    assert "listed twice" in json.loads(_run(brief.draft_brief(**twice)))["error"]


@pytest.mark.parametrize("over,msg", [
    ({"confidence": "certain"}, "confidence must be one of"),
    ({"candidates": 5, "passes_read": 4}, "cannot exceed"),
    ({"lat": 123.0}, "lat must be"),
    ({"observations": []}, "non-empty list"),
    ({"observations": ["x"] * 7}, "more than 6"),
    ({"title": "x" * 91}, "longer than"),
    ({"place": "<img src=x>"}, "markup"),
    ({"place": "a | b"}, "pipes"),
])
def test_fields_are_bounded(brief, over, msg):
    assert msg in json.loads(_run(brief.draft_brief(**good(**over))))["error"]


def test_hypothesis_labels_and_describing_what_is_seen_pass_the_checks(brief):
    assert brief.check_text("Pads, tanks and an access road are visible north of the candidate.") == []
    assert brief.check_text("A leak cannot be ruled out without an aircraft survey.") == []
    assert all(brief.check_text(label) == [] for label in brief.EXPLANATIONS.values())


def test_brief_status_is_the_only_source_for_filed(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good())))
    bid = out["brief_id"]
    assert json.loads(_run(brief.brief_status(bid)))["status"] == "draft"
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/briefs/{bid}.filed.json",
                       Body=json.dumps({"filed_at": "2026-09-25T20:00:00Z"}).encode())
    filed = json.loads(_run(brief.brief_status(bid)))
    assert filed["status"] == "filed" and filed["filed_at"] == "2026-09-25T20:00:00Z"
    assert json.loads(_run(brief.brief_status("brief-20260101T000000-abcdef")))["status"] == "not_found"
    for bad in ("../x", "brief-1", None):
        assert "error" in json.loads(_run(brief.brief_status(bad)))
