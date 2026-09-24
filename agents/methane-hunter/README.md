# Methane Hunter (Act 2)

An Amazon Bedrock AgentCore runtime that finds methane plume complexes detected by NASA EMIT,
ranks them by enhancement, shows the strongest in plasma, and looks at the ground beneath it with
Sentinel-2. Spec: `.kiro/specs/methane-hunter/`. Data spike: `docs/spikes/emit.md`.

## Layout

| File | Role |
|---|---|
| `methane_hunter.py` | Entrypoint: pre-warm short-circuit, S3 sessions, tool-call streaming (same contract as the Earth Analyst) |
| `methane_config.py` | Prompt and settings; re-exports the platform `config` (never name an agent file `config.py`) |
| `methane_tools.py` | `search_methane_plumes` (CMR), `triage_plumes` (LP DAAC + stats + ranking), `show_plume` |
| `_paths.py` | Puts the shared platform code first on `sys.path`: `_geo_agent/` in the image, `../../geo_agent` in the repo |
| `stage_shared.sh` | Copies the allowlisted platform code into `_geo_agent/`, copies `requirements.txt`, generates `Dockerfile` (all gitignored) |
| `deploy.sh` | `DEPLOY_TARGET=dev|stable` deploy via `geo_agent/deploy_lib.sh` (`methane_hunter_dev` / `methane_hunter`) |
| `golden_prompts.json` | Eval cases for `scripts/eval.py --agent methane` |

## Run the tests

```bash
cd agents/methane-hunter
../../.venv/bin/python -m pytest
```

No network, no AWS: CMR comes from a recorded page, LP DAAC downloads are patched, S3 is faked.

## Deploy

```bash
cp .env.example .env.dev    # fill in; same bucket and role as the Earth Analyst
DRY_RUN=1 DEPLOY_TARGET=dev ./deploy.sh
DEPLOY_TARGET=dev ./deploy.sh
```

`EARTHDATA_TOKEN` is required (LP DAAC plume downloads). It expires after 60 days: refresh it the
week before a show. It is only ever sent to `data.lpdaac.earthdatacloud.nasa.gov` and never logged.

## Data notes

- Collection `EMITL2BCH4PLM.002`: 1,686 plume complexes from 2022-08-10; the most recent is
  2025-09-22 and the collection is sparse after 2024. The default window is therefore the 12 months
  ending at the collection's latest plume, not "the last 90 days".
- Plume rasters are CH4 column enhancement in ppm·m with background noise around the plume, so
  area and mean are reported over pixels at or above 500 ppm·m. Ranking is by max enhancement.
- Plume GeoTIFFs are cached once in `s3://<bucket>/methane/cache/` and shared across sessions, so
  rehearsals and the show never depend on LP DAAC after the first triage.
