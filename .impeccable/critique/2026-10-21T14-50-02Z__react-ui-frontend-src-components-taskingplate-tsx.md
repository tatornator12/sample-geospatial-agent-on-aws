---
target: Act 3 stage copy (tasking plate, clock, sea labels)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/TaskingPlate.tsx"
target_fingerprint: "sha256:24ef91411089988f5178e655c16cbbf0257b8e5bb02fb28ab83e505972d21368"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/TaskingPlate.tsx
timestamp: 2026-10-21T14-50-02Z
slug: react-ui-frontend-src-components-taskingplate-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A was written before the detector ran)

# Impeccable critique, before task 1: Act 3 stage copy (clock plate, tasking plate, sea labels and keys)

Target: `react-ui/frontend/src/components/TaskingPlate.tsx` (primary), with `SeaClock.tsx`,
`seaStage.ts` labels, `vesselLayers.ts` clock and key words, and the MapView coverage and target keys.
Visual evidence: the Oct 20 live stage review at 1920×1080 (`stage-review-2026-10-20/screenshots/act3/`
`A_live_04_021s.jpg` coverage beat, `D_plate_1920.jpg` draft, `E_filed_sim_1920.jpg` filed). No new
live run before editing: the copy is the subject and the review's captures are of this exact code
(base `4a2a4ff`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Clock names each beat; at filing it repeats the plate instead of stating what was filed |
| 2 | Match System / Real World | 1 | "heard water", "unproven", "not evidence" are build-internal words; the room cannot restate them |
| 3 | User Control and Freedom | 3 | Officer can change box and candidates, dismiss with "Not now" |
| 4 | Consistency and Standards | 2 | One idea worded five ways across clock, labels, legend rows and layer names |
| 5 | Error Prevention | 3 | Approve waits while the agent works; inert in replay |
| 6 | Recognition Rather Than Recall | 2 | "Box 1 · 4 of 4 candidates" asks the room to remember the boxes come from history and the candidates from today |
| 7 | Flexibility and Efficiency | 3 | Map clicks and plate controls both choose |
| 8 | Aesthetic and Minimalist Design | 2 | The officer sentence three times on screen in the draft and filed states |
| 9 | Error Recovery | 3 | "The draft did not load." with Try again |
| 10 | Help and Documentation | 3 | Legends and key rows present, but explain the wrong thing after the match |
| **Total** | | **25/40** | **Acceptable, copy-bound** |

## Design Specificity Verdict

LLM assessment: the act is authored for this product. The sea at night, one orchid data colour, the
argument drawn in its order and a single amber Approve are specific to an enforcement officer's
decision and could not be lifted onto another product. The weak point is the language, not the
form: the coverage vocabulary is the build's (`heard`, `unproven`) leaking onto the stage, and the
officer's role is asserted by repetition rather than shown once at the moment it matters.

Deterministic scan: `impeccable detect --json` on `react-ui/frontend/src`, `TaskingPlate.tsx` and
`SeaClock.tsx`: `[]` each, exit 0. The detector does not read copy, so it neither confirms nor
contradicts the issues below. No overlay was injected (no browser tool in this step); the live
browser check runs after the edits.

## Overall Impression

The composition works; the words undercut it. Fix the vocabulary and the repetition and the act
reads as evidence first, which is its whole claim.

## What's Working

- Numbers in the mono face everywhere (the Tabular Rule), so "30%", "31 km" and times read at
  distance.
- The single amber control: "Approve the tasking" is the only amber on the act, which makes the
  human decision the one lit thing.
- The clock's two lines map cleanly to "what you see / what it means".

## Priority Issues

1. **[P1] Coverage words do not say what they mean.** "AIS heard over 30% of the reserve / two or
   more vessels within 30 km in one hour, three either side of the pass · hatched: unproven, not
   evidence"; region labels "heard water" and "unproven: AIS not heard here"; ring notes "not
   evidence"; layer names "Heard water", "Unproven water"; legend rows (MapView). Fix: "AIS
   received" and "reception unknown" everywhere (design §3.8.3, R4.3).
2. **[P1] The officer sentence repeats.** Draft: clock "the decision is the officer's", plate
   "Decision: the officer's.", the answer's OFFICERS_DECISION. Filed: clock and plate both "Filed by
   the officer … The agent did not file it.", then the agent's `tasking_status` says it a third
   time. Fix: one filed sentence, on the plate's filed line (R6.7); the clock states the facts.
3. **[P1] The plate summary reads as candidates inside the box.** "Box 1 · 4 of 4 candidates" when
   only one candidate lies in a box. Fix: "Patrol box 1 · check 4 of 4 candidates on the way", and
   the legends "Patrol box (from past dark targets)" / "Candidates (Oct 12 pass)".
4. **[P2] Live regions double up.** The clock is `aria-live="polite"` at the tasking and filed
   beats while the plate's status (`role="status"`) announces the same moment. Fix: clock
   `aria-live="off"` for `tasking` and `filed`.
5. **[P2] After the reveal the region words vanish and the hatch dominates.** The labels go to 0
   and the hatch stays at 0.6 over two thirds of the frame while the room should read four orchid
   rings. Fix: labels at reduced opacity, hatch to about 0.3 at the candidates beat.

## Persona Red Flags

- The room (non-specialist leader): cannot restate "unproven, not evidence"; reads "Box 1 · 4 of 4
  candidates" as a fact about box 1.
- Screen-reader user at the podium (Sam): hears the filed sentence twice back to back (clock, then
  plate).
- Sceptical engineer (Riley): sees "The agent did not file it." three times and reads it as
  protesting too much.

## Minor Observations

- The key row "radar target, not yet explained" stays after the match, when every grey ring is
  explained (MapView, shared file: deferred with the legend rows).
- Box labels carry "9%" with no unit of meaning on the map (box labels are outside task 1).

## Questions to Consider

- Would the room miss the filed sentence on the clock if the plate carries it with the time?
- Does "reception unknown" need its consequence ("no AIS there proves nothing") on every surface,
  or only on the legend and the ring note?

Questions skipped: 5 priority issues, but their direction and scope were approved by the user on
Oct 21 (design revision 4, §3.8.2 to §3.8.4, task 1); the binding run rules say implement, do not
redesign, so no questions are asked in this workflow step.
