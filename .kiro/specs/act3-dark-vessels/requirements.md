# Requirements: act3-dark-vessels (Oct 16–30, started early)

Status: **Approved Oct 16.** The user chose the Galápagos (Oct 15:
"as long as we can possibly detect and predict with the area we have chosen"), set aside the Oct 13
rule against trained forecasting and accuracy claims, tabled EventBridge, and agreed: passes on file
only; vessel type and size only, no flags. On Oct 16 the user approved the rest: the coverage rule
(in its same-hour form, design decision 3), the tasking's `PutObject` grant, the names, the
schedule, and the silent-vessel beat in the run rather than as a spare; the candidates' colour is
orchid. The GFW licence was cleared on Oct 16 (the user: "GFW license is good"), so the
Galápagos act goes ahead and the Santa Barbara fallback is retired.

## Introduction

Act 3 is eight minutes: "It investigates, gathers evidence, and acts with approval." The water is
the Galápagos Marine Reserve, part of a UNESCO World Heritage site, where industrial fishing is
banned and a distant-water squid fleet has worked the edge of Ecuador's waters most seasons since
2017. The persona is a depicted marine reserve enforcement officer (not a real user; no agency's
endorsement implied). The agent finds a Sentinel-1 radar pass over the reserve, detects every
vessel-sized target with its own detector and checks it against Global Fishing Watch's, sets aside
the ones that broadcast AIS, checks that AIS could be heard there at that hour, and only then calls
the rest candidates. Then it predicts: where dark targets will be next and when the radar can look
there, and where the squid fleet is and when its pattern brings it back. The officer approves a
patrol tasking; the agent does not.

The data is proven (`docs/spikes/galapagos.md`, Oct 15): Sentinel-1 sees the reserve on 117 days a
year; GFW's radar detections with no AIS inside the reserve were 41 (2024), 109 (2025) and 183
(2026 to Oct 12), one to three a pass; our CA-CFAR (`cfar.py`) found GFW's dark target within
0.58 km on a raw pass (a 90 km window read in 2.1 s); fitted on 2023–25 and leaving out the ports,
the top 5% of the reserve's water held 53% of 2026's dark targets (10.6× chance), and refitted on
the newest data (to June, checked on July 1 to Oct 12) it held 55% (11.0×) in the spike and 45%
(9×) on the built cache, the number the agent says; ESA's plan to
Nov 5 gives the reserve six planned Sentinel-1D passes; the squid fleet skipped the Galápagos in
2026 and stayed off Peru and Chile.

The hard rules (`PRODUCT.md`, the spikes): maritime findings are candidates with stated
confidence, never accusations; a target is not called dark until the coverage check is shown;
vessels are named by type and size only (no name, MMSI, IMO number, call sign or flag, anywhere);
every prediction ships with its measured check on data it did not see, and no accuracy is claimed
beyond that check; the agent acts only with human approval. GFW data is used under its
non-commercial terms with its attribution ("Powered by Global Fishing Watch.") on the stage.

Scope boundaries: no water outside the reserve and the radar's reach around it, except the fleet's
heat map of the south-east Pacific; no read of GFW, Planetary Computer or NOAA at run time (the
build caches them; the one live read is ESA's plan, bounded, with a cached fallback); no trained
black-box model (counts, grids and backtests only); no automatic action and no EventBridge; no
change to the other three agents' behaviour; no model change (Sonnet 4.6 through the Nov 3
freeze). The GFW licence is cleared (Oct 16), so the act runs in the Galápagos (design decision 1).

## Requirements

### Requirement 1: A fourth agent runtime, built the platform way

**User Story:** As the builder, I want Dark Vessels to be its own runtime under
`agents/dark-vessels/` built like the Methane Hunter and the AI Archaeologist, so that Act 3 cannot
break Acts 1, 2 and 4, and agent number four is a table row, not a copy.

#### Acceptance Criteria

1. WHEN `agents/dark-vessels/` is built THEN it SHALL contain its own entrypoint (`dark_vessels.py`,
   the shared runtime contract: prewarm, S3 session manager, sliding window, the tool-call streaming
   format, the replay-case prompt), `vessels_config.py`, its tool modules, `_paths.py`,
   `requirements-agent.txt` (only if it needs more than the platform image; it does not),
   `deploy.sh`, `.env.example`, `golden_prompts.json`,
   `build_replay_case.py` and `tests/`.
2. WHEN the agent imports shared code THEN it SHALL come from the staged `_geo_agent/` copy through
   `geo_agent/stage_shared.sh`, with the staging allowlist test.
3. WHEN `deploy.sh` runs THEN it SHALL require `DEPLOY_TARGET=dev|stable` through
   `geo_agent/deploy_lib.sh` (runtimes `dark_vessels_dev` / `dark_vessels`) and SHALL NOT pass the
   GFW token to the runtime (the runtime never calls GFW).
4. WHEN `scripts/eval.py`, `runtimes.py`, `bakeoff.py` and `promote.sh` run THEN each SHALL know the
   agent id `vessels` through its existing table.

### Requirement 2: Passes on file only

**User Story:** As the presenter, I want the agent to work only from passes and records we have
prepared, so that nothing on stage waits on a third-party service, and a question we have no data
for gets a plain answer.

#### Acceptance Criteria

1. WHEN the build runs THEN it SHALL cache into `vessels/cache/v1/`, with a manifest: per pass on
   file, the radar crop over the reserve (a COG), its display rendering, our detector's targets,
   GFW's detections that day (matched and unmatched), and the AIS presence around the pass; and,
   for the predictions, the reserve's dark detections since 2023, the AIS-off events near it, and
   the squid fleet's monthly fishing effort since 2017.
2. WHEN anything is cached THEN vessel names, MMSI, IMO numbers, call signs, flags and GFW vessel
   ids SHALL already be stripped; a test SHALL fail the build if any appears in a cached file.
3. WHEN a tool runs THEN it SHALL read only the project bucket and the session, except `next_look`'s
   bounded refresh of ESA's plan.
4. WHEN the presenter asks about a date or water not on file THEN the agent SHALL say "I only
   investigate passes on file." and name the passes it has.

### Requirement 3: See every target the radar saw

**User Story:** As the audience, I want to watch the radar pass arrive and the targets appear, so
that I see what the satellite saw before anyone interprets it.

#### Acceptance Criteria

1. WHEN `find_pass` resolves a pass THEN it SHALL stage its rendering into the session with a render
   hint, the sensing time and satellite, and the agent SHALL show it and look at it before detecting.
2. WHEN `detect_vessels` runs THEN it SHALL return our detector's targets (id, position, peak above
   the local sea in dB, apparent size, coarse) and GFW's detections for the pass, and say how many
   each found and how many both found within 1 km.
3. WHEN a target lies within 10 km of one of the reserve's ports THEN it SHALL be marked `port` and
   not counted as a candidate (the reserve's own tourist and fishing boats moor there).

### Requirement 4: The coverage check before anything is called dark

**User Story:** As the officer, I want to know that AIS could be heard where and when a silent
target was seen, so that poor reception is never mistaken for a vessel hiding.

#### Acceptance Criteria

1. WHEN `check_ais_coverage` runs for a pass THEN it SHALL call each 0.05° cell of the reserve
   `heard` when, in at least one hour of the three either side of the pass, two or more different
   broadcasting vessels were heard within 30 km of it, and `unproven` otherwise; it SHALL return the
   heard and unproven areas for the map, drawn so that every target's status agrees with the cell
   it lies in.
2. WHEN `match_ais` runs before `check_ais_coverage` for that pass in the session THEN it SHALL
   refuse and name the coverage check.
3. WHEN `match_ais` runs THEN each target SHALL get one status: `broadcasting` (GFW matched it to
   AIS), `port`, `unproven` (no match, reception unproven: "not evidence"), or `candidate` (no match,
   in heard water, seen by both detectors); `seen_once` for one detector only.
4. WHEN the agent reports THEN it SHALL give the counts in that order and use the fixed sentence "A
   candidate is a radar target with no broadcast nearby; it is not an accusation."

### Requirement 5: Gather the evidence

**User Story:** As the officer, I want each candidate's evidence in one place, so that I can judge
it myself.

#### Acceptance Criteria

1. WHEN `gather_evidence` runs THEN for each candidate it SHALL return a radar chip the agent looks
   at, both detectors' readings, the nearest broadcasting vessel (km, minutes, type and size), the
   reserve zone it lies in, and its distance to the nearest port and shore.
2. WHEN the agent states confidence THEN it SHALL use "Confidence that this is a vessel: moderate;
   that it was avoiding detection: cannot assess." and name the innocent explanations the record
   supports (small boats need not carry AIS; reception and equipment fail; a transponder can be off
   for ordinary reasons).

### Requirement 6: Where to look next (prediction)

**User Story:** As the officer, I want to know where dark targets are likely next and when the
radar can see there, so that a patrol goes where the pattern points, not where a guess does.

#### Acceptance Criteria

1. WHEN `predict_hotspots` runs THEN it SHALL fit the hotspot map on the reserve's dark detections
   before a cut-off, leaving out port water, and return the held-out check on the period after it
   (the share of those detections in the top 1, 2, 5 and 10% of the water, with the chance rate and
   the lift), the map for the stage, and up to three non-overlapping patrol boxes with their share
   of past dark targets.
2. WHEN patrol boxes are returned THEN each SHALL carry its next planned Sentinel-1 passes from
   `next_look` (those covering at least 90% of the box).
3. WHEN the agent speaks of the prediction THEN it SHALL state it as the check measured it ("fitted
   on everything to June, this map's top 5% of the water held 45% of the dark targets seen since
   July") and SHALL make
   no claim beyond it.

### Requirement 7: Where the fleet is, and when it comes back (prediction)

**User Story:** As the audience, I want to see the squid fleet's yearly pattern and where it is
now, so that I see a pattern the agent found and an honest test of it.

#### Acceptance Criteria

1. WHEN `fleet_pattern` runs THEN it SHALL return the squid fleet's fishing effort by month and zone
   (near the Galápagos, off Peru, off Chile) since 2017 from the cache, its latest month's map, and
   the months the pattern expects it near the Galápagos (the months it was there in at least half of
   the years), with the seasons that matched the pattern and those that did not.
2. WHEN the latest season broke the pattern (2026) THEN the agent SHALL say so in one sentence and
   show where the fleet went instead.
3. WHEN the fleet is drawn THEN it SHALL be a heat map of fishing effort, never individual vessels.

### Requirement 8: When can we look again

**User Story:** As the officer, I want the next planned radar passes over the water I care about, so
that a tasking asks for a look that will happen.

#### Acceptance Criteria

1. WHEN `next_look` runs for an area THEN it SHALL return the next planned IW passes from ESA's newest
   plan per satellite that cover a stated share of it (satellite, start UTC, orbit, share, the plan's
   name and period), and the first one's footprint for the map.
2. WHEN the cached plan is older than 24 hours THEN it SHALL try one refresh (8 s) and fall back to
   the cache, saying its date; past the plan's end it SHALL say the pass is not planned yet and
   SHALL never extrapolate an orbit.

### Requirement 9: A vessel that went silent (a beat in the run)

**User Story:** As the audience, I want to see where a vessel that switched off its AIS could have
been when the radar passed, and then where it came back on.

#### Acceptance Criteria

1. WHEN `reachable_area` runs for an AIS-off event on file THEN it SHALL compute on a water-only grid
   (islands are obstacles) every place the vessel could reach by the pass time at a stated speed,
   list the pass's targets inside it, and return where its AIS came back on, for the reveal.
2. WHEN the agent describes it THEN it SHALL state the speed and the hours and say "I cannot say
   which, if any, of these it is."
3. WHEN the beat plays (its own short turn, after the evidence) THEN the stage SHALL name the case's
   date plainly as an earlier pass (it is not the star pass), show the last broadcast position, grow
   the reachable area by water, light the targets inside it, and only then show where the AIS came
   back on; the vessel SHALL be named by type and size only.

### Requirement 10: Acts with approval

**User Story:** As the officer, I want to choose and approve the patrol tasking myself, on the map,
so that the decision is visibly mine.

#### Acceptance Criteria

1. WHEN `draft_tasking` runs THEN it SHALL write a draft from the session's own records (the pass,
   the counts, the candidates, the coverage, the patrol boxes with their next looks, the prediction's
   check) and the stage SHALL show the boxes on the map and a tasking plate.
2. WHEN the officer chooses a box and the candidates to include THEN the plate SHALL show the choice;
   "Approve the tasking" files it through the authenticated backend (markdown, a map snapshot, Slack
   when configured); "Not now" sends nothing.
3. WHEN the tasking is filed THEN `tasking_status` SHALL be the only way the agent may say so; no
   agent tool files or sends anything.
4. WHEN shown in a replay case THEN the controls SHALL be inert and say the decision is made live.

### Requirement 11: Candidates, never accusations

**User Story:** As the decision-maker in the audience, I want the agent's language to stay inside
what the evidence shows.

#### Acceptance Criteria

1. WHEN the agent or a tasking writes text THEN it SHALL not use "illegal", "poaching", "smuggling",
   "trafficking", "dark fleet", "caught", "guilty", "violation" or an assertion of intent;
   `draft_tasking` and `build_replay_case.py` SHALL refuse text that does.
2. WHEN a vessel or the fleet is mentioned THEN it SHALL be by type and size only; no country is named
   as a vessel's flag or as the fleet's.
3. WHEN asked to name, accuse or speculate THEN the agent SHALL decline in one sentence and offer what
   the evidence shows.

### Requirement 12: The UI knows four agents

**User Story:** As the presenter, I want Dark Vessels in the switcher with its own way of seeing.

#### Acceptance Criteria

1. WHEN `AGENT_RUNTIMES` lists `vessels` THEN the switcher SHALL show "Dark Vessels" with four
   prepared prompts (the run's four turns), a placeholder and plain step names.
2. WHEN a tool passes a render hint THEN the allowlist SHALL accept a `maritime` group (radar,
   targets by status, heard and unproven water, the hotspot map, patrol boxes, the fleet's heat,
   the next pass's footprint, the reserve and its zones), each with a legend in words.
3. WHEN the agent is chosen THEN the stage SHALL show its own way of seeing (the seabed's
   bathymetry, not a satellite basemap; the islands as silhouettes; the reserve and its ports) with
   the latest AIS on file in motion (wakes, moving heads and a clock that names the date and hour),
   labelled as a replay and never as live; the radar SHALL arrive in a way that shows the pass and
   the AIS SHALL stop at the pass's minute; critiqued before and polished after with Impeccable,
   detector 0.
4. WHEN a target's status is drawn THEN it SHALL read without colour alone, never in red, never in
   amber; GFW's attribution SHALL be on the map whenever its data is.
5. WHEN the predictions run THEN they SHALL use the newest data on file: the check holds out the
   most recent months (today Jul 1 to Oct 12, 2026), the forward map uses everything to the newest
   day, and the build SHALL be rerun on Nov 5 to add the newest pass and AIS.
   Amended Oct 21 (`redesign-open-question.md` R9.1 and U10): the Nov 5 rerun SHALL run only IF the
   one-question redesign passes gate A (first attempt Fri Oct 23 pm, drop-dead Mon Oct 26 12:00)
   and gate B (Tue Oct 27, drop-dead Wed Oct 28 12:00), and THEN it SHALL follow that design's
   runbook (§3.6), with the backups first and R9.2's go/no-go. IF either gate is not green by its
   drop-dead, THEN G4 SHALL promote the four-turn version tagged `act3-four-turn-fallback` (task 1's
   copy fixes and nothing else from the redesign), there SHALL be no Nov 5 rerun, the Oct 16 data
   SHALL stand, and the rest file SHALL NOT be republished with `--newest`.
6. WHEN the targets appear THEN, until the coverage check is on the map, a target with no match
   SHALL be a plain grey ring with no label; the candidates' colour (orchid) and their labels SHALL
   appear only after it.

### Requirement 13: An offline replay case

#### Acceptance Criteria

1. WHEN `build_replay_case.py` records the star turn THEN it SHALL copy every layer the room saw into
   `use-cases/vessels-<pass>/` and refuse a recording with a forbidden phrase, an identifier, or no
   coverage check.
2. WHEN the case plays THEN the network log SHALL show only the basemap, TiTiler and the bucket.

### Requirement 14: Tests, gate and run sheet

#### Acceptance Criteria

1. WHEN pytest runs in `agents/dark-vessels/` THEN it SHALL cover the detector, the plan, the
   prediction and its check, the coverage rule and tool order, the fleet pattern, the reachable
   area, the tasking validator, the identity scrub and staging, with no network (target ≥ 60).
2. WHEN the G4 gate runs (Friday Oct 30) THEN every agent's eval SHALL pass on dev and stable, Act 3
   SHALL be timed twice under 8:30 against stable, the 30-minute show SHALL run once, and Release 3
   SHALL be promoted with all four agents.
