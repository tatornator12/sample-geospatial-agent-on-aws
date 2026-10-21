"""The entrypoint's contract with the UI (pre-warm short-circuits before any model work), the tool
surface (no tool can place a point the catalogue does not hold), and the prompt's fixed sentences.
The runtime-only frameworks are stubbed."""
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
    captured = {}

    def mcp_client(*a, **k):
        captured.update(k)
        return object()

    for name, attrs in {
        "strands.telemetry": {"StrandsTelemetry": _Explodes},
        "bedrock_agentcore": {},
        "bedrock_agentcore.runtime": {"BedrockAgentCoreApp": _App},
        "strands.models": {"BedrockModel": lambda **k: object()},
        "strands.tools": {},
        "strands.tools.mcp": {"MCPClient": mcp_client},
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
    sys.modules.pop("ai_archaeologist", None)
    mod = importlib.import_module("ai_archaeologist")
    mod._mcp_kwargs = captured
    return mod


def _collect(agen):
    async def run():
        return [chunk async for chunk in agen]
    return asyncio.run(run())


def test_prewarm_yields_warm_and_builds_nothing(entry):
    assert _collect(entry.ai_archaeologist_agent({"prewarm": True}, types.SimpleNamespace(session_id="s" * 33))) == ["warm"]


def test_no_tool_can_place_a_point_outside_the_catalogue(entry):
    names = [t.__name__ for t in entry.LOCAL_TOOLS]
    assert names[:4] == ["find_known_site", "show_terrain", "measure_profile", "find_similar_sites"]
    assert {"display_visual", "inspect_image", "get_rasters"} <= set(names)
    # display_visual is the agent's own, with the session-file check (act4 P0-2).
    assert next(t for t in entry.LOCAL_TOOLS if t.__name__ == "display_visual").__module__ == "display_tools"
    for open_search in ("create_bbox_from_coordinates", "find_similar_places", "scan_region_change",
                        "find_location_boundary", "bbox_around_point"):
        assert open_search not in names
    assert entry._mcp_kwargs["tool_filters"] == {"allowed": ["reverse_geocode"]}


def test_prompt_carries_the_fixed_sentences_and_the_wording_rules():
    import archaeo_config as c
    p = c.build_prompt("2026-10-13")
    assert "Current date is 2026-10-13" in p
    assert c.KNOWN_ONLY == "I only work with sites already on the public record."
    for sentence in (c.KNOWN_ONLY, c.NO_SEARCH, c.NO_DAMAGE, "The sites I show are already on the public record."):
        assert sentence in p
    assert '"discovered"' in p and '"new site"' in p and "No em dashes" in p
    assert "—" not in p


def test_prompt_keeps_the_closing_paragraph_to_one_sentence_and_the_designation():
    # The caption band takes 280 characters; v14 wrote 306 by adding the line's direction and the
    # designation's full name (stage-fixes-2 C1). One sentence <= 150, the designation <= 60.
    import archaeo_config as c
    p = c.build_prompt("2026-10-21")
    assert "at most 150 characters" in p and "at most 60 characters" in p
    assert "Nothing else goes in it" in p
    assert '"It is already on the World Heritage list."' in p
    assert "at most 240 characters" not in p
    assert "\u2014" not in p and "\u2013" not in p
    # Rule 2's fixed refusal closer is untouched.
    assert '(2) the closer, alone and word for word: "The sites I show are already on the public record."' in p


def test_prompt_lets_the_agent_choose_the_line_and_show_only_the_files_it_was_given():
    import archaeo_config as c
    import site_tools
    p = c.build_prompt("2026-10-20")
    # The display check's retry, and the URL passed unchanged (act4 P0-2).
    assert "did_you_mean" in p and "exactly as the tool returned it" in p
    # Workflow B: the record's line when there is one, else the agent's own bearing after a look.
    assert "has_verified_transect" in p and "line_source" in p
    for code in site_tools.BEARINGS:
        assert f'"{code}"' in p
    # No bank on the line is a designed outcome (PRODUCT.md principle 2), in the tool's own words.
    assert site_tools.NO_BANK == "I cannot confirm a bank on this line." and site_tools.NO_BANK in p
    # Workflow C opens on the top match's name, never on "The LiDAR" (act4 P1-5).
    assert "FIRST LINE starts with the top match's name" in p and 'Never open with "The LiDAR"' in p
    assert "\u2014" not in p and "\u2013" not in p


_CASE = {
    "name": "Newark Earthworks", "location": "Newark, Ohio", "dates": {}, "analysis": {},
    "narrative": "The Great Circle measures 363 m across.", "s3_prefix": "s3://b/use-cases/archaeologist-newark/",
    "assets": {}, "config": {"assets": {"layers": [{"file": "lrm_newark-great-circle.tif", "title": "Local relief"}]}},
}


def test_replay_case_extends_the_prompt(entry, monkeypatch):
    import utils.scenario_loader as loader
    monkeypatch.setattr(loader, "load_scenario", lambda sid: _CASE)
    p = entry.system_prompt_for({"prompt": "how deep is the ditch?", "scenario_id": "archaeologist-newark"})
    assert p.startswith(entry.archaeo_config.build_prompt()[:200]) and "SCENARIO MODE ACTIVE: Newark Earthworks" in p


def test_no_or_bad_scenario_id_is_the_live_prompt(entry, monkeypatch):
    import utils.scenario_loader as loader
    monkeypatch.setattr(loader, "load_scenario", lambda sid: pytest.fail("should not load"))
    live = entry.archaeo_config.build_prompt()
    for payload in ({"prompt": "x"}, {"prompt": "x", "scenario_id": "../sessions"}, {"scenario_id": 7}, None):
        assert entry.system_prompt_for(payload)[:300] == live[:300]
