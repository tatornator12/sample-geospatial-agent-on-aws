---
target: Act 3 keys, legend rows and filed clock sub in MapView
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:2093e85b6cfe253f889f9e45ad0c4569b8ba51d225c3b91764846a6ae56c8ddb"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/act3-open-question/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-21T15-41-53Z
slug: react-ui-frontend-src-components-mapview-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A was written before the detector ran)

# Impeccable critique, before task 1's MapView pass: the Act 3 keys and legend rows, the clock's filed sub

Target: `react-ui/frontend/src/components/MapView.tsx` (the vessels key `:3266-3272`, the coverage
legend `:3276-3281`, the clock's facts at `:3343`). Visual evidence: this run's own live capture at
1920×1080 on the tag `act3-four-turn-fallback` (`RUN/shots/t1_candidates_1920.jpg`, candidates beat;
`t1_filed_1920.jpg`, filed beat). The surface beside it (clock, plate, region labels) was critiqued
and fixed earlier in task 1 (`2026-10-21T14-50-02Z__...taskingplate-tsx.md`); this pass is the part
that critique left open (its priority issue 1, MapView rows).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Filed clock sub points at the plate instead of saying what was filed |
| 2 | Match System / Real World | 1 | "AIS heard: two vessels within 30 km", "unproven: no AIS is not evidence" are the build's words |
| 3 | User Control and Freedom | 3 | Layer toggles, remove, Clear all present |
| 4 | Consistency and Standards | 1 | Layer rows say "AIS received" / "AIS reception unknown", the legend directly under them says "AIS heard" / "unproven"; the clock says "reception unknown" |
| 5 | Error Prevention | 3 | n/a for a key; nothing to get wrong |
| 6 | Recognition Rather Than Recall | 2 | After the reveal the key still says "radar target, not yet explained" when no ring on the map is unexplained |
| 7 | Flexibility and Efficiency | 3 | Map and plate both choose |
| 8 | Aesthetic and Minimalist Design | 3 | Shape plus words, one orchid; rows are short |
| 9 | Error Recovery | 3 | Unchanged |
| 10 | Help and Documentation | 2 | The key explains the wrong thing after the match |
| **Total** | | **24/40** | **Acceptable, copy-bound** |

## Design Specificity Verdict

LLM assessment: the key is authored for this act (each status by its drawn shape and its words, never
colour alone, orchid only for candidates). The failure is vocabulary drift, not form: the plate's
layer rows and the clock were moved to "AIS received" and "reception unknown", and the legend six
pixels below them was not, so one idea reads two ways in one glance.

Deterministic scan: `impeccable detect --json react-ui/frontend/src/components/MapView.tsx` printed
`[]`, exit 0. The detector does not read copy, so it neither confirms nor contradicts the issues
below. No overlay was injected (no browser tool in this step); the live browser check runs after
the edits.

## Overall Impression

The plate is one honest edit away from agreeing with the clock. Change the five rows and the filed
sub's facts, nothing else.

## What's Working

- Shape and words per status, so the key reads in greyscale and from the back of the room.
- The candidate row joins only after the reveal: nothing is called a candidate before coverage.
- Rows wrap (`white-space: normal`) at 15 px, so the longer words fit the 320 px plate.

## Priority Issues

1. **[P1] Legend and key contradict the layer rows and the clock.** "AIS heard: two vessels within
   30 km", "unproven: no AIS is not evidence", "a broadcast accounts for it", "candidate, not an
   accusation". Fix (design §3.8.3): "AIS received: other ships came through here near the pass",
   "reception unknown: no AIS here proves nothing", "matched to a ship's AIS", "candidate: no AIS
   where AIS was received"; after the reveal, "radar target, not yet explained" becomes "set aside:
   reception unknown, or one detector only". Suggested command: /impeccable clarify.
2. **[P2] The filed clock sub defers to the plate.** "the approved box and candidates are on the
   tasking plate". Fix (§3.8.2): pass the filed choice into the clock's facts, so it reads "box 1 ·
   4 of 4 candidates · next radar look in 2 d 9 h"; the plate keeps the one filed sentence.
   Suggested command: /impeccable clarify.

## Persona Red Flags

- The room (non-specialist leader): reads "AIS received" in the layer list and "AIS heard: two
  vessels within 30 km" just under it and cannot tell whether they are two layers.
- Sceptical engineer (Riley): after the reveal sees "radar target, not yet explained" in the key
  while every ring has a label; reads it as the stage not knowing its own state.

## Minor Observations

- "outside the radar: not imaged" belongs to task 7b (it needs the clipped areas); not in this pass.
- The longer rows will run to two lines in the 320 px plate; check the swatch stays centred on both.

## Questions to Consider

- Does "set aside" need to stay in the key once the ring labels say "reception unknown" on the map?

Questions skipped: 2 priority issues (fewer than 3), and their wording was approved by the user on
Oct 21 (design §3.8.2, §3.8.3, task 1; option 1 chosen Oct 21 via the orchestrator).
