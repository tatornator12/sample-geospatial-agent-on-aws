# Requirements: similarity-search (Week 3, Sep 29–Oct 3)

## Introduction

Act 1 closes with the line "the agent sees imagery and finds places by example". Eyes shipped
in Week 2. This spec adds the second half: given a place the presenter names or draws, the
Earth Analyst finds the places across a state or country that look most like it, puts them on
the map ranked, names them, and then looks at the best ones with the eyes it already has. The
room sees the agent go from one example to a ranked set of candidates and evidence for each.

The data is already in the building. `scan_region_change` reads the public LGND Clay v1.5
embeddings (256-dim, one vector per 1.28 km cell, monthly, Jan 2017–Apr 2026) through the
`lgnd-partition-query` Lambda in us-west-2 and compares a cell with itself across time. This
spec compares one place with every other cell in a region at the same time of year. Same
parquet, same Lambda, same DuckDB cosine kernel, same GeoJSON-to-`display_visual` path to the
map. What is new is the query side (turn a geometry into one embedding), the ranking side
(top-k across partitions, spatially thinned, deterministic), and a map style that reads from
the back of the room.

Everything lands on the dev runtime (`DEPLOY_TARGET=dev`) behind the existing switcher until
Friday, when gate G2 promotes Release 1 (foundation + eyes + similarity) to `demo-stable` on
both the stable runtime and the CloudFront UI, and Act 1 is rehearsed at 7 minutes.

Scope boundaries: no new runtime or new agent (the Archaeologist in Week 5 reuses this tool
from `agents/ai-archaeologist/`); no embedding model inference (only the pre-computed LGND
archive); no `render` hint on `display_visual` yet (the map keeps sniffing feature properties,
one more case); no legend or opacity controls for the other layer groups; no change to
`scan_region_change` behaviour or its calibration constants.

## Requirements

### Requirement 1: The agent can find places like a place

**User Story:** As the presenter, I want to name or draw one place and have the agent return
the places in a region that look most like it, so that the room sees search by example rather
than search by name.

#### Acceptance Criteria

1. WHEN the agent calls `find_similar_places(location, geometry_s3_url, search_region,
   year?, month?, top_k?, search_bbox?, min_similarity?, min_separation_km?)` THEN the tool
   SHALL derive one query embedding from the LGND cells intersecting the query geometry's
   bounds for the chosen year and month (mean of the cell vectors, L2-normalised), and SHALL
   report how many cells formed it.
2. WHEN the query geometry intersects no LGND cell for that year and month (ocean, nodata
   month, out-of-archive date) THEN the tool SHALL return a JSON error naming the month tried
   and the archive range, and the turn SHALL continue.
3. WHEN the query embedding exists THEN the tool SHALL rank every land cell in the search
   extent for the same year and month by cosine similarity to it and return the top `top_k`
   (default 10) matches, each with `rank`, `similarity` (4 dp), `center_lat`, `center_lon`
   and `bbox`, excluding the query cells themselves and any cell within `exclude_radius_km`
   (default 5) of the query centroid.
4. WHEN the tool completes THEN it SHALL write one GeoJSON FeatureCollection to
   `s3://<bucket>/session_data/<session_id>/geometries/similar_<location-slug>_<region-slug>_<yyyymm>.geojson`
   containing the query cell(s) as features with `tier: "query"` and the matches with
   `tier: "match"`, `rank` and `similarity`, and SHALL return its URL as
   `similar_geometry_s3_url` together with `summary` (cells compared, partitions, month used,
   seconds) and a `method` string naming Clay v1.5 / LGND.
5. WHEN `year`/`month` are omitted THEN the tool SHALL choose the region's peak-season month
   with the same rule `scan_region_change` uses and the most recent year for which that month
   is inside the archive, and SHALL state the month it used in `summary`.

### Requirement 2: The search is bounded, on land, and repeatable

**User Story:** As the builder, I want the search to finish in demo time and return the same
answer twice, so that what is rehearsed is what is shown.

#### Acceptance Criteria

1. WHEN `search_region` is an exact key of `COUNTRY_BBOXES` or `search_bbox` is given THEN the
   extent SHALL be resolved exactly as `scan_region_change` resolves it, with the same
   "not a recognised whole region, pass a bbox" error and the same limit of 20 geohash
   partitions; WHEN `search_bbox` is given it SHALL take precedence over `search_region`.
2. WHEN matches are ranked THEN cells failing the Natural Earth land mask SHALL be dropped,
   and the remaining cells SHALL be spatially thinned so that no two matches are closer than
   `min_separation_km` (default 5 km, 0 disables), greedy in rank order.
3. WHEN two runs use identical arguments THEN they SHALL return identical matches in identical
   order (sort key: similarity descending, then latitude, then longitude; no randomness).
4. WHEN the search extent is a US state the size of Colorado or New York THEN the warm tool
   time SHALL be under 15 s, measured and recorded in `tasks.md` (the two-period Colorado
   change scan is 19.7 s; this reads one period).
5. WHEN a partition query fails THEN the tool SHALL still return matches from the partitions
   that succeeded and list the failed partitions in `summary.errors`; WHEN every partition
   fails THEN it SHALL return a JSON error and the turn SHALL continue.

### Requirement 3: The agent searches by example at the right moment and verifies with its eyes

**User Story:** As the presenter, I want "find more like this" to be a natural next move after
an analysis, and I want the agent to look at what it found, so that a ranked list becomes
evidence rather than a claim.

#### Acceptance Criteria

1. WHEN the user asks for places like a named place or a drawn area (phrasings the prompt
   lists: "find places like", "more like this", "where else looks like", "similar to") THEN
   the system prompt SHALL route to `find_similar_places` after the query geometry exists
   (`find_location_boundary` + `get_best_geometry`, or `create_bbox_from_coordinates` for a
   drawn shape), and SHALL forbid substituting `scan_region_change`.
2. WHEN the tool returns THEN the prompt SHALL require, in order: `display_visual` of
   `similar_geometry_s3_url`; `reverse_geocode` (or the ArcGIS equivalent, dropped gracefully
   when unreachable) of the top matches so places are named before coordinates; then eyes on
   the top two: `create_bbox_from_coordinates` around each match centre with the match bbox
   size, `get_rasters`, `inspect_image`, one sentence each on what makes it like the example.
   The eyes cap of four inspections per turn stands.
3. WHEN the agent reports THEN it SHALL follow the Week 2 two-part format: a compact table of
   rank, place name, similarity and distance from the example for the transcript, then one
   plain 1–2 sentence closer that names the top match and states the month compared.
4. WHEN `scripts/eval.py --target dev` runs THEN every existing golden prompt SHALL still pass
   and a new `similar-central-park` golden prompt ("Find places across New York State that
   look like Central Park") SHALL pass with expected subsequence
   `["find_similar_places", "display_visual", "get_rasters", "inspect_image"]`, no `Error:`,
   calibrated from the first live recording as Week 2 did.

### Requirement 4: The room sees the matches

**User Story:** As the audience, I want to see where the look-alikes are and how alike they
are, at a glance, so that "it found ten places" is visible and ranked, not read aloud.

#### Acceptance Criteria

1. WHEN a `.geojson` layer whose features carry a numeric `similarity` property is displayed
   THEN MapView SHALL style match cells with a sequential single-hue ramp that pairs hue with
   lightness (no red/green), a 2 px outline, and a rank label at each match centre set ≥ 24 px
   in the mono face with a halo; the query cell(s) SHALL be drawn with a dashed cyan outline
   and no fill; the map SHALL fit to the union of query and matches.
2. WHEN such a layer is registered THEN the layers plate SHALL list it in a new group
   "Similar places" placed directly after "Change detection", with a one-row legend (ramp bar,
   "less alike" / "more alike" labels ≥ 15 px) — the only legend in this release.
3. WHEN the presenter clicks a match cell THEN a popup SHALL show rank, similarity (4 dp) and
   centre coordinates in the mono face, with the pointer cursor on hover, in the same plate
   styling the protected-area popup uses.
4. WHEN the prepared prompts render THEN a fifth plate "Places like Central Park" SHALL send
   the Requirement 3.4 prompt.
5. WHEN `npm run design:check` runs THEN the detector SHALL report 0 findings, and the new
   style SHALL be recorded in DESIGN.md next to the change-scan ramp as evidence colour that
   is not restyled to the accent.

### Requirement 5: One Lambda, two runtimes

**User Story:** As the builder, I want the shared `lgnd-partition-query` Lambda to gain
similarity without changing what the live runtime gets from it, so that Tuesday's Lambda
deploy cannot break Friday's stable scan.

#### Acceptance Criteria

1. WHEN the Lambda receives an event without `mode`, or with `mode: "change"` THEN it SHALL
   behave exactly as today (all existing `test_lgnd_handler.py` tests unchanged and green).
2. WHEN `mode: "embed"` is received with `geohash`, `year`, `month`, `bbox` THEN it SHALL
   return the cells intersecting the bbox for that partition as `{cell_id, bbox, embedding}`,
   capped at 64 cells nearest the bbox centre, plus `cells_found`.
3. WHEN `mode: "similar"` is received with `geohash`, `year`, `month`, `bbox`,
   `query_embedding` (256 floats), `min_similarity`, `limit` THEN it SHALL compute cosine
   similarity inside DuckDB (`list_cosine_similarity`) and return at most `limit` cells with
   `similarity ≥ min_similarity` ordered by similarity descending, as
   `{cell_id, similarity, bbox}`, plus `cells_compared`; embeddings SHALL not be returned.
4. WHEN the Lambda is deployed (`npx cdk deploy ChangeDetectionStack`, us-west-2) THEN a smoke
   invoke with the current `change` payload for one Colorado partition SHALL return the same
   `above_threshold` count as before the deploy, recorded in `tasks.md`.

### Requirement 6: Tests and gate G2

**User Story:** As the builder, I want similarity verified offline and Release 1 promoted by
the script, so that Friday is mechanical and Act 1 can be timed.

#### Acceptance Criteria

1. WHEN `pytest` runs in `geo_agent/` THEN tests SHALL cover, on the existing synthetic LGND
   partition fixture: `embed` mean-pooling and the 64-cell cap; `similar` ordering, threshold,
   limit and bbox filter; the `change` regression; and, with the Lambda client patched, the
   runtime's merge (exclusion radius, land mask, thinning, deterministic order, partial-failure
   summary) and GeoJSON shape — none calling AWS.
2. WHEN `npm test` runs THEN vitest SHALL cover the similarity-layer detection and group
   assignment in `layerFormatting.ts` and the parsing of a `display_visual` whose URL matches
   `similar_*.geojson`.
3. WHEN the Friday gate (Oct 3) runs THEN `pytest -q`, `npm test`, `npm run design:check` and
   `scripts/eval.py --target dev` (live, including `similar-central-park`) SHALL all pass.
4. WHEN the gate is green THEN `scripts/promote.sh` SHALL fast-forward `demo-stable`, tag
   `deployed-2026-10-03`, deploy the stable runtime, and (new this week) deploy or print the
   exact command for the CloudFront UI so both surfaces show Release 1; the stable runtime
   SHALL pass one smoke invoke and `eval.py --target stable` for `similar-central-park` and
   `vegetation-central-park`.
5. WHEN Act 1 is rehearsed THEN the run sheet in `design.md` SHALL be performed twice against
   the stable runtime and timed; both timings SHALL be recorded in the gate log, with the
   target of 7:00 ± 0:30 and the fallback (drop the Folsom compare) named if exceeded.
