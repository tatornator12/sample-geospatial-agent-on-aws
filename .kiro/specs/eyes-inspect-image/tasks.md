# Tasks: eyes-inspect-image (Week 2, Sep 22–26)

Cadence: requirements + design approved before code; tasks top to bottom; every task names
its tests; Friday gate G-eyes. All deploys are `DEPLOY_TARGET=dev`.

Built Sep 18 (approved early, ahead of the Monday cadence). Deviations from the design are
recorded in `design.md` under "Deviations recorded during the build".

- [x] 1. Rendering core (agent)
  - [x] 1.1 `geo_agent/utils/inspection.py`: `render_preview()` with out_shape downsampling, RGB→JPEG, single-band→PNG through `index_style()` ramps mirroring MapView, nodata → transparency + `nodata_pct`
    - RGB JPEG paints nodata flat grey (JPEG has no alpha) and names it in metadata; index PNGs are transparent. Ramps are the ColorBrewer anchors matplotlib/TiTiler interpolate (RdYlGn, reversed for change maps, Blues, Spectral); metadata carries size, source size, style, value range, WGS84 bounds
  - [x] 1.2 `scl_quality()` (generalised `check_raster_quality`): clear / cloud / shadow / nodata / other percentages
    - Masked read over the AOI polygon; outside-polygon pixels are excluded rather than counted as nodata. `rank_candidates()` / `parse_exclude_dates()` factored out so ranking is testable
  - [x] 1.3 `tests/test_inspection.py`: synthetic TCI → JPEG size cap + header; synthetic NDVI → PNG ramp colours at 0 and 1; synthetic SCL → exact percentages; unsupported dtype → error
    - 12 tests: 3000-px scene capped at 1024 with grey nodata pixels verified; NDVI 0 → #a50026 and 1 → #006837 exactly; SCL 10/10/5/75 % exact; change map ramp reversed; grey stretch; no-valid-pixels and missing-file errors; ranking with/without exclusions
  - _Requirements: 1.1, 1.2, 1.4, 5.1_

- [x] 2. `inspect_image` tool
  - [x] 2.1 Tool in `utils/tools.py` (imports `inspection.py`): render, upload to `session_data/<sid>/inspections/<basename>.<ext>`, return image + metadata text ToolResult; error ToolResult on failure
    - Reads through a presigned `/vsicurl/` URL signed for the bucket's real region (overview reads, no full download); GDAL told not to list/HEAD query-string URLs. Real check: a 19.5 MB 3202×2800 scene → 226 KB 1024×895 JPEG in 0.8 s
  - [x] 2.2 Register in `geospatial_agent_on_aws.py` tools list; docstring teaches the fields and the "one sentence of what you see" expectation
  - [x] 2.3 Unit test the error path with a nonexistent S3 URL (moto-free: patch the reader), and the ToolResult shape
    - 11 tests: key derivation, region-aware signing (cached), image block + facts block shape, jpg/png extension and content type, five malformed-URL cases, missing object, unrenderable raster
  - _Requirements: 1.1, 1.3, 1.4_

- [x] 3. Scene facts and rejection path
  - [x] 3.1 `get_filtered_images`: `exclude_dates`, `candidates`, SCL clip + AOI quality, `scl_s3_url`
    - Deviation: AOI quality computed at fetch time from the SCL asset in the clip thread pool; no SCL raster uploaded, no `scl_s3_url` (see design.md). SCL failure never fails the fetch
  - [x] 3.2 `get_rasters`, `_fetch_and_map_rasters`, `get_rasters_for_dates`: `exclude_dates` param, new output fields, docstrings
    - Shared `_raster_result_json`: `aoi_clear_pct`, `aoi_cloud_pct` (clouds+cirrus+shadow), `aoi_snow_pct`, `aoi_nodata_pct` (null without SCL), `candidates`
  - [x] 3.3 Tests: `exclude_dates` filtering and `candidates` ordering with a monkeypatched candidate list (no STAC); SCL fields null when the asset is missing
    - 6 tests in `test_scene_selection.py` through the real `get_filtered_images` with STAC/S3/clip patched
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Prompt
  - [x] 4.1 `config.AGENT_PROMPT`: LOOK BEFORE YOU ANALYSE block; workflow examples updated; tool list line for `inspect_image`
    - Rule 7 + block (one sentence of evidence, the 30 % rule, exclude_dates ≤ 2 retries, both TCIs for comparisons, ≤ 4 inspections/turn, grey = outside AOI), sequential-dependency list, all four workflow examples
  - [x] 4.2 Deploy dev; three manual prompts (clear scene, cloudy Bergen, drawn polygon) — confirm the inspect → sentence → display order and one rejection with `exclude_dates` in the logs
    - Dev v5. Order confirmed on all seven golden prompts (two-date prompts inspect both TCIs). Sentence confirmed verbatim for Hyde Park: "…the park reads as a mix of green vegetation and brownish/dry grass patches, with the Serpentine lake clearly visible as a dark body of water." Renders 0.2–0.4 s in the runtime. **Not observed live: a rejection** — Bergen's window held a 97.9 % clear scene on Sep 18, so `exclude_dates` was never triggered by weather; the path is covered by unit tests (1.3, 3.3) as Requirement 3.4 allows. Re-check on a cloudier day before Friday
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Evidence chips (frontend)
  - [x] 5.1 `/impeccable shape` the chip + enlarged plate against DESIGN.md; record the brief in `.impeccable/surfaces/`
    - Brief recorded as an addendum to the Stage surface brief (design was approved in conversation; form decisions listed there)
  - [x] 5.2 `utils/evidence.ts` + `evidence.test.ts` (URL derivation, extraction incl. truncated/duplicate inputs)
    - 7 tests; jpg-first for true-colour names, png-first otherwise, both offered
  - [x] 5.3 `EvidenceChip.tsx` (placeholder, retry loader, keyboard) and `EvidencePlate.tsx` (enlarged, Esc/outside close, focus return); wire through `StepColumn` and `ChatSidebar`
    - Chip under its step (228×128), probe every 2 s ≤ 60 s; plate closes on Escape/outside/control with focus return; open state cleared on session reset. No kicker (craft floor)
  - [x] 5.4 `npm run build`, `npm test`, `npm run design:check` = 0; `/impeccable polish`; headless Playwright: chip appears during a prompt against dev and enlarges with Enter
    - Build green, vitest 22/22, detector 0. Headless 1920×1080: chip born 28 s into the turn already resolved (164×128 JPEG), Enter opened the plate (612 px wide), Escape closed it and returned focus, caption sentence present. Polish pass: removed the kicker, de-duplicated the date in the plate title
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_

- [x] 6. Golden prompts and gate
  - [x] 6.1 Insert `inspect_image` into every existing expectation; add `cloudy-scene`; `eval.py --target dev` live, recalibrate from the recorded streams
    - 7/7 live against dev v5 (34–63 s each), no recalibration needed
  - [ ] 6.2 Friday gate G-eyes: `pytest -q`, `npm test`, `npm run design:check`, `eval.py --target dev` (live); record the gate log below; decide whether to promote (Week 3's G2 is the planned promotion)
    - Pre-flight Sep 18: pytest 52/52, vitest 22/22, detector 0, eval 7/7. Formal gate stays on Friday Sep 26
  - _Requirements: 3.4, 5.3_

## Gate log

- (append Friday Sep 26 results here)
