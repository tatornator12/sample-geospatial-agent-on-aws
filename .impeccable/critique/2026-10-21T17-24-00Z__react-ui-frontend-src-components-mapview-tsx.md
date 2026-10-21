---
target: the Act 3 layers plate at 1280x720 (MapView.tsx, review B2)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:e10f46d1ef094f6bfe4ba8d0ac644537897fa49c9d9a2d2a7048c780f3619eb6"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-21T17-24-00Z
slug: react-ui-frontend-src-components-mapview-tsx
closed: true
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A was written before the detector and the browser overlay ran)

# Impeccable critique, before task 1's fix pass 2 (review B2): the layers plate at 1280×720

Target: `react-ui/frontend/src/components/MapView.tsx` (the layers plate `:3466-3550`: the body, the
vessels key `:3361-3372`, the coverage key `:3374-3381`, the GFW attribution `:3517-3523`) and its
rules in `stage.css` (`.map-layers` `:1015-1032`, `.map-layers__body` `:1061-1068`, the sea fade
`:1612-1616`, `.map-legend--key` `:1668-1685`). Visual evidence: this run's live captures on the tag
`55098a4` (`RUN/shots/t1d_coverage_1280.jpg`, `t1d_candidates_1280.jpg`, `t1d_candidates_1920.jpg`).

## Assessment A (design review, recorded before the detector)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | At 720p the candidates beat's newest key row sits under the fade; the plate does not show what just changed |
| 2 | Match System / Real World | 3 | The words now agree with the clock and the layer rows (B1 fixed) |
| 3 | User Control and Freedom | 3 | Toggles, remove, Clear; the plate scrolls |
| 4 | Consistency and Standards | 3 | 1920 and 1280 show different keys at the same beat |
| 5 | Error Prevention | 3 | n/a for a key |
| 6 | Recognition Rather Than Recall | 1 | At 720p the orchid rings are on the map and the row that names them is not in view |
| 7 | Flexibility and Efficiency | 3 | The presenter can scroll, but mid-act |
| 8 | Aesthetic and Minimalist Design | 3 | Shape plus words; the 720p key spends 6 px gaps and 1.3 leading it cannot afford |
| 9 | Error Recovery | 3 | Unchanged |
| 10 | Help and Documentation | 2 | GFW's attribution needs a scroll at 720p while its data is on the map |
| **Total** | | **26/40** | **Good at 1080p, short at 720p** |

### Design Specificity Verdict

The key is this act's own: each status by its drawn shape and its words, orchid only for the
candidates, the candidate row joining only after the reveal. The failure is vertical budget, not
form: the B1 strings are right and wrap to two lines in the 320 px plate, and below 800 px of height
the plate is capped at `calc(100% - 190px)` (474 px at 720p) with the attribution last inside the
scrolling body.

### Cognitive load and emotional journey

The candidates beat is the act's peak: the orchid arrives 1.4 s after the coverage. At 720p the room
sees four orchid rings and, in the plate, a key that ends on "at or near a port" with a faded half
line under it. The peak lands without its explanation. Four layer rows, two keys and a licence line
are the plate's whole content; nothing needs removing, it needs to fit.

### What's Working

- Shape and words per status: the key reads in greyscale and from the back of the room.
- 15 px rows, swatch centred on one- and two-line rows (measured in the last pass).
- At 1920×1080 every row and the attribution fit (547 px of a 724 px cap).

### Priority Issues

1. **[P1] At 1280×720 the candidates beat cuts the candidate key row and drops GFW's attribution out
   of view.** The ring row and the candidate row both run to two lines after the reveal (+65 px), so
   the body overflows its 474 px cap by about 74 px; the fade covers the candidate row and the
   attribution needs a scroll. Fix: the attribution moves to a foot of the plate that does not
   scroll; below 800 px of height the keys' rhythm tightens (row gaps, leading, the keys' top
   margin, the body's own padding and gap) so the candidate row fits; text stays 15 px. Suggested
   command: /impeccable adapt (short screens), then polish.
2. **[P2] The 720p plate depends on a scroll the presenter cannot make mid-act.** The fade is right
   for the forecast's nine layers and four keys, but at the coverage and candidates beats the
   content should simply fit. Fix: the same rhythm as issue 1; keep the fade for the forecast.

### Persona Red Flags

- The room (non-specialist leader), 720p projector: four pink rings appear and the plate does not
  say what pink means.
- GFW's licence reviewer: GFW's detections and AIS are on the map, and "Powered by Global Fishing
  Watch." is below the fold.

### Minor Observations

- At the forecast (nine layers, four keys) the keys stay under the fade at both sizes; with the
  attribution in a foot, the licence line stays in view there too. Fitting the forecast's keys is
  the compact plate's job (pre-existing P1-8), not this pass.
- At the tasking and filed beats the plate folds to its head and drops the attribution, as it did
  before task 1 (review: out of scope).

### Questions to Consider

- Should the foot's licence line sit under a hairline, or follow the fade without one?

## Assessment B (detector and browser evidence, run after A)

- CLI: `impeccable detect --json react-ui/frontend/src/components/MapView.tsx` printed `[]`, exit 0.
  `critique-storage slug` gives `react-ui-frontend-src-components-mapview-tsx`; no
  `.impeccable/critique/ignore.md`.
- Browser (live, `dark_vessels_dev`, 1280×720, script `/tmp/act3-open-question/t1e_measure.py`):
  mutation preflight passed; `live-server --background` on 8400, `detect.js` injected at the end of
  turn A, then the server stopped (no file in WT changed). The overlay flagged three things
  (`RUN/shots/t1e_overlay_1280.jpg`):
  - "repeating-gradient decorative stripes": the hatch is data, not decoration ("reception
    unknown" is hatched on the map and in its key swatch, DESIGN.md's Dark Vessels paragraph).
    False positive.
  - "cramped padding" on the four prepared-prompt chips: the console's chips (`ChatSidebar` /
    `Chat.tsx`, stage-fixes-1's files), not this target. Pre-existing, out of scope.
  - "text occluded by an overlap": MapLibre's compact attribution ("Bathymetry: AWS Terrain
    Tiles") under the Base plate. Pre-existing, out of scope.
  The overlay does not measure scroll overflow, so it neither confirms nor contradicts issue 1.
- Measured on the same page (the code at `55098a4`): coverage beat overflow 9 px (the
  attribution's line under the fade); candidates beat overflow 74 px, the candidate row and the
  attribution out of view. With the attribution moved into a foot (simulated in the page):
  tightening only the keys left 27 px over; keys plus 36 px layer rows 5 px over; keys, rows, the
  head's padding and the body's own padding and gap fitted with 7 px to spare
  (`RUN/shots/t1e_variant_*`, `/tmp/act3-open-question/t1e_measure.json`).

## Synthesis

The LLM review and the measurement agree: issue 1 is real and is the whole problem; the detector
has no rule for it. The overlay's three flags are a false positive or outside this target. The fix
is the third variant: GFW's line in a foot that never scrolls, and below 800 px of height a tighter
rhythm on Act 3 only (the head 4 px, the body 6/8 px and an 8 px gap, layer rows 36 px with the
grip still spanning its row, key rows 2 px apart at 1.15 leading, keys 6 px from what is above
them). Text stays 15 px. At 1080p nothing changes but the foot.

Trend: third snapshot for this target, 19 → 24 → 26 (Oct 9, the plate; Oct 21 15:41Z, the key
words, closed; now, the plate at 720p).

Questions skipped: 2 priority issues (fewer than 3), and the fix is the one the review prescribed
(`RUN/t1-review.json` B2), with the user's approved strings unchanged.
