---
target: the Dark Vessels stage (MapView.tsx sea stage)
total_score: 20
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-noise/react-ui/frontend/src/components/MapView.tsx"
target_fingerprint: "sha256:052e642ec1981466777e25607bbaf9950044eafd932919dd35636e69f3c1b9e9"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/vessels-noise/react-ui/frontend/src/components/MapView.tsx
timestamp: 2026-10-23T15-09-44Z
slug: react-ui-frontend-src-components-mapview-tsx
---
Method: dual-agent (A: context-gatherer · B: kirocrew-worker)

# Critique: Dark Vessels stage (MapView.tsx sea stage, with vesselLayers.ts, seaStage.ts, SeaClock.tsx, TaskingPlate.tsx)

Target state: develop c4336ba (worktree vessels-noise, before any change). Visual truth: the vessels-noise report's shots 01 to 15 and a fresh before set (shots-after/*-before.jpg, one live run on dark_vessels_dev and the replay case).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Steps, lit marker and clock track the agent live; the replay case ends on the wrong clock ("Next radar look" or "4 candidates") under a "recorded" tasking plate. |
| 2 | Match System / Real World | 2 | Tool-speak on the clock and key: "AIS held at the pass minute", "steps aside", "near the pass" (a time or a place?), "refitted before each radar day". |
| 3 | User Control and Freedom | 3 | Esc, Not now, layer toggles, New session; a second plate in the same session leaves the Oct 12 plate offering Approve. |
| 4 | Consistency and Standards | 2 | One status, three names ("matched to a ship's AIS", "accounted for by a broadcast", "a broadcast accounts for it"); S1D / S1-D / Sentinel-1D. |
| 5 | Error Prevention | 2 | A live Approve beside "no tasking" in the same session (report shot 14). |
| 6 | Recognition Rather Than Recall | 2 | 142 dots with no key row; by the tasking beat steps 01 to 07 have scrolled off. |
| 7 | Flexibility and Efficiency | 3 | Prepared plates, replay cases, keyboard; the layers plate folds at tasking. |
| 8 | Aesthetic and Minimalist Design | 1 | Heat, boxes, look and tasking sit over 72 h of bright route lines, 4 h tails and 142 dots; 7 key rows plus a ramp; the candidate sentence 3 times at the end. |
| 9 | Error Recovery | 2 | The designed "cannot check" outcome exists, but the replay's stale clock undermines it. |
| 10 | Help and Documentation | n/a | Operate surface watched by a room: help is the presenter's voice; the key is scored under 6 and 8. |
| **Total** | | **20/36** | **Acceptable, with a noisy second half** |

## Design Specificity Verdict

LLM assessment: authored for this product through the argument (01 to 06): the seabed at night, one data hue for the finding, mono "T01  no AIS" labels, a clock that reads as the satellite's own, the radar swept along its track, "Decided:" and "Checked:" lines worded from the tools' enums, and the candidates held until the coverage is on the map. From the heat onwards (07 to 10) nothing retires and the frame turns into the generic maritime-intelligence picture: a white route web, a pink glow, labelled boxes, a long key. The end frame, which the room remembers, is the least specific.

Deterministic scan: `impeccable detect --json` on MapView.tsx, TaskingPlate.tsx, SeaClock.tsx and the whole of react-ui/frontend/src: exit 0, `[]`.

Visual overlays (injected into headless pages; no user-visible tab): rest view 3 findings, replay 7. Two `cramped-padding` on `.docent-plate` are false positives (fixed 32 px height centres the text, 6 px clear above and below). Four `text-occlusion` on wrapped inline number spans in the tasking plate and the step column are false positives (a wrapped inline span's box spans both lines). One `text-occlusion` is real: the basemap plate (`.map-basemap`, stage.css:1696) covers the "Bathymetry: AWS Terrain Tiles" attribution at bottom right. Not part of this act's noise; noted for a later pass.

## Overall Impression

The argument is the act's best moment and its design is right: 22 targets, "can check 19%", a breath, four orchid rings. What hurts is AIS the agent never used: three days of routes and four-hour tails stay up under the radar and come back brighter under the forecast and the tasking, where no number uses AIS at all, and hairlines drawn to whichever dot is nearest read as the match tolerance. The single biggest opportunity: draw only the AIS the matching used.

## What's Working

- The order of the argument is structural, not narrated: the candidates wait for the coverage plus 1.4 s (MapView.tsx maybeReveal), and every figure comes from the tools' files.
- Silence is honest and never colour alone: wash for received, hatch for unknown, outline for not imaged; candidates carry words in mono at 16 px.
- The opening (a living archipelago, one sentence, attribution once) and the human-in-the-loop close (Approve is the act's amber).

## Priority Issues

- **[P1] The AIS on the map is mostly not the AIS the agent used.** Why: the presenter was asked exactly this. The 72 h wakes and 4 h tails feed no number, yet they are on at 0.13/1.0 at the radar beat and back at 0.13/0.35 under heat, boxes, look and tasking (measured). Hairlines (3 on Oct 12, 2.7 to 4.1 km) are drawn from GFW-decided matches to the nearest dot, so they read as the tolerance, then T03 "no AIS" sits 3.2 km from a dot. Fix: `aisLook` (vesselLayers.ts) radar to candidates heads only; forecast beats no AIS; `claimParts` only for `source: 'ours'`; optionally clip rest wakes to the 36 h loop. Command: /impeccable distill.
- **[P1] The replay case's end frame is wrong.** Why: the replay is the on-stage fallback; a clock that disagrees with the plate reads as a broken demo. Traced (before run, beat log): the case's draft loads first (rest -> tasking), then the files land in network order (tasking -> coverage -> heat), the reveal timer fires 1.4 s later unconditionally (heat -> candidates, which also cancels the boxes beat), and the deferred look lands last (candidates -> look). Fix: reveal moves to candidates only from coverage; a recorded draft brings the clock back to the tasking once the beats that land after it have held. Command: /impeccable harden.
- **[P1] Nothing retires in the forecast; 7 key rows plus a ramp in 07 to 09.** Why: each forecast beat should make one point. Fix: item 1 removes the routes; a per-beat key (report item 6) can wait. Command: /impeccable distill.
- **[P2] Fixed sentences repeat.** "not an accusation" 3 times at the tasking beat (answer twice, plate once) and "reason to look" twice at the candidates beat (clock and later answer); 19% twice at the coverage beat. Fix: drop the candidates clock's tail and the plate's note; the answer keeps it. Command: /impeccable clarify.
- **[P2] Tool-speak on the clock.** "AIS held at the pass minute", "near the pass", "steps aside". Fix: "142 ships broadcasting at the radar minute", "in the three hours either side of the pass", "ships' broadcasts are shown for Oct 12 only". Command: /impeccable clarify.

## Persona Red Flags

**The presenter at the podium:** no on-screen answer to "is that the AIS it used?"; must narrate around bright routes in 03 and 10. The replay fallback ends on the wrong clock.

**A technical leader at the back:** the white route web looks like the data; 7 key rows at 15 px read as a grey block; orchid heat and orchid candidates read as one thing.

**A sceptical architect:** 2.7 to 4.1 km hairlines suggest a 4 km tolerance the rule does not use; "T03 no AIS" 3.2 km from a dot; the clock says 36 hours while the wakes draw 72.

## Minor Observations

- The next-look label can sit on Box 2's label line, so Box 2 reads as Oct 24 though its look is Oct 29.
- "reception unknown" crowds the clock plate's right edge in the tasking zoom.
- The answer says "24.6 to 31.0 km" while the plate says "31 km": two precisions for one figure.
- The legend icon for a matched target still draws a small tied dot; it stays valid for targets our detector alone matched.

## Questions to Consider

- If the routes are not evidence, should the traffic freeze to the held dots at the radar beat as a hard cut, so the room learns what the agent used from the motion stopping?
- Is the forecast a second scene rather than a layer over today's argument?
- Does the end frame need the answer's full text when the plate is the decision?

Questions answered by the brief (the build's instructions fix priority, scope and constraints): build recommendations 1 to 5 and 7 of the vessels-noise report; skip the per-beat legend unless cheap; never change a number or decision; avoid StepColumn, steps.ts, BriefCard and stage.css.
