---
target: the map layers plate
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:6593a75708e484fce0bf373939bc8c6b7f9a907cef2f60c169bcc0bff0d99b0d"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-09T19-38-08Z
slug: react-ui-frontend-src-components-mapview-tsx
closed: true
---
Method: dual-agent (A: general-task-execution design review · B: general-task-execution detector + browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The list order is not the draw order; a covered layer still reads as "on" |
| 2 | Match System / Real World | 2 | Rows are grouped by type, so NDVI over true colour spans two groups |
| 3 | User Control and Freedom | 2 | Reordering is one step per click; no cancel, no direct placement |
| 4 | Consistency and Standards | 2 | 28×18 chevrons beside 32px controls; disabled at 0.3 against DESIGN's 45–55% |
| 5 | Error Prevention | 1 | `moveLayer(id, order[i+2])` passes undefined at the top and lifts the raster over every vector and label; finding rasters are inserted with no beforeId |
| 6 | Recognition Rather Than Recall | 2 | Legends sit inside type groups, nothing ties a row to its ramp |
| 7 | Flexibility and Efficiency | 1 | No drag; moving a scene three places is six aimed clicks on 18px targets |
| 8 | Aesthetic and Minimalist Design | 3 | Calm plate; long names wrap 2–4 lines |
| 9 | Error Recovery | 2 | Focus drops to `<body>` when a chevron disables at the end of the stack |
| 10 | Help and Documentation | 2 | Nothing says that order matters or which way is up |
| **Total** | | **19/40** | **Poor** |

## Design Specificity Verdict

LLM assessment: the plate's language matches the stage (plates, hairlines, mono counts, 15px names), but the model behind it is a generic type-grouped layer list; it does not answer the presenter's one question, "what is drawn on top?".

Deterministic scan: CLI detector 0 findings (react-ui/frontend/src, exit 0). Browser: methane mission list order differs from draw order (bottom to top on the map: TCI, TROPOMI, EMIT pass); Lake Mead list roughly matches with the TCI pair swapped. Chevrons measure 28×18. At 1280×720 the plate scrolls and the caption band overlaps its lower corner. Overlay ai-color-palette hits on the plasma/viridis ramps are false positives (scientific ramps).

## Priority Issues

- [P1] List order is not draw order. One list, top row drawn on top, held as React state and mirrored to MapLibre.
- [P1] The raster escape: `nudgeLayer` at i = length−2 and every finding insert pass no beforeId, so the raster lands above the vectors and labels. Anchor every raster move and insert to a raster ceiling (the lowest non-raster layer).
- [P1] No direct manipulation: chevrons, one step per click, 18px tall, focus lost at the ends. Replace with a grip (always visible, 32×36), pointer drag with a 4px threshold and live map preview, keyboard Arrow/Home/End, click-to-lift and click-to-drop (WCAG 2.5.7), Esc and drop-outside restore, aria-live announcements.
- [P2] Legends are tied to type groups. One legend per distinct ramp among visible rasters, below the list, ordered by the highest row using it; a 4px ramp strip under index and plume rows ties each row to its legend.
- [P2] Long names wrap 2–4 lines and push the plate into the caption band at 1280×720. Clamp to two lines with the full name in the title and accessible name.

## Persona Red Flags

- The presenter: wants NDVI over true colour; NDVI sits in "Spectral indices", the scene in "Satellite imagery", and the arrows give no sign of which is on top.
- The keyboard user: a chevron that disables takes focus with it; the next Tab starts from the page top.
- The skeptical architect: the methane pass window lists under the composite yet draws over it.

## Minor Observations

- The group order (change, methane, similar, imagery, indices, boundaries) is a type taxonomy the room never needs.
- "Compare before and after" sits inside the imagery group; it is a plate-level action.
- The hidden state relies on label grey only.

## Questions to Consider

- Should vectors be reorderable, or always drawn on top with their own fixed rules?
- Should the basemap appear as the floor of the stack?
- Is "Restore order" worth a control in the head for a live demo?
