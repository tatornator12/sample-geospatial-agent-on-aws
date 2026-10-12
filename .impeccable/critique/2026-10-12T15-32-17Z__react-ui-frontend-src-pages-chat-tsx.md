---
target: the Stage (step column, caption band, layers plate, globe)
total_score: 23
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:e655a93d1240460dc757441c0fac018ac38bba92d439af50eeab89d5bff7d229"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx
timestamp: 2026-10-12T15-32-17Z
slug: react-ui-frontend-src-pages-chat-tsx
closed: true
---
Method: dual-agent (A: general-task-execution design review · B: general-task-execution detector + browser)

## Design Health Score

Total **23/36** (heuristic 10, Help and Documentation, scored n/a: the stage is presenter-driven). Reviewer A's per-heuristic breakdown was not retained; the key issue per heuristic:

| # | Heuristic | Key Issue |
|---|-----------|-----------|
| 1 | Visibility of System Status | The layers plate says TROPOMI is drawn while MapLibre hides it above zoom 8 (end zoom 12.7); the idle globe is still, so "ready" and "stalled" look the same |
| 2 | Match System / Real World | The caption band shows the answer's last paragraph, the closer, not the answer |
| 3 | User Control and Freedom | The step column can't be minimized to give the map room |
| 4 | Consistency and Standards | Vectors are pinned above every raster while rasters restack; two rules in one list |
| 5 | Error Prevention | At 1280×720 the step column and the console overlap (72×32) |
| 6 | Recognition Rather Than Recall | EMIT (plasma) and TROPOMI (viridis) ramps read as one family; the room can't tell the legends apart |
| 7 | Flexibility and Efficiency | The column is a fixed width; the methane plan strip wraps "Brief" to a second line |
| 8 | Aesthetic and Minimalist Design | The idle globe floats in a flat void; the caption band costs 95–160 px of stage |
| 9 | Error Recovery | The which-company answer (operators of record) is only reachable in the transcript |
| 10 | Help and Documentation | n/a |
| **Total** | | **23/36** |

## Design Specificity Verdict

LLM assessment: the stage language holds (plates, hairlines, mono identifiers, map-first), but the caption band is the weak surface: it paraphrases the agent and picks the wrong paragraph, and the step column has no answer at its end.

Deterministic scan: CLI detector 0 findings (react-ui/frontend/src, exit 0). Browser overlay: 16 hits. 13 are false positives on scientific ramps (ai-color-palette on plasma/viridis/ice strips); 2 borderline cramped-padding on the docent plates; 1 real text occlusion: the basemap plate covers the Esri attribution. Measured: TROPOMI layer maxzoom 8 vs replay end zoom 12.7; step column vs console overlap 72×32 at 1280×720; plan strip wraps at the last step.

## Priority Issues

- [P1] The caption band shows the wrong part of the answer (the closer, not the operators or the number). Remove the band; put the answer (the agent's words after its last tool call) at the foot of the step column.
- [P1] 720p collisions: the step column runs into the console. Measure the column's max height against the draw rail and the console.
- [P1] The column can't widen or minimize. Width `clamp(296px, 19vw, 380px)`, a sticky head that minimizes it and keeps the step count and working dots, plan strip on one line.
- [P2] The layers plate claims TROPOMI is drawn past its zoom cap. Say "Shows only when zoomed out", grey the row, hide its legend, and fly to just under the cap on name click. Give TROPOMI a ramp from a different family (cmocean `ice`).
- [P2] The idle globe is unfinished: no drift, no space. Slow drift at rest, faster while working; a quiet starfield and thin atmosphere; size the globe to fit between the plates.

## Persona Red Flags

- The presenter: asks which company, the room sees one closing sentence; the operators are in the transcript nobody opens.
- The back row: EMIT and TROPOMI legends look the same at 6 m.
- The skeptical architect: "TROPOMI drawn" with nothing on the map reads as a broken layer.

## Minor Observations

- Idle placeholder copy repeats the start card.
- The Esri attribution is covered by the basemap plate.
- Docent plates have tight padding at 1280.

## Questions to Consider

- Does the answer belong in the console (two lines) or the step column (full)? Chosen: the step column, full answer.
- Should vectors restack like rasters? Chosen: yes, one list.
- Is idle motion worth the carve-out from "motion only where it shows work"? Chosen: yes, 1.5°/s, documented.
