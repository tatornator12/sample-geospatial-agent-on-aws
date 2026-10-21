---
target: the Act 3 stage wiring (step column, legend, plates, approve path, gallery card)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/StepColumn.tsx"
target_fingerprint: "sha256:158f0c754758319b182a65ca8f52f924f5d89fc78513fada3af9a7e0b9e14c20"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/StepColumn.tsx
timestamp: 2026-10-21T20-58-03Z
slug: react-ui-frontend-src-components-stepcolumn-tsx
---
## Assessment A (design review, recorded before the detector)

Target: the Act 3 stage surfaces task 7b wires, with the step column as the resolved target
(`react-ui/frontend/src/components/StepColumn.tsx`, rendered by `ChatSidebar.tsx`), and beside it
the coverage legend (`MapView.tsx`), the prepared plates (`stageCopy.ts`), the tasking plate's
approve path (`Chat.tsx`'s automatic follow-up) and the gallery card (`UseCaseGallery.tsx`).
Code read at `af65a93`. Visual evidence: this run's live capture of the stage at 1280×720 on the
four-turn path (`RUN/shots/t1e_candidates_1280.jpg`), which is what the stage still draws for the
one question, because 7a's parts are not wired (no file of 7a is rendered yet).

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The column still shows "Put it on the map" three times in view and no decision or check; the 7a board and lines exist only in tests |
| 2 | Match System / Real World | 2 | "Check where AIS could be heard" in the column; the gallery card says "4, in heard water"; the map hatches reserve water the radar never imaged as "reception unknown" |
| 3 | User Control and Freedom | 3 | "Show N earlier steps" works; approving the tasking sends a turn the presenter did not ask for and replaces the column |
| 4 | Consistency and Standards | 2 | Four prepared plates for a one-question act; two of them (spares) are meant to be asked only |
| 5 | Error Prevention | 3 | The plate's approve is the only action, and it waits for the agent; the follow-up turn it triggers is the only surprise |
| 6 | Recognition Rather Than Recall | 2 | The passes on file never appear, so the choice of pass is invisible |
| 7 | Flexibility and Efficiency | 3 | Earlier steps one press away; the spare plate (U7) is not offered |
| 8 | Aesthetic and Minimalist Design | 2 | Plumbing rows take a third of the column; the plates wrap to two rows at 1280 |
| 9 | Error Recovery | 3 | A failed turn says so |
| 10 | Help and Documentation | 3 | The legend explains each mark in words, except the plain sea outside the radar, which nothing explains once the areas are clipped |
| **Total** | | **25/40** | **Acceptable, wiring-bound** |

### Design Specificity Verdict

LLM assessment: the stage is authored for this show (the sea at night, one lit row, orchid only
for candidates, numbers in mono, the clock band), so it is not generic. What is generic is the
column on an Act 3 turn: a tool log, which any agent could print. 7a built the specific parts (a
board of the passes on file, a line per decision and check worded from the tools' files, the reveal
wait), and none of them reaches the stage yet. The opportunity is entirely wiring, not new visual
language: put the board and the lines where the design says, keep the map's reveal and the column's
counts on one rule, and remove the turn the stage sends by itself.

### Cognitive load

- Fails "one primary focus" at the end of the turn: approving files the tasking and, a beat later,
  the column is replaced by an automatic "Is it filed?" turn, so the room's eye leaves the plate's
  filed line for a column that restarts.
- Fails "chunking" in the column: map calls interleave with the work (`t1e_candidates_1280.jpg`:
  rows 03, 05, 07, 09 are "Put it on the map").
- The prepared plates: four options at 1280 over two rows, where the act needs one question and
  one sceptic's spare (two options).

### Emotional journey

The peak should be "the agent chose this pass, said why, checked it against the standard and found
four candidates", then the officer's approval as the act's (and the show's) last beat. Today the
peak is invisible (no board, no lines), and the end is undercut by a turn the presenter did not ask
for. At 1280 the answer's first line can sit under the fade (7a issue 5).

### What's Working

- The clock band already says each figure beside its own layer, and the plate's filed line is the
  only filed sentence on the stage (task 1).
- The legend explains every mark by shape and words, at 15 px, and the 720p plate keeps every row
  and GFW's attribution in view (task 1, review B2).
- 7a's pure parts are complete and tested: grammar, lines at 100 characters or fewer, the board's
  states from files only, the reveal wait, the height rules.

### Priority Issues

1. **[P1] The board and the lines are not on the stage.** Why: the room cannot see a choice or a
   check; "agentic" is asserted, not shown (R6.1 to R6.3). Fix: `StepColumn` renders a
   `VesselStepExtras` for a vessel turn, keyed by the turn's send time, which loads the board,
   the decision files and the coverage files and renders 7a's grammar, the board under "Weigh the
   passes on file", one line per accepted decision and check, and the radar and evidence chips.
   Suggested command: build per §3.8.1, then /impeccable polish.
2. **[P1] The column and the map can disagree on a count.** Why: a "no candidates" line or a
   candidates count before the map's reveal breaks R4.2 (review M2). Fix: MapView reports its
   reveal (`onCandidatesRevealed(passId, count)`), `Chat.tsx` holds `revealedPasses` per session,
   and the column's lines and board states wait for it. Suggested command: build.
3. **[P1] The stage sends a turn on approval.** Why: the officer's approval is the act's last beat;
   the automatic "Is it filed?" turn replaces the column and repeats what the plate says (U4,
   R6.8). Fix: MapView's `onFiled` calls nothing; `Chat.tsx` passes nothing. Suggested command:
   distill.
4. **[P2] Plain sea outside the radar has no words.** Why: once the coverage areas are clipped to
   the imaged cells (§3.5), reserve water outside the swath carries neither wash nor hatch, and the
   room can read it as "nothing there" (L6). Fix: a legend row "outside the radar: not imaged",
   15 px, a swatch with no fill, shown only when the coverage file is the clipped kind (it carries
   the checkable share), so the four-turn path never shows it. Watch the 720p plate's height (B2).
   Suggested command: clarify.
5. **[P2] Retired words and four plates.** "Check where AIS could be heard" (step name), "4, in
   heard water" (gallery), and four four-turn plates. Fix: step names "Weigh the passes on file"
   and "Check where AIS was received"; one plate "Who is there without broadcasting, and where
   next?" with the U7 spare "Same question, end of August"; placeholder "Ask about the reserve, or
   a radar pass on file"; the card's copy per §3.8.5 (status stays "coming soon" until task 9
   records the case). Suggested command: clarify.

### Persona Red Flags

- **The room (non-specialist leader):** sees plumbing rows and no reason for the pass; after the
  approval, a new turn starts that they did not hear asked.
- **The sceptical architect:** looks for the decision and the coverage judgement in the column and
  finds neither; looks at plain sea outside the swath and cannot tell "not imaged" from "empty".
- **The presenter at 1280:** four plates over two rows; the answer's first line may need a scroll.

### Minor Observations

- The answer scroll is `nearest` for every act; a vessel answer at its cap (about 470 px at 1280)
  is taller than the column's room (about 416 px), so its first line lands under the fade.
- The clock does not yet read the checkable share, the heat's or the boxes' figures from the files
  (7a's readers are unused), so the coverage lead still says "AIS received over 30%".
- The heat and boxes land together, so the heat's beat (and its top 5% figure) is never on screen.
- The forecast's camera returns to the session's first pass, so on the thin path it brings back the
  set-aside pass.

### Questions to Consider

- Should the vessel rows match the other acts' rows exactly (same marker, same lit treatment)? Yes:
  the platform story needs one column grammar, so the vessel list reuses the row's look.

## Assessment B (detector, after A)

- `impeccable detect --json` on `StepColumn.tsx`, `MapView.tsx`, `ChatSidebar.tsx`,
  `UseCaseGallery.tsx` and `react-ui/frontend/src`: `[]` each, exit 0.
- Browser overlay: not injected here. The stage needs the live backend and an agent turn to show
  this surface; the live runs after the edits (task 7b's browser check) are the visual evidence,
  and A used this run's live capture of the same stage.

## Synthesis

The detector has nothing to say: its rules cover type, colour, borders and motion, and these
surfaces pass them. Every issue A found is wiring, words or behaviour, which no detector rule
reads: the 7a board and lines are not rendered, the map's reveal does not reach the column, the
stage sends a turn on approval, the plain sea outside the radar has no legend words, and three
strings still use retired words. The fixes are the approved design's (§3.8.1 to §3.8.5, review M2,
M3, L3, L4, L6), with every string fixed by the design. The one judgement call is the vessel rows'
look: they reuse the column's row (marker, number, lit name, "working") so the platform reads as one
grammar; only the grammar under the rows (board, lines, chips) is Act 3's.

Questions skipped: the fixes and their words are the approved design's; nothing here needs a
direction from the user.
