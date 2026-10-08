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
| `ground_tools.py` | The ground record: `thermal_anomalies` (VIIRS via FIRMS), `nearby_infrastructure` (Overture Maps, types only), `registry_lookup` (OGIM public registry, operators of record) |
| `overture.py` | Overture Maps on AWS Open Data through DuckDB: the category vocabulary, the file index, area extracts, the live query |
| `registry.py` | The OGIM registry cells: cell keys, the disk cache, the DuckDB box query, chord distance, the fixed sentence |
| `../../scripts/build_registry.py` | Turns the OGIM GeoPackage into per-cell Parquet under `methane/registry/<version>/` |
| `brief_tools.py` | `draft_brief` (a draft, never filed; embeds the checks) and `brief_status` (the only source for "filed") |
| `build_replay_case.py` | Records a live run into `use-cases/<id>/` (`--case permian` or `--case watch`) |
| `../../scripts/warm_plumes.py` | Builds the whole-record plume index (`methane/cache/plume_index_v001.json`: every plume with NASA's max concentration and emission rate) so `search_methane_plumes(region="global")` answers "the strongest plume EMIT has ever seen"; `--top 50` caches those rasters |
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

## The public registry check (operators of record)

`registry_lookup` answers "which company?" from open data, as a listing and never as a cause. It
reads OGIM v3.0, the Oil and Gas Infrastructure Mapping database (Environmental Defense Fund and
MethaneSAT LLC, a compilation of public records from governments, industry and others; 4.5 million
wells, 1.9 million pipeline features and the plants, stations, terminals, platforms and tank
batteries around them, in 193 countries). Licence CC BY 4.0, Zenodo DOI
[10.5281/zenodo.7466757](https://doi.org/10.5281/zenodo.7466757). The attribution travels with every
answer: the check's sentence says "the public registry", the record keeps the source and its dates.

What it says: the facilities on record within 2 km by kind (nearest distance), the operators of
record by facility count (up to three, then "and N more"), how many have no operator on record, and
the years the source records are dated. Example from the Permian:

> The public registry lists within 2 km: 192 pipelines (0 km), 120 wells (0.2 km); operators of
> record: … (94 facilities), … (78 facilities) and 26 more; 4 with no operator on record; records
> dated 2020 to 2025.

What it does not say: who emitted, who owns a site today, or anything the registry does not list (a
gap is not an empty site). Coverage is uneven, measured on the built cells: the United States has
4.1 million facilities, 86% with an operator of record; Algeria 149 (19%), Iran 196 (7%),
Turkmenistan 82 (1%), China 14,578 (1%). Outside North America expect "no operator on record" or
nothing listed, and say so. An operator name
appears in ONE place only, this tool's sentence, quoted as written; the prompt forbids "behind",
"responsible", "caused by", "owned by" and "operated by", `draft_brief` rejects a company suffix in
the model's own fields, and `scripts/eval.py` checks the operator tripwires on the stream with the
session's recorded registry sentences removed, so the same name in the agent's own words fails.

Build (once per OGIM release; about two minutes and 180 MB of output):

```bash
curl -L -o /tmp/ogim/OGIM_v3.0.gpkg https://zenodo.org/api/records/22835235/files/OGIM_v3.0.gpkg/content
md5 -q /tmp/ogim/OGIM_v3.0.gpkg           # 99d94e96eefe4d7f561d1a2dbcc1a313 (3.4 GB)
AWS_PROFILE=main ../../.venv/bin/python ../../scripts/build_registry.py /tmp/ogim/OGIM_v3.0.gpkg --upload
```

It writes one Parquet file per 5° × 5° cell to `methane/registry/ogim_v3.0/` (644 cells, the
largest 28 MB, Alberta) with kind, type, status, operator of record, country, state, source date and
a box per row; facility names are not carried. Pipelines are simplified to 20 m and cut into
straight chords of at most 2 km, so the distance is to the pipe, not to a bounding box that can
span a state. The build needs `pyogrio`, `shapely` and `pyarrow` locally; the runtime needs only
`duckdb`: it copies the one to four cells a 2 km box touches to `/tmp` (kept a day) and queries them.

## Slack on a filed brief (optional)

The UI backend posts one message to Slack when the analyst clicks "Approve and file"
(`react-ui/backend/src/slack.ts`): the card's title and place, the counts, the confidence, the
ground-record sentences (heat, mapped infrastructure, public registry), who filed it and the brief id. The agent never triggers it and never sees
it; a Slack failure never unfiles anything. Two webhook shapes work, and the backend tells them
apart by the URL:

- a Slack app's **incoming webhook** (`https://hooks.slack.com/services/T…/B…/…`): gets a Block
  Kit message, laid out by the backend;
- a **Workflow Builder** webhook trigger (`https://hooks.slack.com/triggers/T…/…/…`): gets a flat
  set of variables, and the workflow's own "Send a message" step does the layout. This is the one
  to use in a workspace that does not let members create apps.

### Setting up the Workflow Builder webhook (no app needed)

1. In Slack, open **Tools & settings → Workflow Builder** (or **More → Automations → Workflows**)
   and click **New Workflow → Build Workflow**.
2. For the start of the workflow, choose **From a webhook**.
3. Under **Set up variables**, add these twelve, each with data type **Text**, keys exactly as
   written (Slack matches the payload's keys to these names):
   `title`, `place`, `coordinates`, `evidence`, `confidence`, `single_explanation`, `hypotheses`,
   `ground_record`, `filed_by`, `filed_at`, `brief_id`, `markdown_key`.
4. Click **Continue**. Slack shows the **Web request URL**: copy it. That URL is the secret; it
   never goes in git.
5. Add a step: **Messages → Send a message to a channel**, pick the channel, and compose the
   message with **Insert a variable** for each field. A layout that reads well:

   ```
   Methane Watch brief filed: {title}
   {place} · {coordinates}
   Evidence: {evidence}
   Methane recurs here: {confidence}. Any single explanation: {single_explanation}.
   Unconfirmed hypotheses: {hypotheses}
   Ground record, gaps and next look:
   {ground_record}
   Filed by {filed_by} at {filed_at}. The analyst decided; the agent drafted.
   {brief_id} · {markdown_key}
   ```

6. **Finish Up**: name it (for example "Methane Watch filed briefs"), then **Publish**.
7. Test it before the backend does, from a terminal (fill the URL and keep every key present;
   a missing variable is an error on Slack's side):

   ```bash
   curl -sS -X POST "$SLACK_WEBHOOK_URL" -H 'Content-Type: application/json' -d '{
     "title": "Test brief", "place": "nowhere", "coordinates": "0.0000, 0.0000",
     "evidence": "0 of 0 recent passes are candidates; EMIT looked 0 times.",
     "confidence": "low", "single_explanation": "low without a ground or aircraft check",
     "hypotheses": "none listed", "ground_record": "No ground-record checks were run.",
     "filed_by": "test", "filed_at": "2026-10-07T00:00:00Z",
     "brief_id": "brief-00000000T000000-000000", "markdown_key": "s3://bucket/test.md"
   }'
   ```
   Slack answers `{"ok":true}` and the message appears in the channel.

Regenerating the webhook (Workflow Builder → the trigger → **Regenerate**) is how the URL is
rotated; put the new value where the old one was.

### Where the URL lives

- Local: put `SLACK_WEBHOOK_URL=https://hooks.slack.com/...` in `react-ui/backend/.env`
  (gitignored) and restart the backend; it logs `Slack on filed briefs: on (workflow webhook)`.
- CloudFront stack: the CDK creates the secret `geospatial-agent/<env>/slack-webhook` with a random
  placeholder (read as off); the deployed stack's `<env>` is `dev` (the CDK default), whatever the
  branch. Set it once and restart the tasks:
  ```bash
  aws secretsmanager put-secret-value --secret-id geospatial-agent/dev/slack-webhook --secret-string 'https://hooks.slack.com/services/...'
  aws ecs update-service --cluster geospatial-agent-dev --service geospatial-agent-dev --force-new-deployment
  ```
  Anything but a `hooks.slack.com` URL leaves the feature off, and the URL is never logged.

## Data notes

- Collection `EMITL2BCH4PLM.002`: 1,686 plume complexes from 2022-08-10; the most recent is
  2025-09-22 and the collection is sparse after 2024. The default window is therefore the 12 months
  ending at the collection's latest plume, not "the last 90 days".
- Plume rasters are CH4 column enhancement in ppm·m with background noise around the plume, so
  area and mean are reported over pixels at or above 500 ppm·m. Ranking is by max enhancement.
- Plume GeoTIFFs are cached once in `s3://<bucket>/methane/cache/` and shared across sessions, so
  rehearsals and the show never depend on LP DAAC after the first triage.
