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
