# Design: similarity-search

## Overview

Four additive changes, all on `develop` and the dev runtime, plus one shared-infrastructure
change (the Lambda) that both runtimes see:

1. The `lgnd-partition-query` Lambda gains a `mode` field: `change` (today's behaviour, the
   default), `embed` (return the cells under a small bbox with their vectors) and `similar`
   (rank a partition's cells against one query vector inside DuckDB).
2. A new runtime module `geo_agent/utils/lgnd_similarity.py` turns a query geometry into one
   embedding, fans `similar` out per geohash with the same thread pool as the change scan,
   merges, masks, thins and ranks, and writes the GeoJSON. A new Strands tool
   `find_similar_places` wraps it, registered next to `scan_region_change` behind
   `LGND_EMBEDDINGS_ENABLED`.
3. The prompt learns when to search by example, what to do with the result (display, name,
   inspect the top two), and how to report it.
4. The UI learns one more vector style (numeric `similarity` property), one more layers-plate
   group with the release's only legend, a popup, and a fifth prepared prompt.

Verified premises:

- DuckDB `list_cosine_similarity(list, list)` accepts a literal list on one side; the Lambda
  already uses it between two columns (`handler.py:100–121`). The 256-float query vector is
  ~5 KB of JSON, far under the 6 MB synchronous invoke payload limit.
- Same-place month-to-month cosine similarity has a median of ~0.86 over Colorado
  (`lgnd_embeddings.py:38–43`). Different places that look alike will sit below that, so the
  default `min_similarity` starts at 0.75 and is calibrated Tuesday on New York (task 2.4).
- maplibre-gl ≥ 5.11 renders `text-field` with local/system fonts when the style has no
  `glyphs` property (changelog 5.11.0: text-font is treated as a font fallback list and drawn
  with TinySDF). The stage map style has no `glyphs`, and the app is on maplibre-gl 6.11.2 as
  of commit `4b9f5c3`, so rank labels need no glyph server. Confirm in the first build (task
  4.2); the fallback is a `circle` + numbered popup only.
- The map already picks a vector style by sniffing feature properties (`change_score` →
  change scan, `__layer_type` → protected area) in `MapView.tsx:290–385`. A numeric
  `similarity` property is a third case in the same `if` chain; no `render` hint is needed
  yet, which keeps Week 3 off the shared `display_visual` contract.

## Architecture

```
model ── find_similar_places(location, geometry_s3_url, search_region, year?, month?, top_k, …)
           │
           │ 1. query extent   = bounds(geometry_s3_url)      (S3 read, existing helper)
           │    year/month     = given, else peak month for the centre latitude
           │                    + latest year with that month in the archive (≤ 2026-04)
           │ 2. Lambda embed   one call per geohash the query bbox touches (1, rarely 2)
           │                    → cells {cell_id, bbox, embedding} (≤ 64 nearest centre)
           │    q = mean(vectors) / ‖·‖
           │ 3. Lambda similar fan-out per geohash of the search bbox (≤ 20, pool of 8)
           │                    payload: bbox, year, month, q, min_similarity, limit=top_k*20
           │                    → cells {cell_id, similarity, bbox}   (no vectors return)
           │ 4. merge: drop query cell_ids, drop within exclude_radius_km, land mask,
           │           sort (−similarity, lat, lon), greedy thin by min_separation_km, top_k
           ├─► S3  session_data/<sid>/geometries/similar_<loc>_<region>_<yyyymm>.geojson
           │        features: tier=query (n cells) + tier=match (rank, similarity, center)
           └─► JSON { summary, query, matches[], similar_geometry_s3_url, method, next_steps }

prompt ── display_visual(similar_geometry_s3_url)
          reverse_geocode(top matches)             names before coordinates
          for the top 2: create_bbox_from_coordinates(centre, radius=640 m)
                         → get_rasters → inspect_image → one sentence each
          report: table (rank, place, similarity, km from example) + spoken closer

UI ── .geojson with numeric `similarity` → MapView similarity style
        fill ramp (violet, light→deep) · 2 px outline · rank label 24 px mono w/ halo
        query cells: dashed cyan outline, no fill · fitBounds(query ∪ matches)
      layers plate: "Similar places" group (after Change detection) with a one-row legend
      click match → popup (rank, similarity, centre, mono)
      prepared prompt #5 "Places like Central Park"
```

## Components

### 1. Lambda: `mode` dispatch (`geo_agent/lambda_functions/lgnd_query/handler.py`)

`handler()` reads `mode = event.get("mode", "change")` and dispatches. The existing body
becomes `_change(event, con)` untouched. Shared: the DuckDB connection setup, the partition
path builder, the bbox filter, the always-200 error envelope.

```python
def _embed(event, con):
    # cells under the query bbox for one month; nearest-to-centre cap keeps the payload small
    rows = con.execute(f"""
        SELECT cell_id, bbox, embedding,
               ((bbox.xmin+bbox.xmax)/2 - {cx})^2 + ((bbox.ymin+bbox.ymax)/2 - {cy})^2 AS d2
        FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}
        ORDER BY d2 LIMIT 64
    """).fetchall()
    return {"statusCode": 200, "mode": "embed", "geohash": gh, "cells_found": n_total,
            "cells": [{"cell_id", "bbox", "embedding": [256 floats]}]}

def _similar(event, con):
    q = event["query_embedding"]              # 256 floats, validated for length
    rows = con.execute(f"""
        SELECT cell_id, bbox, list_cosine_similarity(embedding, {q_literal}) AS sim
        FROM read_parquet('{path}', hive_partitioning=true) {bbox_filter}
        WHERE sim >= {min_similarity}
        ORDER BY sim DESC, bbox.ymin, bbox.xmin
        LIMIT {limit}
    """).fetchall()
    return {"statusCode": 200, "mode": "similar", "geohash": gh,
            "cells_compared": n_in_bbox, "cells": [{"cell_id", "similarity", "bbox"}]}
```

`q_literal` is rendered as a DuckDB `[f1, f2, …]::FLOAT[]` literal from validated floats
(no string interpolation of untrusted text: the list is parsed and re-serialised). The
`ORDER BY` tie-breakers make the per-partition result deterministic before the runtime merge.
Errors keep the envelope: `{"statusCode": 200, "cells": [], "error": "…"}`.

Deploy: `cd frontend-cdk && npx cdk deploy ChangeDetectionStack --require-approval never`
(us-west-2). This Lambda is shared by the dev and stable runtimes (fixed function name), so
the change regression test is the guard and Requirement 5.4's before/after smoke invoke is
recorded the day it ships.

### 2. Runtime: `geo_agent/utils/lgnd_similarity.py` (new) + `find_similar_places` tool

Imports from `lgnd_embeddings`: `COUNTRY_BBOXES`, `_get_geohashes_for_bbox`, `_get_peak_month`,
`_is_on_land`, `_haversine_km`, `LAMBDA_FUNCTION_NAME`. Nothing in `lgnd_embeddings.py`
changes.

```python
ARCHIVE_END = (2026, 4)      # last (year, month) in the monthly-aggregated archive

def default_period(center_lat: float, month: int | None, year: int | None) -> tuple[int, int]
def query_embedding(bbox, year, month, lambda_client) -> tuple[np.ndarray, list[dict]]
    # embed per geohash touched by the query bbox; concat cells; mean; L2-normalise
def search_similar(query_vec, query_cells, search_bbox, year, month, *, top_k,
                   min_similarity, exclude_radius_km, min_separation_km, lambda_client) -> dict
    # fan-out (ThreadPoolExecutor ≤ 8, limit = top_k * 20 per partition), merge, filter,
    # sort (−similarity, lat, lon), thin, rank; returns summary + matches + errors
def to_geojson(query_cells, matches) -> dict
```

```python
@tool
async def find_similar_places(
    location: str,                 # name of the example place (for the file name and report)
    geometry_s3_url: str,          # the example's geometry (boundary or drawn bbox)
    search_region: str,            # whole country / US state name, exact COUNTRY_BBOXES key
    year: int = None, month: int = None,
    top_k: int = 10,
    search_bbox: list = None,      # [west, south, east, north]; overrides search_region
    min_similarity: float = 0.75,
    min_separation_km: float = 5.0,
    exclude_radius_km: float = 5.0,
) -> str:
    """Find the places in a region that look most like an example place, using Clay
    embeddings. … Same season, same year, one 1.28 km cell = one vector …"""
```

Behaviour notes:

- Query cells: the example geometry's bounds. Central Park (3.4 km²) touches 2–4 cells; a
  drawn point through `create_bbox_from_coordinates(radius_meters=2000)` touches ~9. The cap
  of 64 cells (≈ 100 km²) is the point where "one example" stops meaning one thing; the tool
  says so in the error when a larger geometry is passed.
- Exclusion: the query's own `cell_id`s and anything within `exclude_radius_km` of the query
  centroid, so the answer is never "the place itself and its neighbours".
- Land mask and thinning reuse the change scan's helpers; sort key is `(−similarity, lat,
  lon)` so ties break by geography, never by arrival order from the pool.
- Match `center_lat/lon` are cell-bbox centres; `distance_km` from the query centroid is
  computed with `_haversine_km` and included for the report table.
- `next_steps` in the result tells the model the display → name → inspect-two order, mirroring
  how `scan_region_change` carries `IMPORTANT_for_drill_in`.
- Registration: `geospatial_agent_on_aws.py` tools list, `+ ([scan_region_change,
  find_similar_places] if LGND_EMBEDDINGS_ENABLED else [])`. Both runtimes have the flag on.

### 3. Prompt (`geo_agent/config.py`)

A new block after TOOL SELECTION, plus a tool-list line and a fifth workflow example:

```
FIND PLACES BY EXAMPLE
- "Find places like X", "more like this", "where else looks like", "similar to": that is
  find_similar_places, never scan_region_change (which compares a place with itself over time).
- Get the example's geometry first (find_location_boundary + get_best_geometry for a named
  place; the drawn shape's create_bbox_from_coordinates result for a point or polygon). Pass the
  search_region the user named; if they named none, use the example's state or country and say so.
- Then, in order: display_visual(similar_geometry_s3_url); reverse_geocode the top matches so
  you can say place names before coordinates; put eyes on the top two: create_bbox_from_coordinates
  around each centre (radius_meters=640), get_rasters, inspect_image, and one sentence on what
  makes each one like the example. Four inspections per turn remains the cap.
- Report as a compact table (rank, place, similarity, km from the example) followed by one
  plain 1-2 sentence closer naming the top match and the month compared.
```

### 4. Frontend (`react-ui/frontend/src`)

- `utils/layerFormatting.ts`: `isSimilarityLayer(layer)` = geometry layer whose URL basename
  starts with `similar_`; `groupLayers` gains `similarPlaces` and excludes it from
  `geometries`. `formatLayerDisplayText(…, 'similar')` → "Places like <example> · <Mon YYYY>"
  from the file name.
- `components/MapView.tsx`, geometry branch: `isSimilarity` = any feature with numeric
  `properties.similarity`. Layers: `fill` with `interpolate` on `similarity` over
  `[min_similarity, 1]` using a single-hue violet ramp (`#e8dcf5 → #a678d6 → #5b2a86`), 0.55
  opacity, filtered to `tier == 'match'`; `line` 2 px `#5b2a86` on matches; `line` dashed
  `#0FF` 2 px on `tier == 'query'`; `symbol` with `text-field: ['to-string', ['get','rank']]`,
  `text-size: 24`, `text-font: ['Atkinson Hyperlegible Mono', 'monospace']`, white text with a
  dark halo, on match centroids (a second `geojson` source built client-side from the match
  centres so labels sit at centres). `fitBounds` over all features. Click on the match fill →
  `maplibregl.Popup` with rank, similarity, `lat, lon` in the mono face; pointer cursor on
  hover; same popup classes the protected-area popup already restyles in `stage.css`.
- Layers plate: new group `Similar places` rendered between Change detection and Satellite
  imagery, rows via `renderLayerRow`, plus `.map-legend` (ramp bar as a CSS gradient of the
  same three stops, labels "less alike" / "more alike", ≥ 15 px, tabular mono for nothing here
  since there are no numbers).
- `ChatSidebar.tsx` `PREPARED_PROMPTS`: `{ label: 'Places like Central Park', prompt: 'Find
  places across New York State that look like Central Park' }`.
- DESIGN.md: one sentence under "Data colour on the map" adding the violet similarity ramp
  and the dashed-cyan query outline to the list of evidence colours; the layers-plate group
  order gains "similar places" after change detection.

### 5. Eval and golden prompts

`scripts/golden_prompts.json` gains:

```json
{
  "name": "similar-central-park",
  "prompt": "Find places across New York State that look like Central Park",
  "expected_tools": ["find_similar_places", "display_visual", "get_rasters", "inspect_image"],
  "forbidden_text": ["Error:"]
}
```

`find_location_boundary` / `get_best_geometry` are deliberately not in the subsequence (the
model may reuse a session geometry). `reverse_geocode` is never expected (ArcGIS outage rule).
Calibrate after the first live run, as 6.1 did in Week 2.

### 6. Promotion (`scripts/promote.sh`)

The agent path is unchanged. After the stable `deploy.sh`, the script prints the frontend step
and runs it when `PROMOTE_FRONTEND=1`:

```
cd frontend-cdk && npx cdk deploy GeospatialAgentStack --require-approval never
```

with a pre-check that `frontend-cdk/.env` carries `AGENT_RUNTIMES` naming both runtimes. The
checklist gains "CloudFront UI shows the new build (hard reload; Places like Central Park plate
present)". This is the first promotion that changes the UI, which is why it lands this week.

## Data models

Tool result:

```json
{
  "summary": {"search_region": "New York", "bbox": [-79.76, 40.5, -71.86, 45.02],
              "year": 2025, "month": 7, "month_name": "July",
              "partitions": 2, "cells_compared": 118420, "query_cells": 3,
              "min_similarity": 0.75, "top_k": 10, "seconds": 9.4, "errors": []},
  "query": {"location": "Central Park", "center_lat": 40.7826, "center_lon": -73.9656,
            "cell_ids": ["…", "…", "…"]},
  "matches": [
    {"rank": 1, "similarity": 0.8412, "center_lat": 40.6602, "center_lon": -73.969,
     "distance_km": 13.6, "bbox": {"west": -73.976, "south": 40.654, "east": -73.961, "north": 40.666}}
  ],
  "similar_geometry_s3_url": "s3://<bucket>/session_data/<sid>/geometries/similar_central_park_new_york_202507.geojson",
  "method": "Clay v1.5 foundation model embeddings (LGND/Source Cooperative), cosine similarity, 1.28 km cells",
  "next_steps": "display_visual the GeoJSON; reverse_geocode the top matches; inspect the top two with get_rasters + inspect_image."
}
```

GeoJSON feature properties: `{"tier": "query"|"match", "rank": int|null, "similarity":
float|null, "cell_id": str, "center_lat": float, "center_lon": float}`.

Lambda events: `{"mode": "embed", "geohash", "year", "month", "bbox"}` and `{"mode":
"similar", "geohash", "year", "month", "bbox", "query_embedding": [256], "min_similarity",
"limit"}`; responses as in Component 1. Without `mode` the event is the existing change one.

## Security

The Lambda builds SQL by string formatting today (bbox numbers, geohash, year, month). The new
modes add a model-supplied vector and a caller-supplied `mode`, so this release tightens the
boundary rather than widening it:

- Every event field is validated before it reaches a query: `mode` against the three-value
  allowlist; `geohash` against `^[0-9b-hjkmnp-z]{1,4}$`; `year`/`month` as ints in range
  (2017 ≤ year ≤ 2026, 1–12); bbox edges as finite floats within [-180, 180] / [-90, 90];
  `min_similarity`/`min_change_score` as finite floats in [-1, 1] / [0, 1]; `limit` as an int
  1–5000; `query_embedding` as exactly 256 finite floats. The DuckDB literal is rendered from
  the parsed floats (`repr(float)`), never from the incoming string. The existing `change` path
  gets the same validation for its shared fields (behaviour unchanged for valid input; invalid
  input now returns the error envelope instead of a DuckDB error).
- The runtime tool validates the same fields before invoking the Lambda, slugifies `location`
  and `search_region` for the S3 key (existing `_slugify`), and caps `top_k` (≤ 50) and the
  query geometry (64 cells) so a prompt cannot turn the tool into an unbounded scan.
- IAM: no change. The Lambda reads a public bucket anonymously and has no new permissions;
  the runtime already holds `lambda:InvokeFunction` on `lgnd-partition-query`. Nothing new is
  network-exposed.
- Errors return the envelope with a short type + message (first 200 chars), never a stack
  trace or the SQL text.
- Frontend: popup HTML is built from numbers only (rank, similarity, coordinates), so nothing
  model-controlled is injected into `setHTML`; the layer name shown in the plate goes through
  React text rendering.
- `promote.sh`'s frontend step reads `frontend-cdk/.env` (gitignored) and prints only the
  variable names it checked, not values.

## Error handling

- Unknown `search_region` and no `search_bbox`: the change scan's error text and sample list.
- More than 20 partitions: the change scan's "scan a smaller sub-region" error.
- Query geometry larger than the 64-cell cap: error naming the cap and suggesting a point or a
  smaller polygon.
- No cells under the query for that month: error naming the month tried and the archive range,
  suggesting a different month/year.
- Partial partition failures: matches from the rest, `summary.errors` lists geohashes; all
  fail: JSON error.
- Lambda `mode` unknown or `query_embedding` wrong length: envelope error, runtime treats the
  partition as failed.
- Frontend: a similarity layer with zero match features still registers (query outline only)
  and the legend still shows; `fitBounds` guarded by the existing zero-coordinate check.

## Testing strategy

- pytest, on the existing 50-row synthetic partition fixture (`conftest.local_lgnd_handler`):
  `embed` returns the cells under a bbox with 256-float vectors and honours the cap (fixture
  extended with 70 cells in one small bbox); `similar` with a query equal to one row returns
  that row at similarity 1.0 first, respects `min_similarity`, `limit`, and the bbox filter;
  `change` tests unchanged. Runtime merge tests with `boto3.client('lambda')` patched to
  return canned partition responses: exclusion of query cells and radius, land mask (a cell
  in the Atlantic dropped), thinning, deterministic order across shuffled input, partial
  failure summary, GeoJSON tiers and file name. Tool-level test with S3 patched for the
  result shape and the three error paths.
- vitest: `isSimilarityLayer`, `groupLayers` placing `similar_*.geojson` in `similarPlaces`
  and not in `geometries`, display text, and `parseToolCalls` on a `display_visual` whose
  URL is a `similar_*.geojson` (complete and truncated inputs).
- Live (recorded in tasks.md): Lambda before/after smoke on one Colorado partition; New York
  search timed warm; New York and Colorado searches run twice for identical output; the
  golden prompt; a headless Chrome pass that the layer, labels, legend and popup render.

## Act 1 run sheet (7 min, rehearsed Friday against stable)

| t | Beat | Prompt / action | What the room sees |
|---|---|---|---|
| 0:00 | Open | New session on Earth Analyst (pre-warmed) | Map, four prepared plates + "Places like Central Park" |
| 0:20 | Eyes | Vegetation, Central Park | Boundary, TCI, evidence chip, "I see…" sentence, NDVI, spoken closer |
| 1:30 | Turn | "That is one park. Now the whole state." | |
| 1:40 | Similarity | Places like Central Park | Ten violet cells ranked across NY, legend, names arrive, two evidence chips of the top matches, table + closer |
| 3:40 | Popup | Click rank 1 | Popup: rank, similarity, coordinates |
| 4:00 | Compare | Water, Folsom Lake | Two TCIs, two inspections, NDWI ×2, "Compare before and after" slider |
| 6:00 | Close | Open the transcript drawer, point at the numbers | Table in the drawer; caption's spoken closer |
| 6:40 | Hand-off | "Same eyes, same search, new domains next." | |

Fallback if over 7:30 on rehearsal two: drop the Folsom compare (the eyes are already shown
in beat 2), or replace it with the Colorado scan only if narration before the 20 s step has
been added.

## Decisions (approved Sep 24, ahead of the Monday cadence)

All five approved as recommended:

1. Query pooling is a plain mean of cell vectors (not the centre cell alone). Simple, stable
   for parks and reservoirs; documented limitation for linear features.
2. Same-month, same-year comparison only. No cross-season matching in this release.
3. `min_similarity` default 0.75 pending Tuesday's calibration on New York; the tasks record
   the chosen value and why.
4. The Lambda is shared with stable and changes Tuesday. Guard: unchanged change-mode tests,
   before/after smoke invoke. Alternative (a second Lambda) rejected as more surface for no
   isolation gain since the parquet is the same.
5. Rank labels rely on maplibre local glyph rendering (no `glyphs` server). If the first build
   shows nothing, fall back to circles + popup and log the deviation.
