---
target: "Dark Vessels right column: map key and tasking plate"
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-legend/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:2d906e7f5912b50036efd2cc7c8712086ef892ee64b7575960877ec93ac31045"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-legend/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-23T17-43-30Z
slug: react-ui-frontend-src-components-mapview-tsx
---
Method: dual-agent (A: kirocrew-worker, design review · B: kirocrew-worker, detector and browser overlay)

Target: the Dark Vessels stage's right column (`react-ui/frontend/src/components/MapView.tsx`: the layers plate and its map key; `TaskingPlate.tsx`; `stage.css`), at the tasking beat and the beats before it. Evidence: a live run and the `vessels-open-question` replay at 1920x1080 and 1280x720 on develop 3a6eb1c (`.agents/tasks/vessels-legend/shots/before-*`), DOM geometry probes, and the source.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Draft, recorded and filed states, a live countdown and working dots; the key disappears without a word when the plate opens |
| 2 | Match System / Real World | 3 | Officer language throughout; "set aside: reception unknown, or one detector only" puts two different rings under one icon |
| 3 | User Control and Freedom | 3 | Box and candidates choosable on the plate or the map, Not now; no Esc |
| 4 | Consistency and Standards | 2 | Key icons do not match the map: the matched ring's dot, ring sizes, the set-aside row, the hatch's strength, the heat ramp's top end |
| 5 | Error Prevention | 3 | Controls wait while busy or filing; the backend re-checks the choice; "Nothing is filed until you approve." |
| 6 | Recognition Rather Than Recall | 1 | At the decision the key is gone and so are the AIS dots: the room must remember what grey, fog and orchid rings mean |
| 7 | Flexibility and Efficiency | 2 | Plate or map both choose; no shortcut, no Esc for Not now |
| 8 | Aesthetic and Minimalist Design | 2 | Box rows run to three lines and repeat "S1-D", "UTC" and "of past dark targets"; the plate is 701 px tall |
| 9 | Error Recovery | 3 | "Try again" on a load failure, an alert line on an approve error |
| 10 | Help and Documentation | 2 | The key is this stage's help, and it leaves exactly when the decision needs it |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** specific to this product. The officer-decides framing ("Nothing is filed until you approve", the filed line), legends that name their sources ("Patrol box (from past dark targets)", "Candidates (Oct 12 pass)"), orchid kept for candidates and amber only on Approve, and the map and plate driving one choice could not be lifted into another product unchanged. The weak spot is the plate's form: a three-line radio list and a checkbox list read as generic form furniture, and their height is what pushes the key off the column.

**Deterministic scan:** `impeccable detect --json react-ui/frontend/src` printed `[]` (exit 0); the two target files alone also `[]`.

**Visual overlays:** injection worked (live server on 8400, stopped afterwards). Real, in target: with the layers list opened at the tasking end frame, the tasking plate (z 3) covers the lower layer rows and all 11 key labels (50 to 100%), confirmed by `elementFromPoint`. Outside the target: `cramped-padding` on the two `.docent-plate` prompts (0 px vertical in a 32 px box, borderline), the basemap plate over the "Bathymetry: AWS Terrain Tiles" credit (known), and `repeating-stripes-gradient` (the hatch key swatch). False positives: the ", in " runs inside `.tasking-plate__option-sub` and a step line (a wrapping inline span's two-line box), and one unreproducible `dark-glow`.

## Overall Impression

The argument is drawn well up to the candidates; the decision frame then throws away the evidence that made it. The single biggest opportunity: keep the key on screen at the tasking beat and give the plate a compact form, so the room reads the marks and the decision at once.

## What's Working

- Provenance is designed in: each plate legend says where its choice comes from, and the filed line says who filed.
- Colour discipline: orchid is the candidates and the history's heat, cyan is AIS, amber is Approve alone; the chosen box is a fog wash on both the plate and the map.
- The plate and the map are one control: a click on a box or a ring and a click on the plate change the same choice.

## Priority Issues

**[P1] The key leaves at the decision.** `onTaskingLoaded` folds the layers plate (`setIsLayerControlOpen(false)`) and the plate sits where the key was. At 1280x720 the key is already mostly lost from the forecast on, because Act 3's keys scroll with the list (2 of 8 rows visible at the look beat). Opening the list at the tasking beat puts the plate over every key label (overlay finding).
- Fix: render the key outside the list's scroll while the plate is up; fold only the list. Place the plate below the key where the column has room (1920x1080); where it does not, place it where it can be whole.
- Suggested command: /impeccable layout

**[P1] The plate is tall and repetitive.** 701 px at 1920 (box rows 80 px, three lines); at 1280 all four candidates are under the body's scroll.
- Fix: two-line box rows ("Box 1  9% of past dark targets" / "Oct 24 00:17 UTC, in 7 h 1 min", the legend naming the next look once), tighter candidate rows, a tighter head and foot. Measured in the stage font, the time line is 240 px without "next look S1-D" against 342 px with it.
- Suggested command: /impeccable distill

**[P1] Key icons do not match the map.** Matched: the key draws a tied dot (`.sea-key--claimed::after`); the map draws a 15 px fog ring, 1.6 px, and a hairline only where our own detector's dot decided (none on Oct 12). Set aside: one 18 px ring for two marks the map draws differently (16 px grey ring at 0.95; the 10 px "seen once" ring at 0.55). Candidate 18 vs 20 px, port 10 vs 8 px, the hatch two to five times stronger than the map's and outlined, the heat ramp ending white where the map ends pale orchid.
- Fix: each icon at the map's size, stroke and alpha; split set aside into its two rings; a tied row only on a pass that draws a hairline.
- Suggested command: /impeccable polish

**[P1] The ships go at the forecast, and the dots have no key row.** `aisLook` puts the held dots at 0 from the heat on; "no AIS where AIS was received" then has nothing on screen to be dark against, and nothing in the key says what a dot is.
- Fix: the held dots back at about 0.45 under heat, boxes, look, tasking and filed, no tails or wakes; a key row in plain words.
- Suggested command: /impeccable colorize

## Persona Red Flags

**The presenter on a projector:** explains grey, fog and orchid rings from memory at the tasking beat; at 1280 would have to scroll the plate in front of the room to show a candidate; opening the list to show a layer hides the key under the plate.

**A back-row audience member:** from the heat beat on, the sea has no ships, so "dark" has no contrast; the matched icon's dot points at something the map does not draw.

**Sam (keyboard, screen reader):** native radios and checkboxes with amber focus rings are good; Not now has no Esc; the plate's arrival is not announced beyond its heading.

## Minor Observations

- "Box 1  9% …" relies on two spaces under `pre-wrap`.
- Comments in MapView still say the plate replaces the layers plate's body and sits in the light plate's slot; `STATUS_KEY.claimed` still promises a hairline to every matched target.
- A candidate the officer leaves out turns grey with "left out" on the map; the key's grey ring row does not mention it (the map label carries it).
- The coverage swatches stay at full strength while the map quiets the coverage under the forecast (kept: a key icon has to stay readable).
- `.map-plate__title` is 12 px: it is a tracked uppercase label, the Back Row Rule's stated exception, so not an issue.

## Questions to Consider

- Does the tasking beat need the heat ramp, when each box already says its share of past dark targets?
- Should the key at the tasking beat list only what is drawn there?
- On a short screen, is the agent's answer or the key the thing to give up while the plate is up?

## Placement, measured

- 1920x1080: the right column runs y 72 to 1004 (the plate stops 76 px above the frame's foot, over the basemap plate). Head 54, key about 340 to 380 px with the AIS row, attribution 32: the plate gets about 440 to 520 px. Today's plate is 701 px; a compact plate (two-line boxes, tight candidates) is about 450 to 550 px. Stacked fits only with both the key and the plate tightened.
- 1280x720: the column runs y 72 to 548 (the console reaches under it). Head, key and attribution take about 400 px, leaving under 100 px; the plate's head and foot alone are about 165 px. Stacked cannot fit without scrolling the key.
- The left over the finished step column fits at both sizes but covers the agent's answer, which at 1920 is fully on screen and at 1280 is already cut off below the steps.
