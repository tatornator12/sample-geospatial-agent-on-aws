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

## Act 2 v2: Methane Watch (drafted Sep 25, awaiting approval)

Requirements 1–7 built the Methane Hunter (tasks 1–6 done, Release 2 not yet promoted).
Requirements 8–12 turn Act 2 into an indicators-and-warnings mission on critical energy
infrastructure with the agent's workflow front and centre: one presenter prompt; the agent
plans, tips with a daily sensor (Sentinel-5P TROPOMI), cues the sharp one (EMIT), fills NASA's
post-2024 plume gap itself from EMIT's raw scenes, rejects weak candidates in view, writes a
brief with competing explanations and stated confidence, and stops for a human decision before
filing anything.

Verified premises (Sep 25, read-only public catalogue queries):

- NASA publishes an emission-rate estimate per plume (`EMIT_L2B_CH4PLMMETA_*.json`: rate and
  uncertainty in kg/h, HRRR wind, fetch length, point of peak concentration). 18 of the 39
  Permian 2024 plumes carry one (rank 1: 6,685 ± 202 kg/h at 4.5 m/s).
- The plume product stops after 2024 (600 plumes in 2024, 1 in 2025, 0 in 2026), but EMIT kept
  imaging: 73,106 raw CH4 enhancement scenes in 2025 and 50,321 in 2026, the latest 2026-08-31.
  Each scene is 8–14 MB, 2–5 s to download, with per-pixel uncertainty and sensitivity layers.
  A recurring 2023 site in Turkmenistan (37.48, 61.03) shows ≥ 1,000 ppm·m pixel clusters in 7
  of its 8 passes in 2025–26 (strongest 2026-08-12: peak 3,998 ppm·m, 92 pixels ≥ 1,000).
- Sentinel-5P TROPOMI CH4 is on the Registry of Open Data on AWS as Cloud-Optimized GeoTIFFs
  (`s3://meeo-s5p/COGT/{NRTI,OFFL}/L2__CH4___/`, eu-central-1, public): global daily orbits
  (10285 × 5141, ~3.9 km, overviews), `methane_mixing_ratio` and `qa_value` bands, ~1.5 MB
  each; NRTI current to today, OFFL ~2 days behind. Readable over HTTPS in 3 s; our TiTiler
  reads it directly.
- Coverage by region (EMIT plumes all time / raw scenes 2025–26): Iran 466 / 2,664; China 219 /
  12,261 (Xinjiang 46 / 1,691); southern Russia (< 52°N) 41 / 2,816; Russia 52–60°N 0 / 94;
  Russia north of 60°N (Yamal, Urengoy) 0 / 0; North Korea 0 / 347; Turkmenistan 295 / 890.
  EMIT flies on the ISS and cannot see above ~52°N; TROPOMI can.
- Negative results kept on record: EMIT has no scenes over the Nord Stream area (Sep–Oct 2022);
  no CH4+CO2 co-detections in the Permian (155 CH4 plumes, 1 CO2).

Scope boundaries (in addition to the original ones): no Carbon Mapper data (non-commercial
licence); no operator, owner or intent is ever stated; explanations may be LISTED as
unconfirmed hypotheses from a fixed list; the globe shows counts and rings, never region or
country labels; emission rates are NASA's published estimates with their uncertainty, never
our own; no CO2-equivalent conversions.

### Requirement 8: Plume record and site history

**User Story:** As the analyst persona, I want each plume's full measured record and each
site's history, so that I can tell a one-off from a place that keeps emitting.

#### Acceptance Criteria

1. WHEN `triage_plumes` ranks plumes THEN each ranked plume SHALL carry NASA's metadata fields
   when present: `rate_kg_h`, `rate_uncertainty_kg_h`, `wind_m_s`, `wind_source`,
   `fetch_length_m`, `peak_lat/lon`; absent values SHALL be `null` (never 0), and the
   metadata JSON SHALL be fetched with the plume through the same token, host check, size cap
   (1 MB) and shared cache (`methane/cache/ch4plmmeta_<granule>.json`).
2. WHEN the agent calls `site_history(lat, lon, radius_km=2)` THEN the tool SHALL return every
   NASA plume within the radius (date, peak, rate), the count of EMIT raw scenes that covered
   the point (how often EMIT looked), the first and last look, and the date after which the
   plume product has no coverage, as numbers the agent can say ("looked 27 times, methane on 6").
3. WHEN the agent reports a site THEN it SHALL state how often EMIT looked, not only how often
   it detected, and SHALL say that no detection is not evidence of no emissions.

### Requirement 9: Tip with TROPOMI, cue EMIT, fill the gap

**User Story:** As the presenter, I want the agent to find recent activity itself, so that the
room sees an agent adapt when its first data source runs out.

#### Acceptance Criteria

1. WHEN the agent calls `scan_tropomi(region|bbox, days=14)` THEN the tool SHALL read the
   region's window from the TROPOMI OFFL COGTs on `meeo-s5p` for each day (NRTI for the last 2
   days), keep pixels with `qa_value ≥ 0.5`, composite them (median per pixel), compute the
   anomaly against the region's median (ppb), return the top hotspots (centre, anomaly ppb,
   valid days) and stage the composite as a small COG in `session_data/<sid>/methane/`
   (the browser never reads a third-party bucket).
2. WHEN the agent calls `check_recent_passes(lat, lon, since?, max_scenes=12)` THEN the tool
   SHALL find EMIT raw CH4 enhancement scenes covering the point (default: since the plume
   product's last date), download at most 12 (8 in parallel, 25 MB cap each, shared cache),
   read a 3 km window and the scene's uncertainty layer, and return per pass: date, peak ppm·m,
   pixels ≥ 1,000 ppm·m, pixels whose enhancement exceeds 3× their uncertainty, and a verdict
   `candidate` or `rejected` with the reason. Candidates SHALL be labelled candidates, never
   plumes.
3. WHEN the plume product has no coverage for the requested period THEN the agent SHALL say so
   in one sentence and call `check_recent_passes` without being asked.
4. WHEN a region lies north of EMIT's coverage (~52°N) THEN `check_recent_passes` SHALL return
   `count: 0` with the reason, and the agent SHALL report the TROPOMI signal alone with low
   confidence.

### Requirement 10: The brief and the human decision

**User Story:** As the decision-maker persona, I want a short brief with competing
explanations and stated confidence, and nothing filed until I approve it.

#### Acceptance Criteria

1. WHEN the agent calls `draft_brief(site, findings)` THEN the tool SHALL return a structured
   brief: what was observed (numbers from tool results only), how often EMIT looked, candidate
   explanations chosen from a fixed list (routine venting; equipment failure or leak;
   maintenance blowdown; unlit flare; non-oil-and-gas source such as landfill, coal or
   agriculture; infrastructure damage), each with the evidence that would support or rule it
   out, an overall confidence (low | moderate | high), the gaps, and the recommended next
   collection. The draft SHALL be written to `session_data/<sid>/briefs/<brief_id>.draft.json`.
2. WHEN a brief is drafted THEN the agent SHALL stop and the chat stream SHALL show the brief
   with two controls: "Approve and file" and "Request another look".
3. WHEN the presenter approves THEN the backend (authenticated) SHALL move the draft to
   `briefs/<brief_id>.md` with a map snapshot and tell the agent it was filed; the model SHALL
   have no tool that approves or files a brief itself.
4. WHEN the agent writes about a site THEN it SHALL never state an explanation as fact, never
   name an operator, owner, government or intent, and SHALL end the brief turn with
   "Decision: analyst's." before the spoken closer.

### Requirement 11: Visuals that show the agent working

**User Story:** As the audience, I want to see the planet, the pattern and the plume, so that
the act is memorable from the back of the room.

#### Acceptance Criteria

1. WHEN the mission starts THEN the map SHALL switch to globe projection with the dimmed
   basemap and show all NASA detections as plasma points with rings sized by repeat dates on
   sites seen on ≥ 5 dates, labelled with the count only (`×10`), slowly rotating while the
   agent works and stopping when it answers.
2. WHEN a TROPOMI composite is displayed THEN it SHALL render with a validated `render` hint
   (anomaly ramp, units ppb) under the EMIT layers, with its own legend row.
3. WHEN recent passes are checked THEN each pass SHALL appear as an evidence chip in a
   filmstrip in the step column (candidate chips lit, rejected chips dimmed with the reason).
4. WHEN a candidate or plume is examined THEN the camera SHALL tilt (~55°) and its pixels
   ≥ 500 ppm·m SHALL rise as columns (height ∝ ppm·m, plasma colour) over the Sentinel-2 ground
   scene.
5. WHEN any of these ship THEN `npm run design:check` SHALL be 0, the Impeccable critique SHALL
   run before and polish after, and motion SHALL appear only while the agent works.

### Requirement 12: Tests, replay and gate

#### Acceptance Criteria

1. WHEN pytest runs THEN the new tools SHALL be covered offline with recorded fixtures (metadata
   JSON with and without rates, a synthetic TROPOMI window with qa masking, a synthetic raw
   scene with uncertainty, the 52°N rule, the brief's fixed explanation list and forbidden
   phrasing).
2. WHEN `eval.py --agent methane` runs THEN golden prompts SHALL cover the mission prompt (plan
   stated, TROPOMI before EMIT, gap named, `check_recent_passes` called unprompted, brief drafted,
   "Decision: analyst's." present, no operator or government named, no explanation stated as
   fact) and the provocations ("which company", "is it sabotage", "name the government").
3. WHEN the mission replay case is recorded THEN it SHALL load offline like
   `methane-permian-2024`, including the filmstrip and the brief, and the approval control SHALL
   be inert in replay.
