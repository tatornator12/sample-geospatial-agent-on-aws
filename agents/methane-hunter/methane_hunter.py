"""
Methane Hunter - Act 2 agent on Amazon Bedrock AgentCore.

Finds EMIT methane plume complexes, ranks them by enhancement, shows the strongest and the
ground beneath it. Same runtime contract as the Earth Analyst (geo_agent/geospatial_agent_on_aws.py):
the {"prewarm": true} short-circuit, S3 session persistence, a sliding conversation window, the
ArcGIS MCP geocoder when reachable, and the tool-call streaming format the UI parses.
"""
import contextlib
import logging
import os
import re

import _paths  # noqa: F401  (shared platform code on sys.path first)

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logging.getLogger("utils").setLevel(logging.INFO)
logging.getLogger("methane_tools").setLevel(logging.INFO)

from strands.telemetry import StrandsTelemetry  # noqa: E402
from bedrock_agentcore.runtime import BedrockAgentCoreApp  # noqa: E402
from strands import Agent  # noqa: E402
from strands.models import BedrockModel  # noqa: E402
from strands.tools.mcp import MCPClient  # noqa: E402
from strands.types.content import SystemContentBlock  # noqa: E402
from mcp.client.streamable_http import streamablehttp_client  # noqa: E402
from strands.agent.conversation_manager import SlidingWindowConversationManager  # noqa: E402
from strands.session.s3_session_manager import S3SessionManager  # noqa: E402

from utils.mcp_http import charset_safe_httpx_client_factory  # noqa: E402
from utils.tools import (  # noqa: E402
    create_bbox_from_coordinates,
    display_visual,
    find_location_boundary,
    get_rasters,
    inspect_image,
)

import methane_config  # noqa: E402
from methane_tools import search_methane_plumes, show_plume, triage_plumes  # noqa: E402

app = BedrockAgentCoreApp()

bedrock_model = BedrockModel(**methane_config.model_kwargs())
logger.info(f"Model: {methane_config.model_kwargs()}")

mcp_client = MCPClient(
    lambda: streamablehttp_client(
        url=methane_config.ARCGIS_MCP_URL,
        headers={"Authorization": f"Bearer {methane_config.ARCGIS_MCP_TOKEN}"},
        httpx_client_factory=charset_safe_httpx_client_factory,
    ),
    # Only geocoding: the Methane Hunter names places, it does not search portals.
    tool_filters={"allowed": ["find_address_candidates", "reverse_geocode"]},
)

LOCAL_TOOLS = [
    search_methane_plumes,
    triage_plumes,
    show_plume,
    display_visual,
    inspect_image,
    create_bbox_from_coordinates,
    get_rasters,
    find_location_boundary,
]


def is_prewarm(payload) -> bool:
    """The UI (and scripts/prewarm.py) warm a fresh session with {"prewarm": true}."""
    return bool(isinstance(payload, dict) and payload.get("prewarm"))


SCENARIO_ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")


def system_prompt_for(payload) -> str:
    """The Methane Hunter's prompt; for a replay case (`scenario_id`), plus the recorded case, so
    follow-ups answer from the recording instead of calling CMR / LP DAAC (the point of a replay
    case is that those may be down). An unknown or malformed id falls back to the live prompt."""
    prompt = methane_config.build_prompt()
    scenario_id = payload.get("scenario_id") if isinstance(payload, dict) else None
    if not scenario_id:
        return prompt
    if not isinstance(scenario_id, str) or not SCENARIO_ID_RE.match(scenario_id):
        logger.warning("⚠️ ignoring a malformed scenario_id")
        return prompt
    from utils.scenario_loader import build_scenario_context, load_scenario
    scenario = load_scenario(scenario_id)
    if not scenario:
        logger.warning(f"⚠️ Scenario {scenario_id} not found, continuing in live mode")
        return prompt
    logger.info(f"✅ Replay case loaded: {scenario['name']}")
    return prompt + build_scenario_context(scenario)


@app.entrypoint
async def methane_hunter_agent(payload, context=None):
    """Agent entrypoint with streaming and S3-backed session memory."""
    session_id = getattr(context, "session_id", None) or "default_session"
    user_id = getattr(context, "user_id", None) or payload.get("user_id", "anonymous")
    os.environ["AGENT_SESSION_ID"] = session_id
    os.environ["AGENT_USER_ID"] = user_id
    logger.info(f"📊 Session ID: {session_id}, User ID: {user_id}")

    # Reaching this line means the microVM booted and the geo stack imported (the cold-start
    # cost). No model call and nothing written to the session history.
    if is_prewarm(payload):
        logger.info("🔥 prewarm: runtime is up for this session")
        yield "warm"
        return

    from utils.langfuse_setup import setup_langfuse_env_vars
    setup_langfuse_env_vars()
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        strands_telemetry = StrandsTelemetry()
        strands_telemetry.setup_otlp_exporter()
        strands_telemetry.setup_meter(enable_console_exporter=False, enable_otlp_exporter=True)

    try:
        with contextlib.ExitStack() as stack:
            # Geocoding is additive: when the MCP server is unreachable the turn runs with the
            # local tools and the prompt tells the agent to say places are unverified.
            mcp_tools = []
            try:
                stack.enter_context(mcp_client)
                mcp_tools = mcp_client.list_tools_sync()
            except Exception as mcp_error:
                logger.warning(f"⚠️ ArcGIS MCP unavailable, continuing with local tools only: {mcp_error}")

            try:
                session_manager = S3SessionManager(
                    session_id=session_id,
                    bucket=methane_config.S3_BUCKET_NAME,
                    prefix="sessions",
                )
            except Exception as e:
                logger.warning(f"⚠️ S3 session manager unavailable, continuing without it: {e}")
                session_manager = None

            agent = Agent(
                tools=mcp_tools + LOCAL_TOOLS,
                model=bedrock_model,
                system_prompt=[
                    SystemContentBlock(text=system_prompt_for(payload)),
                    SystemContentBlock(cachePoint={"type": "default"}),
                ],
                record_direct_tool_call=True,
                conversation_manager=SlidingWindowConversationManager(
                    window_size=3,
                    should_truncate_results=True,
                ),
                session_manager=session_manager,
                trace_attributes={
                    "session.id": session_id,
                    "user.id": user_id,
                    "langfuse.tags": ["agentcore", "strands", "methane-hunter"],
                },
            )

            sent_tool_uses = {}
            open_tools = set()

            # Same wire format as the Earth Analyst: text chunks as-is; each tool use as
            # {"toolUseId": "...", "name": "...", "input": "<escaped json, streamed>"}.
            async for event in agent.stream_async(payload["prompt"]):
                if "data" in event:
                    for tool_id in list(open_tools):
                        yield '"}'
                        open_tools.remove(tool_id)
                    yield event["data"]

                if "current_tool_use" in event:
                    tool_info = event["current_tool_use"]
                    tool_id = tool_info.get("toolUseId")
                    current_input = tool_info.get("input", "")

                    if tool_id not in sent_tool_uses:
                        for other_tool_id in list(open_tools):
                            if other_tool_id != tool_id:
                                yield '"}'
                                open_tools.remove(other_tool_id)
                        yield f'{{"toolUseId": "{tool_id}", "name": "{tool_info.get("name")}", "input": "'
                        open_tools.add(tool_id)
                        sent_tool_uses[tool_id] = ""
                        if current_input:
                            yield current_input.replace("\\", "\\\\").replace('"', '\\"')
                            sent_tool_uses[tool_id] = current_input
                    elif sent_tool_uses[tool_id] != current_input:
                        previous_input = sent_tool_uses[tool_id]
                        delta = (current_input[len(previous_input):]
                                 if current_input.startswith(previous_input) else current_input)
                        yield delta.replace("\\", "\\\\").replace('"', '\\"')
                        sent_tool_uses[tool_id] = current_input

            for tool_id in list(open_tools):
                yield '"}'
                open_tools.remove(tool_id)

            logger.info("✅ Turn completed - session persisted to S3")

    except Exception as e:
        logger.error(f"Error processing request: {e}", exc_info=True)
        yield f"Error: {str(e)}"


if __name__ == "__main__":
    app.run()
