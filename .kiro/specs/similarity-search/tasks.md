# Tasks: similarity-search (Week 3, Sep 29–Oct 3)

Cadence: requirements + design approved before code (drafted and approved Sep 24, ahead of
the Monday cadence; the five design decisions were accepted as recommended); tasks top to bottom; every task names its tests; Friday gate G2 (Oct 3):
Release 1 promoted to `demo-stable` on the stable runtime and the CloudFront UI, Act 1 rehearsed
twice at 7 min. All deploys before Friday are `DEPLOY_TARGET=dev`. The `lgnd-partition-query`
Lambda is shared with the stable runtime and is the one piece of shared infrastructure touched
before Friday (task 1.4 records the before/after guard).

- [x] 1. Lambda: `mode` dispatch (built and deployed Sep 24)
  - [x] 1.1 `lambda_functions/lgnd_query/handler.py`: `mode = event.get("mode", "change")`; move today's body into `_change()` unchanged; shared connection/path/bbox-filter/envelope helpers
    - Change SQL is byte-for-byte the same text; calibration constants untouched. Connection setup moved into `_connect()` and always closed in `finally`
  - [x] 1.2 `_embed()`: cells under the bbox for one (year, month), nearest-to-centre cap of 64, returns `cells[{cell_id, bbox, embedding}]` + `cells_found`
    - Live: Central Park's bounds (2025-07, geohash `dr`) → 13 cells, 256 dims each, ~1 s. **Note for 2.1:** the bbox of a small polygon pulls in the whole Manhattan neighbourhood; the runtime should keep the cells whose centre falls inside the query polygon (fall back to the nearest cell), otherwise the query vector is "dense city" rather than "park"
  - [x] 1.3 `_similar()`: `list_cosine_similarity(embedding, <query literal>)`, `WHERE sim >= min_similarity`, `ORDER BY sim DESC, bbox.ymin, bbox.xmin LIMIT limit`, returns `cells[{cell_id, similarity, bbox}]` + `cells_compared`
    - Live: New York bbox on `dr`, 165,040 cells compared in 6.6 s warm, top 200 returned; top hits are the query's own cells (0.98) and adjacent Manhattan, as expected before the runtime's exclusion step. Similarities in the top 200 are all ≥ 0.96, so 0.75 will be far below the useful range — calibration (2.4) should start at 0.90
  - [x] 1.3a Input validation shared by all three modes (design.md "Security"): allowlisted `mode`, geohash regex, int/float range checks on year, month, bbox, thresholds, limit, and exactly 256 finite floats for `query_embedding`; SQL literals rendered only from parsed numbers; invalid input → error envelope, never a DuckDB error
    - Also: an invalid geohash is not echoed back in the envelope (`geohash: null`). Behaviour change for the change path: out-of-range years (e.g. 1999) now fail validation instead of failing in DuckDB; same envelope, so the runtime is unaffected
  - [x] 1.4 Tests: `test_lgnd_handler.py` untouched (5 green); new `test_lgnd_handler_modes.py`, 29 tests: embed cells/vectors/bbox/cap (cap exercised by monkeypatching `EMBED_CELL_CAP` to 4 on the existing 50-cell fixture rather than growing it), similar self-match ordering and geographic tie-breaks, threshold, limit, bbox, a second query vector ranking a different neighbourhood, missing partition envelope; validation: 8 common-field cases proven to never call `duckdb.connect` (tripwire), 11 similar-field cases proven to execute no SQL (spy connection), change-path year validation, literal rendering. `conftest.lgnd_base_vectors()` factored out of the fixture. pytest total 85/85
  - [x] 1.5 Deployed twice (second for the geohash-echo fix), `cdk diff` showed only the image URI (no IAM/timeout/memory change; role, 2048 MB, 120 s unchanged). Colorado `9x` change smoke 2019-07 vs 2024-07 at 0.25: **before** total_d1 65,749 / total_d2 63,386 / matched 63,244 / above_threshold 4,595 (14.6 s); **after** identical on both deploys. Production envelope confirmed for a NaN-string vector and an injection-shaped geohash
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1_

- [x] 2. Runtime: `lgnd_similarity.py` and the tool (built Sep 24)
  - [x] 2.1 `geo_agent/utils/lgnd_similarity.py`: `ARCHIVE_END`, `resolve_period()`, `query_embedding()` (embed per touched geohash, mean, L2-normalise), `search_similar()` (fan-out ≤ 8 threads, limit `top_k*20`, merge, drop query cell_ids + `exclude_radius_km`, land mask, sort `(−similarity, lat, lon, cell_id)`, greedy thin, rank, `distance_km`), `to_geojson()` (tiers, centres)
    - Two deviations from the design, both from live data: (a) query cells are the cells whose **centre falls inside the example geometry** (nearest cell as fallback), not everything under its bbox — Central Park's bbox pulled 13 Manhattan cells, the inside filter keeps 9; (b) the embed bbox is padded by ~one cell (`QUERY_PAD_DEG` 0.012) because the monthly grid has gaps: Longs Peak had 0 cells at the point and 6 within 0.01°. `resolve_period()` also moves a given off-season month into season with a note, same rule as the scan
  - [x] 2.2 `find_similar_places` in `utils/tools.py`: extent resolution mirrors `scan_region_change` (exact `COUNTRY_BBOXES` key, `search_bbox` precedence, 20-partition limit, same error texts); 64-cell query cap error; no-cells error naming month and archive range; upload `similar_<loc>_<region>_<yyyymm>.geojson`; result JSON per design (summary, query, matches, `similar_geometry_s3_url`, method, `interpretation`, `next_steps`); registered in `geospatial_agent_on_aws.py` behind `LGND_EMBEDDINGS_ENABLED` next to `scan_region_change`
    - Validation at the tool boundary: `top_k` 1–50, thresholds finite and in range, `search_bbox` parsed and range-checked, `geometry_s3_url` must be `s3://`, `location`/`search_region` slugified for the key. Deviation: `"new york": (-79.76, 40.50, -71.86, 45.02)` added to `COUNTRY_BBOXES` (data-only change to `lgnd_embeddings.py`; the demo's search region was not in the table). Known limitation to say on stage: the extent is the state's bounding box, so New York matches include New Jersey and Connecticut
  - [x] 2.3 `tests/test_similarity.py`, 26 tests with a fake Lambda client serving two canned partitions: period defaults/errors, extent rules (no substring match, bbox validation), pooling of inside-cells only, nearest-cell fallback for a point, no-cells and >64 errors, merge (query id + 5 km radius + Atlantic cell dropped, twin thinned, exact rank order), determinism under shuffled partition output, `top_k`, separation off, one failed partition → matches + `errors`, all failed → error, >20 partitions → error, GeoJSON tiers/ring, tool result shape and file name, slugified key resists `../` and `/`, seven argument errors as JSON with nothing uploaded, no-cells as JSON. pytest total 111/111
  - [x] 2.4 Calibrated live from the laptop through the deployed Lambda (module imported directly; no runtime deploy needed). **Central Park → New York, 2025-07**, 9 query cells, 190,329 cells compared: floors 0.85 and 0.90 both return the same top 10 (rank 1 0.970 at 40.754,-74.181 Newark/Branch Brook area, 0.965 Highbridge/Harlem River, 0.960 Bronx Park, 0.958 Bayonne/Staten Island shore, 0.956 Yonkers — urban parks with dense city around them, which is what the example is), 0.95 returns 8. **Longs Peak (point) → Colorado, 2025-07**, 1 query cell, 159,491 compared: 0.90 → 10 matches, rank 1–2 in the San Juan Mountains (0.934, 0.933), rank 3 Gore Range (0.927), rank 5 Lost Creek Wilderness (0.925); 0.95 → 0 matches. **Default fixed at 0.90** (parks land 0.95–0.97, mountains 0.92–0.93; 0.75 from the design would never bind). Two identical New York runs returned identical match lists. Timing: search 3–9 s, embed 4–8 s (a tiny-bbox partition read costs about as much as a full one; DuckDB still scans the partition), so the tool is ~8–15 s warm end to end — at the target, not under it; noted for demo-readiness
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
