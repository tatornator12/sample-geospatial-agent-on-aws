---
target: the stage with the backend down
total_score: 11
max_score: 28
na_heuristics: 6,7,10
p0_count: 1
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/Navigation.tsx"
target_fingerprint: "sha256:3edde83bcbec989b96f7bdbcd375bc41fadda58feb5355d20b039f1bcae3fc51"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/Navigation.tsx
timestamp: 2026-10-21T18-01-21Z
slug: react-ui-frontend-src-components-navigation-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A written before the detector output was read)

Target: the stage with the backend unreachable (`Navigation.tsx` rail, `agentContext.tsx`, `ChatSidebar.tsx` failed answer), `/?agent=vessels` with every request to the backend aborted, headless Chrome at 1920×1080 (`/tmp/stage-fixes-2/shots/before/backend-down-1920.jpg`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 0 | Nothing says the backend is down: the switcher just disappears |
| 2 | Match System / Real World | 2 | A sent prompt reads "The agent stopped before it answered", as if it had started |
| 3 | User Control and Freedom | 1 | No retry; the only way back is a page refresh |
| 4 | Consistency and Standards | 2 | `?agent=vessels` shows Earth Analyst copy ("Ask about any place on Earth") |
| 5 | Error Prevention | 2 | The prompt can be sent into a dead backend |
| 6 | Recognition Rather Than Recall | n/a | One state |
| 7 | Flexibility and Efficiency | n/a | One state |
| 8 | Aesthetic and Minimalist Design | 3 | The stage stays calm |
| 9 | Error Recovery | 1 | The list is fetched once; a backend that comes back is never noticed |
| 10 | Help and Documentation | n/a | One state |
| **Total** | | **11/28** | Poor: a silent failure |

## Design Specificity Verdict

LLM assessment: there is no designed state; the failure is the absence of a control. The stage's own language for failure exists (the failed answer in the error colour), but it names the agent, not the connection.

Deterministic scan: `impeccable detect --json` on `Navigation.tsx`, `ChatSidebar.tsx`: `[]` (0 findings).

Visual overlays: not injected (headless capture only).

## Overall Impression

On a conference network this is the most likely failure, and the stage hides it. Biggest opportunity: one quiet line in the switcher's place that says what is wrong and when it will try again, and a failed turn that blames the connection, not the agent.

## What's Working

- The stage does not crash; the map and console stay usable.

## Priority Issues

- **[P0] Silent backend failure.** Why: the presenter cannot tell a dead backend from a slow one, live, in front of the room. Fix: a `role="status"` notice in the rail, "Can't reach the stage backend. Retrying in 8 s." with a countdown and a quiet "Retry now", error-colour text and no fill; retries back off 2, 4, 8, 16 s, then every 30 s. Suggested command: /impeccable harden.
- **[P1] The act's copy is lost.** Why: on `?agent=vessels` the console asks about "any place on Earth". Fix: while the list is not ready, the stage uses the validated `?agent=` id for its copy. Suggested command: /impeccable harden.
- **[P1] A network failure is told as the agent stopping.** Why: misleading state. Fix: "The stage can't reach the backend. Check the connection, then send the prompt again." for a network error. Suggested command: /impeccable clarify.

## Persona Red Flags

**The presenter:** the switcher is gone and nothing says why; the first sign is a failed prompt in front of the room.

## Minor Observations

- The prewarm call fails silently too (expected: it is fire and forget).

## Questions to Consider

- Should the notice offer the replay gallery as the way through? (Not now: the gallery also needs the backend for its cases.)

Questions answered by the approved brief: a visible notice with retry; nothing more.
