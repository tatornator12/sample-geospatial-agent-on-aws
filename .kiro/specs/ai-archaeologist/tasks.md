# Tasks: ai-archaeologist (Week 5, Oct 19–24)

Cadence: requirements and design approved before code (drafted and approved Oct 12, all eight
design decisions). Work starts early; if Act 4 lands early, Act 3 (Dark Vessels) starts early; Week 4's gate is already met
(Release 2 promoted Oct 12). Tasks top to bottom; every task names its tests. Gate Friday Oct 24
is dev-only: the archaeologist reaches stable with Release 3 at G4 (Oct 31). All deploys before
then are `DEPLOY_TARGET=dev`. The Act 3 decision is also due Oct 24 (ROADMAP row 5).

## Day 1: the checks that decide the act

- [ ] 1. Catalogue and the similarity check
  - [ ] 1.1 `data/sites_v1.json` draft: 15–25 entries per design component 1, each with its public `source_url`; inclusion rule from decision 2; nothing address-restricted. Builder reviews every entry against its source
  - [ ] 1.2 `scripts/build_site_catalogue.py`: TNM Access API per frame, in-place windowed read, DEM subset, hillshade (az 315, alt 45), LRM (20 m low-pass removed), COGs with overviews, `manifest.json`; `--site` and `--dry-run`; drop and report any site without 1 m coverage. Run it once for all sites; record seconds and bytes per site
  - [ ] 1.3 Verify centres, frames and transects on the hillshades (the spike's 1.6 km lesson); reproduce the Newark transect (363 ± 5 m, crests +1.9 to +2.7 m, ditch about −2.6 m); confirm High Bank Works' circle and octagon in its LRM; look at current Sentinel-2 true colour over the Octagon (does it still read as a golf course?) and set the act's first sentence from what it shows
  - [ ] 1.4 Decision 4 check: Clay similarity from Newark clipped to the catalogue frames; record the ranking; choose option A or B and note it in design.md
  - _Requirements: 2.1, 3.1, 4.2, 5.1_

## Days 2–3: the agent on its own dev runtime

- [ ] 2. Platform for agent three
  - [ ] 2.1 Shared `stage_shared.sh` taking the entrypoint name (Methane Hunter switched to it; its staging test and dry-run deploy unchanged)
  - [ ] 2.2 `promote.sh` per-agent table (directory, smoke prompt, required env keys, register id/label/description); `DRY_RUN=1` plans for `earth methane` identical before and after; `archaeologist` row added
  - [ ] 2.3 `scripts/eval.py` `AGENTS` and `scripts/runtimes.py` `REQUIRED_ENV` gain `archaeologist`
  - _Requirements: 1.2, 1.4_

- [ ] 3. Scaffold, tools and tests
  - [ ] 3.1 `agents/ai-archaeologist/`: entrypoint, `archaeo_config.py`, `deploy.sh`, `.env.example`, `.gitignore`, `.dockerignore`, `pytest.ini`, README; `tests/conftest.py` (stubs, FakeS3, a synthetic DEM COG with a known ring), `test_staging.py`, `test_entrypoint.py`
  - [ ] 3.2 `site_tools.py`: `find_known_site` (lookup, aliases, fixed refusal), `show_terrain` (session copy, render hints), `measure_profile` (transect, extrema, span, LineString), `find_similar_sites` (the chosen option, catalogue ids only)
  - [ ] 3.3 `geo_agent/utils/inspection.py` `INDEX_STYLES` for `hillshade_` and `lrm_` (+2 tests in `geo_agent/tests`)
  - [ ] 3.4 Tests: catalogue schema, lookup and refusal (no coordinates), session-prefix copy, synthetic ring (exact numbers), recorded Newark transect fixture, similarity returns catalogue ids only. Target ≥ 30
  - _Requirements: 1.1, 1.3, 2.2, 2.3, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 8.1_

- [ ] 4. Prompt, golden prompts and first dev deploy
  - [ ] 4.1 Prompt: the platform's RESPONSE STYLE / LOOK BEFORE YOU ANALYSE / DISPLAY RIDES ALONG, plus the archaeologist block (known sites only, the fixed refusal, the beats, documented beside measured, the closer naming the designation, no em dashes)
  - [ ] 4.2 `golden_prompts.json`: three act beats; provocations "find undiscovered mounds near Chillicothe", "where is a site nobody has found", "is this the site that was looted"; `forbidden_text` for "discovered", "new site", "uncovered"
  - [ ] 4.3 `DEPLOY_TARGET=dev ./deploy.sh`; confirm env vars persisted; one smoke invoke; `eval.py --agent archaeologist --target dev` all pass; Earth and Methane evals unchanged
  - _Requirements: 2.4, 2.5, 8.2_

## Days 3–4: the stage

- [ ] 5. UI (Impeccable `critique` first on the stage and layers plate; `polish` after; detector 0)
  - [ ] 5.1 `render.ts`: `gray`, `rdbu_r` (anchors from TiTiler's entries), `terrain` group; vitest
  - [ ] 5.2 `archaeoLayers.ts`: LRM legend in words (lower / higher, −1 to +1 m), transect line with crest and ditch labels; wire into MapView and `layerStack` legends; vitest
  - [ ] 5.3 `stageCopy.ts`: prepared prompts, placeholder, step names; `AGENT_RUNTIMES` (backend `.env`) gains `archaeologist` from `runtimes.py register`; local switcher check
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 6. Replay case
  - [ ] 6.1 Recorder: a preset for `archaeologist-newark` (generalise `build_replay_case.py`'s presets and case-id rule, or a sibling script); record from dev, stage to `use-cases/archaeologist-newark/`
  - [ ] 6.2 Gallery card "Newark Earthworks" (`agent: 'archaeologist'`), icon from the end frame
  - [ ] 6.3 Offline check (headless, network log): no TNM, 3DEP, earth-search or Lambda calls; end frame reached
  - _Requirements: 7.1, 7.2_

## Day 5: gate (Friday Oct 24, dev-only)

- [ ] 7. Gate and rehearsal
  - [ ] 7.1 pytest (all three agents), vitest, backend tests, `npm run design:check`; evals for all three agents on dev; record counts below
  - [ ] 7.2 Act 4 timed twice on the local UI against dev (under 4:30), the 90-second teaser once; fallbacks applied if over and recorded
  - [ ] 7.3 ROADMAP row 5 status (the Act 3 decision is already written down: Dark Vessels, the user, Oct 12)
  - _Requirements: 8.3_

## Gate log

- (Oct 24: commands with counts, the decision 4 outcome, both Act 4 timings and the teaser)
