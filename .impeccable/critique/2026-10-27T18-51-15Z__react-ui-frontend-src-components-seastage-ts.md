---
target: Dark Vessels stage, candidates beat
total_score: 25
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-passing/react-ui/frontend/src/components/seaStage.ts"
target_fingerprint: "sha256:2ca209d24672c0f4959187f3a298305e2c8918e6117621ad5c61452c27236472"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-passing/react-ui/frontend/src/components/seaStage.ts
timestamp: 2026-10-27T18-51-15Z
slug: react-ui-frontend-src-components-seastage-ts
closed: true
---
Method: dual-agent (A: context-gatherer design review · B: kirocrew-worker detector run)

Target: the Dark Vessels stage's candidates beat (seaStage.ts targets layers, vesselLayers.ts key rows and clock, vesselSteps.ts candidatesLine, stage.css .sea-key icons, TaskingPlate.tsx), before adding the passed_close status (approved 2026-10-27).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | clock beat, step line and reveal show the check |
| 2 | Match system / real world | 3 | "seen by both detectors" is jargon; one idea in three phrasings once passed_close lands ("set aside", the answer's "not counted", say_as) |
| 3 | User control and freedom | 3 | Stop, Clear, the plate's checkboxes |
| 4 | Consistency and standards | 2 | clock sub and step line say nearly the same sentence |
| 5 | Error prevention | 3 | nothing filed until approved; a passed_close target can never be drafted |
| 6 | Recognition rather than recall | 3 | key icons are the marks; a colliding label drops silently |
| 7 | Flexibility and efficiency | 3 | prepared prompts |
| 8 | Aesthetic and minimalist design | 2 | 9 key rows before the change, 10 after |
| 9 | Error recovery | n/a | the candidates beat has no error state |
| 10 | Help and documentation | 3 | the key, How it works |
| Total | | 25/36 | good, with consistency and density to watch |

Design specificity: authored for this act. Every status is told by shape and words, never colour alone; key icons copy the map's radius and stroke; orchid is the only data colour; ids in mono.

Deterministic scan: `impeccable detect --json react-ui/frontend/src` exit 0, `[]`; the stage files alone, exit 0, `[]`. Browser overlay skipped (no dev server for this worktree when it ran; screenshots taken later).

Priority issues
- [P1] The planned step line ("Checked: 2 candidates ... seen by both detectors. 2 set aside: a broadcasting ship passed close by.") is about 119 characters, over MAX_LINE_CHARS 100, and repeats the key row's words verbatim. Fix: keep the candidates line as it is; add a second "Checked:" line with the numbers the room needs (1 km, 30 minutes) so it is not the key row's sentence again.
- [P1] Label collision: T03 and T04 sit about 3 km apart; a long grey label added above the orchid labels can bump a candidate's label. Fix: add the passed_close layer below -labels so the candidates place first; text-optional so the mark stays when its words cannot.
- [P2] The mark: keep the grey ring (r 8, 1.5 px) through both phases and add a symbol glyph, a short horizontal grey line passing just under the ring (not 45 degrees like the hatch, no dot like the tie), with a dome casing so it reads on the radar's speckle; fade it in with the reveal. Key icon in CSS: the same ring and line.
- [P2] Key height beside the tasking plate: one more row; check at 1920x1080 that the plate still fits.
- [P3] The plate needs no change: it lists the draft's candidates only.

Persona red flags
- Presenter: the old replay case and the script say 4 candidates; a dropped label leaves a target unnamed.
- Technical leader at the back: "why is the ship by T03 not a match?" needs the 1 km and 30 minutes on screen once.

Questions (answered from the brief, delegated job): scope is fixed by the user (key row, map label, step line, clock counts, plate list); the ship's real course is not drawn before the freeze; T03 and T04 keep their ids.
