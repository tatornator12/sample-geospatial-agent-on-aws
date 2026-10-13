# Design: ai-archaeologist

Status: **APPROVED Oct 12** (the user approved all eight decisions at the end; work starts early).

## Overview

One week, four pieces:

1. `agents/ai-archaeologist/`: a third AgentCore runtime with four tools of its own
   (`find_known_site`, `show_terrain`, `measure_profile`, `find_similar_sites`) and the
   platform's shared tools (`display_visual`, `inspect_image`, `get_rasters`,
   `create_bbox_from_coordinates`, ArcGIS `reverse_geocode`).
2. A curated catalogue of public, already-documented sites and an offline build that
   pre-renders each site's terrain from 3DEP 1 m into our bucket. Nothing is computed live.
3. The platform work agent number three forces: one shared `stage_shared.sh`, a per-agent table
   in `promote.sh`, `archaeologist` in `eval.py` / `runtimes.py` / `AGENT_RUNTIMES`.
4. Two ramps and a `terrain` group in the `render` allowlist, matching `inspect_image` styles,
   the LRM legend, a transect line style, prepared prompts, a gallery card and a replay case.

Verified premises:

- Spike (`docs/spikes/lidar.md`, Sep 17): the Newark Great Circle, Octagon and Observatory Circle
  read clearly at 1 m in hillshade and LRM; transect: west crest +1.87 m, interior ditch −2.58
  and −2.65 m, east crest +2.68 m, crest-to-crest 363 m (documented ~366 m). The seed coordinate
  was 1.6 km off: catalogue centres are verified on the LiDAR, never taken from a gazetteer.
- Oct 12: TNM Access API returns 1 m DEM tiles for all eight Hopewell Ceremonial Earthworks
  components (Newark Great Circle and Octagon in `OH_Statewide_Phase2_2020_B20`; Fort Ancient,
  Hopewell Mound Group, Mound City, Hopeton, High Bank Works, Seip in
  `OH_Statewide_Phase3_2021_B21`), 0.3 to 0.9 s per query. Checked at approximate centres; tiles
  are 10 km, so the check holds.
- Oct 12: a 1 m tile opens in place in 0.5 s (512 px tiles, LZW, overviews 2 to 32, EPSG:26917);
  a full-resolution 3 × 3 km window read took 43.7 s from a laptop. Live reads are out; the
  catalogue build reads once per site.
- Oct 12: TiTiler lists 211 colormaps including `gray`, `greys`, `rdbu_r` (#053061 → #f7f6f6 →
  #67001f) and `balance`. Requests need `Accept: image/png` (the map's already send it).
- The similarity Lambda's cells are 1.28 km; the Great Circle is 363 m. Clay similarity sees the
  landscape around an earthwork, not the earthwork (see decision 4).

## Architecture

```
agents/ai-archaeologist/
  ai_archaeologist.py   entrypoint (Methane Hunter's contract; tool list swapped)
  archaeo_config.py     prompt + model kwargs (named so the shared `import config` still works)
  site_tools.py         find_known_site, show_terrain, measure_profile, find_similar_sites
  earthwork_profile.py  transect sampling and bank/ditch analysis (pure numpy; shared by the checks)
  data/sites_v1.json    the catalogue (curated, reviewed, versioned)
  deploy.sh             DEPLOY_TARGET=dev|stable → ai_archaeologist_dev | ai_archaeologist
  golden_prompts.json   3 act beats + 3 provocations
  build_replay_case.py  (or a preset in a shared recorder; see tasks 6.1)
  tests/                conftest (stubs, FakeS3, synthetic DEM with a ring), test_*.py

scripts/build_site_catalogue.py   (offline, builder-run)
  sites_v1.json → TNM Access API (1 m tiles per frame) → rasterio windowed read in place
    → DEM subset → hillshade (az 315, alt 45) → LRM (DEM − 20 m low-pass) → COGs + overviews
    → s3://<bucket>/archaeology/cache/v1/<site_id>_{dem,hillshade,lrm}.tif + manifest.json

model ── find_known_site("Newark Octagon")
           → {site_id, names, culture, period, designation, source_url, centre, frame,
              frame_geometry_s3_url, documented}           (or the fixed refusal, no coordinates)
      ── get_rasters(frame) → inspect_image(tci)          "fairways, trees; nothing ancient"
      ── show_terrain(site_id, "hillshade") → copy_object cache → session_data/<sid>/terrain/
           → {s3_url, bounds, render{raster, gray, 0–255, group terrain}} → display + inspect
      ── show_terrain(site_id, "lrm")      → render{raster, rdbu_r, −1..1 m, legend "Local relief"}
      ── measure_profile(site_id)          → DEM transect: baseline, crests, ditches, span,
           transect_s3_url (LineString, labelled) + documented dimension with its source
      ── find_similar_sites(site_id)       → catalogue sites only (decision 4)
      ── show_terrain(top match, "lrm") → inspect → one sentence on the shared form → closer
```

## Components

### 1. The catalogue (`data/sites_v1.json`)

About 15 to 25 sites, US eastern woodlands earthworks and mounds that a public body documents
with published coordinates: the eight Hopewell Ceremonial Earthworks (UNESCO 2023), Serpent
Mound, Poverty Point (UNESCO 2014), Cahokia Mounds (UNESCO 1982), Effigy Mounds NM, Moundville,
Etowah, Ocmulgee, Toltec Mounds, Aztalan, Angel Mounds, Grave Creek, Miamisburg Mound (each kept
only if its 3DEP 1 m coverage is confirmed by the build). Per entry: `id`, `names[]` (as the
public record uses them), `culture`, `period`, `designation`, `steward`, `source_url`,
`centre` and `frame` (verified on the hillshade), `transect` (verified line through the main
form), `form` (published description: "circle", "octagon joined to a circle", "effigy",
"platform mound", "concentric ridges"), `documented` ({dimension, value, unit, source}).

Inclusion rule (decision 2): the site's location is already published by UNESCO, the NPS, or a
state or tribal steward as a place the public may know about. Sites whose public records are
address-restricted (common for archaeological listings on the National Register) are excluded.

### 2. `find_known_site(name)`

Normalised exact match against `names[]` (case, punctuation, "the", "earthworks"/"works"), then
a small alias table. No fuzzy geocoding. Writes the frame as GeoJSON to the session for
`get_rasters` and the map. Unknown name: `{"error": "I only work with sites already on the
public record.", "known_sites": [names…]}` with no coordinates.

### 3. `show_terrain(site_id, product)`

`product` ∈ {`hillshade`, `lrm`}. `s3.copy_object` from the cache into
`session_data/<sid>/terrain/<site_id>_<product>.tif` (server-side, under a second for 6 to 40 MB;
keeps the backend's presign allowlist and the evidence chip path unchanged). Returns bounds from
the manifest and the render hint. Missing cache object: error naming `build_site_catalogue.py`.

### 4. `measure_profile(site_id, transect=None)`

Reads the cached DEM COG along the transect (bilinear, 1 m step), baseline = median, local
extrema with a 0.5 m prominence floor, labels crests (> +0.5 m) and ditches (< −0.5 m), span =
outermost crest to outermost crest. A given transect must lie inside the site frame. Writes a
LineString with crest/ditch points as GeoJSON. Returns the documented dimension beside the
measured one.

### 5. `find_similar_sites(site_id, top_k=3)` (method per decision 4)

- Option A, Clay: call the shared `find_similar_places` internals with `search_bbox` = the
  catalogue extent and the clip geometry = the union of catalogue site frames; matches are
  mapped back to site ids; the tool returns sites, never cells.
- Option B, form by eye: rank catalogue sites by the published `form` field (same form first,
  then the same culture, then distance), then compose one contact sheet of the top four LRM
  thumbnails with labels (`inspect_image` once) so the model compares the forms it sees.

### 6. Shared and frontend changes

- `geo_agent/utils/inspection.py`: `INDEX_STYLES` for `hillshade_` (gray, 0–255) and `lrm_`
  (rdbu_r, −1..1). One test each.
- `react-ui/frontend/src/utils/render.ts`: `COLORMAPS` += `gray`, `rdbu_r` with `RAMP_ANCHORS`
  from TiTiler's own entries; `RENDER_GROUPS` += `terrain`. Legend words for the LRM.
- An `archaeoLayers.ts` (transect line style, LRM legend) following `methaneLayers.ts`.
- `stageCopy.ts`: three prepared prompts, placeholder "Name a known site, or ask how they built
  it"; step names for the four tools.
- `UseCaseGallery.tsx`: "Newark Earthworks" card, `agent: 'archaeologist'`.

## Security and the known-sites rule

- The rule is enforced in tools, not only the prompt: every coordinate the agent can obtain
  comes from the catalogue; there is no open search tool in this agent (the Earth Analyst's
  `find_similar_places`, `scan_region_change` and portal tools are not in its tool list; ArcGIS
  MCP is filtered to `reverse_geocode`, which takes catalogue coordinates).
- The catalogue is reviewed by the builder against each `source_url` before it ships; its
  version is in the cache path, so a change forces a rebuild.
- Wording: the prompt and `forbidden_text` keep "discovered", "new site", "uncovered",
  "hidden" out of the agent's own words; the closer names the designation ("already on the
  World Heritage list").
- Respect: the agent uses the names, cultures and periods the public record uses, calls the
  earthworks what the record calls them (ceremonial, burial), and never speculates about
  remains or artefacts.

## Error handling

- Unknown site: the fixed refusal with the catalogue's names. Malformed site id: error.
- Cache object missing or a manifest mismatch: error naming the build script; the turn goes on
  with true colour only.
- Transect outside the frame or too short (< 50 m): error.
- Similarity Lambda failure (option A): error; the agent falls back to the catalogue's `form`
  field and says the similarity search was unavailable.
- Frontend: an invalid hint is dropped and the layer falls back, as today.

## Testing strategy

- pytest (no network): catalogue schema (every entry has a source URL, a verified frame inside
  1 m coverage, a transect inside the frame); lookup and aliases; refusal returns no numbers
  that parse as coordinates; `show_terrain` copies within the session prefix only; profile on a
  synthetic DEM with a known ring (exact span, crest and ditch offsets) and on a recorded
  Newark transect fixture (363 ± 5 m); similarity returns only catalogue ids (both options);
  staging allowlist; prewarm.
- `geo_agent` pytest: the two new `INDEX_STYLES`.
- vitest: `parseRenderHint` accepts `gray`, `rdbu_r`, `terrain`; LRM legend words; transect
  style; prepared prompts for `archaeologist`.
- Live (recorded in tasks.md): the catalogue build per site (seconds, bytes), the six golden
  prompts on `ai_archaeologist_dev`, the other agents' evals unchanged, a headless replay
  round-trip, Act 4 timed twice.

## Act 4 run sheet (4 min, closer)

| t | Beat | Prompt / action | What the room sees |
|---|---|---|---|
| 0:00 | Switch | Agent switcher → AI Archaeologist (pre-warmed) | Its three prepared plates |
| 0:10 | From space | "Show me the Newark Octagon the way an archaeologist sees it" | Sentinel-2 true colour (the Octagon has long sat under a country club's golf course; day 1 checks what current imagery shows); chip; one sentence on what is visible from space |
| 0:50 | Under the grass | (same turn) | Hillshade lands: the Octagon and its circle appear under the fairways; chip; one sentence |
| 1:40 | Measure | "How big is the Great Circle, and how was it built?" | LRM (red bank, blue ditch), transect line; "363 m across (366 m documented), bank +2.7 m, ditch −2.6 m" |
| 2:40 | Like this | "Where else did they build like this?" | Sites of the same form from the catalogue (option B); the top match's LiDAR. Candidate after the Oct 13 sheets: Hopeton Earthworks, a circle and a square ploughed down to tens of centimetres, still drawn by the LiDAR at ±0.3 m (High Bank Works' circle and octagon not yet convincing) |
| 3:30 | Close | | "Both are already on the World Heritage list. I only work with sites on the public record." Hand-off to the close |

Fallback if over 4:30 on rehearsal two: drop the measure beat. Cut-list fallback (90-second
teaser in the close): the replay's "under the grass" beat only.

## Decisions to approve

1. Region and star site: US eastern woodlands earthworks on 3DEP 1 m, starring Newark
   Earthworks (part of the Hopewell Ceremonial Earthworks World Heritage property, stewarded by
   the Ohio History Connection; the spike's site). Poverty Point is the alternative star.
   Non-US LiDAR (Maya, Angkor) is out: no public 1 m source we can serve in a week.
2. Known sites only, enforced in tools: a curated catalogue whose locations are already
   published by UNESCO, the NPS or a state or tribal steward; address-restricted records are
   excluded; no open search tool in this agent.
3. Terrain is pre-rendered by an offline build into `archaeology/cache/v1/` and copied into the
   session per turn. Never computed or read from 3DEP live (44 s measured).
4. The similarity step. Recommended: run a half-day check on Oct 19 (Clay similarity from Newark,
   clipped to the catalogue frames: does it rank the other Hopewell components first?). If yes,
   option A (Clay, clipped); if not, option B (rank by the catalogue's published form, then one
   contact-sheet look with the model's eyes). Either way the results are catalogue sites only.
   **Outcome (Oct 13): option B.** Clay ranked the landscape, not the form: from the Great Circle,
   the Octagon (same town) first, then Grave Creek and Moundville (also towns); the other Hopewell
   components 5th to 28th. The act says "same builders, same form" from the record and shows it
   with the LiDAR, which is the honest version of "similarity" at 1 m. Each site carries an
   `lrm_stretch_m` (±1 m for standing walls, ±0.3 m for ploughed ones such as Hopeton and Seip),
   passed in the render hint's `rescale`.
5. Measurement is a tool (`measure_profile` on the cached DEM along a verified transect), and the
   agent always states the documented value beside its own.
6. Platform: one shared `stage_shared.sh` (entrypoint as an argument) and a per-agent table in
   `promote.sh`, done this week (the Methane Hunter design deferred this to agent three).
7. Promotion: the archaeologist goes to stable with Release 3 at G4 (Oct 31), not on its own at
   the Week 5 gate; the Week 5 gate is dev-only.
8. Agent id `archaeologist`, label "AI Archaeologist", directory `agents/ai-archaeologist/`
   (named by the similarity-search spec), runtimes `ai_archaeologist` / `ai_archaeologist_dev`.
