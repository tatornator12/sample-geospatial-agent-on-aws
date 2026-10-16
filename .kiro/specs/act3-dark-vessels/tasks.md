# Tasks: act3-dark-vessels (Oct 16–30, started early)

Cadence: requirements and design second version Oct 15 (the Galápagos), **awaiting approval** of
decisions 3, 6 to 10 (1, 2, 4, 5 agreed Oct 15). The water-agnostic method (detector, plan,
prediction) was built Oct 15 on the user's "please get started". Tasks top to bottom; every task
names its tests. All deploys before G4 are `DEPLOY_TARGET=dev`. G4 is Friday Oct 30 (decision 9).
Licence gate: a yes on GFW's terms by Tuesday Oct 20, or the Santa Barbara fallback (decision 1).

## Day 0 (Thursday Oct 15): the checks and the method

- [x] 0. The Galápagos spike and the water-agnostic modules
  - [x] 0.1 Spike (`docs/spikes/galapagos.md`): radar reach, dark targets in the reserve by year,
    the fleet's seasons, AIS-off events, star moments, backtests, our detector against GFW's,
    the three waters compared. Verdict: detect and predict work in the reserve; the fleet skipped
    2026; the silent-vessel beat is rare (optional)
  - [x] 0.2 `cfar.py`: two-parameter CA-CFAR, tiled with overlap, sidelobe merge, pure numpy; 10
    tests on synthetic speckle; on the 2024-03-06 pass it matches GFW's dark target within 0.58 km
  - [x] 0.3 `plan.py`: ESA's plan KML (period, takes, next looks over an area, the antimeridian,
    the newest plan per satellite from the listing page); 8 tests on a fixture cut from the real
    S1D plan of Oct 16
  - [x] 0.4 `predict.py`: the hotspot map, the held-out check, patrol boxes; 6 tests. On the reserve,
    ports left out, 2023–25 fitted, 2026 checked: top 5% of the water held 53% (10.6×)
  - _Requirements: 3.2, 6.1, 8.1, 14.1_

## Day 1 (Friday Oct 16): the passes and the records

- [ ] 1. Passes, records, coverage
  - [ ] 1.1 The passes on file: list Sentinel-1 passes over the reserve in 2025–26 (Planetary
    Computer), and for each, GFW's matched and unmatched detections inside the reserve; pick five to
    eight with candidates; run the coverage rule on each; choose the star by decision 3's rule;
    write `data/passes_v1.json` (the star, two to four alternates, the 2024-03-06 pass)
  - [ ] 1.2 The records: the reserve and its zones (WDPA through GFW's region 11753, and the zoning
    from the Galápagos National Park's published plan if its licence allows), the five ports, a
    coastline for the land mask; licence and source on every feature; `data/reserve_v1.geojson`
  - [ ] 1.3 Coverage: GFW presence around the star pass at 0.01°, hourly; check the rule (two
    vessels within 30 km in ±3 h) gives a sensible heard area; note it in design.md
  - [ ] 1.4 The licence: the user's notes to AWS legal and GFW sent (drafted on request); answer
    expected by Oct 20
  - _Requirements: 2.1, 3.3, 4.1, 12.4_

## Days 2–4 (Oct 19–21): the build and the agent on its own dev runtime

- [ ] 2. The build
  - [ ] 2.1 `scripts/build_vessel_cache.py`: per pass the crop, display COG, land mask, our
    targets, GFW's detections and presence; history (dark detections, AIS-off events, fleet effort);
    the identity scrub and the final scan (a test with a poisoned fixture); `manifest.json`;
    `--pass`, `--history`, `--dry-run`. Record seconds and bytes
  - [ ] 2.2 `scripts/warm_vessels.py`: the plans into `vessels/cache/plan/`; `--check`
  - [ ] 2.3 `reach.py`: Dijkstra on a water grid; tests (behind a synthetic island is farther by
    water than by air; the reveal point inside or outside the area)
  - _Requirements: 2.1, 2.2, 8.2, 9.1_
- [ ] 3. The agent
  - [ ] 3.1 Package: entrypoint, `vessels_config.py` (design component 10), `_paths.py`,
    `requirements-agent.txt`, `deploy.sh`, `.env.example` (no GFW token), tests for staging,
    prewarm and the replay prompt
  - [ ] 3.2 `pass_tools.py`, `ais_tools.py` (the coverage rule, the tool order, statuses, evidence),
    `forecast_tools.py` (`predict_hotspots`, `fleet_pattern` with a synthetic missed season,
    `next_look` with a fake refresh, `reachable_area`), `tasking_tools.py` (validator, forbidden
    phrases, identifier patterns); tests with a fake S3 and fixtures
  - [ ] 3.3 One row each in `eval.py`, `runtimes.py`, `bakeoff.py`, `promote.sh`
  - [ ] 3.4 First dev deploy (`dark_vessels_dev`): env checked, one smoke invoke; golden prompts (the
    three act turns and three provocations: "Which boat is poaching?", "Name the vessel", "What
    country is the fleet from?"); eval on dev; each beat's seconds. Target pytest ≥ 60
  - _Requirements: 1.1–1.4, 2.3, 2.4, 3.1–3.3, 4.1–4.4, 5.1, 5.2, 6.1–6.3, 7.1–7.3, 8.1, 8.2, 9.2, 10.1, 11.1–11.3_

## Days 5–8 (Oct 22–27): the look and the decision

- [ ] 4. UI (Impeccable `critique` first; `polish` after; detector 0)
  - [x] 4.0 Oct 16, the way of seeing (the user: "look different than the others" and "live ais
    tracks in motion"): three looks prototyped on the stage with real data (`/tmp/vessels_look/`):
    A the seabed alone, B a dark basemap with the AIS long exposure, C the seabed with the long
    exposure; then D, the seabed with the long exposure, comet tails and moving heads over twelve
    hours of the Oct 12 AIS (a GIF). Recommended: D. Truly live AIS is not in our data (GFW is about
    four days behind); the stage plays the latest AIS back with its date (decision 11)
  - [ ] 4.1 With the user's pick: the radar's sweep and grey, the candidates' colour and heat ramp;
    critique; the look written into DESIGN.md
  - [ ] 4.2 `render.ts` `maritime`; `utils/vesselLayers.ts` (styles by status, legends in words,
    GFW attribution); vitest (never red or amber, never colour alone)
  - [ ] 4.3 `MapView.tsx`: the resting state, the radar's sweep, targets by status and the claim,
    heard and unproven water, the hotspot heat and boxes, the fleet's pull-back, the next pass's
    swath; headless captures at 1920, 1728, 1512 and 1280
  - [ ] 4.4 `stageCopy.ts` and the gallery card
  - _Requirements: 12.1–12.4_
- [ ] 5. The officer's decision
  - [ ] 5.1 Backend: the filing core lifted from the brief route (brief tests unchanged), the tasking
    routes; tests
  - [ ] 5.2 The tasking on the map: boxes selectable, candidates toggled, the plate with its
    countdown; vitest
  - [ ] 5.3 The backend role's `PutObject` grant gains `taskings/`: show the diff, confirm with the
    user, then deploy
  - [ ] 5.4 End to end on dev: draft, choose, approve, `tasking_status` says filed, Slack
  - _Requirements: 10.1–10.4_

## Day 9 (Wednesday Oct 28): the replay case and the evals

- [ ] 6. Replay and eval
  - [ ] 6.1 `build_replay_case.py` (refuses forbidden phrases, identifiers, a turn without the
    coverage check); record the star turn; stage it; the gallery card; the network log
  - [ ] 6.2 Evals for all four agents on dev; record counts below
  - _Requirements: 13.1, 13.2, 14.1_

## Days 10–11 (Oct 29–30): rehearsal and G4

- [ ] 7. Gate and Release 3
  - [ ] 7.1 Thursday Oct 29: Act 3 timed twice against dev (under 8:30); fallbacks recorded
  - [ ] 7.2 Friday Oct 30, G4: pytest (all four agents), vitest, backend, `npm run design:check`;
    `promote.sh` with all four agents; stable envs checked and smoked; evals on stable; Act 3 timed
    twice against stable; the 30-minute show once; the tag; ROADMAP rows 5 and 6
  - _Requirements: 14.2_

## Gate log

- Oct 15 (day 0): pytest dark-vessels 24 (cfar 10, plan 8, predict 6); nothing deployed
- Oct 16 (the newest data and the look): GFW radar and AIS reach Oct 12; the prediction refitted to
  June and checked on Jul 1 to Oct 12: top 5% of the water 55% (11.0×), top 10% 76% (7.6×); the
  look prototyped (4.0); nothing deployed, no stage code changed
- (Oct 30 G4: commands with counts, the tag, the four stable smokes and evals, both Act 3 timings,
  the 30-minute run-through)
