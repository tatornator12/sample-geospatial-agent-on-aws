# Tasks: demo-foundation (Week 1, Sep 15–19)

Gate G1 (Fri Sep 19): dev runtime reachable from the local UI through the agent switcher;
`pytest`, `npm test`, `npm run design:check` and `scripts/eval.py --dry-run` all run; four
spike notes exist under `docs/spikes/`.

- [x] 1. Put the deployed code under version control
  - [x] 1.1 `git init` in the workspace, add `origin` (aws-samples) and `fork` remotes, fetch `origin/main`
  - [x] 1.2 Reset the index to `origin/main` and normalise file modes so only real changes remain
  - [x] 1.3 Commit the ArcGIS Enterprise MCP integration (11 modified files + `utils/mcp_http.py`) on `demo-stable`, tag `deployed-2026-09-15`
  - [x] 1.4 Branch `develop`; update `.gitignore` (track `.kiro/{specs,hooks,skills,steering}`, ignore `.kiro/settings/`, `pr-drafts/`, `.env.dev`, `.env.stable`, Impeccable binary and ephemera)
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Guard the deploy scripts
  - [x] 2.1 Create `geo_agent/deploy_lib.sh` with `resolve_deploy_target` and `run` (dry-run with secret redaction)
  - [x] 2.2 Rewrite `deploy.sh` and `deploy_with_langfuse.sh` to require `DEPLOY_TARGET`, per-agent ECR repos, `--name`/`--agent`, and the toolkit-CLI check
  - [x] 2.3 Test: no target, stable without confirm, bogus target, dev without `.env.dev` all refuse; dry runs for both targets and both scripts print redacted commands
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Install the Impeccable toolchain
  - [x] 3.1 `npx impeccable install --providers=kiro --scope=project --no-hooks` (skill v4.3.1, engine v0.1.5)
  - [x] 3.2 Add `npm run design:check` to `react-ui/frontend/package.json`
  - [x] 3.3 Create Kiro hook `impeccable-design-check` (PostToolUse on edit tools) and record the 6-finding baseline in `ROADMAP.md`
  - [x] 3.4 Run `/impeccable init`: `PRODUCT.md` written (audience: AWS customer technical leaders and architects, presenter-driven, no hands-on; headline: one map, many agents on AgentCore; demo name "Agentic AI for Earth"); live mode configured (`.impeccable/live/config.json`, no CSP)
  - [x] 3.5 Redesign instead of document-the-incumbent: `/impeccable document` became a new-work round (the presenter rejected the Material 3 UI). Direction roll chose "The Planetarium Show" (seed key `8e283055`); first build of the Stage landed (`stage.css`, `Icons.tsx`, `StepColumn.tsx`, rewritten `Chat.tsx`, `ChatSidebar.tsx`, `MapView.tsx`, `Navigation.tsx`, `ToolCallDisplay.tsx`, `theme.ts`, `index.css`); detector at 0 findings; `DESIGN.md` and `.impeccable/design.json` written from the built world
  - [ ] 3.6 Visual pass on the live UI (`npm run dev` in `react-ui/backend` and `react-ui/frontend`): check the caption band, step column and layers plate against a real run; `/impeccable polish` the Stage; then the spotlight sweep (transform-based) and active-layer desaturation raises
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4. Stand up the dev runtime
  - [x] 4.1 Review `.env.dev` (created as a copy of `.env`; same bucket and role are fine), then `DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh` and inspect
  - [x] 4.2 `DEPLOY_TARGET=dev ./deploy.sh`; record the new runtime ARN from `.bedrock_agentcore.yaml` under `geospatial_agent_dev`
    - Runtime: `arn:aws:bedrock-agentcore:us-east-1:419324627248:runtime/geospatial_agent_dev-oSBUFd3SUQ` (version 2, image tag `20260917-150237-595`)
    - First image crash-looped at import (`libxml2.so.16` missing: Miniconda `defaults` base mixed with conda-forge). Dockerfile now uses pinned Miniforge, strict channel priority, pinned `sqlite`/`libsqlite`, and a build-time `import rasterio, geopandas, ...` assertion so a broken native stack fails the CodeBuild step instead of the runtime
  - [x] 4.3 Verify env vars persisted on the runtime and run one smoke invoke (`invoke --agent geospatial_agent_dev`); expect a `display_visual` call and no `Error:`
    - 8 env vars present; Hyde Park NDVI prompt returned mean NDVI 0.47 with 3 `display_visual` calls, runtime logs show only the usual COG/Langfuse warnings
  - _Requirements: 3.1, 3.3_

- [x] 5. Add the agent switcher (backend)
  - [x] 5.1 Parse `AGENT_RUNTIMES` JSON with fallback to `AGENT_RUNTIME_ARN` as agent `default`; one AgentCore client per region
    - Invalid JSON, a non-object, a bad ARN or an empty map fail at startup with a named error; no agent at all only warns (invoke answers 503)
  - [x] 5.2 Add `GET /api/agents`; accept `agentId` on `/api/agent/invoke` and `/api/agent/stop-session`; 400 on unknown id
    - `GET /api/agents` returns `{ defaultAgentId, agents: [{ id, label, description }] }`; unknown id is a plain 400 before SSE headers are sent. Verified locally with two agents and a real invoke through the backend to the dev runtime (59 chunks, `done`)
  - [x] 5.3 Update `react-ui/backend/.env.example` and `frontend-cdk` task environment to pass `AGENT_RUNTIMES` (leave the stable stack undeployed this week)
    - CDK validates the JSON at synth, passes it to the task and grants every listed ARN (+`/*`) on the task role; synth checked with and without it. Not deployed
  - _Requirements: 4.1, 4.2, 4.4_

- [ ] 6. Add the agent switcher (frontend)
  - [ ] 6.1 `/impeccable shape` the header agent picker (label, one-line description, keyboard accessible, projector legible)
  - [ ] 6.2 `services/api.ts`: `listAgents()`; pass `agentId` on invoke/stop; `Chat.tsx`: `selectedAgentId` in `localStorage`, switching triggers `handleSessionReset()`
  - [ ] 6.3 `Navigation.tsx`: render the picker; run `npm run design:check` and fix findings in touched files
  - [ ] 6.4 Local UI round-trip against both runtimes (`AGENT_RUNTIMES` with `default` and `dev`)
  - _Requirements: 3.2, 4.3_

- [ ] 7. Test scaffolding: Python
  - [ ] 7.1 `geo_agent/tests/conftest.py` fixtures built on the fly: 256×256 float32 COG, 2 km AOI GeoJSON, 50-row synthetic LGND parquet (256-dim embeddings)
  - [ ] 7.2 `test_geometry.py` (`_slugify` accents/punctuation, `bbox_around_point` closure and centre), `test_raster_utils.py` (`clip_raster_v2` keeps CRS, output is a COG)
  - [ ] 7.3 `test_lgnd_handler.py`: run the handler's similarity SQL against the synthetic partition via a local path
  - [ ] 7.4 Add `pytest` and `pytest-cov` (pinned) to a `geo_agent/requirements-dev.txt`; document `cd geo_agent && ../.venv/bin/python -m pytest -q`
  - _Requirements: 5.1_

- [ ] 8. Test scaffolding: frontend
  - [ ] 8.1 Add pinned `vitest`, `@testing-library/react`, `jsdom` dev deps and a `test` script
  - [ ] 8.2 `src/utils/parsing.test.ts`: complete JSON, truncated `input`, duplicate ids, `.geojson` vs `.tif`, date and cloud-cover extraction; `src/services/api.test.ts`: `listAgents` parsing
  - _Requirements: 5.2_

- [ ] 9. Golden prompts and promotion script
  - [ ] 9.1 `scripts/golden_prompts.json`: the five README prompts plus one drawn-polygon prompt, each with `expected_tools` and `forbidden_text`
  - [ ] 9.2 `scripts/eval.py --target dev|stable [--dry-run]`: resolve ARN by agent name from `.bedrock_agentcore.yaml`, stream `InvokeAgentRuntime`, brace-match tool JSON, subsequence-check tool order, fail on `Error:`
  - [ ] 9.3 `scripts/promote.sh`: eval → checklist → explicit `yes` → `git switch demo-stable && git merge --ff-only develop && git tag deployed-$(date +%F)` → `DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh` → back to `develop`
  - [ ] 9.4 Run `eval.py --target dev` for real once the dev runtime exists; fix golden expectations to match actual tool order
  - _Requirements: 5.3, 5.4_

- [ ] 10. Data spikes (2 hours each, stop at the timebox)
  - [ ] 10.1 EMIT: fetch the plume GeoJSON, render one `CH4PLM` COG via TiTiler → `docs/spikes/emit.md`
  - [ ] 10.2 3DEP: one 1 m DEM tile over Newark Earthworks or Poverty Point, hillshade + local relief → `docs/spikes/lidar.md`
  - [ ] 10.3 OPERA DISP-S1: Earthdata token → `us-west-2` S3 read of one frame, one pixel time series, timing → `docs/spikes/disp-s1.md`
  - [ ] 10.4 Dark Vessels: one month of Channel Islands AIS into DuckDB; one Sentinel-1 GRD scene (requester-pays, `eu-central-1`); CFAR on VV; count targets and AIS matches → `docs/spikes/dark-vessels.md` with the unmatched count that drives the Oct 24 decision
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 11. Friday gate G1
  - [ ] 11.1 Run `pytest -q`, `npm test`, `npm run design:check`, `python scripts/eval.py --target dev --dry-run`; all green
  - [ ] 11.2 Commit `develop`, push `develop` and `demo-stable` (with tag) to `fork`
  - [ ] 11.3 Record the gate result and spike verdicts at the bottom of this file; create `.kiro/specs/eyes-inspect-image/` for Week 2
  - _Requirements: all_

## Gate log

- (append Friday results here)
