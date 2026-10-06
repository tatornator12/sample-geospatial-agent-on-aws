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
| `watch_tools.py` | Methane Watch: `watch_baseline`, `scan_tropomi` (tip), `check_recent_passes` (cue), `site_history` |
| `ground_tools.py` | The ground record: `thermal_anomalies` (VIIRS via FIRMS), `nearby_infrastructure` (Overture Maps, types only) |
| `overture.py` | Overture Maps on AWS Open Data through DuckDB: the category vocabulary, the file index, area extracts, the live query |
| `brief_tools.py` | `draft_brief` (a draft, never filed; embeds the checks) and `brief_status` (the only source for "filed") |
| `build_replay_case.py` | Records a live run into `use-cases/<id>/` (`--case permian` or `--case watch`) |
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

`FIRMS_MAP_KEY` is optional but recommended: the flare check (`thermal_anomalies`) reads 30 nights
of VIIRS detections through NASA FIRMS's area API with it, and only the public 7-day file without
it. Register in a minute at https://firms.modaps.eosdis.nasa.gov/api/map_key/ and add the key to
`.env.dev` and `.env`. Sent only to `firms.modaps.eosdis.nasa.gov`, never logged.

The infrastructure check (`nearby_infrastructure`) reads Overture Maps GeoParquet straight from the
AWS Open Data bucket (`s3://overturemaps-us-west-2`, release pinned in `overture.py`) with DuckDB:
no server in between, and only `subtype`, `class` and the bbox are ever selected, never a name.
`scripts/warm_watch.py` builds, once per release, a file index (each parquet file's bbox) and an
extract of everything mapped inside each watch area into `methane/cache/`, so a check inside a watch
area is one small S3 read and a check anywhere else opens one to five files within a 40 s budget.
Run it the day before a show (it warms both checks for every watch hotspot). `requirements-agent.txt`
holds the agent-only pins (`duckdb`); `stage_shared.sh` appends them to the platform requirements and
bakes DuckDB's `httpfs` extension into the image so the first read never downloads it.

## Data notes

- Collection `EMITL2BCH4PLM.002`: 1,686 plume complexes from 2022-08-10; the most recent is
  2025-09-22 and the collection is sparse after 2024. The default window is therefore the 12 months
  ending at the collection's latest plume, not "the last 90 days".
- Plume rasters are CH4 column enhancement in ppm·m with background noise around the plume, so
  area and mean are reported over pixels at or above 500 ppm·m. Ranking is by max enhancement.
- Plume GeoTIFFs are cached once in `s3://<bucket>/methane/cache/` and shared across sessions, so
  rehearsals and the show never depend on LP DAAC after the first triage.
