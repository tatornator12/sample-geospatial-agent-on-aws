"""draft_brief (requirement 10): fixed explanations, bounded text, no stated causes, draft only."""
import asyncio
import json
import re

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
        recommendation="recommend_new_look", recommendation_reason="no_confirmation_on_record",
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


def _infra(fake_s3, groups):
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/infra_39.4700_53.6400.json", Body=json.dumps({
        "radius_km": 2.0, "mapped": 4, "groups": groups, "types": [{"type": "storage tank", "count": 3, "nearest_km": 1.9}],
        "line": "Overture Maps shows within 2 km: 1 industrial area (1.7 km), 3 storage tanks (1.9 km)."}).encode())


ONLY_OIL_GAS = [{"id": "routine_venting", "assessment": "possible", "next_check": "Passes on new dates with no heat seen would support venting."},
                {"id": "non_oil_gas_source", "assessment": "less likely", "next_check": "Overture Maps shows only oil and gas infrastructure nearby."}]


def test_only_oil_and_gas_is_refused_when_the_mapping_shows_other_groups(brief, fake_s3):
    """Stage review act2 P1-10: "only oil and gas" over an industrial area the tool classed as other industry."""
    _infra(fake_s3, {"oil and gas": 3, "other industry": 1})
    out = json.loads(_run(brief.draft_brief(**good(explanations=ONLY_OIL_GAS))))
    assert "Rewrite these parts of the brief" in out["error"]
    assert "explanations[1].next_check: says 'only oil and gas'" in out["error"] and "other industry" in out["error"]
    assert not any("/briefs/" in k for k in fake_s3.objects)
    gaps = json.loads(_run(brief.draft_brief(**good(gaps=["Only mapped oil-and-gas sites were checked."]))))
    assert "gaps[0]: says 'only oil and gas'" in gaps["error"]


def test_only_oil_and_gas_passes_when_it_is_what_the_mapping_shows(brief, fake_s3):
    _infra(fake_s3, {"oil and gas": 3, "other industry": 0, "mining": 0})
    out = json.loads(_run(brief.draft_brief(**good(explanations=ONLY_OIL_GAS))))
    assert out["status"] == "draft", out


@pytest.mark.parametrize("groups", [None, {}, {"other industry": "1"}, {"other industry": True}, "oil and gas"])
def test_a_mapping_record_without_usable_groups_never_blocks_the_brief(brief, fake_s3, groups):
    _infra(fake_s3, groups)
    assert json.loads(_run(brief.draft_brief(**good(explanations=ONLY_OIL_GAS))))["status"] == "draft"


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
    out = json.loads(_run(brief.draft_brief(**good(candidates=4, passes_read=4,      # the model's numbers differ
                                                    recommendation_reason="confirmation_older_than_90_days"))))
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]
    assert (rec["candidates"], rec["passes_read"], rec["passes_since"]) == (2, 3, "2025-01-01")
    # No site_history record here: the model's looks, since EMIT began (2022), never "in all".
    assert "Looks: 2 of 3 passes read since 2025-01-01 are candidates; EMIT looked 11 times since 2022." in out["markdown"]
    assert "in all" not in out["markdown"]


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


def _cm_record(fake_s3, lat, lon, **over):
    rec = {"lat": lat, "lon": lon, "radius_km": 5.0, "since": "2025-01-01", "count": 45, "latest": "2026-06-20",
           "rate_kg_h": 273.1, "uncertainty_kg_h": 260.9, "instrument": "tanager", "source": "carbon-mapper"}
    rec.update(over)
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/cmplumes_{lat:.4f}_{lon:.4f}.json",
                       Body=json.dumps(rec).encode())


def test_the_brief_carries_carbon_mappers_independent_detections_from_its_own_record(brief, fake_s3):
    _cm_record(fake_s3, 39.4745, 53.6440)      # carbon_mapper_plumes ran at the cued point, ~50 m away
    out = json.loads(_run(brief.draft_brief(**good())))
    line = ("Carbon Mapper lists 45 methane plumes within 5 km since 2025-01-01; the latest on 2026-06-20 by Tanager-1, "
            "Carbon Mapper's estimate about 270 ± 260 kg/h. Source: Carbon Mapper (data.carbonmapper.org).")
    assert f"- Independent detections: {line}" in out["markdown"]
    record = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])
    assert record["brief"]["checks"]["carbon_mapper"]["line"] == line
    assert record["brief"]["checks"]["carbon_mapper"]["count"] == 45


@pytest.mark.parametrize("over,expect", [
    ({"count": 0, "latest": None, "rate_kg_h": None, "uncertainty_kg_h": None, "instrument": None},
     "Carbon Mapper lists no methane plume within 5 km since 2025-01-01. Source: Carbon Mapper (data.carbonmapper.org)."),
    ({"count": 1, "rate_kg_h": None, "uncertainty_kg_h": None, "instrument": "emit"},
     "Carbon Mapper lists 1 methane plume within 5 km since 2025-01-01; the latest on 2026-06-20 by EMIT, "
     "no emission estimate published. Source: Carbon Mapper (data.carbonmapper.org)."),
    ({"uncertainty_kg_h": None, "rate_kg_h": 1513.1},
     "Carbon Mapper lists 45 methane plumes within 5 km since 2025-01-01; the latest on 2026-06-20 by Tanager-1, "
     "Carbon Mapper's estimate about 1,510 kg/h. Source: Carbon Mapper (data.carbonmapper.org)."),
])
def test_the_carbon_mapper_line_is_written_from_numbers(brief, over, expect):
    rec = {"radius_km": 5.0, "since": "2025-01-01", "count": 45, "latest": "2026-06-20", "rate_kg_h": 273.1,
           "uncertainty_kg_h": 260.9, "instrument": "tanager"}
    assert brief.carbon_mapper_line({**rec, **over}) == expect


@pytest.mark.parametrize("over", [{"count": "45"}, {"latest": "June"}, {"instrument": "Acme <b>"}, {"since": None},
                                  {"radius_km": 500}, {"count": True}])
def test_a_malformed_carbon_mapper_record_adds_no_line(brief, fake_s3, over):
    _cm_record(fake_s3, 39.4741, 53.6435, **over)
    out = json.loads(_run(brief.draft_brief(**good())))
    assert out["status"] == "draft" and "Independent detections" not in out["markdown"]
    assert "Acme" not in out["markdown"]


def test_a_carbon_mapper_record_at_another_site_is_not_this_briefs(brief, fake_s3):
    _cm_record(fake_s3, 37.8938, 113.5625)
    out = json.loads(_run(brief.draft_brief(**good())))
    assert "Independent detections" not in out["markdown"]


def test_the_nearest_carbon_mapper_record_within_2_km_is_the_briefs(brief, fake_s3):
    _cm_record(fake_s3, 39.4800, 53.6435, count=3)       # ~650 m away
    _cm_record(fake_s3, 39.4745, 53.6440, count=45)      # ~50 m away: this one
    out = json.loads(_run(brief.draft_brief(**good())))
    assert "Carbon Mapper lists 45 methane plumes" in out["markdown"]


def test_an_unavailable_carbon_mapper_record_adds_no_line(brief, fake_s3):
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/cmplumes_39.4741_53.6435.json",
                       Body=json.dumps({"lat": 39.4741, "lon": 53.6435, "radius_km": 5.0, "since": "2025-01-01",
                                        "status": "unavailable"}).encode())
    out = json.loads(_run(brief.draft_brief(**good())))
    assert "Independent detections" not in out["markdown"]


# --- the agent's decision (approved 2026-10-23) ------------------------------------------------------

SHANXI = (37.8938, 113.5625)


def put_record(fake_s3, lat=SHANXI[0], lon=SHANXI[1], tip=("2026-10-06", "2026-10-20"), cm_days=("2026-06-10",),
               passes=(("2026-08-17", "rejected", "cloud or gap"), ("2025-08-18", "candidate", "candidate"),
                       ("2025-04-22", "candidate", "candidate"), ("2025-04-22", "candidate", "candidate"))):
    """The session's records for one site: the tip, the EMIT passes and Carbon Mapper's plumes within 7 km."""
    pre = f"session_data/{SESSION}/methane/"
    if tip:
        fake_s3.put_object(Bucket=BUCKET, Key=f"{pre}tip_shanxi_coal_basin.json", Body=json.dumps({
            "area": "shanxi coal basin", "start": tip[0], "end": tip[1], "days": 14,
            "top": {"lat": lat, "lon": lon, "anomaly_ppb": 124.7, "valid_days": 3, "emit_can_look": True}}).encode())
    if passes is not None:
        fake_s3.put_object(Bucket=BUCKET, Key=f"{pre}passes_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
            "lat": lat, "lon": lon, "since": "2025-01-01", "looks": len(passes),
            "passes": [{"date": d, "verdict": v, "short": sh, "product": "V002"} for d, v, sh in passes]}).encode())
    if cm_days is not None:
        dates = [{"date": d, "instrument": "tanager", "rate_kg_h": 2050.0, "distance_km": 5.1} for d in cm_days]
        dates.append({"date": "2026-09-01", "instrument": "tanager", "rate_kg_h": 300.0, "distance_km": 9.5})  # beyond 7 km
        fake_s3.put_object(Bucket=BUCKET, Key=f"{pre}cmplumes_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
            "lat": lat, "lon": lon, "radius_km": 10.0, "since": "2025-01-01", "count": len(dates), "latest": "2026-09-01",
            "rate_kg_h": 300.0, "uncertainty_kg_h": 100.0, "instrument": "tanager", "follow_radius_km": 7.0,
            "dates": dates}).encode())


def shanxi(**over):
    return good(place="Yangquan, Shanxi, China", lat=SHANXI[0], lon=SHANXI[1], watch_area="shanxi coal basin", **over)


def test_the_brief_says_the_record_and_the_agents_recommendation_in_code_written_lines(brief, fake_s3):
    put_record(fake_s3)
    out = json.loads(_run(brief.draft_brief(**shanxi(recommendation="recommend_new_look",
                                                     recommendation_reason="confirmation_older_than_90_days"))))
    assert "error" not in out, out
    md = out["markdown"]
    assert ("Record: TROPOMI tipped this site from 2026-10-06 to 2026-10-20; the latest fine-scale confirmation is a "
            "Carbon Mapper plume on 2026-06-10, 118 days earlier; EMIT last looked on 2026-08-17 (clouded out).") in md
    assert ("Recommendation: a new fine-scale look, because the latest confirmation is more than 90 days older than "
            "the tip.") in md
    rec = json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]
    assert (rec["recommendation"], rec["recommendation_reason"]) == ("recommend_new_look", "confirmation_older_than_90_days")
    assert rec["record"] == {"tip_start": "2026-10-06", "tip_end": "2026-10-20", "reference": "tip",
                             "latest_confirmed": {"date": "2026-06-10", "by": "carbon_mapper"}, "days_between": 118,
                             "last_look": {"date": "2026-08-17", "result": "clouded_out"}, "confirmed_dates": 3}
    assert "follow_days" not in rec["checks"]["carbon_mapper"]
    # Two reasons hold here (older than 90 days, last look clouded out): the one the model leads with is the brief's.
    other = json.loads(_run(brief.draft_brief(**shanxi(recommendation="recommend_new_look",
                                                       recommendation_reason="last_look_clouded_out"))))
    assert "Recommendation: a new fine-scale look, because EMIT's last look here was clouded out." in other["markdown"]


@pytest.mark.parametrize("reason,fact", [
    ("confirmed_within_90_days", "the latest fine-scale confirmation is a Carbon Mapper plume on 2026-06-10, 118 days "
                                 "before the tip's first day (2026-10-06)"),
    ("no_confirmation_on_record", "a Carbon Mapper plume on 2026-06-10"),
])
def test_a_choice_the_record_contradicts_is_refused_naming_the_fact(brief, fake_s3, reason, fact):
    put_record(fake_s3)
    want = brief.REASONS[reason]
    before = set(fake_s3.objects)
    out = json.loads(_run(brief.draft_brief(**shanxi(recommendation=want, recommendation_reason=reason))))
    assert fact in out["error"] and "does not fit the record" in out["error"]
    assert "confirmation_older_than_90_days (recommend_new_look)" in out["error"]      # what the record supports
    assert "last_look_clouded_out (recommend_new_look)" in out["error"]
    assert set(fake_s3.objects) == before                                             # nothing written


def test_a_clouded_out_reason_needs_a_clouded_out_last_look(brief, fake_s3):
    put_record(fake_s3, passes=(("2026-08-17", "rejected", "too weak"), ("2025-08-18", "candidate", "candidate")))
    out = json.loads(_run(brief.draft_brief(**shanxi(recommendation="recommend_new_look",
                                                     recommendation_reason="last_look_clouded_out"))))
    assert "EMIT's last look here, on 2026-08-17, was too faint, not clouded out" in out["error"]


@pytest.mark.parametrize("cm_day,ok,refused", [
    ("2026-07-08", "confirmed_within_90_days", "confirmation_older_than_90_days"),    # 90 days before 2026-10-06
    ("2026-07-07", "confirmation_older_than_90_days", "confirmed_within_90_days"),    # 91 days
])
def test_the_90_day_boundary(brief, fake_s3, cm_day, ok, refused):
    put_record(fake_s3, cm_days=(cm_day,))
    good_out = json.loads(_run(brief.draft_brief(**shanxi(recommendation=brief.REASONS[ok], recommendation_reason=ok))))
    assert "error" not in good_out, good_out
    bad = json.loads(_run(brief.draft_brief(**shanxi(recommendation=brief.REASONS[refused], recommendation_reason=refused))))
    assert "does not fit the record" in bad["error"]
    if ok == "confirmed_within_90_days":
        assert ("Recommendation: no new fine-scale look needed, because the latest confirmation is within 90 days of "
                "the tip.") in good_out["markdown"]
        assert "a Carbon Mapper plume on 2026-07-08, 90 days earlier" in good_out["markdown"]


def test_the_enums_are_validated_and_must_agree(brief, fake_s3):
    for over, msg in ((dict(recommendation="maybe"), "recommendation must be one of"),
                      (dict(recommendation_reason="it is old"), "recommendation_reason must be one of"),
                      (dict(recommendation=None), "recommendation must be one of"),
                      (dict(recommendation="no_new_look_needed", recommendation_reason="no_confirmation_on_record"),
                       "leads to 'recommend_new_look', not 'no_new_look_needed'")):
        out = json.loads(_run(brief.draft_brief(**good(**over))))
        assert msg in out["error"]
    assert not [k for k in fake_s3.objects if "/briefs/" in k]


def test_no_record_at_all_is_said_as_such(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good())))      # no tip, no passes, no Carbon Mapper record
    md = out["markdown"]
    assert "Record: no fine-scale confirmation is on record; EMIT's passes here were not read." in md
    assert "Recommendation: a new fine-scale look, because no fine-scale confirmation is on record here." in md


def test_an_emit_confirmation_inside_the_tip_window_is_said_so(brief, fake_s3):
    put_record(fake_s3, cm_days=(), passes=(("2026-10-12", "candidate", "candidate"),))
    out = json.loads(_run(brief.draft_brief(**shanxi(recommendation="no_new_look_needed",
                                                     recommendation_reason="confirmed_within_90_days"))))
    assert ("the latest fine-scale confirmation is an EMIT candidate pass on 2026-10-12, inside the tip's window; "
            "EMIT last looked on 2026-10-12 (methane seen).") in out["markdown"]


def test_the_code_written_lines_never_say_now_still_active_or_leaking(brief):
    import re
    facts = [brief.record_facts(p, c, t, "2026-10-23") for p, c, t in (
        (None, None, None),
        ({"candidate_days": ["2025-08-18"], "last_look": {"date": "2026-08-17", "result": "clouded_out"}},
         {"follow_days": ["2026-06-10"]}, {"start": "2026-10-06", "end": "2026-10-20"}),
        ({"candidate_days": ["2026-10-12"], "last_look": {"date": "2026-10-12", "result": "methane_seen"}}, None,
         {"start": "2026-10-06", "end": "2026-10-20"}),
        ({"candidate_days": [], "last_look": {"date": "2026-10-17", "result": "within_noise"}}, {"follow_days": ["2026-09-10"]}, None),
    )]
    lines = [brief.record_line(f) for f in facts]
    lines += [brief.recommendation_line(brief.REASONS[r], r, f) for f in facts for r in brief.REASONS]
    for line in lines:
        assert not re.search(r"\b(now|still|active|leaking)\b", line, re.IGNORECASE), line
        assert "\u2014" not in line and "\u2013" not in line, line
        assert brief.check_text(line) == [], line


# --- the brief's wording (the presenter's filed brief, 27 Oct) ---------------------------------------
#
# 1. "No new close look is needed yet." sat above "Next: A new EMIT pass or Tanager-1 overpass over this
#    site to confirm recurrence and resolve the spatial pattern." (the model's next_collection).
# 2. The gaps said "NASA's plume product is nearly empty after 2025-09-22; passes after that date have not
#    been checked for outlined plumes.", read as "nothing was checked" though the agent read 20 passes.
# 3. "6 of 20 passes read since 2025-01-01 are candidates; EMIT looked 30 times in all.": the 30 is every
#    look since 2022, the 20 the passes since 2025.

PRESENTERS_NEXT = ("A new EMIT pass or Tanager-1 overpass over this site to confirm recurrence and resolve "
                   "the spatial pattern.")
PRESENTERS_GAP = ("NASA's plume product is nearly empty after 2025-09-22; passes after that date have not been "
                  "checked for outlined plumes.")


def _draft(fake_s3, out):
    return json.loads(fake_s3.objects[f"session_data/{SESSION}/briefs/{out['brief_id']}.draft.json"])["brief"]


def _within_90(**over):
    """A no_new_look_needed brief the record supports (Carbon Mapper 90 days before the tip)."""
    return shanxi(recommendation="no_new_look_needed", recommendation_reason="confirmed_within_90_days", **over)


@pytest.mark.parametrize("given", [PRESENTERS_NEXT, None, "Assess possible sabotage."])
def test_no_new_look_needed_writes_the_next_line_itself_whatever_the_model_sent(brief, fake_s3, given):
    put_record(fake_s3, cm_days=("2026-07-08",))
    over = {} if given is None else {"next_collection": given}
    args = _within_90(**over)
    if given is None:
        args.pop("next_collection")
    out = json.loads(_run(brief.draft_brief(**args)))
    assert "error" not in out, out                                # ignored, never refused or rewritten
    md = out["markdown"]
    assert "Recommendation: no new fine-scale look needed" in md
    assert "Next collection: EMIT's next routine pass over this site, to extend the record." in md
    assert "Tanager-1 overpass" not in md and "sabotage" not in md
    assert _draft(fake_s3, out)["next_collection"] == brief.NO_NEW_LOOK_NEXT


def test_recommend_new_look_keeps_the_models_next_line(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good(next_collection=PRESENTERS_NEXT))))
    assert "error" not in out, out
    assert f"Next collection: {PRESENTERS_NEXT}" in out["markdown"]
    assert _draft(fake_s3, out)["next_collection"] == PRESENTERS_NEXT


@pytest.mark.parametrize("text", [
    "No new close look is needed yet.",
    "No further pass is required; EMIT's routine passes will extend the record.",
    "A new look is not needed while the record is recent.",
    "None needed until the next fortnight.",
    "There is no need for a new pass.",
])
def test_recommend_new_look_refuses_a_next_line_that_says_none_is_needed(brief, fake_s3, text):
    out = json.loads(_run(brief.draft_brief(**good(next_collection=text))))
    assert "next_collection: says no new look is needed, but your recommendation is recommend_new_look" in out["error"]
    assert not [k for k in fake_s3.objects if "/briefs/" in k]


def test_recommend_new_look_needs_its_next_line(brief):
    args = good()
    args.pop("next_collection")
    err = json.loads(_run(brief.draft_brief(**args)))["error"]
    assert "next_collection (the new look you recommend) must be a non-empty string" in err


def test_a_refused_no_new_look_call_is_told_to_add_the_next_line(brief, fake_s3):
    put_record(fake_s3)                        # 118 days: the record supports a new look only
    args = shanxi(recommendation="no_new_look_needed", recommendation_reason="confirmed_within_90_days")
    args.pop("next_collection")
    err = json.loads(_run(brief.draft_brief(**args)))["error"]
    assert "does not fit the record" in err and "also give next_collection: the new look you recommend" in err


def test_the_fixed_next_line_reads_as_no_new_look(brief):
    assert brief._NO_LOOK.search(brief.NO_NEW_LOOK_NEXT) is None
    assert brief.check_text(brief.NO_NEW_LOOK_NEXT) == []
    assert not re.search(r"\b(new|now|still|active|leaking)\b", brief.NO_NEW_LOOK_NEXT, re.IGNORECASE)


def _passes(fake_s3, lat=39.4741, lon=53.6435, latest="2025-09-22", n=3):
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/passes_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
        "lat": lat, "lon": lon, "since": "2025-01-01", "looks": n, "plume_product_latest": latest,
        "passes": [{"date": f"2025-0{i + 1}-10", "verdict": "rejected", "short": "too weak"} for i in range(n)]}).encode())


def _history(fake_s3, lat=39.4741, lon=53.6435, looks=30, first="2022-08-15", latest="2025-09-22"):
    fake_s3.put_object(Bucket=BUCKET, Key=f"session_data/{SESSION}/methane/history_{lat:.4f}_{lon:.4f}.json", Body=json.dumps({
        "lat": lat, "lon": lon, "looks": looks, "first_look": first, "last_look": "2026-10-17",
        "plume_dates": 0, "plume_product_latest": latest}).encode())


def test_the_plume_product_gap_is_the_tools_line_with_its_date_and_the_models_is_dropped(brief, fake_s3):
    _passes(fake_s3)
    out = json.loads(_run(brief.draft_brief(**good(gaps=[PRESENTERS_GAP, "EMIT only sees this site on its passes."]))))
    assert "error" not in out, out                                # dropped, not refused
    line = "NASA's outlined-plume product has none after 22 September 2025, so the agent read EMIT's passes itself."
    assert _draft(fake_s3, out)["gaps"] == [line, "EMIT only sees this site on its passes."]
    assert ("Gaps: NASA's outlined-plume product has none after 22 September 2025, so the agent read EMIT's passes "
            "itself; EMIT only sees this site on its passes.") in out["markdown"]
    assert "have not been checked" not in out["markdown"] and "2025-09-22" not in out["markdown"]


@pytest.mark.parametrize("gap", [
    "NASA's plume product covers only through 2025-09-22; passes after that date have not been reviewed.",
    "NASA's plume product has outlined no plumes here through 2025-09-22; passes after that date are not covered.",
    "NASA has outlined no methane plumes here since 2025-09-22.",
    "The outlined-plume record ends on 2025-09-22.",
])
def test_every_wording_of_the_plume_product_gap_gives_way_to_the_tools(brief, fake_s3, gap):
    _passes(fake_s3)
    out = json.loads(_run(brief.draft_brief(**good(gaps=[gap, "EMIT only sees this site on its passes."]))))
    gaps = _draft(fake_s3, out)["gaps"]
    assert gaps[0].startswith("NASA's outlined-plume product has none after 22 September 2025") and len(gaps) == 2


def test_the_plume_gap_without_a_pass_record_or_a_date(brief, fake_s3):
    out = json.loads(_run(brief.draft_brief(**good())))                    # no records at all
    assert _draft(fake_s3, out)["gaps"][0] == ("NASA's outlined-plume product is nearly empty after 2024, and EMIT's "
                                                "passes here were not read.")
    _history(fake_s3)                                                      # site_history knows the date
    out = json.loads(_run(brief.draft_brief(**good())))
    assert _draft(fake_s3, out)["gaps"][0] == ("NASA's outlined-plume product has none after 22 September 2025, and "
                                                "EMIT's passes here were not read.")


@pytest.mark.parametrize("field,text", [
    ("gaps", ["Passes after 2025-09-22 have not been checked for methane."]),
    ("gaps", ["Later passes are unchecked."]),
    ("observations", ["EMIT's later passes were not reviewed for plumes.", "VIIRS saw no heat."]),
])
def test_passes_said_to_be_not_checked_are_refused(brief, fake_s3, field, text):
    err = json.loads(_run(brief.draft_brief(**good(**{field: text}))))["error"]
    assert "reads as if no pass was checked (the agent read EMIT's passes itself)" in err
    assert not [k for k in fake_s3.objects if "/briefs/" in k]


def test_the_model_keeps_three_gaps_besides_the_plume_products(brief, fake_s3):
    four = ["EMIT only sees this site on its passes.", "VIIRS can miss small flares.",
            "The registry may be incomplete.", "TROPOMI had 3 valid days."]
    assert "gaps has more than 3 items besides NASA's plume product" in json.loads(_run(brief.draft_brief(**good(gaps=four))))["error"]
    out = json.loads(_run(brief.draft_brief(**good(gaps=[PRESENTERS_GAP] + four[:3]))))
    assert len(_draft(fake_s3, out)["gaps"]) == 4                          # the tool's line and the model's three


@pytest.mark.parametrize("first,expect", [("2022-08-15", "since 2022"), ("2023-03-02", "since 2023"), (None, "since 2022")])
def test_emits_looks_and_their_first_year_come_from_site_historys_record(brief, fake_s3, first, expect):
    _passes(fake_s3, n=3)
    _history(fake_s3, looks=30, first=first)
    out = json.loads(_run(brief.draft_brief(**good(looks=11))))           # the model's count differs
    assert f"Looks: 0 of 3 passes read since 2025-01-01 are candidates; EMIT looked 30 times {expect}." in out["markdown"]
    rec = _draft(fake_s3, out)
    assert rec["looks"] == 30 and rec.get("looks_since") == first


def test_one_look_is_one_time_and_a_far_history_record_is_not_this_sites(brief, fake_s3):
    _history(fake_s3, lat=39.8, lon=53.6435, looks=99)                    # ~36 km away
    out = json.loads(_run(brief.draft_brief(**good(looks=1))))
    assert "EMIT looked 1 time since 2022." in out["markdown"]


def test_the_code_written_gap_lines_pass_the_briefs_own_checks(brief, tools):
    import watch_tools as wt
    from datetime import date as d
    lines = [wt.plume_gap_line(day, n) for day in (d(2025, 9, 22), d(2026, 1, 1), None) for n in (0, 20)]
    assert wt.day_words(d(2025, 9, 22)) == "22 September 2025" and wt.day_words(d(2026, 1, 1)) == "1 January 2026"
    for line in lines:
        assert brief.check_text(line) == [], line
        assert brief._PLUME_GAP.search(line)                              # a model copy of it would be dropped
        assert not re.search(r"\b(now|still|active|leaking|checked)\b", line, re.IGNORECASE), line
        assert "\u2014" not in line and "\u2013" not in line and len(line) <= brief.TEXT_MAX, line
