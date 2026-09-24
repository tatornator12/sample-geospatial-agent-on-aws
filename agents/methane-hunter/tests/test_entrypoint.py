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
    assert methane_config.CONFIDENCE_SENTENCE in p
    assert "Current date is 2026-10-06" in p
    assert "render" in p and "never name an emitter" in p.lower()
    assert "ppm·m" in p
