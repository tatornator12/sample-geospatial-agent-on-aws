---
target: step column methane surface (record timeline, pass filmstrip, follow line)
total_score: 15
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-record-ui/react-ui/frontend/src/components/StepColumn.tsx"
target_fingerprint: "sha256:ed3f8337cdaf22d794d0fa3c27125bc3fea0f3a7cf6e4cce763acf604ef42622"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-record-ui/react-ui/frontend/src/components/StepColumn.tsx
timestamp: 2026-10-26T18-52-06Z
slug: react-ui-frontend-src-components-stepcolumn-tsx
closed: true
---
Method: dual-agent (A: context-gatherer design review · B: context-gatherer detector and browser evidence)

Target: the Methane Watch step column's methane surface, step 04 "Cue EMIT on 2 sites": `RecordTimeline.tsx` (model `utils/record.ts`), `PassFilmstrip.tsx`, the wiring in `StepColumn.tsx`, and the follow line (`utils/follow.ts` `decisionWords`). Evidence: a live run of "Methane Watch brief" on the dev runtime (Shanxi top spot, 6 of 20 seen, newest 25 Jul 2026, 78 days before 11 to 24 Oct 2026) and the replay `methane-watch-bars`, at 1920x1080 and 1280x720.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Now" (the fortnight) is an unlabelled 8 px band that reads as a slider knob; frames still loading look like cloud or gap frames |
| 2 | Match System / Real World | 1 | A time chart with no dates under it; the only date, "Jan 2025", sits above the thumbnails; the strip runs newest first against an axis whose oldest end is on the left |
| 3 | User Control and Freedom | 3 | Frames open and close the evidence plate; a press on a frame whose chip has not loaded does nothing |
| 4 | Consistency and Standards | 1 | "Methane seen" is an orange dot, a fog frame border, "candidate" and "seen up close"; time runs two ways in one block |
| 5 | Error Prevention | 2 | The lone "Jan 2025" invites a false claim; `gapWords` would say "about 3 months" for 78 days (heard as 90); 25 Jul to the fortnight's end is 91 days, so the gap must be pinned to the fortnight's first day |
| 6 | Recognition Rather Than Recall | 1 | Dates only in native `title` tooltips; the room must remember the date and the gap from other lines |
| 7 | Flexibility and Efficiency | n/a | A projected exhibit with one presenter path |
| 8 | Aesthetic and Minimalist Design | 3 | Quiet and on-system; the empty Carbon Mapper hairline and the unlabelled bracket are ink without meaning |
| 9 | Error Recovery | 2 | A failed or loading chip looks the same as cloud or gap |
| 10 | Help and Documentation | n/a | A stage has no help layer |
| **Total** | | **15/32** | **Poor** |

## Design Specificity Verdict

LLM assessment: authored for this product (three real sensors on one scale; shape says the verdict, colour says the source and matches the map; frames are the tool's own chips). As a chart it is unfinished: a strip plot without an axis, with a thumbnail grid that runs the other way in time, and the beat's point (the gap) is the smallest unlabelled mark.

Deterministic scan: `impeccable detect --json` on the three target files and on `react-ui/frontend/src` both exit 0 with `[]`. The injected detector on the replay page found 12 page-level patterns at 1920 (19 at 1280, 7 of them its own overlays), none inside `.record-timeline` or `.pass-film`. Browser evidence found a real defect the detector cannot see: rejected and error frames are not dimmed at all, because the frames' `stage-rise` animation runs with fill-mode `both` and its `to { opacity: 1 }` overrides `.pass-film__frame--rejected { opacity: 0.45 }` (measured opacity 1 on every rejected frame). Every text node in the block is 15 px; fog 14.7:1 and label grey 6.6:1 on the plate; no horizontal overflow; EMIT marks four days apart overlap by up to 8.7 of their 10 px.

## Overall Impression

The encoding is right and the evidence is real, but the room cannot tell when anything happened, and the one date on screen reads as the thumbnails' date. The biggest opportunity: a real axis under the rows, with the gap and the fortnight said in words where they are drawn, and the thumbnails dated, in the axis's order, under the EMIT row.

## What's Working

- One grammar shared with the map: shape for the verdict, colour for the source, one x-scale.
- Every word and mark comes from validated manifests; the tracks' aria-labels already say what the visuals should.
- Restrained motion: the bracket draws once; reduced motion is honoured.

## Priority Issues

- **[P0] No date axis, and its one date reads as the thumbnails' date.** Why: the chart cannot be read and the presenter will say something false. Fix: one shared axis under the rows with month ticks and the years at their Januaries; delete the lone "Jan 2025"; never leave a date only in a tooltip. Command: /impeccable layout.
- **[P1] The frames sit away from their row, run the other way and are undated.** Fix: EMIT becomes the last row, the frames sit under the axis oldest to newest, each with its date beneath (a sibling of the button, so dimming never fades it). Command: /impeccable layout.
- **[P1] The gap and the fortnight carry no words.** Fix: say the gap in days, never months, pinned to the fortnight's first day ("78 days to 11 Oct"); label the band "11 to 24 Oct" directly over it; a faint ice rule at the fortnight's first day on the lower tracks. Command: /impeccable clarify.
- **[P1] "Methane seen" looks four ways.** Fix: the candidate frame border becomes the dot's orange (#f89540); hover and focus move from an amber border (a 9 degree hue shift a projector loses) to an amber outline ring outside it; rejected frames are actually dimmed (on the image, not the animated button). Command: /impeccable polish.
- **[P2] The follow line hides the rule; the proposed wording has traps.** "inside" already means "during the fortnight" in follow.ts and the timeline; "checks no further" is contradicted by the three "Check ..." steps that follow; the number is not mono. Fix: "Methane was last seen up close at <spot> 78 days before this fortnight, within 90 days, so the agent stays with it and does not check the next spots.", with the days in mono. Command: /impeccable clarify.

## Persona Red Flags

- **The presenter on stage:** no date to point at; must supply "78 days" from memory; at 1280x720 the block is cut mid-key and needs a scroll; with an orange candidate border the amber hover border is invisible on a projector.
- **A non-technical audience member at the back:** sees hairlines and a square knob that reads as a slider; cannot tell which way time runs; sees white-bordered frames while the key says orange means methane.
- **A technical architect judging credibility:** cannot find which frame is the 25 Jul confirmation; notices the strip and the axis disagree on direction; asks whether 78 days runs to the fortnight's start or end (it is the start; to the end it would be 91, outside the rule).

## Minor Observations

- Draw "seen" marks on top of rings on the same day cluster.
- Candidate frames have a 2 px border and the others 1 px, so their images differ in size.
- The empty Carbon Mapper row says nothing; give it the words "none since January 2025".
- A cloud or gap frame could carry the timeline's clouded-out tick so it differs from a chip still loading.
- DESIGN.md "Step column (signature)" documents "44px frame, newest first, 2px fog frame": update it with the change.
- Step 08's coordinate pairs break across lines at 1280 (outside this block, same screen).
- The pass words differ between the key ("too faint or within noise", "clouded out") and the summary line ("too weak", "within noise", "cloud or gap"). Out of scope here; worth one vocabulary pass.

## Questions to Consider

- Should the 90-day window itself be drawn (a faint ice wash ending at the fortnight) so "within the rule" shows without numbers?
- Should the 25 Jul confirmation frame be the one large picture, with the rest one press away?
- Is 1280x720 the real projector? If so, the full block cannot share a screen with anything else.
