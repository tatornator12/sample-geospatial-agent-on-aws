---
target: the Methane Watch brief card
total_score: 20
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/components/BriefCard.tsx"
target_fingerprint: "sha256:d4989a50d927ebb566da0767fa97d791e08a3d6c74f3d52de0eaabd70dc0e15d"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/components/BriefCard.tsx
timestamp: 2026-10-09T16-08-11Z
slug: react-ui-frontend-src-components-briefcard-tsx
closed: true
---
Method: dual-agent (A: general-task-execution design review · B: general-task-execution detector + browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | A brief that fails to load renders nothing after 30 s of silent retries |
| 2 | Match System / Real World | 2 | Title named the watch area, not the site (fixed in this pass) |
| 3 | User Control and Freedom | 3 | Approve / another look / inert replay are clear |
| 4 | Consistency and Standards | 2 | 14px next-checks below the 15px floor; duplicate subhead rule; three spellings of the watch area (fixed) |
| 5 | Error Prevention | 2 | Model-authored title and place could contradict the geocoder (fixed: tool-composed title, place check) |
| 6 | Recognition Rather Than Recall | 2 | No coordinates on the card; window of "recent" undefined (fixed) |
| 7 | Flexibility and Efficiency | 2 | The decision sits ~600px below the fold of a 296px scroller |
| 8 | Aesthetic and Minimalist Design | 2 | Flat 15px wall of text, 7 sections before the decision |
| 9 | Error Recovery | 2 | Load failure is invisible |
| 10 | Help and Documentation | n/a | Projected end frame; the audience never operates it |
| **Total** | | **20/36** | **Acceptable** |

## Design Specificity Verdict

LLM assessment: the content model is authored for this product (tool-written ground record, server-built card, fixed single-explanation line, "The agent did not file it."); the composition is generic, a long report column in the stage's narrowest plate with nothing tying it to the place.

Deterministic scan: CLI detector 0 findings (BriefCard.tsx and react-ui/frontend/src, exit 0). Browser overlay: 14 findings, none in .brief-card (11 ai-color-palette on plasma/viridis legend and tip bars: false positives, scientific ramps; 2 cramped-padding on docent chips: likely false positive, fixed 32px height; 1 text-occlusion on the Esri attribution under the basemap plate: real, outside the card). Console: React duplicate key (StepColumn and BriefCard both keyed by briefId), a real bug (fixed).

## Priority Issues

- [P0] Title named the wrong place (watch area, not the geocoded site). FIXED: draft_brief composes the title from the place and the evidence (Recurring methane / Methane candidate / Unconfirmed methane tip), rejects places that carry a watch-area phrase, "watch" or coordinates, and the card shows coordinates plus "tipped by the <label> watch area" as provenance.
- [P1] The end frame does not fit: card ~1,430px tall in a column showing 25% (1280x720) to 50% (1920x1080); the decision is off-screen; auto-scroll aligns the card top. OPEN.
- [P1] Too small and too flat for the back row: confidence pair at 15px, verdict words in label grey; next-checks at 14px (FIXED to 15px); state differed from title by colour only (FIXED: regular weight). OPEN for the type scale.
- [P2] Count line hid its window and the evidence for the confidence. FIXED: counts and "since" come from the tool's pass record; "EMIT looked N times in all".
- [P2] A brief that fails to load leaves the end frame silently missing. OPEN.

## Persona Red Flags

- The skeptical architect: caption and card named different places (fixed); "non-oil-and-gas source: less likely" rests on Overture mapping no agriculture while the imagery shows farmland.
- The presenter: must mouse-scroll a 296px column to reach Approve and file.
- Low-vision viewer: verdicts and confidence labels in label grey on a projector.

## Minor Observations

- key={line} collisions in checks and gaps (fixed); duplicate .brief-card__subhead (fixed).
- "Filing" has no working dots; replay hides the decision row entirely.
- The Overture sentence's "(0 km)" reads oddly; "at the site" would be clearer (tool sentence).

## Questions to Consider

- Should the room's one line ("methane recurs here; the cause is unconfirmed") be the biggest text on the card?
- Should the stage card show verdict, place, evidence and decision only, with the full brief in the record?
- Should the end frame take the centre of the stage when the turn ends?
