# Design: eyes-inspect-image

## Overview

Three additive changes, all on `develop` and the dev runtime:

1. A new Strands tool, `inspect_image`, renders a session raster to a small image, returns it
   to the model as a Bedrock image content block (plus metadata text), and saves the same
   image to S3 under a deterministic key.
2. `get_rasters` grows eyes-adjacent facts: AOI-level scene-classification percentages, the
   other candidate scenes, and an `exclude_dates` escape hatch so a rejected scene can be
   replaced without sliding the date window.
3. The UI shows evidence chips on the step column for every `inspect_image` step and an
   enlarged plate on demand; nothing about map layers changes.

Verified premise (strands 1.21.0 in the deployed image, `tools/decorator.py:627`): a tool that
returns a dict with `status` and `content` is passed through as the ToolResult; `content` may
hold `{"image": {"format", "source": {"bytes"}}}` blocks, which `models/bedrock.py:419` formats
for Converse. `types/session.py` base64-encodes bytes when persisting messages, so the
S3SessionManager keeps working. The streaming loop in `geospatial_agent_on_aws.py` forwards
only tool inputs, so image results never touch the SSE stream.

## Architecture

```
model ── inspect_image(s3_url, title, question)
           │  rasterio windowed read (out_shape ≤ 1024 px) ─► numpy ─► PIL
           │  TCI → JPEG q85 · index → PNG via colour ramp matching MapView
           ├─► S3  session_data/<sid>/inspections/<basename>.jpg|png   (what the model saw)
           └─► ToolResult { image block, text block (json metadata) }  (into the model)

UI ── tool input {name: inspect_image, s3_url, title} streams as today
        └─► StepColumn: chip under that step
              thumbnail = presigned GET of the derived inspections/ key (poll ≤ 60 s)
              click/Enter → EvidencePlate (enlarged, Esc closes)
```

## Components

### 1. Agent: `inspect_image` (new, `geo_agent/utils/inspection.py` + registration in tools)

```python
@tool
async def inspect_image(s3_url: str, title: str, question: str = "") -> dict:
    """Look at a session raster. Returns the image itself plus measured facts..."""
```
- `render_preview(path_or_url, max_edge=1024) -> (bytes, fmt, meta)` in `utils/inspection.py`
  (pure function, unit-tested):
  - opens with rasterio (`/vsis3/` for `s3://`), computes `out_shape` to cap the longest edge
    at 1024, reads with `resampling=Resampling.average` (index) or `nearest` (uint8 RGB);
  - `count >= 3 and dtype == uint8` → RGB → JPEG quality 85;
  - single band → apply `index_style(s3_url)` → PNG. The ramp table lives in one place and
    mirrors `MapView.tsx` exactly: `change_detection` → RdYlGn reversed on 0–0.5, `ndvi_` →
    RdYlGn on 0–1, `ndwi_` → Blues on −1–1, `nbr_` → Spectral on −1–1, else greyscale on the
    band's 2–98 % percentiles. Ramps are small anchor-colour tables interpolated with numpy
    (no matplotlib in the image);
  - nodata (raster nodata, or 0 for uint8 RGB) becomes transparent and is counted →
    `nodata_pct`;
  - `meta = {width, height, nodata_pct, bands, dtype, rendered_as}`.
- Quality facts: when the raster is a TCI and a sibling `scl_clipped_<same suffix>.tif` exists
  in the session (written by change 2), `scl_quality(scl_url)` reuses the existing
  `check_raster_quality` logic (`sentinel_utils.py:107`) returning
  `{clear_pct, cloud_pct, shadow_pct, nodata_pct}`; absent SCL → `null`.
- Upload: `put_object(Bucket, Key=session_data/<sid>/inspections/<basename>.<ext>,
  Body=bytes, ContentType=image/jpeg|png)`. `<basename>` is the raster's filename without
  extension (already ASCII for geometries; rasters keep the existing `clean_location` naming,
  so the UI derivation is a pure string swap).
- Return:
  ```python
  {"status": "success", "content": [
      {"image": {"format": "jpeg"|"png", "source": {"bytes": data}}},
      {"text": json.dumps({"title", "question", "preview_s3_url", **meta, "aoi_quality": {...}|None})},
  ]}
  ```
  Errors: `{"status": "error", "content": [{"text": json.dumps({"error": ...})}]}`.
- Bedrock limits: ≤ 1024 px keeps a TCI JPEG under ~400 KB and an index PNG under ~1 MB
  (limit 3.75 MB per image, 20 images per request). `SlidingWindowConversationManager(3)`
  bounds accumulation across turns; the prompt asks for at most a handful of inspections per
  turn.

### 2. Agent: `get_rasters` facts (`utils/sentinel_utils.py`, `utils/tools.py`)
- `get_filtered_images(..., exclude_dates=())`: after sorting, drop candidates whose
  `date[:10]` is excluded; `best_image` is the first survivor; also return
  `candidates = [{date, cloud_pct, coverage_pct} for the next 5]`.
- Clip SCL as one more layer when `best_image["scl"]` exists (20 m, tiny); compute AOI
  quality from the local clipped SCL before upload (`check_raster_quality` generalised to
  return the four percentages: nodata = SCL 0 or raster nodata; cloud = 8, 9, 10 (+ 1
  saturated); shadow = 3; snow 11 reported separately in `other_pct`); upload as
  `scl_clipped_<loc>_<date>.tif` and return `scl_s3_url`.
- `get_rasters(..., exclude_dates: str = "")` and `get_rasters_for_dates(...,
  exclude_dates: str = "")` accept a comma-separated `YYYY-MM-DD` list; `_fetch_and_map_rasters`
  passes it through. Output JSON gains `aoi_clear_pct`, `aoi_cloud_pct`, `aoi_nodata_pct`,
  `scl_s3_url`, `candidates`.
- Docstrings updated so the model learns the fields; `config.AGENT_PROMPT` gains a
  "LOOK BEFORE YOU ANALYSE" block (see 3).

### 3. Prompt (`geo_agent/config.py`)
Add to CRITICAL RULES and the workflow examples:
```
LOOK BEFORE YOU ANALYSE
- After get_rasters / get_rasters_for_dates, call inspect_image(tci_s3_url, title) BEFORE
  display_visual(tci) and before any bandmath or change detection on that scene.
- Say in ONE sentence what you see over the area (land cover, clouds, haze, snow, nodata).
- The scene is unusable if aoi_cloud_pct + aoi_nodata_pct > 30 or you can see the area is
  obscured. Then call get_rasters again with exclude_dates=<rejected dates> (max 2 retries).
  If nothing better exists, proceed with the best scene and say so with the numbers.
- Optionally inspect an index or change map after computing it to describe the pattern.
```
Workflow examples become `get_rasters → inspect_image(tci) → display_visual(tci) →
run_bandmath → display_visual(index)`.

### 4. Frontend: evidence chips (`react-ui/frontend/src`)
- `utils/evidence.ts` (new, unit-tested):
  - `evidenceUrlFor(rasterS3Url)`: `s3://b/session_data/<sid>/rasters/x.tif` →
    `s3://b/session_data/<sid>/inspections/x.jpg`; the extension choice mirrors the tool
    (`.jpg` for TCI-like names — `tci_`, `visual` — else `.png`). Both candidates are tried
    by the loader if the first 404s, so a mismatch degrades to one extra request.
  - `extractEvidence(tools)`: `inspect_image` calls with a complete `s3_url` + `title` →
    `[{toolId, title, sourceUrl, evidenceUrl}]`, de-duplicated by `toolId`.
- `components/EvidenceChip.tsx`: 120×80 thumbnail plate (6 px radius, hairline, plate at
  88 %), title at 15 px beneath, "looking…" placeholder with the working dots until the
  presigned image loads (retry every 2 s, up to 60 s, then a quiet "not saved" state).
  `role="button"`, keyboard operable.
- `components/EvidencePlate.tsx`: enlarged view, centred over the stage, Level 4 shadow, image
  at ≤ 70 vw/vh, title 18 px + mono date, close button, Escape/outside click close, focus
  returned to the chip. Rendered inside `.stage__overlay`.
- `StepColumn.tsx`: accepts `evidence` and renders a chip row under the matching step
  (`toolId` match); `ChatSidebar.tsx` computes `extractEvidence(stepTools)`.
- Presigned URLs via the existing `getPresignedUrl` (backend `/api/presigned-url`); the
  presigner does not check existence, so the `<img onError>` drives the retry.
- Impeccable: `/impeccable shape` the chip + plate before coding; `polish` after; detector 0.

### 5. Eval and golden prompts
- Insert `inspect_image` after the imagery fetch in every existing expectation:
  `[..., "get_rasters", "inspect_image", "run_bandmath", "display_visual"]` etc.; recalibrate
  against the live dev runtime as in Week 1.
- New `cloudy-scene`: prompt "Show vegetation health for Bergen, Norway as of 2025-11-15"
  (a location and month where the AOI is usually cloud-affected); expected
  `["get_rasters", "inspect_image", "run_bandmath", "display_visual"]`, forbidden `Error:`.
  The rejection loop is unit-tested, not gated on live weather.

## Deviations recorded during the build (Sep 18)

- **AOI quality is measured at fetch time, not by a sibling SCL file.** `get_filtered_images`
  reads the SCL asset with a masked read over the AOI polygon (so pixels outside the polygon
  are excluded rather than counted as nodata) in the same thread pool as the band clips, and
  returns the percentages in the `get_rasters` JSON. No `scl_clipped_*.tif` is uploaded and
  `inspect_image` does not look one up — one fewer S3 round trip, and the model already holds
  the numbers when it inspects. `aoi_cloud_pct` = clouds + cirrus + shadow; snow reported
  separately as `aoi_snow_pct`.
- **JPEG cannot carry alpha**, so true-colour previews paint nodata flat grey and say so in the
  metadata (`nodata_treatment`) and in the prompt ("flat grey is outside the AOI or missing,
  never land cover"). Index PNGs stay transparent as designed.
- **Presigned reads are signed for the bucket's real region** (`get_bucket_location`, cached);
  signing with the process default region produced S3 400s on a laptop whose default region
  differed from the bucket's.
- **Chips live inside the step column**, one under each `inspect_image` step (228×128), rather
  than as a separate gallery block — the room reads the image at the moment the step happens.
- **The plate has no kicker line** (the craft floor bans eyebrows); the title carries itself,
  and the mono date is only added when the title does not already contain it.
- **Bergen was clear on calibration day** (AOI 97.9 % clear), so the `cloudy-scene` golden
  prompt asserts the inspect-then-analyse sequence as planned and the rejection loop remains
  unit-tested (`exclude_dates` ranking), exactly per Requirement 3.4.

## Data models

`inspect_image` text block:
```json
{"title": "Sentinel-2 true colour, Hyde Park, 2026-08-21", "question": "",
 "preview_s3_url": "s3://bucket/session_data/<sid>/inspections/tci_clipped_hyde_park_london_2026-08-21.jpg",
 "width": 1024, "height": 812, "bands": 3, "dtype": "uint8", "rendered_as": "jpeg",
 "nodata_pct": 0.4,
 "aoi_quality": {"clear_pct": 91.2, "cloud_pct": 6.1, "shadow_pct": 2.3, "nodata_pct": 0.4}}
```
`get_rasters` additions:
```json
{"aoi_clear_pct": 91.2, "aoi_cloud_pct": 8.4, "aoi_nodata_pct": 0.4,
 "scl_s3_url": "s3://…/scl_clipped_hyde_park_london_2026-08-21.tif",
 "candidates": [{"date": "2026-08-16", "cloud_pct": 12.0, "coverage_pct": 100.0}, ...]}
```

## Error handling
- `inspect_image` never raises into the stream: read/render/upload failures return an error
  ToolResult; the model is told to continue with the numbers it has.
- Missing SCL → `aoi_*` fields `null`; the prompt rule then relies on the model's eyes alone.
- Chip load failures are silent to the room (placeholder → "not saved"); nothing blocks the
  caption or the map.

## Testing strategy
- pytest (`geo_agent/tests/test_inspection.py`): synthetic 3-band uint8 COG → JPEG ≤ 1024 px
  and valid image header; synthetic float32 NDVI COG → PNG with expected ramp colours at
  known values (0 → red end, 1 → green end); synthetic SCL raster with known class counts →
  exact percentages; `get_filtered_images` candidate filtering with `exclude_dates` using a
  monkeypatched `get_all_images_from_gdf` and no network; missing object → error dict.
- vitest (`src/utils/evidence.test.ts`): URL derivation for `.tif` inputs, non-session URLs
  return null, `extractEvidence` with complete/truncated/duplicate inputs.
- Live: `scripts/eval.py --target dev` recalibrated; headless Playwright run shows a chip.
