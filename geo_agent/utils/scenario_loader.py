"""
Scenario Loader - Loads pre-configured use cases from S3
"""
import json
import boto3
import logging
from typing import Dict, Optional
import config

logger = logging.getLogger(__name__)

s3_client = boto3.client('s3', region_name=config.AWS_REGION)


def load_scenario(scenario_id: str) -> Optional[Dict]:
    """
    Load a pre-configured scenario from S3.

    Args:
        scenario_id: The scenario identifier (e.g., 'la-fires-2025')

    Returns:
        Dict with scenario metadata, asset URLs, and narrative
        Returns None if scenario not found

    Expected S3 structure:
        s3://bucket/use-cases/{scenario_id}/
            ├── config.json
            ├── geometry.geojson
            ├── before/
            ├── after/
            ├── analysis.json
            └── narrative.md
    """
    bucket = config.S3_BUCKET_NAME
    scenario_prefix = f"use-cases/{scenario_id}/"

    logger.info(f"Loading scenario: {scenario_id} from {bucket}/{scenario_prefix}")

    try:
        # Load config.json
        config_key = f"{scenario_prefix}config.json"
        config_obj = s3_client.get_object(Bucket=bucket, Key=config_key)
        scenario_config = json.loads(config_obj['Body'].read().decode('utf-8'))

        # Load narrative.md
        narrative_key = f"{scenario_prefix}narrative.md"
        try:
            narrative_obj = s3_client.get_object(Bucket=bucket, Key=narrative_key)
            narrative = narrative_obj['Body'].read().decode('utf-8')
        except s3_client.exceptions.NoSuchKey:
            logger.warning(f"No narrative.md found for {scenario_id}")
            narrative = ""

        # Load analysis.json (pre-computed metrics)
        analysis_key = f"{scenario_prefix}analysis.json"
        try:
            analysis_obj = s3_client.get_object(Bucket=bucket, Key=analysis_key)
            analysis = json.loads(analysis_obj['Body'].read().decode('utf-8'))
        except s3_client.exceptions.NoSuchKey:
            logger.warning(f"No analysis.json found for {scenario_id}")
            analysis = {}

        # Build asset URLs
        assets = {
            "geometry_url": f"s3://{bucket}/{scenario_prefix}geometry.geojson",
            "before": {
                "tci": f"s3://{bucket}/{scenario_prefix}before/tci.tif",
                "red": f"s3://{bucket}/{scenario_prefix}before/red.tif",
                "nir08": f"s3://{bucket}/{scenario_prefix}before/nir08.tif",
                "swir2": f"s3://{bucket}/{scenario_prefix}before/swir2.tif",
                "nbr": f"s3://{bucket}/{scenario_prefix}before/nbr.tif",
            },
            "after": {
                "tci": f"s3://{bucket}/{scenario_prefix}after/tci.tif",
                "red": f"s3://{bucket}/{scenario_prefix}after/red.tif",
                "nir08": f"s3://{bucket}/{scenario_prefix}after/nir08.tif",
                "swir2": f"s3://{bucket}/{scenario_prefix}after/swir2.tif",
                "nbr": f"s3://{bucket}/{scenario_prefix}after/nbr.tif",
            }
        }

        # Construct full scenario object
        scenario = {
            "id": scenario_id,
            "name": scenario_config.get("name", scenario_id),
            "description": scenario_config.get("description", ""),
            "location": scenario_config.get("location", ""),
            "dates": scenario_config.get("dates", {}),
            "s3_prefix": f"s3://{bucket}/{scenario_prefix}",
            "assets": assets,
            "analysis": analysis,
            "narrative": narrative,
            "config": scenario_config
        }

        logger.info(f"✅ Scenario loaded: {scenario['name']}")
        return scenario

    except s3_client.exceptions.NoSuchKey as e:
        logger.error(f"❌ Scenario not found: {scenario_id} - Missing {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Error loading scenario {scenario_id}: {e}")
        return None


def build_scenario_context(scenario: Dict) -> str:
    """
    Build system prompt context for a loaded scenario.

    Args:
        scenario: Scenario dict from load_scenario()

    Returns:
        String to append to system prompt
    """

    # Agent-neutral: every act's replay case uses this (the Earth Analyst's before/after cases and
    # the Methane Hunter's layer-list case). Case-specific facts come from the case's own files.
    dates = scenario.get('dates') or {}
    dates_text = "\n".join(f"  - {k.replace('_', ' ').capitalize()}: {v}" for k, v in dates.items()) or "  - N/A"
    layers = ((scenario.get('config') or {}).get('assets') or {}).get('layers') or []
    if layers:
        asset_lines = "\n".join(
            f"   - {layer.get('title', layer.get('file'))}: `{scenario['s3_prefix']}{layer.get('file')}`"
            for layer in layers if isinstance(layer, dict) and layer.get('file')
        )
    else:
        asset_lines = (
            f"   - Geometry: `{scenario['assets']['geometry_url']}`\n"
            f"   - Before imagery: TCI, Red, NIR08, SWIR2, index at `{scenario['s3_prefix']}before/`\n"
            f"   - After imagery: TCI, Red, NIR08, SWIR2, index at `{scenario['s3_prefix']}after/`"
        )

    assets_summary = f"""

═══════════════════════════════════════════════════════════
SCENARIO MODE ACTIVE: {scenario['name']}
═══════════════════════════════════════════════════════════

**CRITICAL**: This is a PRE-LOADED replay case. The analysis is already done and on the map.

**Location**: {scenario['location']}
**Dates**:
{dates_text}

**PRE-COMPUTED ANALYSIS**:
{json.dumps(scenario['analysis'], indent=2) if scenario['analysis'] else 'None (use the recorded answer below)'}

**The recorded answer** (what the room has already seen):
{scenario['narrative']}

**SCENARIO MODE INSTRUCTIONS** (FOLLOW THESE):

1. Answer from the recorded answer and the analysis above: the place, the dates and the key
   figures exactly as they appear there. Never add a figure that is not in them.

2. DO NOT re-run the live workflow (the data may be unreachable, and the result is recorded):
   - no geocoding or boundary lookups (find_address_candidates, find_location_boundary)
   - no new imagery or data searches (get_rasters, search_methane_plumes, triage_plumes)
   - You CAN call display_visual() to show a pre-loaded asset again if asked

3. **Pre-loaded assets** (display ONLY if the user asks):
{asset_lines}

4. For follow-up questions, keep referencing the recorded answer, keep its caveats and
   confidence statements, and end the way the agent's own rules say (its closing paragraph).

**This is a pre-analyzed case, NOT a new analysis request.**

═══════════════════════════════════════════════════════════
"""

    return assets_summary


def list_available_scenarios(bucket: str = None) -> list:
    """
    List all available scenarios in S3.

    Args:
        bucket: S3 bucket name (defaults to config.S3_BUCKET_NAME)

    Returns:
        List of scenario IDs
    """
    if bucket is None:
        bucket = config.S3_BUCKET_NAME

    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix="use-cases/",
            Delimiter="/"
        )

        scenarios = []
        if 'CommonPrefixes' in response:
            for prefix in response['CommonPrefixes']:
                # Extract scenario ID from prefix
                # e.g., "use-cases/la-fires-2025/" → "la-fires-2025"
                scenario_id = prefix['Prefix'].replace('use-cases/', '').rstrip('/')
                scenarios.append(scenario_id)

        logger.info(f"Found {len(scenarios)} scenarios: {scenarios}")
        return scenarios

    except Exception as e:
        logger.error(f"Error listing scenarios: {e}")
        return []
