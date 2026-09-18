# Requirements: eyes-inspect-image (Week 2, Sep 22–26)

## Introduction

Act 1 today analyses imagery it has never looked at. Scene choice is a metadata sort (whole-tile
`eo:cloud_cover`, then footprint coverage), and the one scene that wins is displayed and
analysed regardless of what is actually over the area of interest. This spec gives the Earth
Analyst eyes: the model sees a rendering of the imagery it is about to use, judges whether the
area of interest is usable, says in one sentence what it sees, and can reject a scene and ask
for the next candidate. The room sees the same images the agent looked at, as evidence chips
pinned to the step that produced them.

Everything lands on the dev runtime (`DEPLOY_TARGET=dev`) and behind the existing agent
switcher; the live runtime is not touched until a gated promotion.

Scope boundaries: no new runtime, no embedding/similarity work (Week 3), no per-agent `render`
hints on `display_visual` (later), no changes to the map layer pipeline.

## Requirements

### Requirement 1: The agent can look at a raster

**User Story:** As the presenter, I want the agent to actually see the imagery it works with,
so that the room believes it perceives rather than merely computes.

#### Acceptance Criteria

1. WHEN the agent calls `inspect_image(s3_url, title, question?)` on a session raster THEN the
   tool SHALL render that raster to an image no larger than 1024 px on its longest edge and
   return it to the model as a Bedrock image content block together with a text block of
   metadata (dimensions, nodata percentage, and for TCI scenes the AOI-level clear/cloud/
   shadow percentages when a scene-classification layer is available).
2. WHEN the raster is an RGB scene (TCI) THEN it SHALL be rendered as true colour (JPEG);
   WHEN it is a single-band index (NDVI, NDWI, NBR, change map) THEN it SHALL be rendered with
   the same rescale range and colour ramp the map uses for that index, so the model and the
   room see the same picture.
3. WHEN `inspect_image` completes THEN the rendered image SHALL also be saved to
   `s3://<bucket>/session_data/<session_id>/inspections/<raster-basename>.<jpg|png>` so the
   UI, replay cases and later turns can show exactly what the model saw.
4. WHEN the raster cannot be read (missing object, unsupported dtype, zero valid pixels) THEN
   the tool SHALL return a text-only error result naming the problem and the turn SHALL
   continue (no exception escapes to the stream).

### Requirement 2: Scene quality is measured, not guessed

**User Story:** As the presenter, I want scene selection to carry numbers about the area of
interest itself, so that "this scene is cloudy" is evidence, not an adjective.

#### Acceptance Criteria

1. WHEN `get_rasters` or `get_rasters_for_dates` processes a scene THEN it SHALL also clip the
   Sentinel-2 scene-classification (SCL) layer and return `aoi_clear_pct`, `aoi_cloud_pct`
   (clouds + cirrus + shadow) and `aoi_nodata_pct` computed over the AOI, alongside the
   existing whole-tile `cloud_pct`.
2. WHEN `get_rasters` returns THEN it SHALL include `candidates`: up to five other scenes in
   the search window as `{date, cloud_pct, coverage_pct}` ordered as the selector ranks them,
   so the model knows whether alternatives exist before rejecting a scene.
3. WHEN the agent calls `get_rasters` (or `get_rasters_for_dates`) with `exclude_dates` THEN
   scenes on those dates SHALL be skipped and the next-ranked scene processed; WHEN no scene
   remains THEN the tool SHALL return the existing "no satellite images found" result.
4. WHEN the SCL asset is absent for a scene THEN the AOI quality fields SHALL be `null` and
   the tool SHALL still succeed.

### Requirement 3: The agent uses its eyes at the right moment

**User Story:** As the presenter, I want inspection to be part of every analysis, in the
right place, so that a bad scene is caught before it reaches the map or the numbers.

#### Acceptance Criteria

1. WHEN the agent fetches imagery for analysis THEN the system prompt SHALL require
   `inspect_image(tci_s3_url)` before `display_visual(tci)` and before any `run_bandmath` /
   `run_change_detection` on that scene, and SHALL require one sentence stating what the agent
   sees over the area (evidence-first voice, numbers with units).
2. WHEN the inspection shows the area of interest is unusable (the prompt states the rule:
   AOI cloud + nodata above 30 %, or the agent sees the AOI is obscured) THEN the agent SHALL
   call `get_rasters` again with `exclude_dates` containing the rejected date(s), up to two
   retries, before proceeding with the best available scene and saying so.
3. WHEN the agent completes an index or change analysis THEN it MAY call `inspect_image` on
   the result to describe the pattern it sees (optional, not required by the prompt).
4. WHEN `scripts/eval.py --target dev` runs THEN every existing golden prompt SHALL still pass
   with `inspect_image` inserted into its expected tool subsequence after the imagery fetch,
   and a new `cloudy-scene` golden prompt SHALL pass: expected subsequence
   `["get_rasters", "inspect_image", "run_bandmath", "display_visual"]`, no `Error:`.
   (The rejection loop itself is verified by unit test on a synthetic cloudy scene, because a
   live scene's cloudiness cannot be guaranteed on a given day.)

### Requirement 4: The room sees the evidence

**User Story:** As the audience, I want to see the images the agent looked at, at the moment
it looked at them, so that "the agent inspected the scene" is visible rather than asserted.

#### Acceptance Criteria

1. WHEN an `inspect_image` tool call streams THEN the UI SHALL show an evidence chip
   (thumbnail + title) attached to that step in the step column, first as a "looking…"
   placeholder and then as the saved rendering once it exists in S3 (poll the presigned URL,
   give up quietly after 60 s).
2. WHEN the presenter clicks a chip or focuses it and presses Enter/Space THEN the image SHALL
   open enlarged in a floating plate over the map (Level 4 shadow, hairline, title and
   inspection date in the plate), closed by Escape, by the close control, or by clicking
   outside; focus SHALL return to the chip.
3. WHEN the turn ends THEN the chips SHALL remain with the completed steps of that turn (the
   step column already keeps the last turn's steps) and SHALL be cleared on New session /
   agent switch like everything else.
4. WHEN the UI derives the evidence image location THEN it SHALL use the same convention as
   Requirement 1.3 (swap the raster's session prefix to `inspections/` and the extension), and
   that derivation SHALL be covered by a vitest.
5. WHEN `npm run design:check` runs THEN the detector SHALL report 0 findings; the chip and
   the enlarged plate SHALL follow DESIGN.md (Back Row rule: chip captions ≥ 15 px, enlarged
   title ≥ 18 px; one spotlight: the lit step stays the only amber; Floating Plate rule).

### Requirement 5: Tests and gate

**User Story:** As the builder, I want the eyes verified without live satellite calls, so that
Friday's gate is mechanical.

#### Acceptance Criteria

1. WHEN `pytest` runs in `geo_agent/` THEN tests SHALL cover: rendering a synthetic TCI COG to
   JPEG within the size cap, rendering a synthetic NDVI COG with the map's colour ramp,
   AOI quality percentages from a synthetic SCL raster (known clear/cloud/nodata counts),
   `exclude_dates` filtering of ranked candidates, and the tool's error result for a missing
   object — none of which call STAC, S3 or Bedrock.
2. WHEN `npm test` runs THEN vitest SHALL cover the evidence-URL derivation and the extraction
   of `inspect_image` calls into gallery items (complete and truncated inputs).
3. WHEN the Friday gate (Sep 26) runs THEN `pytest -q`, `npm test`, `npm run design:check` and
   `scripts/eval.py --target dev` (live, including `cloudy-scene`) SHALL all pass, and a
   headless UI round-trip SHALL show at least one evidence chip rendering during a prompt.
