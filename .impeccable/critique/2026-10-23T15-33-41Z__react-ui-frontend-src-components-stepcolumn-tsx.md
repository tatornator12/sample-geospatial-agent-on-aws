---
target: the Methane Watch step column before the record timeline (StepColumn, TipBoard, PassFilmstrip, BriefCard)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-record/react-ui/frontend/src/components/StepColumn.tsx"
target_fingerprint: "sha256:53fc07626e8d8528da75845de7ec96cda93d546a4313b629b34694866013e461"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-record/react-ui/frontend/src/components/StepColumn.tsx
timestamp: 2026-10-23T15-33-41Z
slug: react-ui-frontend-src-components-stepcolumn-tsx
---
Method: dual-agent (A: kirocrew-worker design review · B: kirocrew-worker detector and browser)

Target: the Act 2 (Methane Watch) stage surface in the step column, before the record timeline is built:
`react-ui/frontend/src/components/StepColumn.tsx` (resolved target), with `TipBoard.tsx`, `PassFilmstrip.tsx`,
`BriefCard.tsx` (its last-look line from `utils/brief.ts`) and `stage.css`. Code at c4336ba (branch methane-record).
Visual evidence: the replay case `methane-watch-mission` at 1920x1080 (end frame, all steps, the card alone).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The choice of site is a 15 px "following" flag; in replay the column lands on the end frame at once |
| 2 | Match System / Real World | 2 | "candidate", "within noise", "cloud or gap", "Latest sign: TROPOMI, 14 days to ... (about 4 km cells)" |
| 3 | User Control and Freedom | 3 | Toggles work; the end frame scrolls the board and filmstrip away |
| 4 | Consistency and Standards | 2 | Three date formats (ISO on the board, "Aug 17 2026" on the card), three verdict vocabularies, 5 km on screen |
| 5 | Error Prevention | 3 | "Request another look" beside a coming "new look" invites a wrong press unless worded apart |
| 6 | Recognition Rather Than Recall | 2 | "Last EMIT look Aug 17 2026" on the card against the board's "latest 2025-11-30", scrolled off |
| 7 | Flexibility and Efficiency | 3 | Plates, replay, "Show all steps" serve the presenter |
| 8 | Aesthetic and Minimalist Design | 2 | "4 of 8" four times in the end frame; the card is 1,255 px of text |
| 9 | Error Recovery | 3 | Failed loads say so with the id |
| 10 | Help and Documentation | 2 | Nothing says what a framed or dimmed frame means; no column heads on the board |
| **Total** | | **25/40** | **Acceptable: solid bones, inconsistent words** |

## Design Specificity Verdict

LLM assessment: authored for this show (plan strip, tip board with its ice bar and "following" mark, 44 px pass frames,
the chain line, the inert replay card); every number comes from a tool record. Where it slips: the card is a long stack
of sentences exactly where the "why look again" argument has to land, and the time gap, which is the reason for the
recommendation, has no visual form anywhere.

Deterministic scan: `impeccable detect --json` on StepColumn, BriefCard, TipBoard, PassFilmstrip and `src`: `[]`, exit 0.
Browser overlay (injected on the replay at 1920x1080): 9 findings in the end frame. False positives: ai-color-palette on
the tip-row and legend ramps (they are data ramps matching the rasters), text-occlusion on the card's chain line (an
inline span's box overlapping the inline arrow). Outside this surface: cramped-padding on `.docent-plate` (32 px fixed
height centres the text), "© Esri" 33% under the basemap plate.

## What's Working

- Provenance discipline: the board, the chain and the last-look line are built from manifests, never model text, so the
  new line can be code-written with the plumbing that exists.
- The filmstrip shows the agent's judgement as evidence (framed candidates, dimmed rejections, a click opens the reason).
- Restraint with amber: only the lit step and "Approve and file" use it.

## Priority Issues

1. [P1] The gap is never said, and its pieces sit in four places in three formats. Fix: delete `brief-card__look` and put
   one code-written line in its place; one date formatter (day month year, mono, nowrap) for the timeline and the line;
   the radius comes from the record (7 km).
2. [P1] The proposed card line repeats the verdict ("keeps showing up" after "Recurring methane" and "Methane recurs
   here") and "confirmation" sits beside "Cause: unconfirmed". Fix: attribute the recommendation to the agent ("The agent
   recommends a new fine-scale look"); one function writes the months for both the bracket and the line.
3. [P1] The timeline would sit above a newest-first filmstrip whose summary names the same passes in other words. Fix:
   one vocabulary for the marks; the followed site's summary line steps aside for the timeline; the strip keeps its
   newest frames as the clickable evidence.
4. [P2] Space: 293 px for the track at 1920, 224 px at 1280. Fix: each row's label on its own 15 px line over a
   full-width track; marks at least 10 px, same-day looks merged; two date ticks only; the TROPOMI band at least 8 px;
   colour by source (EMIT plasma orange #f89540, Carbon Mapper mint #6fe0b8 ring, TROPOMI pale ice band), verdict by
   shape (filled, hollow ring, grey tick); the bracket in fog, never amber; under 150 px tall.
5. [P2] The end frame scrolls the timeline away, and the replay never holds the following beat. Fix: the card line is
   the end frame's one statement of the gap and the bracket is the following beat's, from one string.
6. [P3] Below the 15 px floor already on this surface: `.brief-card__subhead` 12 px, `.tip-row__value` 14 px.

## Persona Red Flags

- The room: "Last EMIT look Aug 17 2026" reads as "already watched"; two EMIT denominators (4 of 8, 28 in all).
- The sceptical architect: 5 km on screen against 7 km in the tool; a bracket that does not start on a drawn, dated mark
  looks invented; mark count against frame count.
- The presenter at 1280: 224 px of track; side labels impossible; the decision must stay on the card's first screen.

## Minor Observations

- Layer titles still say "CH4 Enhancement" and "CH4 Anomaly" where the legends use plainer words.
- The Carbon Mapper source line should show once per visible frame.
- "Show the summary" is vague for what it does.

## Questions to Consider

- Does TROPOMI need its own row, or is the tip the right-hand bound?
- Could the EMIT marks open the evidence plate themselves?

## Synthesis

The detector has nothing to say about the source; the browser overlay's findings are data ramps and a geometry artifact.
Every issue A found is words, dates and duplication, which no rule reads. The build follows the approved design (report
section 6) with these adjustments from this critique: the card line attributes the recommendation to the agent; one
formatter and one months function for the bracket and the line; the followed site's filmstrip summary steps aside for
the timeline and the strip keeps its newest eight frames; colour by source, verdict by shape; no amber in the timeline.

Questions skipped: the direction, scope and words are the presenter's approved design (approved 2026-10-23) and the
user's brief for this run; the remaining choices are recorded as decisions in the run report.
