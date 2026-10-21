---
target: the step column on an Act 3 turn (pass board, decision lines)
total_score: 22
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/StepColumn.tsx"
target_fingerprint: "sha256:158f0c754758319b182a65ca8f52f924f5d89fc78513fada3af9a7e0b9e14c20"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/StepColumn.tsx
timestamp: 2026-10-21T20-17-44Z
slug: react-ui-frontend-src-components-stepcolumn-tsx
---
## Assessment A (design review, recorded before the detector)

Target: the step column on an Act 3 turn, `react-ui/frontend/src/components/StepColumn.tsx`
(rows, `groupSteps`/`groupName` from `utils/steps.ts`), with `TipBoard.tsx` as the board pattern
the pass board is modelled on. Visual evidence: this run's live captures on `55098a4`
(`RUN/shots/t1e_coverage_1920.jpg`, 7 rows while the coverage is drawn; `t1e_forecast_1280.jpg`,
the forecast turn at 720p). Code read at `71781c3`.

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The lit row is "Put 2 layers on the map"; what the agent is deciding or checking never appears in the column |
| 2 | Match System / Real World | 2 | "Check where AIS could be heard" (the retired word) and "Look at the image" for the radar |
| 3 | User Control and Freedom | 3 | "Show N earlier steps" works; nothing else to control here |
| 4 | Consistency and Standards | 2 | Methane gets a board and reason lines under its steps; Act 3's choice of pass gets nothing |
| 5 | Error Prevention | n/a | A read-only column |
| 6 | Recognition Rather Than Recall | 2 | The alternatives (other passes on file) are never on screen, so the room cannot see a choice was made |
| 7 | Flexibility and Efficiency | 3 | Earlier steps one press away |
| 8 | Aesthetic and Minimalist Design | 2 | "Put it on the map" takes 3 of 7 rows at the coverage beat (4 of 4 at the forecast) |
| 9 | Error Recovery | 3 | A failed turn says so in the error colour |
| 10 | Help and Documentation | 3 | Rows are plain words; the line under a step is the stage's own |
| **Total** | | **22/36** | **Acceptable, structure-bound** |

### Design Specificity Verdict

LLM assessment: the column is authored for this show (one lit row, amber only on the working
label, numbers in mono, the step plate over the map), and Methane's tip board proves the pattern
can carry an act's argument. Act 3 does not use it: its rows are the tool log with the map plumbing
left in, so the column could belong to any agent. The specific opportunity is the one the redesign
names: the passes on file as a board before the choice, and one line under each step that says
what was decided or checked, from the tools' numbers.

### Cognitive load

- Fails "one primary focus": at 1920 the lit row ("Put 2 layers on the map") competes with the
  quote under it and the radar chip; the step that matters (coverage) is a done row above.
- Fails "chunking": map calls interleave with the work, so seven rows hold four ideas.
- Decision points with more than four visible options: none in the column.

### Emotional journey

The peak should be "the agent chose this pass, checked it, and found four candidates". Today the
column's peak is a plumbing row, and the end frame at 720p is the answer's first lines cut by the
fade. The reassurance moment (coverage over the standard) lives only on the clock plate.

### What's Working

- One lit row with a 15 px "working" label, everything else quiet: the eye finds the agent.
- The tip board's grammar (rows from the stage's own words, numbers in mono, a fog ring and dot
  for what was cued and followed) is the right model for the passes.
- The line under a step (`.step-detail`, 15 px label grey with a mono fog run) is already the
  place a reason can live without new chrome.

### Priority Issues

1. **[P1] Map plumbing as steps.** `display_visual` is its own row three times in seven
   (`t1e_coverage_1920.jpg`) and the radar's look is "Look at the image". Why: the room reads the
   column as the agent's reasoning; three of its rows say nothing about the vessels. Fix: fold
   each `display_visual` into the step whose file it shows (radar to find, targets to detect or
   match, coverage to the coverage check, heat and boxes to the forecast, the look to next look),
   fold chip inspections into the evidence step, and call the radar's row "Look at the radar"
   (design §3.8.1). The clean path becomes 10 rows. Suggested command: /impeccable distill.
2. **[P1] No choice is visible.** The passes on file never appear, so "Find the radar pass" reads
   as a lookup, not a decision. Fix: a pass board under "Weigh the passes on file" (date, satellite,
   share imaged, the state from the decision files), modelled on the tip board, mono 15 px, no amber
   and no orchid, 4 rows under 1600 px and 6 above, a marked row never hidden. Suggested command:
   /impeccable shape (done in the design), then build.
3. **[P1] Decisions and checks have no words in the column.** The coverage verdict and the
   candidates count live only on the clock and vanish on the next beat. Fix: one line per accepted
   `decide` ("Decided:" in fog) and per check ("Checked:" in label grey), at most 100 characters,
   built only from the files' enums and numbers, with the zero-candidate lines held until the map's
   reveal (R4.2, review M2) and both `stop` lines as "Checked:" (review L1). Suggested command:
   /impeccable clarify.
4. **[P2] Retired word in a row name.** "Check where AIS could be heard" (`stageCopy.ts:139`). Fix:
   "Check where AIS was received", and "Weigh the passes on file" for `list_passes`. `stageCopy.ts`
   is shared (agentic-moments): task 7b. Suggested command: /impeccable clarify.
5. **[P2] The end frame at 720p.** The answer starts under the steps and its first line can sit
   below the fold. Fix: the answer's `block: 'start'` scroll for a vessel answer taller than the
   column (§3.8.1); the pure rule here, the wiring in 7b (`ChatSidebar.tsx`, shared). Suggested
   command: /impeccable adapt.

### Persona Red Flags

- **The room (non-specialist leader):** sees "Put 2 layers on the map" lit while the coverage
  appears; cannot say why this pass was read or that others were on file.
- **The sceptical architect:** looks for the decision and finds a tool log; "agentic" is asserted
  by the presenter, not shown.
- **Screen-reader user at the podium:** the column is `aria-live="polite"`; three "Put it on the
  map" announcements in a row add noise without content.

### Minor Observations

- The board must fit 296 px at 1280: date, satellite and share in fixed mono widths, the state
  word last so "no candidates" can take a second line late in the act without moving the figures.
- "and N older" under the board as `.step-detail` (15 px), never a smaller caption.

### Questions to Consider

- Should a set-aside row stay on the board at the end frame, or is the line naming both passes
  enough? (The design keeps the board unpinned.)

## Assessment B (detector, after A)

- `impeccable detect --json react-ui/frontend/src/components/StepColumn.tsx`: `[]`, exit 0.
- `impeccable detect --json react-ui/frontend/src/components/TipBoard.tsx`: `[]`, exit 0.
- `impeccable detect --json react-ui/frontend/src`: `[]`, exit 0.
- Browser overlay: not injected. Task 7a builds pure parts and a component that the stage does not
  render until task 7b wires it (VesselStepExtras inside StepColumn); the browser checks of the
  rendered board and lines are 7b's and gate B's (run rules). The evidence for A is this run's
  live captures of the current column.

## Synthesis

The detector has nothing to say about this surface: its rules cover type, colour, borders and
motion, and the column already passes them. Every issue A found is structural or verbal (rows that
are map plumbing, no visible alternatives, no words for decisions and checks), which no detector
rule reads. So the fix is the design's §3.8.1, built as pure functions first: the grammar that
folds `display_visual` and chip inspections, the line templates from the decision and coverage
files (each at most 100 characters, "Decided:" for choices and "Checked:" for rule outcomes,
including both `stop` lines), the reveal wait for every zero-candidate line and board state, and a
pass board on the tip board's pattern. Issues 4 and 5 need shared files (`stageCopy.ts`,
`ChatSidebar.tsx`) and go to task 7b with their pure rules ready.

Questions skipped: the fixes are the approved design's (§3.8.1, review M2 and L1), with the
strings fixed by the design; nothing here needs a direction from the user.
