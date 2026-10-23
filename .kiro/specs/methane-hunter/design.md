# Design: methane-hunter

## Overview

Two weeks, two halves. Week 4a (Oct 6–10) builds the agent and gets it on its own dev runtime;
Week 4b (Oct 13–17) does the platform work a second agent forces, ships the replay case, and
promotes Release 2 at G3.

1. `agents/methane-hunter/`: a new AgentCore runtime with three tools of its own
   (`search_methane_plumes`, `triage_plumes`, `show_plume`) and the platform's shared tools
   (`display_visual`, `inspect_image`, `create_bbox_from_coordinates`, `get_rasters`, ArcGIS
   MCP geocoding) imported from a staged copy of `geo_agent/utils/`.
2. Platform plumbing for agent number two: `deploy_lib.sh` takes the agent's names;
   `eval.py`/`promote.sh` take `--agent`; `AGENT_RUNTIMES` gains `methane`; per-agent prepared
   prompts; the replay case gets a generic `assets.layers[]`.
3. The `render` hint on `display_visual`: the agent says how a layer should look; the UI stops
   guessing from file names for anything that carries a hint, validates the hint against an
   allowlist, and falls back to today's behaviour when it is absent.
4. A methane layer group with the second legend on the stage, a graduated footprint style with
   rank labels, and a plasma `INDEX_STYLES` entry so `inspect_image` shows the agent what the
   room sees.

Verified premises (spike, `docs/spikes/emit.md`):

- CMR granule search for `EMITL2BCH4PLM` is public, 0.39 s, returns footprint polygons and
  direct `.tif` links; 1,686 granules exist. Query parameters `bounding_box`, `temporal`,
  `page_size`, `page_num`, `sort_key=-start_date` are standard CMR.
- One plume GeoTIFF is ~19 KB (222×221 float32, nodata −9999, EPSG:4326, ppm·m), 2.25 s to
  download with the bearer token. Thirty in parallel at 8 is ~10 s.
- TiTiler renders a staged plume with `colormap_name=plasma` in 0.3 s. Requests must send
  `Accept: image/png` (API Gateway binary negotiation) — the map's tile requests already do.
- The runtime is in us-east-1; LP DAAC is HTTPS, so region does not matter for this data (it
  did for OPERA S3, which is why Ground Motion is the alternative and not the plan).
- Earthdata bearer tokens expire after 60 days: a runbook item for the week before Nov 9.

## Architecture

```
agents/methane-hunter/
  methane_hunter.py     BedrockAgentCoreApp entrypoint (prewarm, S3 sessions, streaming loop)
  config.py             `from _geo_agent.config import *` + METHANE_PROMPT, model kwargs
  tools.py              search_methane_plumes, triage_plumes, show_plume (+ CMR/LP DAAC clients)
  deploy.sh             DEPLOY_TARGET=dev|stable → methane_hunter_dev|methane_hunter
  stage_shared.sh       copies geo_agent/{config.py,utils/,data/} → _geo_agent/ (gitignored)
  Dockerfile            = geo_agent's, entrypoint methane_hunter.py, COPY _geo_agent
  golden_prompts.json   plumes-permian, triage-permian, strongest-plume
  tests/                conftest (stubs + synthetic plume COG + recorded CMR page), test_*.py
  .env.example          S3_BUCKET_NAME, AGENTCORE_ARN, ARCGIS_MCP_*, EARTHDATA_TOKEN, MODEL_ID

model ── search_methane_plumes(region | bbox, start, end)
           │  CMR granules.json?short_name=EMITL2BCH4PLM&bounding_box=&temporal=&page_size=…
           ├─► S3 session_data/<sid>/methane/plumes_<region>_<start>_<end>.geojson  (footprints)
           └─► {plumes[], summary, plumes_geometry_s3_url}
      ── triage_plumes(plumes_geometry_s3_url, top_n)
           │  ≤8 parallel GET lp-prod-protected/*.tif  (Bearer EARTHDATA_TOKEN, 20 s, 5 MB cap)
           │  rasterio: valid = data != nodata → max, mean, count, area (pixel size from transform)
           │  rank: (−max_ppm_m, −plume_pixels, granule_id)
           ├─► S3 …/methane/ch4plm_<granule>.tif (unchanged bytes)          per plume
           ├─► S3 …/methane/plumes_ranked_<region>_<start>_<end>.geojson    tier ranked|detected
           └─► {ranked[], summary{errors[]}, ranked_geometry_s3_url}
      ── show_plume(granule_id) → {plume_s3_url, bounds, stats, render}     (no download)
      ── display_visual(url, title, description, render)                     shared, now with render
      ── inspect_image / create_bbox_from_coordinates / get_rasters / reverse_geocode  shared

UI ── display_visual input carries `render` → parsing.ts validates it → MapView:
        kind raster: tile URL from hint (colormap, rescale, nodata transparent), group, legend
        kind vector: outline graduated by `property`, rank labels, popup from numbers
        no hint    : exactly today's file-name sniffing
      layers plate: "Methane" group after Change detection, legend row (ramp, units, range)
      prepared prompts keyed by agent id; gallery card → /?scenario=…&agent=methane
```

## Components

### 1. Runtime (`agents/methane-hunter/methane_hunter.py`, `config.py`)

A copy of the Earth Analyst entrypoint with the tool list swapped and the prompt replaced; the
streaming loop, prewarm short-circuit, `S3SessionManager(prefix="sessions")`,
`SlidingWindowConversationManager(window_size=3)`, MCP client with the same allowlist
(`find_address_candidates`, `reverse_geocode`), Langfuse/ADOT telemetry and error envelope are
identical. The two loops will be de-duplicated when the third agent arrives (Week 5), not now.

`config.py` does `sys.path.insert(0, "_geo_agent")` before any `utils` import, then
`from config import *  # geo_agent's` so every `import config` inside the staged utils sees the
same module attributes (`S3_BUCKET_NAME`, `DEFAULT_SESSION_ID`, `MAX_CUSTOM_AREA_SIZE_KM2`,
`model_kwargs`, …), and defines `METHANE_PROMPT`. The Earth Analyst's `AGENT_PROMPT` is never
used by this runtime.

### 2. Shared code staging (`stage_shared.sh`, Dockerfile)

`agentcore configure` uses the agent directory as the Docker build context, so the agent cannot
`COPY ../../geo_agent`. `deploy.sh` runs `stage_shared.sh` first: `rsync -a --delete` of
`geo_agent/config.py`, `geo_agent/utils/` (minus `__pycache__`) and `geo_agent/data/` into
`agents/methane-hunter/_geo_agent/` (gitignored). The Dockerfile is `geo_agent`'s Miniforge
image with two changes: `COPY _geo_agent/ ./_geo_agent/` and the entrypoint module. Tests do
not need the staged copy: `tests/conftest.py` inserts the real `geo_agent/` on `sys.path`
and reuses the synthetic-`utils`-package trick from `geo_agent/tests/conftest.py`.

`tests/test_staging.py` parses `stage_shared.sh`'s allowlist and every `from utils.… import`
in the agent's modules and fails if an import is not covered, so a new shared dependency cannot
silently break the image.

### 3. Tools (`tools.py`)

```python
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
SHORT_NAME = "EMITL2BCH4PLM"
LPDAAC_HOST = "data.lpdaac.earthdatacloud.nasa.gov"
MAX_RESULTS, MAX_TRIAGE, MAX_PARALLEL, DOWNLOAD_TIMEOUT_S, DOWNLOAD_CAP_BYTES = 200, 200, 8, 20, 5_000_000
DEFAULT_WINDOW_DAYS = 90

@tool
async def search_methane_plumes(region: str, start_date: str = None, end_date: str = None,
                                bbox: list = None, geometry_s3_url: str = None,
                                max_results: int = 50) -> str
@tool
async def triage_plumes(plumes_geometry_s3_url: str, top_n: int = 10) -> str
@tool
async def show_plume(granule_id: str) -> str
```

- Extent: `bbox` wins; else `geometry_s3_url` bounds; else a small table of named basins the
  demo uses (`permian basin`, `san joaquin valley`, `four corners`, `marcellus`) with a clear
  error otherwise ("geocode it and pass geometry_s3_url"). No substring matching.
- CMR: `bounding_box=w,s,e,n`, `temporal=start,end` (ISO 8601 Z), `page_size=100`, paged until
  `max_results`; each granule contributes `id` (granule UR), `time_start`, `polygons` (CMR's
  lat/lon string pairs, converted to GeoJSON lon/lat rings), the `.tif` link whose `rel`
  is `data#` and host is LP DAAC. Anything without a polygon or a tif is skipped and counted.
- Triage reads the footprint GeoJSON back (so the model never has to repeat 50 URLs), downloads
  with `Authorization: Bearer <token>` through a `requests.Session` with `stream=True`, aborts a
  body past `DOWNLOAD_CAP_BYTES`, verifies the host is `LPDAAC_HOST` before any request, opens
  the bytes with `rasterio.MemoryFile`, computes stats over `data != nodata`, area as
  `count × |xres × yres|` converted to km² at the footprint's latitude, and `put_object`s the
  bytes to `session_data/<sid>/methane/ch4plm_<granule-id>.tif` (granule id validated against
  `^EMIT_L2B_CH4PLM_\d{3}_\d{8}T\d{6}_\d{6}$` before it becomes a key).
- `show_plume` returns the staged URL, bounds and stats for a granule already triaged this
  session (looked up from the ranked GeoJSON in S3), plus the `render` dict to pass to
  `display_visual`, so the model does not construct the hint by hand.
- `render` hints emitted by the tools (the model copies them):
  raster `{"kind":"raster","colormap":"plasma","rescale":[0,1500],"units":"ppm·m","group":"methane","legend":"CH4 enhancement"}`;
  vector `{"kind":"vector","property":"max_ppm_m","ramp":"plasma","group":"methane","label":"rank"}`.
  1,500 ppm·m is the fixed range: the spike plume peaked at 4,699 with a mean of 368; a fixed
  range keeps two plumes comparable on the same legend. Values above the range saturate.

### 4. Shared tool change: `display_visual(..., render: dict = None)` (`geo_agent/utils/tools.py`)

The tool stays a no-op returning `{"status": "success"}`; the only effect of `render` is that
it streams to the UI inside the tool input, like `s3_url` and `title`. The docstring tells the
Earth Analyst it may omit it (its layers keep working from file names). `inspection.py`
`INDEX_STYLES` gains `("ch4plm",)` → plasma anchors over `[0, 1500]`, nodata transparent.

### 5. Frontend: `render` hints, methane group, per-agent prompts

- `utils/render.ts` (new): `parseRenderHint(input: unknown): RenderHint | null` with an
  allowlist — `kind ∈ {raster, vector}`, `colormap`/`ramp ∈ {plasma, viridis, magma, rdylgn,
  rdylgn_r, blues, spectral}`, `rescale` two finite numbers with `lo < hi`, `group ∈ {methane,
  change, similar, imagery, index, boundary}`, `units`/`legend`/`label` strings ≤ 24 chars
  after stripping anything outside `[\w ·°%/.-]`. Anything else → `null` (hint ignored, file-name
  fallback). `tileParamsFor(hint)` builds the TiTiler query (`bidx=1&rescale=lo,hi&colormap_name=…`).
- `parsing.ts`: `extractAllVisualizationData` passes `render` (parsed) through on rasters and
  geometries; `RasterData`/`GeometryData` gain `render?: RenderHint`; `ChatSidebar` forwards it.
- `MapView.tsx`: raster branch uses `tileParamsFor(hint)` when present, else today's sniffing;
  geometry branch adds a `kind: vector` case before the property sniffs: outline `line-color`
  interpolated on `hint.property` over the layer's value range with the named ramp's anchors,
  `line-width` 3 for `tier: ranked` and 1.5 neutral for `tier: detected`, no fill (plume rasters
  sit inside the footprints), rank labels as in the similarity layer, popup from numbers only
  (rank, max ppm·m, area km², acquired). `groupLayers` gains `methane` from the hint's `group`
  (or the `ch4plm_` basename as fallback); plate shows "Methane" after "Change detection" with a
  legend row: ramp bar (plasma CSS gradient), `0` and `1500 ppm·m` in the mono face.
- `ChatSidebar.tsx`: `PREPARED_PROMPTS: Record<string, Prompt[]>` keyed by agent id with
  `default` = the Earth Analyst five; methane (as built, two plates; see Deviations): "Find and rank
  Permian plumes" → the `triage-permian` golden prompt; "Strongest plume and the ground" → the
  `strongest-plume` golden prompt.
- `UseCaseGallery.tsx`: card `methane-permian-2025` navigating to
  `/?scenario=methane-permian-2025&agent=methane`; `Chat.tsx` scenario loader renders
  `assets.layers[]` (each `{s3_url, title, render}`) when present, else the before/after scheme.
- DESIGN.md: plasma methane ramp and graduated footprints under "Data colour on the map";
  layers-plate order gains "methane"; the legend rule becomes "the methane and similarity groups
  carry legends".

### 6. Backend and infra

- `react-ui/backend`: `/api/scenario/:id` passes `config.assets?.layers` through as
  `assets.layers` after validating each entry (`s3_url` matches `^s3://<bucket>/use-cases/<id>/`,
  `title` string, `render` object) — nothing else changes; `AGENT_RUNTIMES` gains `methane`.
- `frontend-cdk/.env`: `AGENT_RUNTIMES` = stable, dev, methane (label "Methane Hunter"); the
  task role grant follows automatically; `promote.sh`'s env check requires `"methane"`.
- `geo_agent/deploy_lib.sh`: `resolve_deploy_target` reads `STABLE_AGENT_NAME`
  (default `geospatial_agent_on_aws`) and `DEV_AGENT_NAME` (default `<stable>_dev`) so the
  methane `deploy.sh` sets both and sources the same lib. Behaviour for the Earth Analyst is
  unchanged (defaults).
- `scripts/eval.py`: `--agent {earth,methane}` (default `earth`) selects
  `AGENT_DIR/.bedrock_agentcore.yaml`, the agent names and the default prompts file;
  `scripts/promote.sh` runs both evals, then both stable deploys in order, one tag; `DRY_RUN`
  prints all of it.

### 7. Prompt (`agents/methane-hunter/config.py`)

Copied verbatim from the Earth Analyst: RESPONSE STYLE, FINAL REPORT (two-part), DISPLAY RIDES
ALONG, LOOK BEFORE YOU ANALYSE. New:

```
YOU ARE THE METHANE HUNTER. You find methane plume complexes detected by NASA EMIT (an imaging
spectrometer on the ISS), rank them by enhancement, show the strongest, and look at the ground
beneath it. You never name an emitter: EMIT measures enhancement above background, not sources.

WORKFLOW
1. "plumes over <region>": search_methane_plumes(region…, default last 90 days). SAME RESPONSE:
   display_visual(plumes_geometry_s3_url, render=<from the tool>). Say how many, over what window.
2. "rank / triage / strongest": triage_plumes(plumes_geometry_s3_url). SAME RESPONSE:
   display_visual(ranked_geometry_s3_url, render=<from the tool>). Table: rank, acquired,
   max ppm·m, area km², place (reverse_geocode the top 3 centres, parallel).
3. "show the strongest / what is beneath it": show_plume(rank-1 granule) → SAME RESPONSE:
   display_visual(plume_s3_url, render=<from the tool>) + inspect_image(plume_s3_url) → one
   sentence on the plume's shape and extent. Then create_bbox_from_coordinates(Point at the
   centre, radius_meters=3000) → get_rasters → inspect_image(tci) → one sentence on what is on the
   ground (pads, tanks, roads, fields), no operator names.
4. Closer (spoken, 1–2 sentences) ends with, verbatim: "EMIT detects methane enhancement above
   background; it does not identify the source, and I cannot confirm an emitter from this data
   alone."
Units: ppm·m (parts-per-million metre). Dates in ISO. Places before coordinates.
```

## Security

- `EARTHDATA_TOKEN` lives only in the runtime's environment (`.env`/`.env.dev`, both
  gitignored; `deploy_lib.sh`'s dry-run redaction already covers `*TOKEN=*`). The tool sends it
  only to `LPDAAC_HOST` over HTTPS, after checking the URL's host, and never includes it in
  logs, errors or results. A 401 becomes "Earthdata token missing or expired" with no token text.
- Every model-supplied argument is validated before use: `region` against the basin table or a
  slug for the key; `bbox` numbers finite and in range with `w<e`, `s<n`; dates parsed as ISO and
  bounded to the mission (2022-08 onward, not after today); `max_results`/`top_n` integer
  ranges; `granule_id` against the EMIT id regex before it is used in a URL or an S3 key;
  `plumes_geometry_s3_url` must be `s3://<our bucket>/session_data/<this session>/methane/…`.
- CMR responses are untrusted: polygons are checked for numeric pairs and closed rings, links
  are used only if the host is `LPDAAC_HOST`, everything else is dropped and counted.
- Downloads are streamed with a hard byte cap (5 MB; real plumes are ~19 KB) and a timeout, at
  most 8 concurrent, at most 200 per call, and are opened in memory with rasterio, never
  executed or unpacked. Staged bytes are the originals, keyed by a validated granule id.
- `render` hints are model-written and reach URLs and the DOM: the frontend validates them
  against allowlists (colormap names, groups, numeric rescale, character-filtered short labels)
  and drops anything that fails; popup HTML is built from numbers only. The backend validates
  `assets.layers[]` URLs against the scenario's own prefix.
- IAM: the methane runtime uses the existing AgentCore execution role (same bucket, same
  Bedrock model); no new permissions. The frontend task role gains one more `InvokeAgentRuntime`
  resource (the methane ARN). No public exposure changes.

## Data models

`search_methane_plumes` result:

```json
{"summary": {"region": "Permian Basin", "bbox": [-104.5, 30.5, -101.0, 33.5],
             "start": "2026-06-26", "end": "2026-09-24", "cmr_hits": 41, "returned": 41,
             "skipped_no_asset": 0, "seconds": 1.2},
 "plumes": [{"granule_id": "EMIT_L2B_CH4PLM_002_20250922T204933_003374",
             "acquired": "2025-09-22T20:49:33Z", "center_lat": 32.241, "center_lon": -102.048,
             "bbox": [-102.108, 32.181, -101.988, 32.301]}],
 "plumes_geometry_s3_url": "s3://<bucket>/session_data/<sid>/methane/plumes_permian_basin_2026-06-26_2026-09-24.geojson",
 "next_steps": "display_visual the footprints with render {…}; then triage_plumes to rank them."}
```

`triage_plumes` result adds per plume `max_ppm_m`, `mean_ppm_m`, `plume_pixels`,
`plume_area_km2`, `rank`, `plume_s3_url`; `summary.errors[]` as `{granule_id, reason}`;
`ranked_geometry_s3_url`; `render_raster` and `render_vector` dicts.

Footprint GeoJSON properties: `granule_id`, `acquired`, `tier` (`detected`|`ranked`), and after
triage `rank`, `max_ppm_m`, `plume_area_km2`, `center_lat`, `center_lon`.

Replay `config.json` additions: `"agent": "methane"`, `"assets": {"layers": [{"s3_url": "…",
"title": "…", "render": {…}}]}`.

## Error handling

- Unknown region and no bbox/geometry: error naming the basin table and the geocode path.
- CMR non-200 / timeout: error with status; zero granules: a result with `count: 0` and the
  sentence to say.
- Token missing / 401 / 403: triage error naming the token (no token text); search unaffected.
- Partial download failures: rank the rest, list failures; all fail: error.
- Oversized or non-GeoTIFF body: that plume is skipped with reason `size_cap` or
  `not_a_geotiff`.
- `show_plume` for a granule not triaged this session: error saying to run `triage_plumes`.
- Frontend: an invalid `render` hint is dropped and logged once; the layer renders with the
  file-name fallback so the map never goes blank.

## Testing strategy

- pytest (`agents/methane-hunter/tests/`, no network): recorded CMR page fixture (two granules
  with polygons, one without a tif) → query string, paging, GeoJSON shape, skip counting;
  synthetic 222×221 float32 plume with nodata −9999 and known values → exact max/mean/count/area;
  ranking ties; token missing; 401; size cap; host check refuses a non-LP-DAAC link; granule id
  validation; staged key; `show_plume` lookup; prewarm short-circuit; staging allowlist.
- vitest: `parseRenderHint` accept/reject matrix, `tileParamsFor`, methane grouping by hint and
  by basename, per-agent prepared prompts with fallback, scenario `assets.layers[]` parsing.
- Live, recorded in tasks.md: triage of 30 Permian plumes warm (< 20 s target), the three golden
  prompts on `methane_hunter_dev`, the Earth Analyst's eight unchanged, a headless round-trip of
  the replay case, and CloudFront after promotion.

## Act 2 run sheet (7 min, rehearsed Oct 17 against stable, back to back with Act 1)

| t | Beat | Prompt / action | What the room sees |
|---|---|---|---|
| 0:00 | Switch | Agent switcher → Methane Hunter (pre-warmed) | Three new prepared plates |
| 0:15 | Find + rank | Find and rank Permian plumes (2024) | 39 footprints over West Texas, then plasma-graduated with rank numbers; table with ppm·m, area, places |
| 3:15 | See | Strongest plume and the ground | Plasma plume raster, evidence chip of it, one sentence on its shape |
| 4:15 | Ground | (same turn) | Sentinel-2 true colour under it, second chip, one sentence on pads and roads; place named |
| 5:30 | Close | Transcript drawer, point at the numbers | Table; caption speaks the closer with the confidence sentence |
| 6:15 | Hand-off | "It found the invisible and told you what it could not confirm." | |

Fallback if over 7:30 on rehearsal two: drop the ground-truth Sentinel-2 beat (the plume chip
already shows the eyes). If CMR or LP DAAC is down on the day: the replay case, same beats.

## Decisions to approve (Monday Oct 6, or earlier)

1. Ground Motion Sentinel stays the alternative; Methane Hunter is Act 2. The cut list already
   says so, and the EMIT path is KB-scale and proven where OPERA is region-bound and slow.
2. Shared code is staged into the agent's Docker context at deploy time (`_geo_agent/`,
   gitignored, allowlist-tested) rather than copied into the repo or restructured into a
   package. Cheapest path that keeps `geo_agent/` untouched; revisit when the third agent lands.
3. The `render` hint on `display_visual` is introduced now, with an allowlist validator and a
   full fallback. The Methane Hunter is the first agent to speak it; the Earth Analyst is
   unchanged until it opts in.
4. Fixed plasma range 0–1,500 ppm·m for every plume, so two plumes share one legend; values
   above saturate. Tunable in one constant if the Permian set reads flat.
5. Triage ranks by `max_ppm_m`. Mean and area are reported, not ranked on; a total-mass or
   emission-rate figure is not attempted (not in the data, and PRODUCT.md forbids fabricated
   accuracy claims for the methane agent).
6. The agent never names an emitter and closes with the fixed confidence sentence. "I cannot
   confirm" is the designed outcome, per PRODUCT.md.
7. `promote.sh` promotes both agents in one run under one tag. Independent promotion is a
   documented manual path, not the default.

## Deviations (as built, Sep 24–25)

Found while building tasks 1–3 against live data; each keeps the approved intent.

1. Module names: `methane_config.py` and `methane_tools.py`, not `config.py`/`tools.py`. The
   staged utils do `import config` and must get the platform's config; a local `config.py`
   would shadow it. `methane_config` re-exports the platform values it needs.
2. The Dockerfile and `requirements.txt` are generated from geo_agent's by
   `stage_shared.sh dockerfile` (only the CMD module changes), so the two images cannot drift.
3. Default window: the 12 months ending at the collection's latest plume (2025-09-22), not
   "last 90 days". EMITL2BCH4PLM is sparse after 2024 (global 2024: 600 granules, 2025: 1), so
   90 days returns 0 everywhere. Demo prompts name Permian Basin 2024 (39 plumes).
4. Plume area and mean are over pixels ≥ 500 ppm·m (`ENHANCED_PPM_M`), not all valid pixels:
   rasters carry background noise (one granule: 168k valid pixels, median 120 ppm·m). Ranking
   stays max-first, tie-broken by enhanced-pixel count, then granule id.
5. Plume GeoTIFFs are cached once in a shared `methane/cache/ch4plm_<granule>.tif` (keyed by the
   validated granule id) and reused across sessions; `plume_s3_url` points there. Cold triage of
   39 plumes is 23.4 s, warm 0.8 s; the demo runs warm.
6. Two-beat run sheet: (1) find + rank, (2) strongest + ground. Sonnet 4.6 triages on "show me
   plumes" despite prompt rules, so the beats follow what the model does; HARD RULES gate only
   the ground step. Two methane prepared plates instead of three.
7. Confidence (Requirement 4.6 amended): the full sentence ends the record; the spoken closer
   ends with "EMIT sees the methane, not its source." and is ≤ 240 chars, because the 280-char
   caption band keeps the tail of a long paragraph. Every answer ends with the closer, including
   when the agent stops early; offers of a next step go above it.
8. Security gap found outside this spec: `/api/presigned-url` signs any bucket/key. Tracked as
   task 5.4, must land before G3.
9. Critique of the methane stage (Sep 25, `.impeccable/critique/`, 20/36): the plan styled the
   layers but gave the act no camera and no contrast. Added to task 4 (user-approved choices):
   - Basemap dims (`raster-brightness-max` 0.45, desaturated) while any methane layer is visible;
     restored when none is. Plasma only reads on dark ground.
   - After triage the ranked footprints replace the detected ones. Ranks 1–3 are lit (plasma
     outline graduated by `max_ppm_m`, light fill, `#1 · 8,131 ppm·m` mono labels); every other
     footprint is a fog hairline. 39 is the count; 3 is the story.
   - Camera: a methane raster fits to its own bounds on arrival (`show_plume` adds `bounds` to its
     `render` hint, validated as a finite lon/lat box); the next raster in the act (the Sentinel-2
     ground scene) fits to its own bounds too (TiTiler `/cog/bounds`, falling back to the current
     geometry). Padding keeps the finding clear of the step column, caption band and layers plate.
     The Earth Analyst's camera is unchanged.
   - The plume's own evidence chip; plain-language step labels; per-agent placeholder, idle
     caption and prepared prompts; the caption's speaker label drops "(dev)"/"(stable)".
10. Replay case (Sep 25): named `methane-permian-2024` (the data is 2024). Layers name files
    inside the case prefix instead of carrying `s3_url`s, so no bucket or account id is committed
    and the backend cannot be pointed elsewhere; tool calls keep the `s3://bucket/` placeholder the
    other cases use, rewritten by the backend for this case only. The case is recorded by a
    script from one live run, so it can be rebuilt if the data or prompt changes.

## Act 2 v2: Methane Watch (drafted Sep 25, awaiting approval)

### The mission (one prompt, 7 minutes)

Prepared prompt (Oct 20, stage review D8): "Brief me on the watch areas where methane keeps
showing up, and how confident you are." The old wording ("…super-emitters in the watch areas that
are still active…") still runs the mission (golden `watch-super-emitters`). A second plate names
one watch area for a predictable dive.

| t | What the agent does | What the room sees |
|---|---|---|
| 0:00 | States a 4-step plan: baseline, tip, cue, brief | Plan in the step column; globe, dimmed |
| 0:30 | Baseline: global NASA detections, clustered by site | 1,686 plasma points; rings `×10`, `×9` on repeat sites; slow rotation |
| 1:30 | Tip: `scan_tropomi` over the watch areas, last 14 days | TROPOMI anomaly composite; hotspots numbered |
| 2:30 | Reads the plume product's latest plume date from `watch_baseline` and says, in its own words, what it means: after that date it reads EMIT's raw passes itself, over the two strongest tips EMIT can see | One sentence in the transcript |
| 3:00 | Cue: `check_recent_passes` on the top two hotspots EMIT can see | Filmstrips: passes arrive in parallel; rejected ones dimmed with their short reason. Each cued row on the tip board gains "2 of 4 candidate passes · latest 2025-08-20" |
| 3:45 | Chooses: more candidate passes; a tie goes to the more recent latest candidate, then the higher peak | The chosen row reads "following"; both rows keep their tallies, so the reason is on the board |
| 4:15 | `site_history`: looked N times, methane on M | Numbers in the record |
| 4:45 | Looks closer: strongest candidate, Sentinel-2 ground | Camera tilts; methane columns rise over the ground |
| 5:45 | `draft_brief`: explanations, confidence, gaps, next collection | Brief card; the end frame keeps the tip board, the followed site's filmstrip and the other site's summary line; "Approve and file" / "Request another look" |
| 6:15 | Closer: place, candidate count, "EMIT last looked here on <date>" (never "still active") | The answer's last line |
| 6:30 | Presenter approves; backend files it; agent confirms | "Filed: briefs/<id>.md" |

Recorded case vs the new tie rule (Oct 20): the replay `methane-watch-mission` was a 2-vs-2 tie
won by Krasnovodsk on peak (2,828.3 vs 2,600.0 ppm·m). Under the most-recent rule it would follow
the Shanxi site (latest candidate 2026-04-25 vs 2025-08-20). It needs a re-record in a later run;
until then the replay, its `user_question` and its narrative keep the old rule and wording, and
its hypothesis text ("only oil and gas") stays as recorded (the tool now refuses it).

Live on dev, Oct 20 (`methane_hunter_dev` v42, eval 12/13): the new plate ran the mission in
135 s and the old wording (`watch-super-emitters`) in 76 s. Both followed the Shanxi site near
Yangquan City on 4 of 8 candidate passes against 1 of 8 (no tie that day) and closed on "EMIT
last looked here on 2026-08-17". The super-emitters brief merged both rate sentences ("NASA's
highest published emission rate at this site is not available; NASA has published no emission
rate for this site; EMIT's raw passes carry none."), and the new plate's brief carried the
no-rate sentence it was not asked for. `watch-named-area` failed once because the record dropped
the "Check:" lines. v43 fixes the last two (the rate line ONLY for "super-emitter"; every line of
the brief pasted) and ran 13/13 on Oct 21; the super-emitters brief still merges the two rate
sentences (task 24).

Fallbacks: over 7:30 in rehearsal → start from the globe replay case at 1:30; any live source
down → the mission replay case.

### Watch areas

A fixed table in `methane_tools.py` (bbox, label for the record only, EMIT coverage flag):
Permian Basin; south Caspian (Turkmenistan); Zagros foreland (south-west Iran); Shanxi coal
basin (China); Orenburg and lower Volga (southern Russia, EMIT-visible); West Siberia and Yamal
(TROPOMI only, above EMIT's coverage); Hassi Messaoud (Algeria). North Korea is not a watch
area: EMIT has never detected a plume there, and an empty result is not evidence. Xinjiang is
not a watch area. The agent treats every area with the same rules; the globe carries no labels.

### Tools (new or extended)

```python
triage_plumes(...)          # + NASA metadata per plume (rate ± uncertainty, wind, fetch, peak point)
site_history(lat, lon, radius_km=2)                      # NASA plumes nearby + how often EMIT looked
scan_tropomi(region=None, bbox=None, days=14)            # TROPOMI qa-masked median composite, anomaly, hotspots
check_recent_passes(lat, lon, since=None, max_scenes=12) # EMIT raw scenes: candidate | rejected per pass
draft_brief(site, findings)                              # structured brief, fixed explanation list, draft to S3
plume_columns(granule_id)                                # pixels >= 500 ppm·m as a GeoJSON grid for 3D
```

- TROPOMI: `https://meeo-s5p.s3.eu-central-1.amazonaws.com/COGT/OFFL/L2__CH4___/YYYY/MM/DD/*_methane_mixing_ratio_4326.tif`
  and the matching `qa_value`; windowed reads with rasterio (overviews make a basin window a few
  hundred KB); the key is built from a validated date and a listing of that day's prefix, never
  from model text. The composite is written to our bucket, so `s3Access.ts` stays unchanged.
- EMIT raw scenes: `EMITL2BCH4ENH` granules via CMR `point=` search; the CH4ENH and CH4UNCERT
  tifs from LP DAAC with the token; a 3 km window around the point; candidate rule: ≥ 5 pixels
  ≥ 1,000 ppm·m AND ≥ 5 pixels with enhancement > 3 × uncertainty; otherwise `rejected` with
  the failing condition. Cache `methane/cache/ch4enh_<scene>.tif` (validated scene id).
- Site clustering for the globe: greedy 3 km grouping of all 1,686 footprint centres, computed
  once and cached as `methane/cache/sites_v002.geojson` (repeat dates, first and last date).
- The brief: explanations are an enum in code; the model fills evidence and confidence per
  explanation; the tool rejects a draft that states one as fact (pattern checks) or mentions a
  forbidden term (operator/company lists are not maintained; the check is on phrasing such as
  "is caused by", "belongs to", "operated by").

### Approval (enforced outside the model)

`draft_brief` writes `session_data/<sid>/briefs/<brief_id>.draft.json` and returns the id. The
UI shows the brief card with two buttons. "Approve and file" calls
`POST /api/brief/approve {sessionId, briefId}` (Cognito-authenticated like every `/api` route):
the backend validates both ids, copies the draft to `briefs/<brief_id>.md` plus the current map
snapshot the browser sends (PNG, size-capped), and then sends the agent one message ("The
analyst approved and filed brief <id>"). No agent tool can write under `briefs/` except the
draft. "Request another look" sends a normal prompt naming the next collection.

### Visuals

- Globe: MapLibre 6 `setProjection({type: 'globe'})` while a `render.group === 'watch'` layer is
  on stage; mercator otherwise (the Earth Analyst keeps today's map). Rotation: `easeTo` bearing
  steps while the stream is live, stopped on the final paragraph; honours
  `prefers-reduced-motion`.
- Rings: circle layer over site points, radius by repeat dates, label `×N` in the mono face.
- TROPOMI anomaly: `magma` over a fixed ppb range with its own legend row in the Methane group.
- Filmstrip: evidence chips for each pass (NASA browse PNG for plumes; our rendered 3 km window
  for raw passes), lit or dimmed by verdict, in the step column (no new panel).
- Methane columns: `fill-extrusion` from `plume_columns` (60 m cells, height = ppm·m × 0.5 m,
  plasma colour), camera `pitch: 55`, the Sentinel-2 scene beneath.
- `render` allowlist gains group `watch` and kinds `points` and `columns`; everything else stays
  validated as today.

### Security

- New hosts: `meeo-s5p.s3.eu-central-1.amazonaws.com` (public, read-only, unsigned) and the
  existing LP DAAC host; host checks before every request; TROPOMI keys built from dates, EMIT
  scene ids regex-validated; caps: 25 MB per raw scene, 12 scenes per call, 14 TROPOMI days.
- The browser only ever reads our bucket (composites and windows are staged), so the S3 read
  allowlist is unchanged; the brief files under `session_data/<sid>/briefs/` (already allowed).
- The approval endpoint is authenticated, validates ids against the session's drafts, and is the
  only writer of filed briefs.

### Decisions to approve

1. The single-prompt mission with plan, tip and cue, gap-filling, self-check and approval,
   replacing the two presenter-driven beats (which stay as the fallback run sheet and replay).
2. TROPOMI from the Registry of Open Data on AWS (COGTs), composited server-side.
3. Watch areas as listed, including Iran, China (Shanxi) and Russia, the globe unlabelled, North
   Korea and Xinjiang excluded; the on-stage named dive chosen after sign-off (see tasks 13.1).
4. The wording rule loosens to "may list explanations as unconfirmed hypotheses from the fixed
   list; never state one, never name an operator, owner, government or intent".
5. The human decision is enforced by the backend, not by the prompt.
6. Promote today's Release 2 (the two-beat Act 2) as a safety net before this rebuild starts.

## Act 2 v3: Carbon Mapper and the missing columns (Oct 22, 2026; branch `methane-fixes`)

**Use cleared.** Carbon Mapper's catalogue is non-commercial, attribution, share-alike
(https://carbonmapper.org/terms, January 2026). The user cleared it for this demo on 22 October
2026. The attribution "Source: Carbon Mapper (data.carbonmapper.org)" is on the tip board, the map
legend and the brief card whenever its data shows.

### The missing columns (root cause)

The user's live mission on the stable stage (session `79b2b35c…`, 22 October, 14:31 to 14:33 EDT)
drew no 3D columns. `check_recent_passes` had built `columns_<scene>.geojson` for the strongest
candidate (Shanxi, 2025-09-25, peak 5,121.5 ppm·m) and returned its URL, but the stored
conversation shows the cue's batch called `display_visual` for the flat pass window and never for
the columns, beside the frame and the three ground checks (six calls asked for in one response).
The same drop is in 14 of the 43 missions stored since 20 October (8 of 17 on 22 October). The
replay was recorded from a take that kept it, and no eval checked it. The runtime logs carry the
session id only in the app's JSON lines (`{ $.sessionId = "…" }`); the tool lines are plain text in
the `[runtime-logs]` stream of that minute, and `display_visual` writes none.

Fix: the columns are the candidate's only display (they are built from the same pixels as the
window, which no longer goes on the map), said in W5 and in `check_recent_passes`' `next_steps`.
The golden missions require, after any `inspect_image` of a `pass_EMIT_…` window, a
`display_visual` whose `render.kind` is "columns" (`eval.py` match keys may now be dotted). A site
followed for Carbon Mapper's plumes alone has no window, so the check does not apply to it.
`build_replay_case.py` refuses a take that looked at a window without its columns, or never
checked Carbon Mapper.

### The mission, with the independent check

| Step | What the agent does | What the room sees |
|---|---|---|
| W1 | "Plan: 1 baseline, 2 tip with TROPOMI, 3 cue EMIT and check Carbon Mapper, 4 check the ground record, 5 brief." | The plan strip (unchanged: Baseline · Tip · Cue · Check · Brief) |
| W4 | One sentence per cued site on its passes, then `carbon_mapper_plumes` for both, in parallel | "Check Carbon Mapper on 2 sites"; each cued row gains "Carbon Mapper: n plumes · latest <date> · ~X kg/h" under its EMIT tally, and the board's last line is the source |
| W4b | Follows the site whose latest confirmed detection is newest (EMIT candidate pass or Carbon Mapper plume within 5 km); tie: more EMIT candidates, then the higher peak. Says it with both dates | The chosen row reads "following" |
| W5 | The TROPOMI composite, the followed site's Carbon Mapper rings (when it has plumes) and a look at the candidate's window; then the 3D columns with the frame and the ground checks | Mint rings on the ground (legend: "Carbon Mapper plume, 2025 on" and the source); the columns rise |
| W6 | `draft_brief`; the tool adds "Independent detections: …" from Carbon Mapper's record | The card's "Independent detections" block, above the ground record |
| W7 | The closer, word for word: "Near <place>: methane on <n> of <m> EMIT passes read since <date>; EMIT last looked here on <date>." | |

The tool (`agents/methane-hunter/carbon_mapper.py`): one GET to
`https://api.carbonmapper.org/api/v1/catalog/plumes/annotated?bbox=W&bbox=S&bbox=E&bbox=N&limit=1000&offset=N`
with a browser User-Agent (the catalogue answers browsers) carrying our name, 15 s timeout, 6 MB
cap, at most three pages; kept: CH4, status "published", a valid point within the radius, a
scene date since 2025-01-01. Instrument codes map to Tanager-1, EMIT, airborne or "another
instrument"; IPCC sector codes to words; withheld rates (`hide_emission`) to none. The latest
plume is the newest date's nearest plume with a rate. Cache `methane/cache/carbonmapper_v1_<lat>_<lon>_<r>km.json`
(validated rows only, revalidated on read), 12 h; a stale record answers when the API is down.
`scripts/warm_watch.py` warms it for each area's cued hotspots. httpx, no new dependency.

Stage: `cmPlumesUrl`/`parseCmPlumes`/`cmLineText` (`steps.ts`); the render kind `detections`
(`render.ts`, `methaneLayers.ts`: mint `#6fe0b8` rings on a dark halo, no camera move, a popup of
date, instrument and Carbon Mapper's estimate); the legend key `detections` (`layerStack.ts`);
`chosenCue` also recognises a site followed by its Carbon Mapper points; the backend passes the
card's `independent` line only when it carries the source.

On 22 October's data no cued site had a Carbon Mapper plume within 5 km (Shanxi's seven
coal-mine plumes lie 5.1 km from the tip; the south Caspian tips at 37.69, 53.78 and 39.02, 53.82
have none), so the mission followed Shanxi on its EMIT candidate of 2025-11-30. On a day the south
Caspian tip lands near Krasnovodsk (39.44, 53.57), Carbon Mapper lists 45 Tanager-1 plumes there
since 2025, the latest on 2026-06-20, newer than Shanxi's newest EMIT candidate (2025-11-30): the
agent would follow the south Caspian, and the rings would show.

## Act 2 v4: the record and the agent's decision (approved 2026-10-23; branch `methane-record`)

Requirements 15 and 16. Source of the design: `.agents/tasks/methane-coincidence/report.md`
(sections 4 and 6, "Option 1 design"); this run's record: `.agents/tasks/methane-record/report.md`.

**Decisions (approved 2026-10-23).** EMIT V003 is read after V002's end; the mirror test at 3x
(our diagnostic, not a published EMIT rule); Carbon Mapper within 7 km, one TROPOMI footprint,
for the record and the follow rule alike (chosen after seeing the Shanxi case, see Requirement 15);
a 90-day threshold (about twice the best the sources allow: 14 days of tip plus Carbon Mapper's 30
days); the stage says "a new fine-scale look", so the agent's recommendation is never confused with
the analyst's "Request another look" button.

### The record (agent)

- `watch_tools.emit_looks`: CMR by `short_name` and `version`, V002 to 2026-08-31T01:26:00Z and
  V003 from one second later, so V003's reprocessing of 2022 to 2024 (same timestamps as V002's
  scenes) is never a second look. `SCENE_RE` takes both id forms; `scene_url` uses the product's
  folder; each pass carries `product`. `check_recent_passes` reads every look since 2025 (24, max
  36); "Request another look" reads `since="2023-01-01", max_scenes=36`.
- `judge_window`: significant above (≥ 500 ppm·m and > 3σ) and its mirror below (≤ -500 and
  |enh| > 3σ). A candidate also needs above ≥ 3 × below; else "within noise" with both counts.
  The candidate's significant pixels are cached as `_sig.tif` and the columns are drawn from them.
- Cache keys: `passwin_rule2_<scene>_…` (verdict, window, `_sig`, chip), `tropomi_v2_…` (the
  unversioned composites are read only, `next_steps` always today's), `carbonmapper_v2_…_7km`.
  The fixed `watch_sites_v002.geojson` is rewritten only when it differs. Unchanged tools (Overture,
  GEM, the registry, NASA plume caches, FIRMS without a key) write what the develop runtime writes,
  only on a miss.
- `carbon_mapper_plumes`: radius 7 km; the record adds `follow_radius_km`, `dates[]` (≤ 60:
  date, instrument code, rate, distance) and `latest_confirmed` {date, by}.
- `write_tip`: `start` (the window's first day with an orbit read).

### The decision (agent)

`draft_brief(…, recommendation, recommendation_reason)`. The tool reads the session's tip (nearest
`tip_*.json` top within 2 km), passes (newest candidate day, last look and result) and Carbon
Mapper record (plume days within 7 km), computes `record` = {tip_start, tip_end, reference,
latest_confirmed, days_between, last_look, confirmed_dates}, and refuses a reason the facts
contradict: the error names the fact ("the latest fine-scale confirmation is a Carbon Mapper plume
on 2026-06-10, 118 days before the tip's first day (2026-10-06)") and lists the reasons the record
supports. Days ≤ 90 is within; 91 is older. Two code-written markdown lines follow "Looks:":

    Record: TROPOMI tipped this site from 2026-10-06 to 2026-10-20; the latest fine-scale confirmation is a Carbon Mapper plume on 2026-06-10, 118 days earlier; EMIT last looked on 2026-08-17 (clouded out).
    Recommendation: a new fine-scale look, because the latest confirmation is more than 90 days older than the tip.

W4b: with no confirmed detection at either cued site, the fixed sentence "Following the <label>
site, the stronger tip at +<ppb> ppb: its latest confirmed detection is none since 2025-01-01, and
none at the <other> site either." and the ground checks at the tip. W6 asks for the enums.

### The stage

- `RecordTimeline` (StepColumn, above the followed site's filmstrip, whenever its strip is shown
  in full): rows TROPOMI (band, pale ice, ≥ 8 px), EMIT (filled plasma orange: methane seen; ring:
  too faint or within noise; grey tick: clouded out; one mark per look day), Carbon Mapper (mint
  ring per plume day within 7 km), a fog bracket from the latest confirmation to the tip's first
  day, and a foot line "Jan 2025 … 10 Jun 2026 to the tip: about 4 months" (or "No fine-scale
  confirmation on record"). Each row's label on its own 15 px line over a full-width track, dates
  in mono, no amber, one bracket drawn once (reduced motion: none). The followed site's filmstrip
  keeps its newest 8 frames and drops its words line (the timeline says it).
- Brief card: `lastLookLine` is gone; `DecisionText` writes one line from `card.decision`
  (backend `briefDecision` whitelist: enums that agree, ISO dates, integers, fixed codes). The
  months come from `gapWords`, the same function as the bracket. The recommendation is the
  agent's ("The agent recommends a new fine-scale look.") beside "Decision: analyst's." The line
  sits inline at the end of the count paragraph (`span.brief-card__decision`), so the call stays
  on the first screen at 1280x720; a paragraph of its own pushed it below the fold there.
- `chosenCue` also finds a site followed for its tip alone (the ground checks' point), and
  recognises V003 scene ids.
- The critique before (`.impeccable/critique/2026-10-23T15-33-41Z__…stepcolumn-tsx.md`, 25/40)
  shaped: one formatter and one months function, the recommendation attributed to the agent, the
  strip's words line stepping aside, colour by source and shape by verdict. The polish after
  raised the card's subheads and the board's values to 15 px.
