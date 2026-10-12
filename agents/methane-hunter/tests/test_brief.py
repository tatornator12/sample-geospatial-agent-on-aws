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
    ("place", "Hazar, near the state-owned field", "names a government"),
    ("place", "Near Xinxiang, Henan, eastern Shanxi and Ordos coal basin, China", "names the watch area"),
    ("place", "south Caspian watch site", "names the watch area"),
    ("place", "39.47, 53.64", "gives coordinates"),
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
    ({"place": "x" * 75}, "longer than"),
    ({"place": "<img src=x>"}, "markup"),
    ({"place": "a | b"}, "pipes"),
])
def test_fields_are_bounded(brief, over, msg):
    assert msg in json.loads(_run(brief.draft_brief(**good(**over))))["error"]


def test_a_rejected_character_is_named_with_its_plain_words_stand_in(brief):
    # A vague rejection made the model rewrite ppm·m as ppm-m; the error names the one character.
    obs = ["EMIT saw 98 pixels >= 1000 ppm·m on 2025-08-20.", "VIIRS saw no heat source within 1 km."]
    err = json.loads(_run(brief.draft_brief(**good(observations=obs))))["error"]
    assert "observations[0] contains '>'" in err and "'at least' or 'over'" in err and "ppm·m are fine" in err
    assert "U+0007" in json.loads(_run(brief.draft_brief(**good(place="Krasnovodsk\x07, Turkmenistan"))))["error"]
    ok = good(observations=["EMIT saw 98 pixels of at least 1000 ppm·m on 2025-08-20.", obs[1]])
    assert "error" not in json.loads(_run(brief.draft_brief(**ok)))


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


def test_the_brief_carries_the_ground_checks_from_their_own_records(brief, fake_s3):
    """draft_brief embeds the tools' numbers, nearest within 2 km, never text from the model."""
    prefix = f"session_data/{SESSION}/methane/"
    fake_s3.put_object(Bucket=BUCKET, Key=f"{prefix}thermal_39.4700_53.6400.json", Body=json.dumps({
        "nights_checked": 30, "detections": 0, "nights_with_heat": 0, "verdict": "no heat", "source": "firms-api",
        "line": "VIIRS saw no heat source within 1 km over the last 30 nights; flaring was not observed."}).encode())
    fake_s3.put_object(Bucket=BUCKET, Key=f"{prefix}infra_39.4700_53.6400.json", Body=json.dumps({
        "radius_km": 2.0, "mapped": 3, "groups": {"oil and gas": 3}, "types": [{"type": "well", "count": 3, "nearest_km": 0.4}],
        "line": "Overture Maps shows within 2 km: 3 storage tanks (0.4 km); nothing mapped for mining, waste, wetland."}).encode())
    # A check for another site, 40 km away, must not be picked up.
    fake_s3.put_object(Bucket=BUCKET, Key=f"{prefix}thermal_39.8000_53.6400.json", Body=json.dumps({
        "verdict": "persistent heat", "line": "VIIRS saw heat on 9 of 30 nights."}).encode())
    out = json.loads(_run(brief.draft_brief(**good())))
    assert out["status"] == "draft"
    assert "- Check: VIIRS saw no heat source" in out["markdown"] and "- Check: Overture Maps shows within 2 km: 3 storage tanks" in out["markdown"]
    assert "9 of 30" not in out["markdown"]
    record = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])
    assert record["brief"]["checks"]["thermal"]["verdict"] == "no heat"
    assert record["brief"]["checks"]["infrastructure"]["types"] == [{"type": "well", "count": 3, "nearest_km": 0.4}]


def test_a_brief_without_checks_still_drafts(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good())))
    assert out["status"] == "draft" and "- Check:" not in out["markdown"]


def test_the_tool_titles_the_brief_from_the_geocoded_place_and_names_the_watch_area_as_provenance(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good(place="Near Xinxiang, Henan, China", watch_area="shanxi coal basin",
                                                    confidence="high", lat=35.4451, lon=114.5779))))
    assert "error" not in out, out
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]
    assert rec["title"] == "Recurring methane near Xinxiang, Henan, China"         # "Near" is not doubled
    assert rec["place"] == "Xinxiang, Henan, China"
    assert rec["watch_area"] == "Shanxi and Ordos coal basins (China)"              # the stage's label, from the key
    md = out["markdown"]
    assert "Site: near Xinxiang, Henan, China (35.4451, 114.5779); tipped by the Shanxi and Ordos coal basins (China) watch area." in md
    low = json.loads(_run(brief.draft_brief(**good(confidence="low"))))
    assert "Methane candidate near Hazar, Balkan Region" in low["markdown"]           # the adjective follows the evidence
    tip = json.loads(_run(brief.draft_brief(**good(confidence="low", candidates=0))))
    assert "Unconfirmed methane tip near Hazar, Balkan Region" in tip["markdown"]      # no EMIT candidate: only a tip
    # A place the geocoder could give stays a place, even when it shares a word with an area.
    assert brief.check_place("Amman, Jordan") == [] and brief.check_place("Hassi Messaoud, Ouargla, Algeria") == []


def test_pass_counts_and_their_window_come_from_the_tools_own_record(brief, fake_s3):
    lat, lon = 39.4741, 53.6435
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/passes_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
        "lat": lat, "lon": lon, "since": "2025-01-01", "looks": 9,
        "passes": [{"date": "2025-08-01", "verdict": "candidate"}, {"date": "2025-08-20", "verdict": "candidate"},
                   {"date": "2025-09-02", "verdict": "rejected"}]}).encode())
    out = json.loads(_run(brief.draft_brief(**good(candidates=4, passes_read=4))))      # the model's numbers differ
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]
    assert (rec["candidates"], rec["passes_read"], rec["passes_since"]) == (2, 3, "2025-01-01")
    assert "Looks: 2 of 3 passes read since 2025-01-01 are candidates; EMIT looked 11 times in all." in out["markdown"]


def test_the_registry_field_line_is_its_own_check_in_the_brief(brief, fake_s3):
    lat, lon = 31.67, 6.07
    field_line = ("The public registry places the site inside the HASSI MESSAOUD oil and gas field; "
                  "operator of record SONATRACH; record dated 2017.")
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/registry_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
        "radius_km": 2.0, "listed": 10, "operators_named": 0, "facilities": [{"kind": "pipeline", "count": 10, "nearest_km": 0.2}],
        "operators": [], "source_dates": ["2021-01-01", "2021-01-01"], "source": "OGIM v3.0",
        "line": "The public registry lists within 2 km: 10 pipelines (0.2 km); no operator on record for any of them; records dated 2021.",
        "field": {"name": "HASSI MESSAOUD", "operator": "SONATRACH", "inside": True, "distance_km": 0.0, "src_date": "2017-06-24"},
        "field_line": field_line}).encode())
    out = json.loads(_run(brief.draft_brief(**good(place="Hassi Messaoud, Ouargla, Algeria", watch_area="hassi messaoud",
                                                    lat=lat, lon=lon))))
    assert "error" not in out, out
    checks = [l for l in out["markdown"].splitlines() if l.startswith("- Check:")]
    assert checks[-1] == f"- Check: {field_line}" and len(checks) == 2
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]
    assert rec["checks"]["registry"]["field"]["operator"] == "SONATRACH"
    assert brief.check_text(field_line) == []          # a company name passes only in the registry's own words


def _registry_with_gem_field(fake_s3, lat, lon, operator="Turkmennebit", owners="Turkmennebit (100%)"):
    gem_line = (f"The nearest oil and gas field on Global Energy Monitor's record is Goturdepe Gas Field "
                f"(operating; outline from the OGIM registry), 6.4 km away; operator of record {operator}.")
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/registry_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
        "radius_km": 2.0, "listed": 0, "operators_named": 0, "facilities": [], "operators": [],
        "source_dates": [], "source": "OGIM v3.0",
        "line": "The public registry (OGIM v3.0) lists no oil and gas facility within 2 km; a registry gap is not evidence of an empty site.",
        "gem_field": {"name": "Goturdepe Gas Field", "status": "operating", "operator": operator, "owners": owners,
                      "inside": False, "distance_km": 6.4},
        "gem_field_line": gem_line}).encode())
    return gem_line


def test_a_party_from_the_record_never_rides_in_the_models_own_fields(brief, fake_s3):
    # Oct 12 gate: the model wrote "...; operator of record Turkmennebit." as an observation, so the
    # name sat in the brief outside the registry's sentence. The tool now sends that back unwritten.
    lat, lon = 39.4379, 53.5730
    gem_line = _registry_with_gem_field(fake_s3, lat, lon)
    named = good(lat=lat, lon=lon, place="Krasnovodsk, Turkmenistan", observations=[
        "TROPOMI shows a 14-day anomaly of +108.8 ppb above background at this site.",
        "The nearest field on Global Energy Monitor is Goturdepe Gas Field, 6.4 km away; operator of record turkmennebit."])
    err = json.loads(_run(brief.draft_brief(**named)))["error"]
    assert "observations[1]: names 'Turkmennebit' from the public record" in err
    assert not [k for k in fake_s3.objects if "/briefs/" in k]                     # nothing drafted
    clean = good(lat=lat, lon=lon, place="Krasnovodsk, Turkmenistan", observations=named["observations"][:1] + [
        "EMIT read 4 passes since 2025-01-01; 2 were candidates peaking at 2,828.3 ppm·m on 2025-08-20."])
    out = json.loads(_run(brief.draft_brief(**clean)))
    assert "error" not in out, out
    assert f"- Check: {gem_line}" in out["markdown"]                                # the record's own words carry it
    assert out["markdown"].count("Turkmennebit") == 1


def test_record_names_cover_every_party_and_spare_the_place(brief):
    checks = {"registry": {"operators": [{"operator": "BP"}],
                           "field": {"operator": "SONATRACH"},
                           "gem_field": {"operator": "Turkmennebit", "owners": "Turkmennebit (100%), Dragon Oil (60%)"},
                           "mine": {"owners": "Hazar (100%)", "parent": "Jincheng Energy"}}}
    names = brief.record_names(checks)
    assert set(names) == {"BP", "SONATRACH", "Turkmennebit", "Dragon Oil", "Hazar", "Jincheng Energy"}
    b = {"place": "Hazar, Balkan Region, Turkmenistan", "watch_area": "south caspian", "next_collection": "An aircraft survey.",
         "observations": ["EMIT saw methane near Hazar.", "The bp of the pass was low.", "Dragon oil fields lie offshore."],
         "gaps": [], "explanations": [{"next_check": "Ask Jincheng Energy."}]}
    problems = brief.check_record_names(b, names)
    assert [p.split(":")[0] for p in problems] == ["observations[2]", "explanations[0].next_check"]
