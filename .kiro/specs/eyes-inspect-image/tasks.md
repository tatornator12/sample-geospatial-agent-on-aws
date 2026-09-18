# Tasks: eyes-inspect-image (Week 2, Sep 22–26)

Cadence: requirements + design approved before code; tasks top to bottom; every task names
its tests; Friday gate G-eyes. All deploys are `DEPLOY_TARGET=dev`.

- [ ] 1. Rendering core (agent)
  - [ ] 1.1 `geo_agent/utils/inspection.py`: `render_preview()` with out_shape downsampling, RGB→JPEG, single-band→PNG through `index_style()` ramps mirroring MapView, nodata → transparency + `nodata_pct`
  - [ ] 1.2 `scl_quality()` (generalised `check_raster_quality`): clear / cloud / shadow / nodata / other percentages
  - [ ] 1.3 `tests/test_inspection.py`: synthetic TCI → JPEG size cap + header; synthetic NDVI → PNG ramp colours at 0 and 1; synthetic SCL → exact percentages; unsupported dtype → error
  - _Requirements: 1.1, 1.2, 1.4, 5.1_

- [ ] 2. `inspect_image` tool
  - [ ] 2.1 Tool in `utils/tools.py` (imports `inspection.py`): render, upload to `session_data/<sid>/inspections/<basename>.<ext>`, return image + metadata text ToolResult; error ToolResult on failure
  - [ ] 2.2 Register in `geospatial_agent_on_aws.py` tools list; docstring teaches the fields and the "one sentence of what you see" expectation
  - [ ] 2.3 Unit test the error path with a nonexistent S3 URL (moto-free: patch the reader), and the ToolResult shape
  - _Requirements: 1.1, 1.3, 1.4_

- [ ] 3. Scene facts and rejection path
  - [ ] 3.1 `get_filtered_images`: `exclude_dates`, `candidates`, SCL clip + AOI quality, `scl_s3_url`
  - [ ] 3.2 `get_rasters`, `_fetch_and_map_rasters`, `get_rasters_for_dates`: `exclude_dates` param, new output fields, docstrings
  - [ ] 3.3 Tests: `exclude_dates` filtering and `candidates` ordering with a monkeypatched candidate list (no STAC); SCL fields null when the asset is missing
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 4. Prompt
  - [ ] 4.1 `config.AGENT_PROMPT`: LOOK BEFORE YOU ANALYSE block; workflow examples updated; tool list line for `inspect_image`
  - [ ] 4.2 Deploy dev; three manual prompts (clear scene, cloudy Bergen, drawn polygon) — confirm the inspect → sentence → display order and one rejection with `exclude_dates` in the logs
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 5. Evidence chips (frontend)
  - [ ] 5.1 `/impeccable shape` the chip + enlarged plate against DESIGN.md; record the brief in `.impeccable/surfaces/`
  - [ ] 5.2 `utils/evidence.ts` + `evidence.test.ts` (URL derivation, extraction incl. truncated/duplicate inputs)
  - [ ] 5.3 `EvidenceChip.tsx` (placeholder, retry loader, keyboard) and `EvidencePlate.tsx` (enlarged, Esc/outside close, focus return); wire through `StepColumn` and `ChatSidebar`
  - [ ] 5.4 `npm run build`, `npm test`, `npm run design:check` = 0; `/impeccable polish`; headless Playwright: chip appears during a prompt against dev and enlarges with Enter
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_

- [ ] 6. Golden prompts and gate
  - [ ] 6.1 Insert `inspect_image` into every existing expectation; add `cloudy-scene`; `eval.py --target dev` live, recalibrate from the recorded streams
  - [ ] 6.2 Friday gate G-eyes: `pytest -q`, `npm test`, `npm run design:check`, `eval.py --target dev` (live); record the gate log below; decide whether to promote (Week 3's G2 is the planned promotion)
  - _Requirements: 3.4, 5.3_

## Gate log

- (append Friday Sep 26 results here)
