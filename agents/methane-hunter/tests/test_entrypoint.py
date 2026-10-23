"""The entrypoint's contract with the UI: pre-warm short-circuits before any model work, and the
prompt carries the fixed confidence sentence. The runtime-only frameworks are stubbed."""
import asyncio
import importlib
import sys
import types

import pytest


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


class _App:
    def entrypoint(self, fn):
        return fn

    def run(self):
        raise RuntimeError("not in tests")


class _Explodes:
    def __init__(self, *a, **k):
        pass

    def __call__(self, *a, **k):
        raise AssertionError("constructed during a pre-warm")


@pytest.fixture()
def entry(monkeypatch):
    strands = sys.modules["strands"]
    monkeypatch.setattr(strands, "Agent", _Explodes, raising=False)
    for name, attrs in {
        "strands.telemetry": {"StrandsTelemetry": _Explodes},
        "bedrock_agentcore": {},
        "bedrock_agentcore.runtime": {"BedrockAgentCoreApp": _App},
        "strands.models": {"BedrockModel": lambda **k: object()},
        "strands.tools": {},
        "strands.tools.mcp": {"MCPClient": lambda *a, **k: object()},
        "strands.types": {},
        "strands.types.content": {"SystemContentBlock": dict},
        "mcp": {},
        "mcp.client": {},
        "mcp.client.streamable_http": {"streamablehttp_client": lambda **k: None},
        "strands.agent": {},
        "strands.agent.conversation_manager": {"SlidingWindowConversationManager": _Explodes},
        "strands.session": {},
        "strands.session.s3_session_manager": {"S3SessionManager": _Explodes},
    }.items():
        monkeypatch.setitem(sys.modules, name, _stub(name, **attrs))
    sys.modules.pop("methane_hunter", None)
    return importlib.import_module("methane_hunter")


def _collect(agen):
    async def run():
        return [chunk async for chunk in agen]
    return asyncio.run(run())


def test_prewarm_yields_warm_and_builds_nothing(entry):
    assert _collect(entry.methane_hunter_agent({"prewarm": True}, types.SimpleNamespace(session_id="s" * 33))) == ["warm"]


def test_is_prewarm():
    import methane_hunter as m  # already imported by the fixture in this module's first test
    assert m.is_prewarm({"prewarm": True}) and not m.is_prewarm({"prompt": "x"}) and not m.is_prewarm(None)


def test_tool_surface(entry):
    names = [t.__name__ for t in entry.LOCAL_TOOLS]
    assert names[:3] == ["search_methane_plumes", "triage_plumes", "show_plume"]
    assert {"display_visual", "inspect_image", "create_bbox_from_coordinates", "get_rasters"} <= set(names)


def test_prompt_carries_the_confidence_sentence_and_render_rule():
    import methane_config
    p = methane_config.build_prompt("2026-10-06")
    assert methane_config.CONFIDENCE_SENTENCE in p and methane_config.SPOKEN_CONFIDENCE in p
    assert "Current date is 2026-10-06" in p
    assert "render" in p and "never name an emitter" in p.lower()
    assert "ppm·m" in p


def test_the_watch_reads_its_dates_from_the_tools_and_says_when_emit_last_looked():
    """Stage review D5 and D8 (Oct 20): the plume product's date is read from watch_baseline, not
    recited; a tie goes to the more recent candidate; the closer gives the last look, never "still
    active"; a rate is given when "super-emitter" is asked, and only NASA's own."""
    import methane_config
    p = " ".join(methane_config.build_prompt("2026-10-20").split())   # line breaks are layout
    assert "nearly empty after 2024, so I'm" not in p and "post-2024" not in p
    assert "plume_product_latest in watch_baseline's summary" in p and "latest date could not be read" in p
    # The follow rule (Oct 22): the newest confirmed detection (an EMIT candidate pass or a Carbon
    # Mapper plume within 5 km) wins; a tie goes to more EMIT candidates, then the higher peak.
    assert "latest confirmed detection is the most recent" in p
    assert "on a tie, the site with MORE EMIT candidate passes; then the higher peak ppm·m" in p
    # The 90-day switch rule (approved 2026-10-23): step 2 only when step 1's follow is stale; the
    # decision goes through follow_site's guard, and its sentence is said word for word.
    assert "the 90-day switch rule only (follow_site checks your choice" in p
    assert "Check the extra hotspots ONLY in step 2." in p and "hotspots ranked 2 and 3 in each cued area" in p
    for reason in ("newest_confirmation", "top_spot_stale_switched", "top_spot_stale_no_fresher", "stronger_tip"):
        assert f'"{reason}"' in p
    assert "say its `say` sentence word for word" in p
    assert "EMIT last looked here on" in p and "last_look" in p
    # Oct 22 (task 25): the closer is a template, word for word ("with EMIT last looking on" failed
    # 3 of 4 mission runs on dev v44).
    assert ("WORD FOR WORD with only the blanks filled (no other wording: not \"last looking\", not \"at this site\"" in p
            and "EMIT passes read since <since>; EMIT last looked here on <site_history's last_look>." in p)
    assert 'never says "still active", "recent" or "active"' in p
    assert "NASA's highest published emission rate at this site" in p and "Never estimate a rate yourself" in p
    assert 'never write "only oil and gas"' in p and "one plain sentence with a verb" in p
    # The checks' own lines reach the record once, as the tool's "- Check:" lines (dev v42 eval run 1:
    # a model that copied them into observations dropped the "Check:" lines from the pasted record).
    assert "never copy a check's line" in p and "\"- Check:\" and \"- Independent detections:\" lines included" in p
    # The agent's decision (approved 2026-10-23): two enums in draft_brief, the brief's own lines pasted.
    assert '"Recommendation:", "- Check:"' in p and '"Record:",' in p and "YOUR decision on whether this site needs a new fine-scale" in p
    assert "within 7 km, one TROPOMI footprint" in p and "within 5 km" not in p
    assert 'ONLY when the user\'s own words include "super-emitter"' in p
    # The mission still starts on the old plate's words (a replay case and old notes use them).
    assert '"super-emitters", "still active"' in p
    assert "\u2014" not in p


def test_the_mission_checks_carbon_mapper_and_puts_the_candidate_on_the_map_as_its_columns():
    """Oct 22: the live mission on production drew no 3D columns. Its cue batch asked for two
    display_visual calls (the flat window and the columns) among six, and the model dropped the
    columns (14 of 43 missions Oct 20-22). The columns are now the candidate's only display."""
    import methane_config
    import methane_hunter
    p = " ".join(methane_config.build_prompt("2026-10-22").split())
    assert "3 cue EMIT and check Carbon Mapper" in p
    assert "carbon_mapper_plumes(lat, lon) for BOTH cued sites" in p
    # Oct 23 (the bars): the tip bars, then the record bars, each its own display; never a flat window.
    assert "display_visual(tip_columns_s3_url, render=<render_tip_columns>)" in p
    assert "display_visual(record_columns_s3_url, render=<render_record_columns>)" in p
    assert "they replace this fortnight's bars; never display a flat pass window" in p
    # The model echoes the prompt's names on stage, so W5 calls the bars by plain names only.
    w5 = p[p.index("W5. LOOK CLOSER"):p.index("W5b. THE GROUND RECORD")]
    assert "tip bars" not in w5 and "record bars" not in w5
    assert "display_visual(that window_s3_url" not in p
    assert "its sector code is never a cause" in p and "Carbon Mapper's estimate" in p
    names = [getattr(t, "__name__", "") for t in methane_hunter.LOCAL_TOOLS]
    assert "carbon_mapper_plumes" in names and names.index("follow_site") > names.index("carbon_mapper_plumes")


# --- replay cases (scenario_id) -------------------------------------------------------------------

_CASE = {
    "name": "Permian Basin methane, 2024", "location": "Permian Basin", "dates": {"window": "2024-01-01/2024-12-31"},
    "analysis": {}, "narrative": "The strongest plume ... peaked at 8,130.7 ppm·m. EMIT sees the methane, not its source.",
    "s3_prefix": "s3://b/use-cases/methane-permian-2024/", "assets": {"geometry_url": "s3://b/use-cases/methane-permian-2024/geometry.geojson"},
    "config": {"assets": {"layers": [{"file": "ch4plm_x.tif", "title": "Plume"}]}},
}


def test_replay_case_extends_the_prompt_and_forbids_the_live_workflow(entry, monkeypatch):
    import utils.scenario_loader as loader
    asked = []
    monkeypatch.setattr(loader, "load_scenario", lambda sid: asked.append(sid) or _CASE)
    p = entry.system_prompt_for({"prompt": "why that one?", "scenario_id": "methane-permian-2024"})
    assert asked == ["methane-permian-2024"]
    assert p.startswith(entry.methane_config.build_prompt()[:200])
    assert "SCENARIO MODE ACTIVE: Permian Basin methane, 2024" in p and "8,130.7 ppm·m" in p
    assert "search_methane_plumes, triage_plumes" in p and "s3://b/use-cases/methane-permian-2024/ch4plm_x.tif" in p
    assert "burned" not in p.lower()


def test_no_or_bad_scenario_id_is_the_live_prompt(entry, monkeypatch):
    import utils.scenario_loader as loader
    monkeypatch.setattr(loader, "load_scenario", lambda sid: pytest.fail("should not load"))
    live = entry.methane_config.build_prompt()
    for payload in ({"prompt": "x"}, {"prompt": "x", "scenario_id": "../sessions"}, {"scenario_id": 7}, None):
        assert entry.system_prompt_for(payload)[:300] == live[:300]
    monkeypatch.setattr(loader, "load_scenario", lambda sid: None)
    assert "SCENARIO MODE" not in entry.system_prompt_for({"scenario_id": "missing-case"})
