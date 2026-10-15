# Requirements: act3-dark-vessels (Oct 16–30, started early)

Status: **DRAFT Oct 15, awaiting approval** (written ten days ahead of the Monday cadence because
Act 4 landed early; nothing is built until the user approves this and the design's decisions).

## Introduction

Act 3 is eight minutes: "It investigates, gathers evidence, and acts with approval." The persona
is the depicted marine sanctuary enforcement officer at the Channel Islands National Marine
Sanctuary. Every vessel that broadcasts AIS is already on a screen somewhere; the act asks about
the ones that did not. A Sentinel-1 radar pass sees every vessel-sized target on the water, lit
or not. The agent finds the pass, detects the targets, sets aside the oil platforms, matches the
rest against AIS, checks whether AIS could even hear that water at that hour, and only then says
which targets had no broadcast. It gathers the evidence for each, works out where a vessel that
went silent could have gone and when the radar can look again, and drafts a referral that the
officer, not the agent, approves.

The data is proven (`docs/spikes/dark-vessels.md`, Sep 17–18): one Sentinel-1 GRD pass over the
Santa Barbara Channel through Microsoft Planetary Computer (anonymous signing, tiled COG,
windowed reads), a two-parameter CA-CFAR over 3,000 km² of open water (19 targets in 19 s), and
NOAA's daily AIS files read by DuckDB (1 s a day once downloaded). Of 19 targets, 5 were oil
platforms, 7 sat in a proven AIS receiver gap (not evidence) and 7 had no broadcast within 500 m
in covered water, clustered where the market-squid fleet works (vessels under 65 ft need not
carry AIS). Rechecked Oct 15 for this spec: Planetary Computer still serves the spike's pass and
holds 67 passes over the channel in May–June 2026 (Sentinel-1A, 1C and 1D); NOAA's AIS files run
to Jun 30, 2026 and stop there (Jul 31 onward 404), so AIS lags three to four months and every
pass the act investigates is historical; ESA's published acquisition plan (KML, S1C and S1D, to
Nov 6, 2026) parses in 0.1 s and plans two passes a week that cover the whole channel.

The hard rules (`PRODUCT.md`, the spike's binding caveats): maritime findings are "candidates"
with stated confidence, never accusations; terrestrial AIS coverage gaps are not evidence on
their own, and the coverage check is shown before anything is called "dark"; the oil platforms
are set aside before anything is counted; no accuracy claims for the maritime agent; the agent
acts only with human approval.

Scope boundaries: no pass outside a curated catalogue of passes on file (each with its AIS
days); no Planetary Computer or NOAA read at run time (live AIS stays first on the ROADMAP cut
list, so it is not built); no water outside the Santa Barbara Channel and the sanctuary around
the northern Channel Islands; no trained forecasting model and no accuracy claims; no vessel
named, and no MMSI, IMO number or call sign shown, on the stage or in a referral; no automatic
action of any kind (the referral is filed only by the officer's click); no change to the other
three agents' behaviour; no model change (Sonnet 4.6 through the Nov 3 freeze).

## Requirements

### Requirement 1: A fourth agent runtime, built the platform way

**User Story:** As the builder, I want Dark Vessels to be its own runtime under
`agents/dark-vessels/` built exactly like the Methane Hunter and the AI Archaeologist, so that
Act 3 cannot break Acts 1, 2 and 4, and agent number four is a table row, not a copy.

#### Acceptance Criteria

1. WHEN `agents/dark-vessels/` is built THEN it SHALL contain its own entrypoint
   (`dark_vessels.py`, the shared runtime contract: prewarm short-circuit, S3 session manager,
   sliding window, the tool-call streaming wire format, replay-case prompt), `vessels_config.py`
   (prompt and model kwargs; not `config.py`), its own tool modules, `_paths.py`,
   `requirements-agent.txt` and `Dockerfile.extra` (DuckDB and its httpfs extension, as the
   Methane Hunter's), `deploy.sh`, `.env.example`, `golden_prompts.json`, `build_replay_case.py`
   and `tests/`.
2. WHEN the agent imports shared code THEN it SHALL come from the staged `_geo_agent/` copy
   through `geo_agent/stage_shared.sh`, with the staging allowlist test.
3. WHEN `deploy.sh` runs THEN it SHALL require `DEPLOY_TARGET=dev|stable` through
   `geo_agent/deploy_lib.sh` (runtimes `dark_vessels_dev` / `dark_vessels`, `CONFIRM_STABLE=yes`
   for stable, `DRY_RUN=1` redacted) and SHALL need no data token (every source is public and
   read ahead of time).
4. WHEN `scripts/eval.py`, `scripts/runtimes.py`, `scripts/bakeoff.py` and `scripts/promote.sh`
   run THEN each SHALL know the agent id `vessels` through its existing table (one row each).

### Requirement 2: Passes on file only

**User Story:** As the presenter, I want the agent to investigate only radar passes we have
prepared, with their AIS, so that nothing on stage waits on a 200 MB download or a third-party
service, and a question about a date we have no data for gets a plain answer.

#### Acceptance Criteria

1. WHEN the catalogue is built THEN `data/passes_v1.json` SHALL list each pass on file
   (Sentinel-1 scene id, satellite, sensing time UTC, orbit direction and relative orbit, the
   share of the channel it covers, the AIS days on file) and an offline build SHALL have written,
   per pass, the radar crop of the channel, its display rendering, and that day's AIS (the day
   before and after too) filtered to the channel, into `vessels/cache/v1/` with a manifest.
2. WHEN a tool runs THEN it SHALL read only the project bucket (the cache and the session), never
   Planetary Computer or NOAA; the acquisition plan is the one external file and is read from the
   cache, refreshed by the warm script (Requirement 7).
3. WHEN the presenter asks about a date or water that is not on file THEN the agent SHALL say the
   fixed sentence "I only investigate passes on file." and name the passes it has, and SHALL call
   no detection tool.
4. WHEN the cache path changes shape THEN its version SHALL change (`v1` to `v2`), so a stale
   cache can never be read as a new one.

### Requirement 3: See every vessel-sized target the radar saw

**User Story:** As the audience, I want to watch the radar pass arrive and the targets appear on
the water, so that I see what the satellite saw before anyone interprets it.

#### Acceptance Criteria

1. WHEN `find_pass` resolves a pass THEN the tool SHALL stage its radar rendering into the session
   and return it with a render hint, the sensing time and the satellite, and the agent SHALL show
   it and look at it (`inspect_image`) before detecting anything.
2. WHEN `detect_vessels` runs THEN it SHALL run CA-CFAR on the cached crop inside a water mask
   (land and islands buffered by 500 m), keep clusters of 1–200 pixels above the spike's
   thresholds, and return every target with an id, position, peak above the local sea in dB and
   apparent extent in metres (pixels × spacing; stated as coarse).
3. WHEN a target lies within 800 m of a platform in `data/platforms_v1.json` (each with its
   public source) THEN the tool SHALL mark it `platform` and SHALL never count it as a vessel.
4. WHEN the same pass is detected twice THEN the second run SHALL read the first's cached result
   (the detection is deterministic for a pass and a version).

### Requirement 4: The coverage check before anything is called dark

**User Story:** As the officer, I want to know whether AIS could hear a piece of water at the hour
of the pass before a silent target is called a candidate, so that a receiver gap is never mistaken
for a vessel hiding.

#### Acceptance Criteria

1. WHEN `check_ais_coverage` runs for a pass THEN it SHALL grid the channel (2 km cells) and mark a
   cell covered when AIS was received in it within an hour either side of the pass, and in a
   coverage gap when the cell carries traffic on that day's other hours but none in that window;
   it SHALL return the gap area as GeoJSON with its hours, for the map.
2. WHEN `match_ais` runs before `check_ais_coverage` for the same pass in the session THEN it SHALL
   return an error naming the coverage check; the order is enforced in the tools, not the prompt.
3. WHEN `match_ais` runs THEN each non-platform target SHALL get exactly one status: `broadcasting`
   (an AIS position within 500 m within 10 minutes of the pass, positions interpolated along the
   track), `coverage_gap` (no match, in a gap cell: "not evidence"), or `no_ais` (no match, in
   covered water: a candidate), with the nearest broadcast's distance and time for every target.
4. WHEN the agent reports the result THEN it SHALL give the counts in that order (targets,
   platforms, broadcasting, in a coverage gap, no AIS in covered water) and SHALL call only `no_ais`
   targets candidates, with the fixed sentence "A candidate is a radar target with no broadcast
   nearby; it is not an accusation."

### Requirement 5: Gather the evidence

**User Story:** As the officer, I want each candidate's evidence in one place, so that I can judge
it myself rather than take the agent's word.

#### Acceptance Criteria

1. WHEN `gather_evidence` runs for a pass's candidates THEN for each it SHALL return a radar chip
   (a small COG the agent looks at with `inspect_image`), the nearest broadcast (distance, time,
   vessel type and length class from AIS static data, never a name, MMSI, IMO or call sign),
   whether it lies inside the sanctuary or one of its marine reserves (from
   `data/cinms_v1.geojson`, each boundary with its public source), and its distance to shore and to
   the shipping lanes.
2. WHEN the agent states a candidate's confidence THEN it SHALL use the fixed sentence for the
   observation ("Confidence that this is a vessel: moderate; that it was avoiding detection: cannot
   assess.") and SHALL name the innocent explanations the record supports (vessels under 65 ft need
   not carry AIS; a transponder can be off for ordinary reasons).
3. WHEN `ais_gaps` runs for a pass THEN it SHALL list vessels whose broadcasts stopped for at least
   30 minutes across the pass time while they were in covered water, each with its last position
   and time, its own top speed over the six hours before, and its type and length class only.

### Requirement 6: Where could it have gone

**User Story:** As the audience, I want to see where a vessel that went silent could have been when
the radar passed, so that the agent's reasoning is a picture I can check, not a forecast I have to
trust.

#### Acceptance Criteria

1. WHEN `reachable_area` runs for a gap from `ais_gaps` THEN it SHALL compute, on a water-only grid
   (land and islands are obstacles, 250 m cells), every place the vessel could reach from its last
   position by the pass time at a stated top speed (its own six-hour top speed by default, or the
   speed the presenter names), and return the area as GeoJSON with the speed, the minutes and the
   farthest distance in kilometres.
2. WHEN the area is returned THEN the tool SHALL list the pass's `no_ais` and `coverage_gap` targets
   inside it, and the agent SHALL say how many there are and that any of them could be the vessel,
   or none ("I cannot say which, if any, it is.").
3. WHEN the agent describes the area THEN it SHALL state the speed and the minutes it used and SHALL
   make no claim of accuracy, likelihood or prediction beyond "could have reached".

### Requirement 7: When can we look again

**User Story:** As the officer, I want to know when the radar will next see this water, so that the
referral can ask for a second look at a time that exists.

#### Acceptance Criteria

1. WHEN `next_look` runs THEN it SHALL read ESA's published Sentinel-1 acquisition plan (the newest
   KML per satellite, cached and parsed) and return the next planned IW passes after now that cover
   at least half of the channel: satellite, start time UTC, relative orbit, the share covered, and
   the plan file's own name and period.
2. WHEN the plan in the cache is older than 24 hours THEN the tool SHALL try to refresh it once
   (bounded by a timeout) and SHALL fall back to the cached plan, saying its date; the warm script
   SHALL refresh it the day before and the morning of the show.
3. WHEN the plan has no pass covering the channel in its period THEN the tool SHALL say so and give
   the plan's end date; it SHALL never extrapolate the orbit.

### Requirement 8: Acts with approval

**User Story:** As the officer, I want the agent to draft a referral and stop, so that the decision
to send a patrol or ask for a second look is mine, made on stage with one click.

#### Acceptance Criteria

1. WHEN `draft_referral` runs THEN it SHALL validate the referral (the pass, the counts from the
   tools' own records in S3, the candidates with their fixed confidence, the coverage statement,
   the requested action from a fixed list: a patrol look, a second radar look at a named planned
   pass, or no action; the next look from `next_look`) and write a draft under
   `session_data/<sid>/referrals/`; the counts SHALL come from the tools' records, not the model.
2. WHEN a draft is written THEN the agent SHALL stop and the step column SHALL show the referral
   card with two controls, "Approve and send" and "Request another look"; the agent SHALL end with
   "Decision: the officer's." before its spoken closer.
3. WHEN the officer approves THEN the backend (authenticated) SHALL file the referral (markdown and a
   map snapshot), post to Slack when configured, and tell the agent; the model SHALL have no tool
   that files or sends a referral, and `referral_status` SHALL be the only way it may say "filed".
4. WHEN a referral card is shown in a replay case THEN its controls SHALL be inert and it SHALL say
   the decision is made live.

### Requirement 9: Candidates, never accusations

**User Story:** As the decision-maker in the audience, I want the agent's language to stay inside
what the evidence shows, so that I trust it more for what it refuses to say.

#### Acceptance Criteria

1. WHEN any of the agent's text or a referral field is written THEN it SHALL not use "illegal",
   "smuggling", "trafficking", "dark fleet", "caught", "confirmed vessel", "guilty", "violation" or
   an assertion of intent; `draft_referral` SHALL reject a draft that does and name the phrases, and
   `build_replay_case.py` SHALL refuse a recording that does.
2. WHEN a vessel is mentioned THEN it SHALL be by type and length class only ("a fishing vessel,
   20–30 m"); the tools SHALL drop names, MMSI, IMO numbers and call signs before anything reaches
   the model or the stage.
3. WHEN the presenter asks the agent to name, accuse or speculate about a vessel or its crew THEN the
   agent SHALL decline with one sentence and offer what the evidence does show.

### Requirement 10: The UI knows four agents

**User Story:** As the presenter, I want Dark Vessels in the switcher with its own prepared plates
and its own way of seeing, so that Act 3 reads as its own place on the same stage.

#### Acceptance Criteria

1. WHEN `AGENT_RUNTIMES` lists `vessels` THEN the switcher SHALL show it ("Dark Vessels") and the
   stage SHALL show its three prepared prompts, its placeholder and plain step names for every tool.
2. WHEN a Dark Vessels tool passes a render hint THEN the allowlist SHALL accept a new `maritime`
   group (radar raster, targets as points by status, AIS tracks, the coverage gap, the reachable
   area, the sanctuary and reserves, the next pass's footprint), and each SHALL have its legend in
   words in the layers plate; the stage's styling SHALL win over a hint that drifts.
3. WHEN the agent is chosen THEN the stage SHALL show its resting state before any prompt (the
   sanctuary, its marine reserves, the platforms and the star pass's day of AIS traffic, from a
   published record, never from the model), and the radar SHALL arrive in a way that shows the pass
   (decision 7), with Impeccable `critique` before and `polish` after, detector 0.
4. WHEN a target's status is drawn THEN it SHALL read without colour alone (shape and label as well
   as hue), never in red (red reads as guilt) and never in amber (the One Spotlight Rule).

### Requirement 11: An offline replay case

**User Story:** As the presenter, I want Act 3's first beat as a replay case that loads with no live
calls, so that the act survives a slow network or a runtime failure.

#### Acceptance Criteria

1. WHEN `build_replay_case.py` records the star turn from dev THEN it SHALL copy every layer the room
   saw (the radar, the targets, the AIS tracks, the coverage gap, the evidence chips, the reachable
   area, the next pass, the referral draft) into `use-cases/vessels-<id>/` with placeholder bucket
   URLs, and the gallery SHALL list it.
2. WHEN the case is played THEN the headless network log SHALL show only the basemap, TiTiler and the
   project bucket, no `/api/agent/invoke`, and the referral card SHALL be read-only.

### Requirement 12: Tests, gate and run sheet

**User Story:** As the builder, I want Act 3 held to the same gates as the other acts, so that
Release 3 goes to stable with all four agents in one checked run.

#### Acceptance Criteria

1. WHEN `pytest` runs in `agents/dark-vessels/tests/` THEN it SHALL cover CFAR on synthetic speckle
   with planted targets, the platform rule, the coverage grid and the tool order, AIS matching with
   interpolation, the gap finder, the water-only reachable area around a synthetic island, the plan
   parser on a fixture KML, the referral validator and its forbidden phrases, the name scrubbing,
   staging and the replay prompt, with no network (target ≥ 40 tests).
2. WHEN `vitest` and the backend tests run THEN they SHALL cover the `maritime` hints, the target
   styles by status, the stage copy and the referral route (filing, idempotence, refusal).
3. WHEN the G4 gate runs (Friday Oct 30) THEN every agent's eval SHALL pass on dev and stable, Act 3
   SHALL be timed twice under 8:30 against stable, the full 30-minute show SHALL run once, and
   Release 3 (all four agents) SHALL be promoted by `scripts/promote.sh` with its tag.
