# Requirements: demo-foundation (Week 1, Sep 15–19)

## Introduction

Before any new capability is built for the Nov 9 demo, the project needs a safety net and a
platform shape that lets four more agents be added without touching the runtime that is
currently live. This spec covers version control, a guarded deploy path, a dev lane, the
multi-agent switcher, test scaffolding, the Impeccable design toolchain, and the timeboxed
data spikes whose results decide Act 3.

## Requirements

### Requirement 1: Version control and stable baseline

**User Story:** As the builder, I want the code that is live on the demo runtime captured in
git, so that every later change can be diffed, reverted and promoted deliberately.

#### Acceptance Criteria

1. WHEN the workspace is inspected THEN it SHALL be a git repository with `origin` pointing at
   `aws-samples/sample-geospatial-agent-on-aws` and `fork` at the personal fork.
2. WHEN `demo-stable` is checked out THEN the working tree SHALL equal what is deployed on the
   live runtime, including the ArcGIS Enterprise MCP integration, and SHALL carry a tag of the
   form `deployed-YYYY-MM-DD`.
3. WHEN development happens THEN it SHALL happen on `develop` or feature branches, never on
   `demo-stable` directly.
4. WHEN `git status` is run on a clean checkout THEN no secrets (`.env*`,
   `.bedrock_agentcore.yaml`, `*_role_info.json`, `.kiro/settings/`) SHALL be tracked or
   proposed for tracking.

### Requirement 2: Guarded deploys

**User Story:** As the builder, I want deploys to name their target explicitly, so that an
accidental `./deploy.sh` can never overwrite the live demo runtime.

#### Acceptance Criteria

1. WHEN `deploy.sh` or `deploy_with_langfuse.sh` runs without `DEPLOY_TARGET` THEN it SHALL
   exit non-zero with usage help and perform no AWS calls.
2. WHEN `DEPLOY_TARGET=stable` is set without `CONFIRM_STABLE=yes` THEN the script SHALL
   refuse.
3. WHEN `DEPLOY_TARGET=dev` is set THEN the script SHALL configure and launch a separate
   agent runtime (`geospatial_agent_dev` by default, overridable via `DEV_AGENT_NAME`), use
   its own ECR repository, read `.env.dev`, and always address the runtime with `--agent`.
4. WHEN `DRY_RUN=1` is set THEN the script SHALL print every command it would run, with
   token/secret values redacted, and execute nothing.
5. WHEN the `agentcore` binary on PATH is not the starter-toolkit CLI THEN the script SHALL
   detect this and fail with a message pointing to `AGENTCORE_BIN`.

### Requirement 3: Dev lane

**User Story:** As the builder, I want a dev runtime and a local UI wired to it, so that I can
iterate on tools and prompts without touching the live runtime or CloudFront deployment.

#### Acceptance Criteria

1. WHEN `DEPLOY_TARGET=dev ./deploy.sh` completes THEN a runtime named `geospatial_agent_dev`
   SHALL exist with the same env vars as stable (bucket and role may be shared).
2. WHEN the local UI (`react-ui/backend` + `react-ui/frontend` dev servers) is started with
   the dev runtime ARN THEN a prompt SHALL round-trip through the dev runtime and render on the
   map.
3. WHEN a smoke invoke is run against the dev runtime THEN the response SHALL contain no
   `Error:` text and at least one `display_visual` tool call.

### Requirement 4: Agent switcher

**User Story:** As a presenter, I want to switch between agents in the same UI, so that each
act of the demo runs on its own runtime while the audience sees one product.

#### Acceptance Criteria

1. WHEN the backend starts with `AGENT_RUNTIMES` (JSON map of `agentId` to
   `{ arn, label, description }`) THEN `GET /api/agents` SHALL return the list, and
   `POST /api/agent/invoke` SHALL accept an optional `agentId` and invoke that runtime.
2. WHEN `AGENT_RUNTIMES` is absent THEN the backend SHALL fall back to `AGENT_RUNTIME_ARN` as a
   single agent named `default`, so the current deployment keeps working unchanged.
3. WHEN the user changes the agent in the header THEN the session SHALL reset (new session id,
   cleared layers) and subsequent prompts SHALL go to the selected agent.
4. WHEN `/api/agent/stop-session` is called THEN it SHALL target the runtime of the agent that
   owns the session.

### Requirement 5: Test scaffolding

**User Story:** As the builder, I want unit, contract and golden-prompt tests in place, so
that every later spec can name its tests and Friday gates are mechanical.

#### Acceptance Criteria

1. WHEN `pytest` runs in `geo_agent/` THEN a `tests/` package with fixtures (a 256×256 COG
   chip, a small GeoJSON AOI, a synthetic LGND parquet partition) SHALL execute and pass at
   least one real test per fixture (e.g. `_slugify`, `bbox_around_point`, `clip_raster_v2`).
2. WHEN `npm test` runs in `react-ui/frontend` THEN vitest SHALL execute tests for
   `parseToolCalls` and `extractAllVisualizationData` covering complete, truncated and
   duplicate tool-call JSON.
3. WHEN `scripts/eval.py --target dev` runs THEN it SHALL invoke the dev runtime with the
   golden prompts in `scripts/golden_prompts.json`, assert the expected tool names appear in
   order, assert no `Error:` text, and exit non-zero on any failure.
4. WHEN `scripts/promote.sh` runs THEN it SHALL run eval against dev, print the promotion
   checklist, and only then (after an explicit `yes`) fast-forward `demo-stable`, tag it, and
   invoke the stable deploy with `CONFIRM_STABLE=yes`.

### Requirement 6: Impeccable design toolchain

**User Story:** As the builder, I want Impeccable installed and wired into the workflow, so
that UI work is guided by its commands and checked by its detector.

#### Acceptance Criteria

1. WHEN the workspace is opened in Kiro THEN the `impeccable` skill SHALL be available under
   `.kiro/skills/impeccable` and `/impeccable <command>` SHALL work.
2. WHEN the agent edits a file under `react-ui/frontend/src` THEN a Kiro hook SHALL instruct
   it to run the detector and fix findings before finishing.
3. WHEN `npm run design:check` runs in `react-ui/frontend` THEN the detector SHALL scan `src/`
   and exit 0 when clean, 2 when findings exist.
4. WHEN `/impeccable init` and `/impeccable document` have been run THEN `PRODUCT.md` and
   `DESIGN.md` SHALL exist at the repo root describing the demo audience (technical
   decision-makers, projector, Operate mode) and the current visual system from `theme.ts`.
5. WHEN the Impeccable engine binary is present THEN it SHALL be gitignored (12 MB; the
   launcher re-downloads it).

### Requirement 7: Data spikes (timeboxed, 2 hours each)

**User Story:** As the builder, I want each candidate data source proven or disproven in a
fixed timebox, so that the Oct 24 Act 3 decision is based on evidence.

#### Acceptance Criteria

1. WHEN the EMIT spike runs THEN a note in `docs/spikes/emit.md` SHALL record whether the
   plume list was fetched, one `CH4PLM` COG rendered through TiTiler, and the access path used.
2. WHEN the 3DEP spike runs THEN `docs/spikes/lidar.md` SHALL record a hillshade rendered from
   one 1 m DEM tile over a public earthwork (Newark Earthworks or Poverty Point).
3. WHEN the OPERA spike runs THEN `docs/spikes/disp-s1.md` SHALL record whether one DISP-S1
   frame opened from `us-west-2` with an Earthdata token and the time to extract one pixel
   time series.
4. WHEN the maritime spike runs THEN `docs/spikes/dark-vessels.md` SHALL record whether one
   month of Channel Islands AIS loaded into DuckDB, one Sentinel-1 scene was found and CFAR
   produced offshore targets, and how many were unmatched to AIS. The Act 3 decision rule:
   Dark Vessels only if unmatched targets exist.
5. WHEN a spike exceeds two hours THEN it SHALL stop and record "not proven in timebox".
