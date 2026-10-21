---
target: the Methane Watch tip board and cue step
total_score: 19
max_score: 28
na_heuristics: 5,7,9
p0_count: 0
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/agentic-moments/react-ui/frontend/src/components/TipBoard.tsx"
target_fingerprint: "sha256:6a3019efc394c73ef53489d336aa0e18ad397f5326d7a95e9067642cab1ad9b3"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/agentic-moments/react-ui/frontend/src/components/TipBoard.tsx
timestamp: 2026-10-20T17-11-32Z
slug: react-ui-frontend-src-components-tipboard-tsx
closed: true
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A written before the detector output was read)

Target: the tip board and the cue step in the Methane Watch end frame (`TipBoard.tsx`, `PassFilmstrip.tsx`, the cue hunk of `StepColumn.tsx`), replay `methane-watch-mission`, headless Chrome at 1920×1080 and 1280×720 (`/tmp/agentic-moments/act2/before-*.jpg`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The board says which site was followed ("following"), not why |
| 2 | Match System / Real World | 3 | "+108.8 ppb" and the ramp read well; the ring for "cued" is unlabelled |
| 3 | User Control and Freedom | 3 | "Show all 17 steps" brings the other site's strip back; nothing in the end frame does |
| 4 | Consistency and Standards | 3 | Two cued sites while working, one in the end frame: the strip count changes under the room |
| 5 | Error Prevention | n/a | Read-only surface |
| 6 | Recognition Rather Than Recall | 2 | The room must remember the working-state strips to know Shanxi was checked too |
| 7 | Flexibility and Efficiency | n/a | The audience does not operate it |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, one ramp, mono numbers; the value is 14 px under a 15 px floor |
| 9 | Error Recovery | n/a | No error states here |
| 10 | Help and Documentation | 2 | Nothing says what the ring or the bar length mean |
| **Total** | | **19/28** | Good, with one gap in the story |

## Design Specificity Verdict

LLM assessment: specific to this product. The board is the TROPOMI field ranked in the TROPOMI legend's own ramp, labelled from the stage's table, with the decision marked in fog. It could not be lifted into another product unchanged.

Deterministic scan: `impeccable detect --json` on `TipBoard.tsx`, `PassFilmstrip.tsx`, `StepColumn.tsx`: `[]` (0 findings). No false positives to discuss.

Visual overlays: not injected (headless capture only).

## Overall Impression

The board shows the whole field before the agent commits, which is the right idea. The single biggest gap: it shows the outcome of the choice and hides the reason. South Caspian is marked "following" beside the top TROPOMI row, so the room reads "it followed the biggest tip", when the rule was candidate passes (2 of 4 against 2 of 6, a tie broken on peak).

## What's Working

- Every area in one plate, strongest first, numbers in tabular mono on one ramp.
- Words only from the stage's own table; "TROPOMI only" is said, not coloured.
- The filmstrip's summary line ("2 candidates · 1 within noise · 1 cloud or gap") says the self-check in words.

## Priority Issues

- **[P1] The reason for the choice is not on the board.** Why it matters: the decision is the agentic moment; without the counts the room infers the wrong rule. Fix: a third line on each cued row with the counts from the pass manifest, "2 of 4 candidate passes · latest 2025-08-20", numbers in mono. Suggested command: /impeccable clarify.
- **[P1] The end frame drops the site that lost.** Why it matters: the comparison that justified the choice disappears exactly when the room reads the result. Fix: keep the other site's labelled summary line (not its frames: the end frame is already taller than the column). Suggested command: /impeccable distill.

## Persona Red Flags

**The back-row architect:** sees "following" on the top row and concludes the agent chased the largest anomaly. Nothing on screen contradicts it.

**The presenter:** has to say the counts aloud from memory; the stage does not carry them.

## Minor Observations

- `.tip-row__value` is 14 px (stage floor 15 px). Existing; left for a later pass.
- "TROPOMI only" runs into the place name (review P2); left for the stage-fixes run.
- The coordinates line under the cue ("39.44, 53.57 · 35.55, 112.69") repeats what the card says.

## Questions to Consider

- Should the losing site's numbers sit next to the winner's on the board, so the comparison is one glance?
- Once the tie-break is "most recent", does the latest date need to be on the board too? (Yes: it is the tie-break.)

Questions skipped: 2 priority issues (below the 3 that require questions), and the scope is fixed by the plan for this workflow step.
