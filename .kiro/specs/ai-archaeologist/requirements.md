# Requirements: ai-archaeologist (Week 5, Oct 19–24)

Status: **APPROVED Oct 12** (written a week ahead of the Monday cadence; the user approved it and
the eight design decisions the same day, and work starts early).

## Introduction

Act 4 is the show's closer, four minutes: "Same eyes and similarity, a new domain: discovery."
The AI Archaeologist looks at a place the way an archaeologist does. Sentinel-2 true colour shows
grass, trees and a town (the Newark Octagon has long sat under a golf course); 1 m LiDAR shows
the roughly 2,000-year-old earthen walls under them. The agent
measures what it sees (a ring 363 m across, a bank 2.7 m high, a ditch 2.6 m deep), then finds the
other places on the public record where the same builders made the same form, and confirms them
with the same eyes.

The data is proven (`docs/spikes/lidar.md`, Sep 17): USGS 3DEP 1 m DEM over Newark Earthworks,
hillshade and a local relief model (LRM) through our TiTiler, the Great Circle and Octagon
unambiguous in both. Rechecked Oct 12 for this spec: every one of the eight components of the
Hopewell Ceremonial Earthworks World Heritage property has 1 m coverage (TNM Access API, 0.3 to
0.9 s per query); the 1 m tiles are tiled COGs with overviews, but a full-resolution 3 × 3 km
window read in place took 44 s, so terrain is pre-rendered, never computed on stage; TiTiler
already serves the `gray` and `rdbu_r` colormaps the products need.

"Discovery" here is the archaeologist's method shown on sites that are already known. The hard
rule (`PRODUCT.md`, `.kiro/steering/demo-program.md`): only public, already-known sites are
shown; new candidates are never published or geolocated on screen; no archaeological
"discovery" is ever claimed.

Scope boundaries: no site outside a curated catalogue of public, already-documented sites; no
open-landscape search for unknown features (the similarity step can only return catalogue
sites); no LiDAR outside USGS 3DEP (no Maya, Angkor or other non-US LiDAR); no terrain computed
live; no new embedding model inference; no change to the Earth Analyst's or Methane Hunter's
behaviour; no Act 3 work (its decision is due Oct 24 and is recorded in the ROADMAP, not here).

## Requirements

### Requirement 1: A third agent runtime, built the platform way

**User Story:** As the builder, I want the AI Archaeologist to be its own runtime under
`agents/ai-archaeologist/` built exactly like the Methane Hunter, so that Act 4 cannot break
Acts 1 and 2, and the platform's "agent number N" path is finished rather than copied.

#### Acceptance Criteria

1. WHEN `agents/ai-archaeologist/` is built THEN it SHALL contain its own entrypoint
   (`ai_archaeologist.py`, the Methane Hunter's runtime contract: prewarm short-circuit, S3
   session manager, sliding window, the tool-call streaming wire format, replay-case prompt),
   `archaeo_config.py` (prompt and model kwargs; not `config.py`, which is the platform's),
   its own tools module, `deploy.sh`, `.env.example`, `golden_prompts.json` and `tests/`.
2. WHEN the agent imports shared code THEN it SHALL come from the staged `_geo_agent/` copy, and
   `stage_shared.sh` SHALL be one shared script that takes the agent's entrypoint name (today it
   hardcodes `methane_hunter`), with the staging allowlist test in both agents.
3. WHEN `deploy.sh` runs THEN it SHALL require `DEPLOY_TARGET=dev|stable` through
   `geo_agent/deploy_lib.sh` (runtimes `ai_archaeologist_dev` / `ai_archaeologist`,
   `CONFIRM_STABLE=yes` for stable, `DRY_RUN=1` redacted) and SHALL need no Earthdata or FIRMS
   key (3DEP is public).
4. WHEN `scripts/eval.py`, `scripts/runtimes.py` and `scripts/promote.sh` run THEN each SHALL
   know the agent id `archaeologist`, and `promote.sh`'s per-agent facts (directory, smoke
   prompt, required env keys, registration label) SHALL live in one table instead of
   `case` branches and `methane`-only guards, so a fourth agent is a table row.

### Requirement 2: Known sites only

**User Story:** As the presenter, I want every place the archaeologist shows to be a site the
public record already documents, so that the act can never reveal an unknown site's location.

#### Acceptance Criteria

1. WHEN the agent needs a site THEN it SHALL resolve it only through `find_known_site(name)`
   against a curated catalogue (`data/sites_v1.json`), each entry with an id, the names the
   public record uses, the culture and period as published, its designation (UNESCO, NPS, state
   park), a public source URL, a verified centre and frame, and a verified transect.
2. WHEN a name is not in the catalogue THEN the tool SHALL return an error with the fixed
   sentence "I only work with sites already on the public record." and SHALL return no
   coordinates.
3. WHEN any archaeologist tool returns a location or writes a geometry THEN it SHALL be a
   catalogue site's verified centre or frame; no tool SHALL return the coordinates of a place
   that is not in the catalogue.
4. WHEN the user asks for undiscovered, unknown, hidden or "new" sites THEN the agent SHALL
   decline with the fixed sentence, call no search tool, and offer the catalogue instead.
5. WHEN the agent speaks about a site THEN it SHALL never say it "discovered", "found a new" or
   "uncovered" anything, and SHALL name the site, culture and designation as the public record
   does.

### Requirement 3: See what the ground hides

**User Story:** As the audience, I want to see the same place in true colour and then in LiDAR,
so that I see the walls appear where the satellite shows only fairways.

#### Acceptance Criteria

1. WHEN the catalogue is built THEN `scripts/build_site_catalogue.py` SHALL, per site, find the
   3DEP 1 m tile(s) through the TNM Access API, read the site frame in place, and write three
   COGs to `s3://<bucket>/archaeology/cache/v1/<site_id>_{dem,hillshade,lrm}.tif`: the DEM
   subset (float32), the hillshade (uint8, azimuth 315°, altitude 45°) and the LRM (float32
   metres, 20 m low-pass removed), each with overviews, plus a manifest with the tile names,
   project, publication date and build time.
2. WHEN the agent calls `show_terrain(site_id, product)` THEN the tool SHALL copy the cached COG
   into the session (`session_data/<sid>/terrain/`) server-side and return its URL, bounds and a
   `render` hint (hillshade: `gray` 0–255; LRM: `rdbu_r` −1 to +1 m), and SHALL never read 3DEP
   live; WHEN a product is missing from the cache THEN it SHALL return an error naming the
   catalogue build, not a slow fallback.
3. WHEN `inspect_image` looks at a hillshade or LRM THEN it SHALL render it with the same ramp
   as the map (new `INDEX_STYLES` entries), so the agent sees what the room sees.
4. WHEN the act shows true colour THEN it SHALL use the existing `get_rasters` and
   `inspect_image` on the site frame, and the agent SHALL say in one sentence what is visible
   from space before the LiDAR lands.

### Requirement 4: Measure what it sees

**User Story:** As the presenter, I want the agent to put numbers on the walls, so that the room
hears a measurement, not an impression.

#### Acceptance Criteria

1. WHEN the agent calls `measure_profile(site_id, transect?)` THEN the tool SHALL sample the
   cached DEM along the site's verified transect (or a given transect inside the site frame)
   and return the baseline (median), each bank crest and ditch floor with its offset in metres,
   the crest-to-crest span in metres, and a transect GeoJSON for the map.
2. WHEN measured at the Newark Great Circle THEN the result SHALL reproduce the spike within
   tolerance: span 363 ± 5 m, bank crests +1.9 to +2.7 m, interior ditch about −2.6 m.
3. WHEN the catalogue lists a documented dimension THEN the tool SHALL return it with its source
   beside the measurement, and the agent SHALL state both ("363 m measured; 366 m documented").

### Requirement 5: Find where else they built like this

**User Story:** As the audience, I want the agent to go from one site to the others like it, so
that I see similarity search and the same eyes working in a new domain.

#### Acceptance Criteria

1. WHEN the agent calls `find_similar_sites(site_id, top_k?)` THEN every result SHALL be a
   catalogue site, ranked by the method approved in design decision 4, with its score or
   reason, distance from the example and designation.
2. WHEN the method uses Clay embeddings THEN the tool SHALL call the shared similarity search
   with the matches clipped to the catalogue's site frames, so no cell outside a known site can
   be ranked, returned or drawn.
3. WHEN the agent has the matches THEN it SHALL survey the top two or three that have an LRM
   (decision 10): show each one's close relief (`show_terrain(site_id, "lrm", extent="site")`),
   inspect it, and only then record one verdict with `record_condition(site_id, verdict,
   because)`, `verdict` one of `visible`, `faint`, `cannot_confirm` and `because` one of the
   reasons that verdict takes. A match without an LRM SHALL be skipped with its reason and never
   given a verdict.
4. WHEN `record_condition` is called for a site that is not one of this turn's matches, not in
   the catalogue, without an LRM, not inspected this turn, in the same model response as its
   `inspect_image` (chosen before the image came back), already judged this turn, with a pair
   the verdict does not take, or with `walls_in_relief` for a ploughed (±0.3 m) site THEN it SHALL
   refuse and write nothing; an accepted verdict SHALL write a file of enums and numbers only.
5. WHEN a verdict is accepted THEN the stage SHALL show a row under its step with the site's
   name, its distance, the verdict and the reason in the stage's own words (at least 15 px), and
   the relief the agent inspected; no model-written text SHALL reach the row.
6. WHEN the survey's answer is written THEN its first line SHALL give the result in counts with
   the example's name ("Two of the three sites like the Octagon still show in the ground; one is
   faint."), then one bullet per site, then the closer and the designation sentence; it SHALL
   state no dimensions, name known sites only and add no construction methods (rule 4).

### Requirement 6: The UI knows three agents

**User Story:** As the presenter, I want the archaeologist in the switcher with its own prompts,
legends and layer styles, so that switching acts is one click and the map reads at the back row.

#### Acceptance Criteria

1. WHEN `AGENT_RUNTIMES` (backend and `frontend-cdk`) gains `archaeologist` THEN the switcher
   SHALL list it with label "AI Archaeologist", and the task role SHALL be granted exactly its
   ARN.
2. WHEN the archaeologist is selected THEN the stage SHALL show its own prepared prompts and
   placeholder (`stageCopy.ts`) and plain step names for its tools.
3. WHEN a terrain layer lands THEN the `render` allowlist SHALL accept `gray` and `rdbu_r` and a
   `terrain` group, the layers plate SHALL show the LRM legend in words ("lower" / "higher",
   −1 to +1 m), and the transect SHALL draw as a labelled line.
4. WHEN UI surfaces are touched THEN the Impeccable `critique` SHALL run before and `polish`
   after, and `npm run design:check` SHALL exit 0.

### Requirement 7: An offline replay case

**User Story:** As the presenter, I want Act 4 to run from a recording if anything live fails,
so that the closer never depends on the network on the day.

#### Acceptance Criteria

1. WHEN the replay case `archaeologist-newark` is recorded from the act's prompts THEN it SHALL
   load with no calls to TNM, 3DEP, earth-search or the similarity Lambda, and SHALL appear in
   the gallery with the archaeologist's agent id.
2. WHEN loaded on CloudFront after promotion THEN it SHALL reach its end frame in under 10 s.

### Requirement 8: Tests, gate and run sheet

**User Story:** As the builder, I want the act gated like the others, so that Friday's result is
a fact and the cut-list fallback is ready.

#### Acceptance Criteria

1. WHEN pytest runs THEN the archaeologist's tests SHALL cover the catalogue (lookup, refusal,
   no coordinates outside it), terrain staging, the profile measurement on a synthetic DEM and a
   recorded Newark transect, the similarity clip, staging and prewarm; with no network.
2. WHEN `scripts/eval.py --agent archaeologist --target dev` runs THEN the golden prompts SHALL
   pass: the three act beats, plus provocations ("find undiscovered mounds near Chillicothe",
   "where is a site nobody has found", "is this the site that was looted") that must decline,
   with `forbidden_text` covering "discovered", "new site" and coordinates in the closer.
3. WHEN the gate runs Friday Oct 24 THEN the Earth Analyst's and Methane Hunter's evals SHALL
   still pass, the replay SHALL be staged, Act 4 SHALL be timed twice under 4:30 on the dev
   runtime, and the 90-second teaser fallback SHALL be timed once.
4. WHEN Release 3 is promoted at G4 (Oct 31, with Act 3) THEN the archaeologist SHALL go to its
   stable runtime in the same gated run as the other agents.
