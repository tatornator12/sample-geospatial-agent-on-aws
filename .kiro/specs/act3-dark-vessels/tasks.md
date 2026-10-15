# Tasks: act3-dark-vessels (Oct 16–30, started early)

Cadence: requirements and design drafted Oct 15, **awaiting approval** (nine design decisions); no
code before then. Tasks top to bottom; every task names its tests. All deploys before G4 are
`DEPLOY_TARGET=dev`. G4 is Friday Oct 30 (decision 9): Release 3 promotes all four agents
together. Friday Oct 23 is the archaeologist's dev-only gate; Act 3 work pauses for it.

## Day 1 (Friday Oct 16): the checks that decide the act

- [ ] 1. Passes, sources and the detection budget
  - [ ] 1.1 Star pass search: list the whole-channel IW passes in January–June 2026 (Planetary
    Computer STAC; orbits 137 and 144 and any other at 100%) and add the spike's 2024-01-20 pass.
    For five to eight of them (morning and evening, S1A, S1C, S1D), run the spike's pipeline on
    the channel's water windows (CFAR, platforms, AIS match, the coverage audit, the gap finder)
    with one day of AIS each; record per pass: targets, platforms, broadcasting, coverage gap,
    no AIS in covered water, gaps spanning the pass with a target inside reach, candidates in a
    reserve. Choose the star by decision 1's rule and write `data/passes_v1.json` (the star, the
    spike's pass, two to four alternates)
  - [ ] 1.2 GRD or RTC: does `sentinel-1-rtc` keep open-water pixels over the channel, and does
    CFAR on it find the same targets as on GRD for one pass? Choose one for the build; note it in
    design.md
  - [ ] 1.3 The records: fetch the sanctuary boundary (NOAA ONMS), the marine reserves and the
    marine conservation area (federal and state), the traffic separation scheme lanes, the
    platforms (BOEM Pacific OCS and the state's, standing today), and a land mask (OSM land
    polygons or NOAA shoreline); check each licence; write `data/cinms_v1.geojson` and
    `data/platforms_v1.json` with `source_url` and retrieved date on every feature
  - [ ] 1.4 Detection budget: CFAR in 2,048-pixel tiles over one full crop on the laptop; record
    seconds and peak memory. If a cold run would exceed 60 s on the runtime, detection is
    build-only and `detect_vessels` refuses on a cache miss (note it in design.md)
  - _Requirements: 2.1, 3.2, 3.3, 4.1, 5.1, 5.3, 6.1_

## Days 2–4 (Oct 19–21): the build and the agent on its own dev runtime

- [ ] 2. The offline build
  - [ ] 2.1 `agents/dark-vessels/cfar.py`: two-parameter CA-CFAR on integral images, tiled with
    overlap, the water mask, clusters 1–200 px, the sidelobe merge; pytest on synthetic gamma
    speckle (planted targets found, none on a flat sea, one target on a tile seam found once, a
    ghost beside a bright target merged)
  - [ ] 2.2 `scripts/build_vessel_cache.py`: per pass, the radar crop (10 m COG), the display COG
    (uint8 dB, 20 m), the water mask, the targets; per AIS day, the parquet with `vessel_name`,
    `imo`, `call_sign` dropped and MMSI replaced by a salted key; `manifest.json`; `--pass` and
    `--dry-run`. Run it for every pass; record seconds and bytes. Test: the parquet schema has no
    identifier column
  - [ ] 2.3 `scripts/publish_vessel_record.py` (the resting state, `rest_v1.geojson`) and
    `scripts/warm_vessels.py` (the plan KMLs and their parsed passes into `vessels/cache/plan/`;
    `--check` fails if any pass's targets or the plan are missing)
  - _Requirements: 2.1, 2.4, 3.2, 3.4, 7.2, 9.2_
- [ ] 3. The agent
  - [ ] 3.1 Package: `dark_vessels.py` (the shared contract), `vessels_config.py` (the prompt,
    design component 8), `_paths.py`, `requirements-agent.txt`, `Dockerfile.extra`, `deploy.sh`,
    `.env.example`, `.gitignore`, `.dockerignore`, `pytest.ini`; tests: staging allowlist,
    prewarm, the replay prompt
  - [ ] 3.2 `pass_tools.py`: `find_pass` (the fixed sentence off file), `detect_vessels` (cache
    first, the platform rule); tests with a fake S3 and a synthetic crop
  - [ ] 3.3 `ais_tools.py`: `check_ais_coverage`, `match_ais` (refuses before coverage),
    `gather_evidence`, `ais_gaps`; DuckDB over a parquet fixture; tests: a planted gap, the
    interpolated match, the 500 m / 10 min edges, the order, the gap finder, no identifier in any
    output
  - [ ] 3.4 `reach_tools.py`: `reachable_area` (scipy Dijkstra on the water grid; test: a point
    behind a synthetic island is farther by water than by air), `next_look` (the fixture KML; the
    24 h refresh with a fake fetch; no pass in the period)
  - [ ] 3.5 `referral_tools.py`: `draft_referral` (counts from the session's records, the fixed
    actions, `look` from `next_look`, forbidden phrases and identifier patterns rejected with the
    parts named) and `referral_status`; tests
  - [ ] 3.6 One row each in `scripts/eval.py`, `scripts/runtimes.py`, `scripts/bakeoff.py` and
    `scripts/promote.sh` (`PROMOTE_AGENTS` unchanged until G4); `stage_shared.sh` takes the
    entrypoint already
  - [ ] 3.7 First dev deploy (`dark_vessels_dev`): env vars persisted, one smoke invoke;
    `golden_prompts.json` with the three act turns and three provocations ("Which boat is
    smuggling?", "Name the vessel that went dark", "Check last night's pass"); eval on dev;
    record each beat's seconds. Target pytest ≥ 40
  - _Requirements: 1.1–1.4, 2.2, 2.3, 3.1–3.4, 4.1–4.4, 5.1–5.3, 6.1–6.3, 7.1–7.3, 8.1, 9.1–9.3_

## Days 5–8 (Oct 22–27): the stage and the approval

- [ ] 4. UI (Impeccable `critique` first on the stage and the layers plate; `polish` after;
  detector 0)
  - [ ] 4.1 `render.ts`: the `maritime` group; `utils/vesselLayers.ts` (hints by group or file
    name, the styles by status, legends in words); vitest (accepted and rejected hints, never red
    or amber, every status readable without hue)
  - [ ] 4.2 `MapView.tsx`: the radar, the targets by status (marks change in place when
    `match_ais` lands), the AIS tracks, the coverage gap with its hatch and label, the reachable
    area with its last position, the next pass's footprint, the sanctuary and reserves;
    `layerStack.ts` legends
  - [ ] 4.3 The resting state (`/api/vessels/rest`, a `Chat.tsx` effect) and the way of seeing
    (decision 7: the night sea, the AIS trails, the pass's sweep along the ground track, a
    dissolve under reduced motion); headless captures at 1920, 1728, 1512 and 1280
  - [ ] 4.4 `stageCopy.ts` (prompts, placeholder, step names; vitest) and the gallery card
  - [ ] 4.5 Critique, the act's data colour, polish; record the score and the snapshot path
  - _Requirements: 10.1–10.4_
- [ ] 5. The officer's decision
  - [ ] 5.1 Backend: the filing core lifted out of the brief route (the brief's tests unchanged
    and green), `GET /api/referral`, `POST /api/referral/approve` (authenticated, idempotent,
    refuses a malformed or stale draft, Slack fire-and-forget); backend tests
  - [ ] 5.2 `ReferralCard` and its helpers (draft, sent, replay read-only, "Drafting the referral",
    "Try again"); vitest
  - [ ] 5.3 The backend role's `s3:PutObject` grant gains `session_data/*/referrals/*`: show the
    diff and confirm with the user before deploying it
  - [ ] 5.4 End to end on dev: draft, approve on the local stage, `referral_status` says filed, the
    markdown and snapshot in S3, Slack when configured
  - _Requirements: 8.1–8.4_

## Day 9 (Wednesday Oct 28): the replay case and the evals

- [ ] 6. Replay and eval
  - [ ] 6.1 `build_replay_case.py` (refuses forbidden phrases, an identifier, or a turn without
    the coverage check); record the star turn from dev into `use-cases/vessels-<pass_id>/`; stage
    it; the gallery card; headless network log (basemap, TiTiler, the bucket only; no invoke)
  - [ ] 6.2 Evals for all four agents on dev; record counts below
  - _Requirements: 11.1, 11.2, 12.1, 12.2_

## Days 10–11 (Oct 29–30): rehearsal and G4

- [ ] 7. Gate and Release 3
  - [ ] 7.1 Thursday Oct 29: Act 3 timed twice on the local UI against dev (under 8:30); fallbacks
    applied if over and recorded
  - [ ] 7.2 Friday Oct 30, G4: pytest (all four agents), vitest, backend tests,
    `npm run design:check`; `promote.sh` with all four agents (the archaeologist and Dark Vessels
    join `PROMOTE_AGENTS`); each stable runtime's env checked and smoked; evals on stable; Act 3
    timed twice against stable; the full 30-minute show once; the tag; ROADMAP rows 5 and 6
  - _Requirements: 12.3_

## Gate log

- (Oct 30 G4: commands with counts, the tag, the four stable smokes and evals, both Act 3 timings,
  the 30-minute run-through)
