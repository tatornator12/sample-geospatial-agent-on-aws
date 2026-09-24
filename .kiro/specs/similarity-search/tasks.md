# Tasks: similarity-search (Week 3, Sep 29–Oct 3)

Cadence: requirements + design approved before code (drafted and approved Sep 24, ahead of
the Monday cadence; the five design decisions were accepted as recommended); tasks top to bottom; every task names its tests; Friday gate G2 (Oct 3):
Release 1 promoted to `demo-stable` on the stable runtime and the CloudFront UI, Act 1 rehearsed
twice at 7 min. All deploys before Friday are `DEPLOY_TARGET=dev`. The `lgnd-partition-query`
Lambda is shared with the stable runtime and is the one piece of shared infrastructure touched
before Friday (task 1.4 records the before/after guard).

- [ ] 1. Lambda: `mode` dispatch
  - [ ] 1.1 `lambda_functions/lgnd_query/handler.py`: `mode = event.get("mode", "change")`; move today's body into `_change()` unchanged; shared connection/path/bbox-filter/envelope helpers
  - [ ] 1.2 `_embed()`: cells under the bbox for one (year, month), nearest-to-centre cap of 64, returns `cells[{cell_id, bbox, embedding}]` + `cells_found`
  - [ ] 1.3 `_similar()`: `list_cosine_similarity(embedding, <query literal>)`, `WHERE sim >= min_similarity`, `ORDER BY sim DESC, bbox.ymin, bbox.xmin LIMIT limit`, returns `cells[{cell_id, similarity, bbox}]` + `cells_compared`
  - [ ] 1.3a Input validation shared by all three modes (design.md "Security"): allowlisted `mode`, geohash regex, int/float range checks on year, month, bbox, thresholds, limit, and exactly 256 finite floats for `query_embedding`; SQL literals rendered only from parsed numbers; invalid input → error envelope, never a DuckDB error
  - [ ] 1.4 `tests/test_lgnd_handler.py`: existing change tests untouched and green; new: `embed` cells + vectors + cap (fixture gains 70 cells inside one small bbox), `similar` self-match at 1.0 first, threshold, limit, bbox filter, wrong-length vector → envelope error, unknown mode → envelope error, injection attempts in `geohash` / `query_embedding` (e.g. `"9x'); DROP"`, `["1e999", "nan", "x"]`) → envelope error with no query executed
  - [ ] 1.5 Deploy `npx cdk deploy ChangeDetectionStack --require-approval never` (us-west-2). Before and after: `aws lambda invoke` with the change payload for one Colorado partition (geohash `9x`, 2019-07 vs 2024-07, bbox from `COUNTRY_BBOXES["colorado"]`, `min_change_score` 0.25) and record `above_threshold` both times here; they must match
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1_

- [ ] 2. Runtime: `lgnd_similarity.py` and the tool
  - [ ] 2.1 `geo_agent/utils/lgnd_similarity.py`: `ARCHIVE_END`, `default_period()`, `query_embedding()` (embed per touched geohash, mean, L2-normalise), `search_similar()` (fan-out ≤ 8 threads, limit `top_k*20`, merge, drop query cell_ids + `exclude_radius_km`, land mask, sort `(−similarity, lat, lon)`, greedy thin, rank, `distance_km`), `to_geojson()` (tiers, centres)
  - [ ] 2.2 `find_similar_places` in `utils/tools.py`: extent resolution copied from `scan_region_change` (exact `COUNTRY_BBOXES` key, `search_bbox` precedence, 20-partition limit, same error texts); 64-cell query cap error; no-cells error naming month and archive range; upload `similar_<loc>_<region>_<yyyymm>.geojson`; result JSON per design (summary, query, matches, `similar_geometry_s3_url`, method, `next_steps`); register in `geospatial_agent_on_aws.py` next to `scan_region_change`
  - [ ] 2.3 `tests/test_similarity.py` (Lambda client patched with canned partition responses): mean pooling + normalisation, query-cell and radius exclusion, land mask (Atlantic cell dropped), thinning at 5 km, identical output from shuffled partition order, partial failure → matches + `summary.errors`, all fail → error; tool-level with S3 patched: file name, GeoJSON tiers/properties, the three error paths
  - [ ] 2.4 Calibrate live against dev (after 3.2): New York from Central Park and Colorado from Rocky Mountain National Park, `min_similarity` 0.70 / 0.75 / 0.80 — record match counts, top-3 similarity values and a one-line eyeball of whether rank 1–3 are parks/reservoirs/mountains respectively; fix the default here and in the tool signature. Record warm timing for both states (target < 15 s) and that two identical runs return identical output
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1_

- [ ] 3. Prompt and dev deploy
  - [ ] 3.1 `config.AGENT_PROMPT`: FIND PLACES BY EXAMPLE block, tool-list line, fifth workflow example; TOOL SELECTION gains the "similar ≠ scan" sentence
  - [ ] 3.2 `DEPLOY_TARGET=dev ./deploy.sh`; confirm env vars persisted (`LGND_EMBEDDINGS_ENABLED=true`), one smoke invoke; three manual prompts: "Find places across New York State that look like Central Park", a drawn point in the Adirondacks + "find more like this in New York", and "Find places in Colorado like Rocky Mountain National Park" — confirm the display → names → two inspections → table + closer order in the logs, and that `scan_region_change` is never chosen
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Frontend
  - [ ] 4.1 `/impeccable critique` the layers plate and the map popup before touching them; record the brief as an addendum in `.impeccable/surfaces/`
  - [ ] 4.2 `MapView.tsx` similarity branch: violet fill ramp on `similarity`, 2 px match outline, dashed cyan query outline, 24 px mono rank labels with halo on a client-side centre source, `fitBounds` over all features, click popup (rank, similarity, lat/lon in mono), pointer on hover. **Verify rank labels render with no `glyphs` in the style (maplibre local fonts); if not, circles + popup and record the deviation in design.md**
  - [ ] 4.3 `utils/layerFormatting.ts`: `isSimilarityLayer`, `similarPlaces` group excluded from `geometries`, `formatLayerDisplayText(…, 'similar')`; layers plate group "Similar places" after Change detection with the one-row legend (`.map-legend`, ≥ 15 px labels)
  - [ ] 4.4 `ChatSidebar.tsx`: fifth prepared prompt "Places like Central Park"
  - [ ] 4.5 `layerFormatting.test.ts` + `parsing.test.ts`: detection, grouping, display text, `display_visual` with a `similar_*.geojson` URL (complete and truncated)
  - [ ] 4.6 DESIGN.md: violet ramp + dashed cyan query outline under "Data colour on the map"; layers-plate order gains "similar places"
  - [ ] 4.7 `npm run build`, `npm test`, `npm run design:check` = 0; `/impeccable polish`; headless Chrome against dev: layer, ten labels, legend row, popup on click, then hard-reload survives
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.2_

- [ ] 5. Golden prompt
  - [ ] 5.1 `scripts/golden_prompts.json`: `similar-central-park` with `["find_similar_places", "display_visual", "get_rasters", "inspect_image"]`; `eval.py --target dev` live; calibrate from the recorded stream; record 8/8 and per-prompt seconds here
  - _Requirements: 3.4_

- [ ] 6. Promotion tooling
  - [ ] 6.1 `scripts/promote.sh`: after the stable agent deploy, print the frontend command and run it when `PROMOTE_FRONTEND=1`; pre-check `frontend-cdk/.env` has `AGENT_RUNTIMES` naming both runtimes; checklist line for the CloudFront hard-reload check; `DRY_RUN=1` prints both
  - [ ] 6.2 `frontend-cdk`: confirm the stack synthesises with the current `.env` (`npx cdk synth GeospatialAgentStack`), no deploy yet
  - _Requirements: 6.4_

- [ ] 7. Gate G2 (Friday Oct 3) and Act 1 rehearsal
  - [ ] 7.1 `pytest -q`, `npm test`, `npm run design:check`, `eval.py --target dev` (live, 8 prompts); record counts below
  - [ ] 7.2 `scripts/promote.sh` with `PROMOTE_FRONTEND=1`: tag `deployed-2026-10-03`, stable runtime deployed, CloudFront UI deployed; confirm env vars on the stable runtime, one smoke invoke, `eval.py --target stable --only similar-central-park` and `--only vegetation-central-park`; push `develop`, `demo-stable` and the tag to `fork`
  - [ ] 7.3 Rehearse the Act 1 run sheet (design.md) twice against stable on the CloudFront UI, pre-warmed; record both timings and the beat where time was lost; apply the fallback if over 7:30 and record the decision
  - [ ] 7.4 Update `ROADMAP.md`: row 3 status, G2 result; note anything deferred to Week 4
  - _Requirements: 6.3, 6.4, 6.5_

## Gate log

- (append Friday Oct 3 results here: commands with counts, promotion tag, stable smoke + eval, two rehearsal timings)
