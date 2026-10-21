---
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:541ba5553c4a19ae19fe7670c9141d0c453f91c1aaa2d8212969119452edbdec"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-21T20-01-11Z
slug: react-ui-frontend-src-components-mapview-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; written after the Group B edits had begun, so Assessment A reads the Oct 20 review's before screenshots and today's after screenshots side by side; the detector ran after Assessment A was written)
Target: the map and its plates (`MapView.tsx`: similarity, methane and terrain layers, the layers plate and its legends, the watch globe), headless Chrome at 1920×1080 and 1280×720. Before: `stage-review-2026-10-20/screenshots/act1/a1_live_sim_labels_crop.jpg`, `act1/a1_lake-mead-water_1920.jpg`, `act2/idle_1280.jpg`, `act2/watch_1280_t18.jpg`, `act4/08_circle_replay_1920_end.jpg`. After: `stage-fixes-2/screenshots/gb/b7-*.jpg`, `b8-*.jpg`, `b11-b14-*.jpg`, `b12-*.jpg`, `b13-*.jpg`, `b15-mission-*.jpg`, `b16-*.jpg`.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The idle globe sat under the console at 1280 (an offset only turns a globe); now padded between the plates |
| 2 | Match System / Real World | 3 | Legends blurred looks, plumes and dates ("site", "seen on 5+ dates", "CH4 enhancement"); now "NASA plume site", "plumes on 5+ dates", "EMIT methane above background", "TROPOMI, 14 days, above the area median"; NDVI no longer calls water "bare" |
| 3 | User Control and Freedom | 3 | Rank 1 could not be clicked at state zoom; its dot and its label now open "Match 1" |
| 4 | Consistency and Standards | 3 | Two unnamed "Local relief" legends; each now names its site and one shows at a time |
| 5 | Error Prevention | 3 | A world-wide ranking framed the Sahara; now its top ranks or rank 1 |
| 6 | Recognition Rather Than Recall | 3 | Replay rows "TCI Before" over "TCI After"; now "True colour, Oct 01 2025 (after)" on top and the compare slider pairs them |
| 7 | Flexibility and Efficiency | 3 | The layers plate keeps the legends at its foot at 1280; only rows scroll |
| 8 | Aesthetic and Minimalist Design | 3 | Ten colliding numerals; now dots for all, labels 1 to 5, no overlaps |
| 9 | Error Recovery | n/a | No error path changed here |
| 10 | Help and Documentation | n/a | The legends are the help; scored under 2 |
| **Total** | | **24/32** | Good |

## Design Specificity Verdict
LLM assessment: specific. Each act's map grammar (violet similarity, plasma and ice methane, the relief's red and blue) is kept; the fixes are words, placement and framing.
Deterministic scan: `impeccable detect --json` on `MapView.tsx`: `[]` (0 findings).
Visual overlays: not injected (headless capture only).

## What's Working
- Rank labels beside the plume (east edge) instead of across it.
- The brief's end frame and the plate's foot both fit at 1280×720.

## Priority Issues
- **[P1] Similarity numerals collide; rank 1 not clickable.** Fixed (B7), plus room under the lowest dot for its label (found in the live check).
- **[P1] Replay stacks the before scene on top; no compare.** Fixed (B8), the index order too (found in the browser check).
- **[P1] Legend wording (Act 2), rank labels on plumes, Sahara framing, legend clipped at 1280, two Local relief legends.** Fixed (B11 to B14, B16).
- **[P2] Rest labels sit on their marks (Act 4); hard-edged replay true colour; edge tiles 404.** Open, deferred.

Questions skipped: the approved brief fixes the scope.
