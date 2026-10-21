"""The entrypoint's contract with the UI (pre-warm short-circuits before any model work), the tool
surface (the act's tools and the platform's eyes, no open search, no MCP), and the prompt's fixed
sentences. The runtime-only frameworks are stubbed."""
import asyncio
import importlib
import re
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
        "strands.types": {},
        "strands.types.content": {"SystemContentBlock": dict},
        "strands.agent": {},
        "strands.agent.conversation_manager": {"SlidingWindowConversationManager": _Explodes},
        "strands.session": {},
        "strands.session.s3_session_manager": {"S3SessionManager": _Explodes},
    }.items():
        monkeypatch.setitem(sys.modules, name, _stub(name, **attrs))
    sys.modules.pop("dark_vessels", None)
    return importlib.import_module("dark_vessels")


def _collect(agen):
    async def run():
        return [chunk async for chunk in agen]
    return asyncio.run(run())


def test_prewarm_yields_warm_and_builds_nothing(entry):
    assert _collect(entry.dark_vessels_agent({"prewarm": True}, types.SimpleNamespace(session_id="s" * 33))) == ["warm"]


def test_prewarm_begins_no_turn(entry, monkeypatch):
    monkeypatch.setattr(entry.vs, "_turn", {"turn_id": None, "prompt": ""})
    _collect(entry.dark_vessels_agent({"prewarm": True}, types.SimpleNamespace(session_id="s" * 33)))
    assert entry.vs.current_turn() is None


def test_the_turn_begins_with_the_presenters_words_before_the_model_streams(entry, monkeypatch):
    """vs.begin_turn runs before stream_async, so decide's `asked` sees this turn's words and a
    question opened in an earlier turn is closed."""
    monkeypatch.setattr(entry.vs, "_turn", {"turn_id": "0123456789ab", "prompt": "an earlier turn"})
    seen = {}

    class Agent:
        def __init__(self, *a, **k):
            pass

        async def stream_async(self, prompt):
            seen.update(turn=entry.vs.current_turn(), prompt=entry.vs.turn_prompt(), asked=prompt)
            yield {"data": "ok"}

    monkeypatch.setattr(entry, "Agent", Agent)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    words = "Same question, end of August"
    out = _collect(entry.dark_vessels_agent({"prompt": words}, types.SimpleNamespace(session_id="s" * 33)))
    assert out == ["ok"]
    assert seen["prompt"] == seen["asked"] == words
    assert re.fullmatch(r"[0-9a-f]{12}", seen["turn"]) and seen["turn"] != "0123456789ab"


def test_the_tool_surface_is_the_act_and_the_platforms_eyes(entry):
    names = [t.__name__ for t in entry.LOCAL_TOOLS]
    assert names[:7] == ["list_passes", "decide", "find_pass", "detect_vessels", "check_ais_coverage", "match_ais",
                         "gather_evidence"]
    assert {"reachable_area", "predict_hotspots", "fleet_pattern", "next_look", "draft_tasking", "tasking_status",
            "display_visual", "inspect_image"} <= set(names)
    for open_search in ("get_rasters", "create_bbox_from_coordinates", "find_similar_places", "scan_region_change",
                        "find_location_boundary", "bbox_around_point"):
        assert open_search not in names
    assert not hasattr(entry, "mcp_client")


def test_prompt_carries_the_fixed_sentences_and_the_wording_rules():
    import vessels_config as c
    p = c.build_prompt("2026-10-16")
    assert "Current date is 2026-10-16" in p
    for sentence in (c.ON_FILE_ONLY, c.CANDIDATE_SENTENCE, c.CANNOT_SAY, c.OFFICERS_DECISION, c.NO_ACCUSE,
                     c.NO_IDENTITY, c.FLEET_NOT_FLAG, c.CLOSER):
        assert sentence in p
    assert c.ON_FILE_ONLY == "I only investigate passes on file."
    assert c.CANDIDATE_SENTENCE == "A candidate is a radar target with no broadcast nearby; it is not an accusation."
    assert "No em dashes" in p and "—" not in p
    assert "four turns" in p and "Has a vessel gone silent near here?" in p
    # The room's words for coverage (R4.3): the retired ones cannot come back through the prompt.
    assert not re.search(r"heard water|\bunproven\b|not evidence|could be heard|\bheard\b|best bet", p, re.I)
    assert "AIS received" in p and "AIS reception unknown" in p and c.vs.SAY_ELSE in p


_CASE = {
    "name": "Galápagos, Oct 12 2026", "location": "Galápagos Marine Reserve", "dates": {}, "analysis": {},
    "narrative": "Four candidates in heard water.", "s3_prefix": "s3://b/use-cases/vessels-s1d-20261012t0018/",
    "assets": {}, "config": {"assets": {"layers": [{"file": "radar_s1d-20261012t0018.tif", "title": "Radar"}]}},
}


def test_replay_case_extends_the_prompt(entry, monkeypatch):
    import utils.scenario_loader as loader
    monkeypatch.setattr(loader, "load_scenario", lambda sid: _CASE)
    p = entry.system_prompt_for({"prompt": "which is closest to port?", "scenario_id": "vessels-s1d-20261012t0018"})
    assert p.startswith(entry.vessels_config.build_prompt()[:200]) and "SCENARIO MODE ACTIVE: Galápagos, Oct 12 2026" in p


def test_no_or_bad_scenario_id_is_the_live_prompt(entry, monkeypatch):
    import utils.scenario_loader as loader
    monkeypatch.setattr(loader, "load_scenario", lambda sid: pytest.fail("should not load"))
    live = entry.vessels_config.build_prompt()
    for payload in ({"prompt": "x"}, {"prompt": "x", "scenario_id": "../sessions"}, {"scenario_id": 7}, None):
        assert entry.system_prompt_for(payload)[:300] == live[:300]
