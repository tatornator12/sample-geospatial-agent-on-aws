# Tasks: methane-hunter (Week 4, Oct 6–17)

Cadence: requirements + design approved before code (drafted Sep 24, ahead of the Monday
cadence; the seven design decisions await approval); tasks top to bottom; every task names its
tests. Two Fridays: Oct 10 is a checkpoint (agent on its dev runtime, three golden prompts pass);
Oct 17 is gate G3: Release 2 promoted (both stable runtimes + CloudFront), two agents in the
switcher, Acts 1–2 rehearsed back to back. All deploys before Oct 17 are `DEPLOY_TARGET=dev`.
Shared surfaces touched before the gate: `geo_agent/deploy_lib.sh` (defaults keep the Earth
Analyst's behaviour), `geo_agent/utils/tools.py` (`display_visual` gains an optional argument),
`geo_agent/utils/inspection.py` (one more style), all covered by the existing tests.

## Week 4a (Oct 6–10): the agent on its own dev runtime

- [x] 1. Scaffold and shared-code staging
  - [x] 1.1 `agents/methane-hunter/`: `methane_hunter.py` (entrypoint copied from the Earth Analyst, tool list swapped), `config.py` (`sys.path` to `_geo_agent`, `from config import *`, `METHANE_PROMPT` placeholder), `requirements.txt` (= geo_agent's), `.env.example` (adds `EARTHDATA_TOKEN`), `.gitignore` (`_geo_agent/`, `.env*`, `.bedrock_agentcore.yaml`), `README.md` (how to run, deploy, test)
  - [x] 1.2 `stage_shared.sh`: rsync allowlist (`geo_agent/config.py`, `geo_agent/utils/`, `geo_agent/data/`) into `_geo_agent/`; `Dockerfile` = `geo_agent/Dockerfile_geospatial_agent_on_aws` + `COPY _geo_agent/ ./_geo_agent/` + entrypoint `methane_hunter`
  - [x] 1.3 `geo_agent/deploy_lib.sh`: `STABLE_AGENT_NAME` / `DEV_AGENT_NAME` parameters with today's defaults; `agents/methane-hunter/deploy.sh` sources it with `methane_hunter` / `methane_hunter_dev`, runs `stage_shared.sh`, requires `EARTHDATA_TOKEN` in the env file, passes it as `--env` (redacted in dry run). `DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh` and the Earth Analyst's dry run both print unchanged plans
  - [x] 1.4 `tests/conftest.py` (real `geo_agent/` on `sys.path`, the synthetic-`utils` and stub pattern from `geo_agent/tests/conftest.py`, `S3_BUCKET_NAME` defaulted, a synthetic 222×221 float32 plume COG fixture with nodata −9999 and known values, a recorded CMR page fixture); `tests/test_staging.py` (allowlist covers every `utils.` import); `tests/test_entrypoint.py` (prewarm short-circuit yields "warm" and returns)
  - _Requirements: 1.1, 1.2, 1.3, 7.1_

- [x] 2. Tools
  - [x] 2.1 `tools.py` `search_methane_plumes`: extent resolution (bbox / geometry bounds / basin table, no substring match), date defaults and bounds, CMR query + paging, polygon and link validation (LP DAAC host only), footprints GeoJSON to `session_data/<sid>/methane/plumes_<slug>_<start>_<end>.geojson`, result JSON with `next_steps` and the vector `render` dict
  - [x] 2.2 `triage_plumes`: read the footprints back from S3 (URL must be this session's `methane/` prefix), ≤ 8 parallel streamed downloads with the bearer token, 20 s timeout, 5 MB cap, `rasterio.MemoryFile` stats (max, mean, count, area from the transform), deterministic ranking, staged `ch4plm_<granule>.tif` (id regex-validated), ranked GeoJSON, `summary.errors`, token-missing and 401 errors without the token text
  - [x] 2.3 `show_plume`: lookup by granule id in the session's ranked GeoJSON; returns staged URL, bounds, stats, raster `render`
  - [x] 2.4 Shared: `display_visual(..., render: dict = None)` in `geo_agent/utils/tools.py` (docstring: optional, Earth Analyst may omit); `inspection.INDEX_STYLES` `("ch4plm",)` plasma over `[0, 1500]`. `geo_agent` pytest still green (add one test for the new style)
  - [x] 2.5 `tests/test_search.py`, `tests/test_triage.py`, `tests/test_show.py`: query string and paging, zero results, non-200, polygon/link validation, GeoJSON shape; exact stats on the synthetic plume, ranking with ties, partial and total failure, token missing, 401, size cap, non-LP-DAAC host refused, invalid granule id refused, staged key; show_plume hit/miss. Target ≥ 30 tests
  - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.4, 7.1_

- [ ] 3. Prompt and first dev deploy (checkpoint Friday Oct 10)
  - [x] 3.1 `METHANE_PROMPT`: Earth Analyst's RESPONSE STYLE / FINAL REPORT / DISPLAY RIDES ALONG / LOOK BEFORE YOU ANALYSE verbatim + the Methane Hunter block from design.md (workflow, units, the fixed confidence sentence, never name an emitter)
  - [x] 3.2 `.env.dev` (same bucket and role as the Earth Analyst, `EARTHDATA_TOKEN` from `.env.spikes`); `DEPLOY_TARGET=dev ./deploy.sh` → `methane_hunter_dev` v1; confirm env vars persisted (token present, never printed); smoke invoke with `{"prewarm": true}` then one prompt
  - [x] 3.3 `golden_prompts.json` (`plumes-permian`, `triage-permian`, `strongest-plume`); `scripts/eval.py --agent {earth,methane}` (agent dir, yaml, default prompts file; `earth` default keeps every existing invocation working); live run against `methane_hunter_dev`; calibrate from the recorded streams; record seconds. **Measure** warm triage of 30 Permian plumes (target < 20 s) and record here
  - [x] 3.4 Manual prompts on dev through the local UI with `AGENT_RUNTIMES` extended locally (`react-ui/backend/.env`): the three prepared prompts in order; confirm the display → triage → plume → ground order, the confidence sentence in the closer, and that no emitter is named
  - _Requirements: 1.5 (eval part), 2.*, 3.*, 4.5, 4.6, 7.3_
  - Results (built Sep 24–25, ahead of Week 4a):
    - 1–2: commit `233858f`; `pytest` in `agents/methane-hunter/` = 59 passed (search 19, triage/show 31, staging 5, entrypoint 4); `geo_agent/` = 117 passed. Earth Analyst `DRY_RUN=1` plans unchanged.
    - 3.2: `methane_hunter_dev-rIr0SoGuR2` deployed (5 deploys by Sep 25); env vars persisted, `EARTHDATA_TOKEN` present (not printed); prewarm smoke returned "warm".
    - 3.3 live triage, Permian 2024 (39 plumes, not 30): cold 23.4 s (S3 cache empty; 39 downloads), warm 0.8 s (cache hits). The < 20 s target is for warm; the demo runs warm (`prewarm` + cache already populated). Rank 1: `EMIT_L2B_CH4PLM_002_20240131T182459_002534`, 8,130.7 ppm·m, 2.0 km² ≥ 500 ppm·m, Midland County TX.
    - 3.3 eval runs 1–4: 0/3 → 2/3. Run 4: `triage-permian` 46 s PASS (158-char closer), `strongest-plume` 69 s PASS, `plumes-permian` FAIL (stopped after search as designed, but ended on an offer "Would you like me to rank them…?" instead of the closer). Fix (run 5, deployed Sep 25): HARD RULE 2 now says every answer ends with the closer, offers go above it; stop-early closer example; stale "last 90 days" wording removed. `eval.py` gains `closer_endswith` and keeps the tail of `report_text` (a head cut at 1,500 chars made run 4's complete `strongest-plume` closer look truncated). Run 5 (Sep 25): **3/3 PASS**: `plumes-permian` 12 s, `triage-permian` 22 s, `strongest-plume` 50 s (warm cache). Closers: "EMIT detected 39 methane plume complexes over the Permian Basin in 2024. EMIT sees the methane, not its source." (111 chars) and "The strongest plume EMIT … peaked at 8,130.7 ppm·m near Midland, Texas, on 2024-01-31. EMIT sees the methane, not its source." (158 chars) for the other two. Earth Analyst `eval.py --target dev` after the `eval.py` changes: **8/8 PASS** (30–63 s).
    - Requirement 4.6 amended: the full confidence sentence is the record's last line; the spoken closer ends with the short form "EMIT sees the methane, not its source." and is ≤ 240 chars, because the 280-char caption band keeps the TAIL of a long paragraph (a long closer would show only the disclaimer).

## Week 4b (Oct 13–17): the platform knows two agents; replay case; G3

- [x] 4. `render` hints and the methane surface (frontend)
  - [x] 4.1 `/impeccable critique` the layers plate (legend row will be the second) and the map popup; record the brief in `.impeccable/surfaces/`
  - [x] 4.2 `utils/render.ts`: `parseRenderHint` (allowlists, finite rescale, character-filtered labels), `tileParamsFor`; `parsing.ts` carries `render` on rasters and geometries; types updated; `ChatSidebar` forwards it
  - [x] 4.3 `MapView.tsx`: raster branch prefers the hint; vector `kind` branch (graduated outlines by `property`, ranked vs detected tiers, rank labels, numbers-only popup); `groupLayers` `methane` by hint or `ch4plm_` basename; "Methane" group after Change detection with legend row (plasma bar, `0` / `1500 ppm·m` mono). Fallback path unchanged: the Earth Analyst's layers render exactly as before (existing vitest cases stay green)
  - [x] 4.4 `ChatSidebar.tsx`: `PREPARED_PROMPTS` keyed by agent id with `default` fallback; the three methane plates
  - [x] 4.5 `render.test.ts` (accept/reject matrix, tile params), `layerFormatting.test.ts` (methane grouping by hint and basename, prompts per agent + fallback), `parsing.test.ts` (render passthrough, junk dropped)
  - [x] 4.6 DESIGN.md: plasma methane ramp + graduated footprints; plate order; legend rule now covers methane and similarity
  - [x] 4.7 `npm run build`, `npm test`, `npm run design:check` = 0, lint at baseline; `/impeccable polish`; headless Chrome DOM check (group, legend, rows) against dev
  - [x] 4.8 Critique additions (Sep 25 critique, 20/36; decisions approved by the user: dim basemap, top 3 lit, camera follows): basemap dims while a methane layer is visible; the ranked footprints replace the detected ones; top 3 lit with `#rank · ppm·m` labels, the rest fog hairlines; camera fits the plume raster on arrival (hint `bounds` from `show_plume`) and the ground scene after it; the plume's own evidence chip (`methane/cache/` source → the session's `inspections/`); plain-language step labels; per-agent placeholder and idle caption; caption speaker label without "(dev)"
  - [x] 4.9 Agent side: the closer stays one sentence with a place name on follow-up turns; `eval.py` `setup_prompt` (two turns, one session) and golden prompt `strongest-followup`
  - _Requirements: 4.1, 4.2, 4.3, 5.2, 5.4, 7.2_
  - Results (built Sep 25, ahead of Week 4b):
    - 4.1 critique `.impeccable/critique/2026-09-25T13-31-23Z__…chat-tsx.md`: 20/36 (P0 ×2: no camera, invisible plume; P1 ×2: ranking not on the map, wrong-agent chrome). Detector 0 then and after. Closed by the polish pass after every P0/P1 was addressed.
    - 4.2–4.5: `utils/render.ts` (allowlist validator, tile params, plasma ramp) and `utils/stageCopy.ts` (per-agent prompts/placeholder/idle, speaker label, step names); methane group + legend, lit top 3 with centre labels, fog hairlines, ranked replaces detected, basemap dim, camera (hint `bounds` → TiTiler `/cog/bounds`, verified live → geometry); the plume's evidence chip; layer dates read as written (the "2023-12-28 - Dec 27 2023" bug was a UTC parse). Deviation: two methane plates, not three (design.md Deviations 6).
    - 4.7: `npm run build` 0; `npm test` 87 passed (8 files; +render, +stageCopy, +methane grouping/dates/evidence/parsing cases); `npm run design:check` 0; eslint on touched files at the HEAD baseline (no new findings). Headless Chrome 1920×1080 before/after captures of the two beats on the local UI against `methane_hunter_dev` v4 (not committed; `/tmp`). Mobile not checked: stage-only surface (PRODUCT.md), projector resolution still unconfirmed.
    - 4.9: `methane_hunter_dev` v4 (env vars persisted, token present). `eval.py --agent methane --target dev`: **4/4 PASS** — `plumes-permian` 11 s, `triage-permian` 27 s, `strongest-plume` 50 s, `strongest-followup` 34 s (two turns, one session; closer names Midland, no coordinates). Earth Analyst `eval.py --target dev` after the `eval.py` changes: **8/8 PASS** (28–68 s). pytest: methane 60, geo_agent 117.
    - Not done here (P3 from the critique, recorded): the transcript drawer overlaps the caption band's right end when open; the agent picker in the rail still shows "(dev)" (presenter control; the stable labels in `frontend-cdk/.env`, task 5.1, carry no suffix).

- [ ] 5. Two agents end to end
  - [ ] 5.1 `react-ui/backend/.env` and `frontend-cdk/.env`: `AGENT_RUNTIMES` gains `methane` (stable first, then dev, then methane); `promote.sh` env check requires `"methane"`; `cdk synth` shows the task role gaining exactly the methane ARN
  - [ ] 5.2 `scripts/promote.sh`: `--agent`-aware: eval both agents, then `geo_agent` stable deploy, then `agents/methane-hunter` stable deploy, one tag; `DRY_RUN=1` prints all of it; `.env` for the methane stable runtime prepared (`EARTHDATA_TOKEN`, refreshed token noted in the runbook)
  - [ ] 5.3 Switcher check on the local UI: three entries, prompts change with the agent, session reset and pre-warm on switch, stop-session routes to the right runtime
  - [ ] 5.4 Security (pre-existing gap, found Sep 24): `react-ui/backend/src/index.ts` `/api/presigned-url` signs any bucket/key it is given. Restrict to `S3_BUCKET_NAME` and the prefixes the UI reads (`session_data/<caller's session>/`, `use-cases/`, `methane/cache/`); reject everything else with 403; unit test the allow/deny matrix. Must land before G3 promotes Release 2
  - _Requirements: 1.5, 5.1, 5.3_

- [ ] 6. Replay case `methane-permian-2025`
  - [ ] 6.1 Run the three prompts once on dev, capture the tool calls and results; build `use-cases/methane-permian-2025/` (`config.json` with `agent`, `tool_calls`, `assets.layers[]`; `geometry.geojson` = ranked footprints; the top plume's `ch4plm_*.tif`; its Sentinel-2 TCI; `narrative.md`; card icon png); stage to `s3://<bucket>/use-cases/methane-permian-2025/`
  - [ ] 6.2 Backend `/api/scenario/:id`: pass validated `assets.layers[]` through; `Chat.tsx` renders `assets.layers[]` with hints when present; `UseCaseGallery.tsx` card → `/?scenario=methane-permian-2025&agent=methane`; `scenario_loader.py` context wording made agent-neutral (no "burned")
  - [ ] 6.3 Verify: loads on the local UI with the network tab showing no CMR/LP DAAC calls; headless Chrome timing on CloudFront after promotion (< 10 s)
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 7. Gate G3 (Friday Oct 17) and rehearsal
  - [ ] 7.1 `pytest -q` in `geo_agent/` and `agents/methane-hunter/`, `npm test`, `npm run design:check`, `eval.py --agent earth --target dev` (8), `eval.py --agent methane --target dev` (3); record counts below
  - [ ] 7.2 `PROMOTE_FRONTEND=1 scripts/promote.sh`: tag `deployed-2026-10-17`, both stable runtimes deployed, CloudFront UI deployed; env vars confirmed on both runtimes (token present on methane), one smoke invoke each, `eval.py --agent methane --target stable --only strongest-plume`, `eval.py --agent earth --target stable --only similar-central-park`; push `develop`, `demo-stable`, tag
  - [ ] 7.3 Rehearse Act 1 then Act 2 back to back on the CloudFront URL, pre-warmed, twice; record all four timings; apply fallbacks if over 7:30 and record
  - [ ] 7.4 `ROADMAP.md` row 4 status + G3 result; Week 5 (`ai-archaeologist`) notes: what the archaeologist reuses (`render` hints, `find_similar_places`, `inspect_image`)
  - _Requirements: 7.3, 7.4, 7.5_

## Gate log

- (Oct 10 checkpoint: dev runtime version, three golden prompts, triage timing)
  - Sep 25 (early): dev runtime `methane_hunter_dev-rIr0SoGuR2` live; triage cold 23.4 s / warm 0.8 s for 39 plumes; golden prompts 3/3 on run 5 (12 / 22 / 50 s); Earth Analyst dev 8/8. Checkpoint met early.
  - 3.4 (Sep 25, local UI, user): both prompts work end to end on `methane_hunter_dev`; verdict "working, a bit clunky and not visually pleasing" — expected before task 4 (hints ignored, file-name fallback styling). Task 4 critique takes this as its starting brief.
- (Oct 17 G3: commands with counts, tag, both stable smokes + evals, four rehearsal timings)
