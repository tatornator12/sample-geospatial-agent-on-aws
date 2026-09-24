# Requirements: methane-hunter (Week 4, Oct 6–17)

## Introduction

Act 2 is the show's second agent and its first new runtime: "It senses the invisible and triages
at scale." The Methane Hunter finds methane plume complexes detected by NASA's EMIT imaging
spectrometer, ranks them by how much methane they carry, puts the strongest on the map in the
colour the science uses, looks at it with the same eyes the Earth Analyst has, shows what is on
the ground underneath in Sentinel-2 true colour, and says plainly what it can and cannot confirm.

The data is proven (`docs/spikes/emit.md`, PROVEN in three minutes): the EMIT L2B CH4PLM
collection is 1,686 plume-complex granules discoverable through the public CMR search (footprint
polygons and direct GeoTIFF links, no auth), each plume a ~19 KB Cloud-Optimized GeoTIFF of CH4
enhancement in ppm·m behind an Earthdata bearer token, renderable through our TiTiler with the
plasma colormap once staged in our bucket. Everything the act needs is kilobytes and seconds.

This spec also does the platform work the roadmap has deferred until a second agent existed: a
second runtime in the switcher end to end (deploy, eval, promote, backend, frontend, IAM), the
`render` hint on `display_visual` so agents describe how their layers should look instead of the
UI guessing from file names, per-agent prepared prompts, and a replay case that is not shaped
like a fire.

Scope boundaries: no methane source attribution (EMIT detects enhancement; naming an emitter is
out of scope and the agent says so); no Carbon Mapper or VISIONS data; no Ground Motion Sentinel
(first on the cut list, kept as the documented alternative); no changes to Earth Analyst
behaviour beyond the shared `render` hint; no big-screen mode; no legend or opacity work outside
the methane and similarity groups.

## Requirements

### Requirement 1: A second agent runtime, built the platform way

**User Story:** As the builder, I want the Methane Hunter to be its own runtime under
`agents/methane-hunter/` that reuses the platform's shared code without touching the Earth
Analyst, so that Act 2 cannot break Act 1 and the next two agents follow the same path.

#### Acceptance Criteria

1. WHEN `agents/methane-hunter/` is built THEN it SHALL contain its own entrypoint
   (`methane_hunter.py`, a `BedrockAgentCoreApp` with the same `{"prewarm": true}` short-circuit,
   S3 session manager, sliding-window conversation manager and tool-call streaming protocol as
   `geo_agent/geospatial_agent_on_aws.py`), its own `config.py` prompt, its own `tools.py`, its
   own `Dockerfile`, `requirements.txt`, `.env.example`, `deploy.sh`, `golden_prompts.json` and
   `tests/`.
2. WHEN the agent needs shared platform code (`display_visual`, `inspect_image`,
   `create_bbox_from_coordinates`, `get_rasters`, the S3 and raster helpers, the ArcGIS MCP
   client factory) THEN it SHALL import it from a staged copy of `geo_agent/utils/`,
   `geo_agent/config.py` and `geo_agent/data/` placed inside the agent directory by `deploy.sh`
   before the image builds (gitignored, never edited by hand), and a unit test SHALL fail if
   the staging allowlist and the imports drift apart.
3. WHEN `deploy.sh` runs THEN it SHALL require `DEPLOY_TARGET=stable|dev` exactly like
   `geo_agent/deploy.sh` (runtime names `methane_hunter` and `methane_hunter_dev`, env files
   `.env` and `.env.dev`, `CONFIRM_STABLE=yes` for stable, `DRY_RUN=1` printing with secrets
   redacted), by generalising `geo_agent/deploy_lib.sh` to take the agent's names rather than
   hardcoding the Earth Analyst's.
4. WHEN the runtime starts THEN it SHALL read `EARTHDATA_TOKEN` from its environment (never
   from code or the repo), SHALL never log or echo it, and WHEN the token is missing or LP DAAC
   answers 401 THEN plume search SHALL still work (CMR is public) and triage SHALL return a JSON
   error naming the token as the cause, with the turn continuing.
5. WHEN `scripts/eval.py` and `scripts/promote.sh` run for this agent THEN they SHALL accept an
   `--agent methane` selection that maps to the agent's `.bedrock_agentcore.yaml` and
   `golden_prompts.json`, and `promote.sh` SHALL promote both agents' runtimes in one gated run
   (Earth Analyst first, Methane Hunter second, one tag), with the frontend env check requiring a
   `methane` entry in `AGENT_RUNTIMES`.

### Requirement 2: Find plumes

**User Story:** As the presenter, I want to name a region and a time window and see every methane
plume EMIT detected there, so that the room sees a sensor finding what no eye can.

#### Acceptance Criteria

1. WHEN the agent calls `search_methane_plumes(region, start_date?, end_date?, bbox?,
   max_results?)` THEN the tool SHALL query the CMR granule search for `EMITL2BCH4PLM` with a
   bounding box (from a named region's geometry bounds, or an explicit `bbox`) and a temporal
   range (default: the last 90 days ending today), paging until `max_results` (default 50, max
   200) or the end, and SHALL return each plume's granule id, acquisition time, footprint
   centroid, footprint polygon and its protected GeoTIFF URL.
2. WHEN the search completes THEN the tool SHALL write one GeoJSON FeatureCollection of the
   footprints (properties: `granule_id`, `acquired`, `tier: "detected"`) to
   `s3://<bucket>/session_data/<sid>/methane/plumes_<region-slug>_<start>_<end>.geojson`, return
   its URL as `plumes_geometry_s3_url`, and report `summary` (count found, count returned, window,
   CMR hits, seconds).
3. WHEN CMR returns zero granules THEN the tool SHALL return a JSON result with `count: 0` and a
   sentence the agent can say ("EMIT recorded no plume complexes over <region> between <start>
   and <end>"), never an error.
4. WHEN CMR is unreachable or answers non-200 THEN the tool SHALL return a JSON error with the
   status and the turn SHALL continue.

### Requirement 3: Triage at scale

**User Story:** As the presenter, I want the agent to rank the plumes by how much methane they
carry and show the ranking on the map, so that "triage" is a measured list, not a guess.

#### Acceptance Criteria

1. WHEN the agent calls `triage_plumes(plumes_geometry_s3_url, top_n?)` THEN the tool SHALL
   download every listed plume's GeoTIFF from LP DAAC with the Earthdata token in parallel (at
   most 8 at a time, 20 s timeout each, 5 MB size cap, at most 200 plumes per call), compute per
   plume from the valid pixels: `max_ppm_m`, `mean_ppm_m`, `plume_pixels`, `plume_area_km2`
   (pixel size read from the raster), and stage each GeoTIFF unchanged to
   `s3://<bucket>/session_data/<sid>/methane/ch4plm_<granule-id>.tif`.
2. WHEN stats exist THEN the tool SHALL rank plumes by `max_ppm_m` descending with ties broken
   by `plume_pixels` then `granule_id` (deterministic), return the top `top_n` (default 10, max
   50) as `ranked[]` with `rank`, the stats, `acquired`, `center_lat/lon`, `bbox` and
   `plume_s3_url`, and SHALL write the footprints GeoJSON again with `rank`, `max_ppm_m`,
   `plume_area_km2` and `tier: "ranked"|"detected"` as
   `.../methane/plumes_ranked_<region-slug>_<start>_<end>.geojson`, returning it as
   `ranked_geometry_s3_url`.
3. WHEN some downloads fail THEN the tool SHALL rank the ones that succeeded and list failures
   in `summary.errors` (granule id + reason, never the token); WHEN all fail THEN it SHALL return
   a JSON error.
4. WHEN triage of 30 plumes runs warm THEN it SHALL complete in under 20 s, measured and
   recorded in `tasks.md`.

### Requirement 4: See the plume, and the ground beneath it

**User Story:** As the audience, I want to see the strongest plume in the colour scientists use,
the agent looking at it, and the true-colour ground beneath it, so that the invisible becomes
evidence.

#### Acceptance Criteria

1. WHEN the agent calls `display_visual(plume_s3_url, title, description, render)` with
   `render = {"kind": "raster", "colormap": "plasma", "rescale": [0, 1500], "units": "ppm·m",
   "group": "methane", "legend": "CH4 enhancement"}` THEN the map SHALL render the plume through
   TiTiler with that colormap and range, nodata transparent, in a layers-plate group "Methane"
   placed directly after "Change detection", with a one-row legend showing the ramp, the units and
   the range ends in the mono face (≥ 15 px).
2. WHEN `render` is absent on a `display_visual` THEN the map SHALL behave exactly as today
   (colormap chosen from the file name), so the Earth Analyst is unchanged.
3. WHEN the agent calls `display_visual(ranked_geometry_s3_url, …, render={"kind": "vector",
   "property": "max_ppm_m", "ramp": "plasma", "group": "methane", "label": "rank"})` THEN
   footprints SHALL be drawn as outlines graduated by `max_ppm_m` with the rank at each
   footprint's centre (24 px mono, halo), `tier: "detected"` footprints as thin neutral outlines,
   and a click on a ranked footprint SHALL open a popup with rank, `max_ppm_m`, area and
   acquisition time in the mono face (numbers only, nothing model-written).
4. WHEN the agent calls `inspect_image(plume_s3_url, title)` THEN the preview SHALL be rendered
   with the same plasma ramp and range the map uses (an `INDEX_STYLES` entry keyed on
   `ch4plm`), so the agent and the room see the same picture.
5. WHEN the prompt directs the agent after triage THEN it SHALL: display the ranked footprints;
   for the top plume, display its raster, `inspect_image` it and say one sentence about the
   plume's shape and extent; `create_bbox_from_coordinates` at the plume centre
   (`radius_meters=3000`), `get_rasters`, `inspect_image` the Sentinel-2 true colour, and say one
   sentence about what is on the ground (well pads, tanks, roads, fields) without naming an
   operator; `reverse_geocode` the centre so the place is named before its coordinates.
6. WHEN the agent reports THEN it SHALL follow the two-part format (compact table: rank,
   acquired, max ppm·m, area km², place; then one plain 1–2 sentence closer) and the closer SHALL
   include the confidence sentence the prompt provides verbatim: "EMIT detects methane
   enhancement above background; it does not identify the source, and I cannot confirm an
   emitter from this data alone."

### Requirement 5: The UI knows two agents

**User Story:** As the presenter, I want to switch to the Methane Hunter and find its own
prepared prompts and replay case, so that Act 2 starts from the same shell as Act 1.

#### Acceptance Criteria

1. WHEN `AGENT_RUNTIMES` carries a `methane` entry (label "Methane Hunter", description "EMIT
   methane plumes: find, rank, inspect") THEN the switcher SHALL list it, the backend SHALL route
   prewarm, invoke and stop-session to its ARN, and the frontend-cdk task role SHALL be granted
   `InvokeAgentRuntime`/`StopRuntimeSession` on that ARN only.
2. WHEN the selected agent changes THEN the prepared prompts SHALL change with it: the Earth
   Analyst keeps its five; the Methane Hunter shows "Plumes over the Permian Basin", "Triage the
   plumes", "Show the strongest plume" (the exact prompts in the design), keyed by agent id in
   one frontend map with the Earth Analyst as the fallback for unknown ids.
3. WHEN the replay-case gallery lists the methane case THEN its card SHALL navigate with
   `?scenario=<id>&agent=methane` so the right runtime is selected on load.
4. WHEN `npm run design:check` runs THEN the detector SHALL report 0 findings; the methane legend
   and popup SHALL follow DESIGN.md (scientific palette not restyled to the accent, Back Row
   rule, tabular mono for every number), recorded in DESIGN.md next to the similarity ramp.

### Requirement 6: An offline replay case

**User Story:** As the presenter, I want Act 2 to load a finished Permian Basin triage with no
live calls, so that a CMR or LP DAAC outage on Nov 9 costs nothing.

#### Acceptance Criteria

1. WHEN `use-cases/methane-permian-2025/` is staged to S3 THEN it SHALL contain `config.json`
   (name, description, location, `user_question`, `agent: "methane"`, `tool_calls` naming the
   three methane tools with their real params and results, and an `assets.layers[]` list of
   `{s3_url, title, render}` entries), `geometry.geojson` (the ranked footprints), the top
   plume's staged GeoTIFF and its Sentinel-2 true-colour context, and `narrative.md`.
2. WHEN the backend serves `/api/scenario/methane-permian-2025` THEN it SHALL return
   `assets.layers[]` as listed in `config.json` (in addition to the existing before/after fields,
   which stay for the fire and drought cases), and the frontend SHALL load every listed layer
   with its `render` hint, so the methane case renders without a fire-shaped asset scheme.
3. WHEN the methane replay case loads THEN no request SHALL leave for CMR or LP DAAC (verified
   by the tool-call list being replayed from `config.json` and the layers coming from S3 through
   presigned TiTiler tiles), and the case SHALL load in under 10 s on the CloudFront URL.

### Requirement 7: Tests and gate G3

**User Story:** As the builder, I want the Methane Hunter verified offline and Release 2 promoted
by the script, so that G3 on Oct 17 is mechanical and Acts 1–2 can be timed together.

#### Acceptance Criteria

1. WHEN `pytest` runs in `agents/methane-hunter/` THEN tests SHALL cover, with CMR and LP DAAC
   patched (recorded fixtures, no network): CMR paging, bbox and temporal query construction, the
   zero-result and non-200 paths, footprint GeoJSON shape; triage stats on a synthetic 222×221
   float32 plume COG with known values (max, mean, pixel count, area), deterministic ranking with
   ties, partial and total download failure, the token-missing error, the size cap and per-call
   limit, the staged key naming; the staging allowlist test from 1.2; and the streaming
   entrypoint's prewarm short-circuit.
2. WHEN `npm test` runs THEN vitest SHALL cover `render` hint parsing and validation (allowlisted
   colormaps and groups, finite rescale numbers, rejected junk), tile-URL construction from a
   hint, the methane layer grouping, per-agent prepared prompts, and `assets.layers[]` handling in
   the scenario loader.
3. WHEN `scripts/eval.py --agent methane --target dev` runs THEN three golden prompts SHALL pass:
   `plumes-permian` (`["search_methane_plumes", "display_visual"]`), `triage-permian`
   (`["search_methane_plumes", "triage_plumes", "display_visual"]`), `strongest-plume`
   (`["triage_plumes", "display_visual", "inspect_image", "get_rasters", "inspect_image"]`), no
   `Error:`; and the Earth Analyst's eight SHALL still pass.
4. WHEN the Friday gate (Oct 17) runs THEN `pytest -q` in both agents, `npm test`,
   `npm run design:check`, both evals and a headless UI round-trip on the methane replay case
   SHALL pass; `PROMOTE_FRONTEND=1 scripts/promote.sh` SHALL deploy both stable runtimes and the
   UI under tag `deployed-2026-10-17`; both stable runtimes SHALL pass one smoke invoke and one
   golden prompt each.
5. WHEN Acts 1 and 2 are rehearsed back to back THEN the two run sheets SHALL be performed
   twice against stable and timed (Act 1 target 7:00, Act 2 target 7:00, ± 0:30 each), both
   timings recorded in the gate log, with the Act 2 fallback (drop the ground-truth Sentinel-2
   beat) named if exceeded.
