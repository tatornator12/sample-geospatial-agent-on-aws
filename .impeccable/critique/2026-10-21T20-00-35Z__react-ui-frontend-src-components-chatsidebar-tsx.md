---
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/ChatSidebar.tsx"
target_fingerprint: "sha256:c9737fdc178e1dc9321f4f8d512d9eb5302eb18aba8597240071fa745f8bfea7"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/ChatSidebar.tsx
timestamp: 2026-10-21T20-00-35Z
slug: react-ui-frontend-src-components-chatsidebar-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; written after the Group B edits had begun, so Assessment A reads the Oct 20 review's before screenshots and today's after screenshots side by side; the detector ran after Assessment A was written)
Target: the step column (`ChatSidebar.tsx`, `StepColumn.tsx`, `EarlierTurns.tsx`): live turns on the dev runtimes, the scratch SSE scripts and the replay cases, headless Chrome at 1920×1080 and 1280×720. Before: `stage-review-2026-10-20/screenshots/act1/a1_state_error_1920.jpg`, `act1/a1_la-fires-2025_1920.jpg`, `act2/permian_1280_t18.jpg`. After: `stage-fixes-2/screenshots/gb/b1-slowtool-lit-*.jpg`, `b2-failmid-*.jpg`, `b5-answer-*.jpg`.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Before: the lit step lagged one behind the running tool (A1 P1-2). After: the started call lights at once; the narration line still waits 2.5 s between sentences by design |
| 2 | Match System / Real World | 3 | Ranked tables folded into nested parentheses; now "2024-01-31 · 8,130.7 · Midland, TX" |
| 3 | User Control and Freedom | 3 | A failed turn erased its steps; now they stay and the record keeps them |
| 4 | Consistency and Standards | 3 | Transcript printed function names and "N steps" against the column's grouped count; now step names and "N tool calls" |
| 5 | Error Prevention | 2 | New session while working still has no confirm (S17, deferred) |
| 6 | Recognition Rather Than Recall | 3 | The failed line names the step reached ("stopped at step 02, Fetch Sentinel-2") |
| 7 | Flexibility and Efficiency | 2 | The prompt is still the 13th Tab stop (S16, deferred) |
| 8 | Aesthetic and Minimalist Design | 3 | Answers ran 2 to 4 screens; tables now cap at five rows with "+N more rows in the transcript" |
| 9 | Error Recovery | 3 | The failed line says what to do next |
| 10 | Help and Documentation | n/a | A stage, not a tool with help |
| **Total** | | **25/36** | Good |

## Design Specificity Verdict
LLM assessment: specific to this stage. The column's grammar (one lit step, the Saw line, the earlier turns) is the product's own; the fixes keep it and remove the places where it lied about time (the lag) or lost work (the failed turn).
Deterministic scan: `impeccable detect --json` on `ChatSidebar.tsx`, `StepColumn.tsx`, `EarlierTurns.tsx`, `ToolCallDisplay.tsx`: `[]` (0 findings).
Visual overlays: not injected (headless capture only).

## Overall Impression
The column now tells the truth about where the agent is: the step lights when its tool starts, a replay shows its steps before its answer, and a failure keeps what was done. The remaining gaps are keyboard reach and a confirm on New session mid-turn.

## What's Working
- One status line (`role="status"`) announces "Step 3: Find similar places" once per step and how the turn ended; the list is no longer a live region (S15).
- The answer's first line comes to the top of the column under the head, so the line to repeat is in view.

## Priority Issues
- **[P1] The lit step lagged one behind.** Fixed: `openTool` lights the started call (B1).
- **[P1] A failed turn erased its steps.** Fixed (B2).
- **[P1] Replays showed the answer, not the work.** Fixed: `useReplayReveal`, one call at a time, under 6 s, everything at once under reduced motion (B10).
- **[P1] Answers buried the steps; tables folded into parentheses.** Fixed (B5).
- **[P2] New session is icon-only with no confirm while working; the prompt is the 13th Tab stop.** Open (S16, S17): deferred, listed in gb-verification.md.

## Persona Red Flags
**The presenter:** during a 25 s similarity search the column used to say the agent was still putting the boundary on the map. Now it says "Find similar places, working".

## Minor Observations
- The column title `<h2>` still sits inside the toggle button (deferred P2).

Questions skipped: the approved brief fixes the scope (Group B's P1 list, then P2s as time allows).
