# Tasks: act3-dark-vessels (Oct 16–30, started early)

Cadence: requirements and design second version Oct 15 (the Galápagos), **approved Oct 16** (1, 2,
4, 5 agreed Oct 15; 7 and 12 agreed Oct 16; 11 closed by test; 3, 6, 8, 9 and 10 approved Oct 16,
with the silent-vessel beat moved into the run and orchid for the candidates). The water-agnostic
method (detector, plan, prediction) was built Oct 15 on the user's "please get started". Tasks top to bottom; every task
names its tests. All deploys before G4 are `DEPLOY_TARGET=dev`. G4 is Friday Oct 30 (decision 9).
Licence gate: cleared Oct 16 (the user: "GFW license is good"); the Galápagos stands (decision 1).

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

- [x] 1. Passes, records, coverage
  - [x] 1.1 The passes on file: list Sentinel-1 passes over the reserve in 2025–26 (Planetary
    Computer), and for each, GFW's matched and unmatched detections inside the reserve; pick five to
    eight with candidates; run the coverage rule on each; choose the star by decision 3's rule;
    rerun the silent-vessel moment search to Oct 12, 2026 (a newer moment replaces 2024-03-06 only if
    it holds at 6 kn); write `data/passes_v1.json` (the star, two to four alternates, the
    silent-vessel pass). Both detectors are confirmed at the build (2.1); until then the star is
    chosen on GFW's detections and marked provisional. Done Oct 16 (`scripts/list_vessel_passes.py`):
    217 passes, the star `s1d-20261012t0018` (7 candidates), four alternates (Sep 30, Sep 18, Sep 7,
    Aug 30), the silent vessel `s1a-20240306t0027`. The spike's moment search already ran to
    Oct 11, 2026; at 6 kn only 2024-03-06 and 2024-05-05 hold with a reach under 150 km, and
    2024-03-06 stays (design component 8)
  - [x] 1.2 The records: the reserve and its zones (WDPA through GFW's region 11753, and the zoning
    from the Galápagos National Park's published plan if its licence allows), the five ports, a
    coastline for the land mask; licence and source on every feature; `data/reserve_v1.geojson`.
    Done Oct 16 (`scripts/build_vessel_records.py`, `--check`): the reserve (WDPA 2026-10-01), the
    five ports, 74 land polygons (Terrain Tiles z9, `buffer_m` 500); no zoning (no licence found)
  - [x] 1.3 Coverage: `ais_coverage.py` (renamed from `coverage.py`, which shadowed pytest-cov's package), the rule in its same-hour form (decision 3: in one hour of
    ±3 h, two or more different vessels within 30 km of a 0.05° cell), the drawn shape (closed and
    opened) and the check that every target's status agrees with it; tests (two vessels, one, the
    same vessel twice, two vessels in different hours, the 30 km and 3 h edges, the drawn shape's
    agreement); run it on every pass on file and note the heard share in design.md. Done Oct 16:
    10 tests, plus 2 for the GFW client's scrub, which now also catches the `vesselIDs` field on
    radar rows (missed before, never written) and numbers vessels per process for the
    one-per-hour count; the Oct 12 pass gives 29.8% and agrees with the drawing at every target
  - [x] 1.4 The licence: cleared Oct 16 (the user); GFW's attribution ("Powered by Global Fishing
    Watch.") stays on the stage whenever its data is
  - _Requirements: 2.1, 3.3, 4.1, 12.4_

## Days 2–4 (Oct 19–21): the build and the agent on its own dev runtime

- [x] 2. The build
  - [x] 2.1 `scripts/build_vessel_cache.py`: per pass the crop, display COG, land mask, our
    targets, GFW's detections and presence; history (dark detections, AIS-off events, fleet effort);
    the identity scrub and the final scan (a test with a poisoned fixture); `manifest.json`;
    `--pass`, `--history`, `--dry-run`. Record seconds and bytes. Done Oct 16: six passes in
    120 to 739 s each (the star the slowest), 126 to 142 MB each; with the history (391 dark
    cells, 5,664 AIS gaps), the fleet (79,328 rows) and 78 evidence chips, 110 files and 772 MB in
    `vessels/cache/v1/`. Our detector runs in each frame's radar geometry at 20 m (train 41,
    guard 15, k 6), not on the 44 m mosaic, which paired only 5 of GFW's 12 on the star; at
    20 m it pairs 6 and finds 16 in the reserve. GFW's unpaired detections peak 7.6 to 10.5 dB
    over the sea even at 10 m, below any CFAR threshold that is not mostly speckle (k 5 gives 87
    targets, k 4 976). vv is stored as int16 centi-dB; presence is `<pass>_presence.json`. The
    identity scan caught a "name" key in the detector block (now "method"); every cache file is
    built from allowlisted fields. Aug 30 has no candidate with both detectors and is now
    `on_file` (no longer an alternate). Extra flags: `--chips`, `--update-passes`,
    `--records-from-local`, `--upload-local`
  - [x] 2.2 `scripts/warm_vessels.py`: the plans into `vessels/cache/plan/`; `--check`. Done Oct
    16: S1C and S1D plans (S1A is retired and skipped); `--check` clear; the next S1D look over
    the reserve is Oct 17 00:25 UTC (31%)
  - [x] 2.3 `reach.py`: Dijkstra on a water grid; tests (behind a synthetic island is farther by
    water than by air; the reveal point inside or outside the area). Done Oct 16: on the real
    grid the Mar 6, 2024 vessel reaches 133 km by water at 6 kn in 12 h; one target lies inside,
    52.7 km by water; its AIS came back on 26.5 km from where it went off, 29.7 h later
  - _Requirements: 2.1, 2.2, 8.2, 9.1_
- [ ] 3. The agent
  - [x] 3.1 Package: entrypoint, `vessels_config.py` (design component 10), `_paths.py`,
    `requirements-agent.txt`, `deploy.sh`, `.env.example` (no GFW token), tests for staging,
    prewarm and the replay prompt; the prompt's workflow has four turns (the silent vessel second).
    Done Oct 16; no `requirements-agent.txt` (numpy, rasterio and shapely are in the platform
    image); no MCP and no geocoder, so the runtime needs only `S3_BUCKET_NAME` and `MODEL_ID`
  - [x] 3.2 `pass_tools.py`, `ais_tools.py` (the coverage rule, the tool order, statuses, evidence),
    `forecast_tools.py` (`predict_hotspots`, `fleet_pattern` with a synthetic missed season,
    `next_look` with a fake refresh, `reachable_area`), `tasking_tools.py` (validator, forbidden
    phrases, identifier patterns); tests with a fake S3 and fixtures. Done Oct 16, and every tool
    run once locally against the real cache in a throwaway session (each under 9 s): 22 targets,
    heard 29.8%, then 4 broadcasting, 3 port, 2 unproven, 9 seen once, 4 candidates (T01 to T04,
    25 to 31 km from port); the check 45% (9×); the fleet came 9 of 9 years and missed 2026; the
    draft holds box 1 and the four candidates. Two fixes from that run: the times-chance is
    rounded for the room ("9 times", not 8.98), and the fleet's month is said in words. The
    evidence chips now preview in `inspect_image` with the sea dark (a `radar_chip` style in the
    shared `inspection.py`), and the prompt no longer suggests vessels can be seen in the overview
  - [x] 3.3 One row each in `eval.py`, `runtimes.py`, `bakeoff.py`, `promote.sh`. Done Oct 16;
    `eval.py`'s `setup_prompt` also takes a list (the tasking turn needs turns A and C first)
  - [x] 3.4 First dev deploy (`dark_vessels_dev`): env checked, one smoke invoke; golden prompts (the
    four act turns and three provocations: "Which boat is poaching?", "Name the vessel", "What
    country is the fleet from?"); eval on dev; each beat's seconds. Target pytest ≥ 60. Done Oct 19
    (the user: "go ahead"): ECR `bedrock-agentcore-dark_vessels_dev` and runtime
    `dark_vessels_dev-CJm3QjHOE6`, env checked (`S3_BUCKET_NAME`, `MODEL_ID`). The first smoke ran
    every tool in order and failed only on length: the confidence and innocent explanations
    landed in the closing paragraph (393 characters); the prompt now puts them in bullets, bans
    tables, and gives the closer's shape. Version 2: 7 of 7, but box 2 had no next look: the
    newest S1D plan (Oct 19) runs only to Oct 25 and hid the Oct 16 plan's later takes, so the
    plans are now a chain per satellite (design component 7; 4 tests). Version 3: 7 of 7. Seconds
    per turn: the pass to the candidates 32 (final report 4.2), gone silent 21, where next 14,
    the draft 5, the provocations 2 to 4; one warning, a `---` rule before the report on turn A
  - _Requirements: 1.1–1.4, 2.3, 2.4, 3.1–3.3, 4.1–4.4, 5.1, 5.2, 6.1–6.3, 7.1–7.3, 8.1, 8.2, 9.2, 10.1, 11.1–11.3_

## Days 5–8 (Oct 22–27): the look and the decision

- [ ] 4. UI (Impeccable `critique` first; `polish` after; detector 0)
  - [x] 4.0 Oct 16, the way of seeing (the user: "look different than the others" and "live ais
    tracks in motion"): three looks prototyped on the stage with real data (`/tmp/vessels_look/`):
    A the seabed alone, B a dark basemap with the AIS long exposure, C the seabed with the long
    exposure; then D, the seabed with the long exposure, comet tails and moving heads over twelve
    hours of the Oct 12 AIS (a GIF). Recommended: D. Truly live AIS is not in our data (GFW is about
    four days behind); the stage plays the latest AIS back with its date (decision 11)
  - [x] 4.0a Oct 16, the user's pick: D (decision 7); live AIS to be tested on aisstream.io
    (decision 11); the Nov 5 data rerun and Nov 6 rehearsal agreed (decision 12)
  - [x] 4.0b Oct 16, the aisstream test: ten minutes over the islands and a mainland check box
    heard nothing of any message kind; the eastern Pacific heard 24 positions in ten minutes, all
    north of 8° N (GFW: a median 100 vessels an hour in the reserve). No receiver reaches the
    Galápagos; decision 11 closed on the dated replay; no proxy
  - [x] 4.0c Oct 16, the beats prototyped headless on the stage with the Oct 12 data, five rounds
    (`/tmp/vessels_beats/r5/`): the order agreed (claim in grey, then coverage, then candidates),
    per-view island names, the heat as a field, the clock's spacing, tiles loaded before each shot;
    the user's pick: orchid #f07ad8, the heat ramp from it
  - [x] 4.1 Critique on the r5 beats; the look written into DESIGN.md. Done Oct 19: 20/36, two P0s
    (the claim beat showed no claim; the heat in the candidates' colour), three P1s (luminance,
    the Back Row Rule, the two unprototyped beats); stored in `.impeccable/critique/` with what the
    build did about each. The heat stays orchid (the user's pick), softened: 0.75, a dome halo
    under the rings, "the heat is history, not today's candidates" on the clock. The review's amber
    selection was not taken: the selection is fog, amber is the Approve button's alone
  - [x] 4.2 `render.ts` `maritime`; `utils/vesselLayers.ts` (styles by status, legends in words,
    GFW attribution); vitest (never red or amber, never colour alone). Done Oct 19
  - [x] 4.3 `MapView.tsx` with `components/seaStage.ts` and `SeaClock.tsx`: the resting state, the
    radar's sweep (the TiTiler preview drawn along the orbit's direction over 3.8 s), targets by
    status and the claim (marked at `detect_vessels`), heard and unproven water, the candidates'
    reveal (1.4 s after that pass's coverage is on the map), the hotspot heat and boxes, the
    fleet's pull-back (back after 7 s), the next pass's swath; the seabed tiles pre-loaded for the
    reserve and the fleet's view. Done Oct 19; five live headless runs against dev at 1920 with the
    filed views at 1728, 1512 and 1280 (`/tmp/vessels_stage/`). Fixes from the runs: radar tiles
    landing after the pass's targets no longer reverts the beat or the camera; a mistyped session
    URL from the model (`fleet_2026_10` for `fleet_2026-10`) is refused by the agent's own
    `display_visual` with `did_you_mean` (the frontend also stops after two failed loads); box
    labels short (the look time alone) and slid off island names; reserve-scale labels hidden
    below zoom 6; coverage quiet under the forecast and the fleet; the tasking framed once per
    draft clear of both plates (on a 1280 screen the chosen box and the candidates, following the
    officer's box), and the choice painted the moment it is clicked (it waited for the map to go
    idle). The tasking turns were also run at 1280 from the start
  - [x] 4.5 The silent vessel on the stage (decision 10): the earlier pass dated plainly, the last
    broadcast, the reachable area, the targets inside it lit, then the reveal of where the AIS came
    back on (4.2 s later); vitest for its copy and order. Done Oct 19, with one deviation: the
    reach fades in, it does not grow by water around the islands (open with the user)
  - [x] 4.4 `stageCopy.ts` (the act's prompts and step names) and the gallery card. Done Oct 19:
    the card is "coming soon" until the replay case is recorded (6.1); its picture is the
    candidates beat from the live run
  - _Requirements: 12.1–12.4_
- [ ] 5. The officer's decision
  - [x] 5.1 Backend: the filing core lifted from the brief route (brief tests unchanged), the tasking
    routes; tests. Done Oct 19: `filing.ts`, `tasking.ts`, `GET /api/vessels/rest`,
    `GET /api/tasking`, `POST /api/tasking/approve` (idempotent: a second approval files nothing);
    68 backend tests. Slack for taskings posts only to `SLACK_TASKING_WEBHOOK_URL` (or the brief's
    webhook when it is an incoming webhook); the brief's workflow trigger says "brief", so tasking
    Slack is off until that variable is set
  - [x] 5.2 The tasking on the map: boxes selectable, candidates toggled, the plate with its
    countdown; vitest. Done Oct 19 (`TaskingPlate.tsx`): click a box or a ring on the map or use
    the plate; the boxes not chosen step back; a candidate left out turns grey with "left out";
    after filing the stage asks the agent "Is it filed?" and `tasking_status` answers
  - [x] 5.3 The backend role's `PutObject` grant gains `session_data/*/taskings/*` (the user, Oct 16:
    "go ahead"): written in `frontend-cdk/lib/geospatial-agent-stack.ts` with its IAM5 reason;
    `cdk synth` clean (cdk-nag passes; the statement lists exactly `briefs/*` and `taskings/*`).
    Live at the G4 frontend promotion (7.2), not before
  - [x] 5.4 End to end on dev: draft, choose, approve, `tasking_status` says filed, Slack. Done Oct
    19, five times from the local stage against `dark_vessels_dev` (box 2, three of four
    candidates; `session_data/<sid>/taskings/` holds the filed record). Slack Oct 20: the tasking
    has its own Workflow Builder workflow, "Patrol taskings" (ten Text variables,
    `TASKING_WORKFLOW_VARIABLES`; the fixed sentences typed into its message), built by the user
    and tested from a terminal; then one live approve from the stage
    (`tasking-20261020T135453-7bb4c1`) posted to it. Production: the URL becomes the ECS secret at
    the G4 frontend promotion (7.2), like the brief's
  - _Requirements: 10.1–10.4_

## Day 9 (Wednesday Oct 28): the replay case and the evals

- [ ] 6. Replay and eval
  - [x] 6.1 `build_replay_case.py` (refuses forbidden phrases, identifiers, a turn without the
    coverage check); record the star turn; stage it; the gallery card; the network log. Done Oct 21
    as the redesign's task 9: the one question recorded as `vessels-open-question` (U11), the card
    available, AC 8 passing at 1920 and 1280 (gate log)
  - [ ] 6.2 Evals for all four agents on dev; record counts below
  - [ ] 6.3 Follow-up (redesign task 9a): Re-run task 9a with s1d-20261018t1149 once GFW's AIS
    reaches Oct 19 (about Oct 24), before the Nov 3 freeze, still on v1r. The Oct 21 run built the
    Oct 17 pass only (`--until 2026-10-18`): GFW's AIS then reached Oct 17 and showed 0 vessels in
    every hour of the Oct 18 pass's window, so building it would have shown a false 0% heard
  - _Requirements: 13.1, 13.2, 14.1_

## Days 10–11 (Oct 29–30): rehearsal and G4

- [ ] 7. Gate and Release 3
  - [ ] 7.1 Thursday Oct 29: Act 3 timed twice against dev (under 8:30); fallbacks recorded. The
    presenter's, by hand, on the run sheet in `design.md` (rewritten Oct 21); not yet run
  - [ ] 7.2 Friday Oct 30, G4: pytest (all four agents), vitest, backend, `npm run design:check`;
    `promote.sh` with all four agents (the frontend's `cdk diff` shows the `taskings/*` grant and
    the usual task-definition and origin-header changes, nothing else); stable envs checked and smoked; evals on stable; Act 3 timed
    twice against stable; the 30-minute show once; the tag; ROADMAP rows 5 and 6
  - _Requirements: 14.2_

## Gate log

- Oct 15 (day 0): pytest dark-vessels 24 (cfar 10, plan 8, predict 6); nothing deployed
- Oct 16 (the newest data and the look): GFW radar and AIS reach Oct 12; the prediction refitted to
  June and checked on Jul 1 to Oct 12: top 5% of the water 55% (11.0×), top 10% 76% (7.6×); the
  look prototyped (4.0); nothing deployed, no stage code changed
- Oct 19 (the stage and the decision, dev only): `dark_vessels_dev` v4 (claim at detect, the heard
  share) 7/7; v5 (the `display_visual` URL check) 5/7, two closers over 240 characters; v6 (the
  closer one sentence plus the fixed one) 7/7, one warning: a `---` rule on turn A, which the stage
  now drops (`stagePunctuation`). pytest dark-vessels 74; vitest 237; backend 68; tsc and
  `npm run build` clean; detector 0; eslint adds nothing over HEAD. Stable untouched
- Oct 16 (live AIS): aisstream 10 min islands box 0 messages, 10 min eastern Pacific 24 positions (all
  north of 8° N), aiscast 3 min 0; the dated replay stands
- Oct 16 (the beats and the decisions): five headless rounds on the stage; the coverage rule's
  same-hour form 29.8% of the reserve on Oct 12 (30.8% across the window), the same seven
  candidates; AIS wakes: 9 of 10,264 hourly segments over 25 km cross a gap of more than an hour
  (the long straight lines are real transits); all decisions approved; the `taskings/*` grant
  written, `cdk synth` clean; day 1 done (1.1 to 1.3); pytest dark-vessels 36 (cfar 10, plan 8,
  predict 6, coverage 10, scrub 2); nothing deployed
- Oct 16 (the build and the agent): the licence cleared; the cache built and uploaded (110 files,
  772 MB); the plans warmed, `--check` clear; the agent package and every tool run locally on the
  real cache; on the cache's own history (329 dark detections away from the ports, 49 in the
  hold-out) the check is 45% (9.0×) at SPREAD 1, against 35% at 0, 39% at 2 and 35% at 3, so
  SPREAD 1 stays; the spike's 55% (11.0×) does not reproduce on the cache at any spread and is
  not said; pytest
  dark-vessels 66 passed, 1 skipped (staging, until `stage_shared.sh` runs); geo_agent 124;
  nothing deployed
- Oct 19 (first dev deploy): `dark_vessels_dev` version 3 READY, env checked; eval vessels dev 7/7
  (`/tmp/eval_vessels_dev3.json`); plans warmed as a chain (S1C Oct 19 to Nov 8, no look over the
  reserve; S1D Oct 19 + Oct 16, four looks to Nov 5, next Oct 24 00:17 UTC, 54%), `--check`
  clear; pytest dark-vessels 71 (no skip now the image is staged); nothing stable touched
- Oct 21 (the one-question redesign, `redesign-open-question.md`, branch `act3-open-question`, dev
  only). Hashes are after gate B's rebase onto `develop` `f50b2b6` unless marked pre-rebase. The
  run's notes and eval reports are in `.agents/tasks/act3-open-question/` (not committed):
  - Task 1, the copy fixes both versions need: the four-turn eval on dev 6/7, then 7/7
    (`evals/t1d-four-turn-dev-run2.*`, dev version 7: unseen 37 s, gone-silent 24 s, where-next
    19 s, draft-tasking 9 s, the provocations 2 to 3 s). The tag `act3-four-turn-fallback` was made
    then; it moved three times in task 1 and once with gate B's rebase, and is now `11da083`
    (`11da08319909c843792c13d0c8e07e90679de397`)
  - Gate A attempt 1, 15:29 EDT, **FAIL** (`54be770` pre-rebase, version 8, v1 data): all cases
    9/11; `open-question` x3 1/3 (124 and 121 words over the cap), median 55.5 s, max 60.8 s
    (`evals/gate-a-1-*`)
  - Gate A attempt 2, 16:07 EDT, **PASS** (`71781c3` pre-rebase, version 10, v1): all cases 11/11
    (also 11/11 on version 9, the round before); `open-question` x3 3/3 on one path, median 54.5 s,
    max 58.3 s, 108 words, 0 refusals; `thin-pass` 81.2 s with a draft; `named-pass` 55.5 s;
    `second-question` 60.8 s (1 refusal, the gate working); `gone-silent` 21.5 s (`gate-a.md`,
    `evals/gate-a-2-*`)
  - Gate B attempt 1, 18:27 EDT, **PASS** (`3415058`; the agent from `73410d9`, version 11, v1):
    the rebase replayed 41 commits with no conflict; vitest 447, backend 76, detector `[]`,
    design:check 0; all cases 11/11; `open-question` x3 3/3, median 47.2 s, max 48.9 s, 0 refusals;
    `thin-pass` 46.1 s on the stop line (1 refusal, W2); headless live runs, three at 1920 and one
    at 1280, every AC 6 check met, the answer landing 45.9 to 52.0 s after the click; findings W1 to
    W6 (`gate-b.md`, `evals/gate-b-*`)
  - Task 9a, 18:28 to 19:05 EDT (`vessels/cache/v1r` with the Oct 17 pass added, version 12):
    **AC 7 met**: `open-question` 74.6 s (all cases), then x3 49.1, 43.8 and 50.9 s (median
    49.1 s, max 50.9 s), each reading Oct 12 as `newest_wide`, drafting box 1, 0 refusals; all
    cases 11/11; no U14 signal (`t9a.md`, `evals/t9a-*`)
  - Task 9, 19:10 to 19:50 EDT (version 13, v1r): gate B's W1 to W4 first (the boxes beat held
    3.00 s; `decide(draft)` refused before a match; no key row clipped at 1920; W4 recorded as known
    1280 behaviour); `thin-pass` 94.7 s with a draft; the replay case `vessels-open-question`
    recorded once (take 2: 21 calls, 0 refusals). **AC 8**, as amended that day, **passes** at
    1920 and 1280: 0 agent invocations, no live data call waited on (`t9-verification.md`,
    `evals/t9-*`)
  - Task 15, **done** (version 14, v1r): the Case 8 pass `s1a-20260401t0026` built in 203.2 s
    and uploaded as 26 new keys under `vessels/cache/v1/`; its record in the v1 and v1r manifests
    after backups to `backup-2026-10-22`; the Mar 27 S1A plan cached; agent pytest 255 passed;
    smoke 1/1 (22 s); `gone-silent` 1/1 in 23.5 s with "2026" (`evals/t15-*`; redesign §4)
  - Finding from task 15, nothing changed for it: v1r's history (task 9a's `--history` rebuild,
    Oct 21) has 0 hours, 0 km and 0 knots on all 5,748 AIS-off rows; v1's (Oct 16) has hours and
    km on all 5,664 and knots on 5,542. The likely cause, not checked against GFW's API: its gaps
    events no longer fill the fields `build_history` reads (`durationHours`, `distanceKm`,
    `impliedSpeedKnots`, read with a default of 0). On v1r `reachable_area` therefore
    returns `hours_after_off` 0.0. The Nov 5 runbook's `--history` (task 13) would write the same
    into v1, so the build needs a fix and a test before then
  - Task 10, docs: the run sheet (`design.md`), the redesign's §3.2 and §3.9 with the seconds
    measured above, and DESIGN.md's Act 3 paragraph. The presenter's timed rehearsal x2 on dev
    (7.1, Act 3 under 8:30 twice) is manual and was not done in this run
  - U14, recorded for after this run (tasks 13 and 14, Nov 5 and 6): if any of three runs on the
    rerun data ends without a draft or takes over 120 s, restore the backups and present on the
    pre-rerun data; task 9a showed no such signal, so the rerun stands
  - Stable, `demo-stable` and Slack untouched: every eval and browser check ran with empty
    `SLACK_*` variables. Dev is left on version 14 with `VESSEL_CACHE_PREFIX=vessels/cache/v1r`,
    which task 11 removes at G4
- (Oct 30 G4: commands with counts, the tag, the four stable smokes and evals, both Act 3 timings,
  the 30-minute run-through)
