---
target: the agent switcher
total_score: 20
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 4
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/AgentPicker.tsx"
target_fingerprint: "sha256:7f2d39da9bc227ee702488f8ce5690fb4c31f364f3e0805562b2d1ed30e84e43"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/components/AgentPicker.tsx
timestamp: 2026-10-21T17-57-48Z
slug: react-ui-frontend-src-components-agentpicker-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A written before the detector output was read)

Target: the agent switcher on the exhibit rail (`AgentPicker.tsx`, list from `agentContext.tsx`), dev server with the live-like backend list, headless Chrome at 1920×1080 and 1280×720 (`/tmp/stage-fixes-2/shots/before/picker-*.jpg`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | The trigger names the act on stage; nothing else to report |
| 2 | Match System / Real World | 1 | The room reads runtime words: "(stable)", "(dev)", "Live demo runtime, deployed from demo-stable" |
| 3 | User Control and Freedom | 3 | Escape and a click outside close it; focus returns to the trigger |
| 4 | Consistency and Standards | 2 | Names and lines differ from the intro deck's slide 3 (the room just saw "Reads imagery, finds similar places") |
| 5 | Error Prevention | 2 | "Earth Analyst (dev)" is one arrow key away on the live stage |
| 6 | Recognition Rather Than Recall | 2 | Backend order (Act 1, dev, Act 2, Act 4, Act 3), not the show's; the presenter has to recall which act is next |
| 7 | Flexibility and Efficiency | 3 | A real listbox: arrows, Home/End, Enter/Space, Escape |
| 8 | Aesthetic and Minimalist Design | 3 | Calm plate, one amber wash on the current act; five options, two of them the same agent |
| 9 | Error Recovery | 1 | With the backend down the switcher disappears without a word |
| 10 | Help and Documentation | n/a | A presenter control with one-line descriptions; nothing to document |
| **Total** | | **20/36** | Acceptable, with copy that belongs to the build, not the show |

## Design Specificity Verdict

LLM assessment: the plate itself is the product's (dome plate, hairline, amber wash on the act on stage, 15 px rows). The content is the backend's configuration file read aloud: runtime suffixes, branch names and a dev twin of Act 1, in the order the env var lists them.

Deterministic scan: `impeccable detect --json react-ui/frontend/src/components/AgentPicker.tsx`: `[]` (0 findings).

Visual overlays: not injected (headless capture only).

## Overall Impression

The control works; what it says is wrong for the room. The single biggest opportunity: the frontend owns the room copy (names and lines from the deck, in show order) and the backend's runtimes stay behind it.

## What's Working

- Keyboard model is complete and the current act is the only amber on the plate.
- Two lines per option at 15 px read from the back.

## Priority Issues

- **[P1] Runtime words reach the room.** Why: "(stable)" and "deployed from develop" tell the audience about our branches, not the agents. Fix: a frontend show table with the room name and the deck's slide 3 line per act; the backend label stays for nothing the room sees. Suggested command: /impeccable clarify.
- **[P1] Not in show order.** Why: the presenter walks the list top to bottom; the list should be the run order (Earth Analyst, AI Archaeologist, Methane Watch, Dark Vessels). Fix: order by the show table, no act numbers (they no longer match the run order). Suggested command: /impeccable layout.
- **[P1] Dev runtimes offered on the live site.** Why: one wrong arrow key sends the room's prompt to an untested runtime. Fix: dev runtimes only in rehearsal (the vite dev server or `?dev=1`), under a "Rehearsal" heading with the `?agent=` id in mono. Suggested command: /impeccable harden.
- **[P1] Silent when the backend is unreachable.** Why: the presenter cannot tell a dead backend from a slow one. Fix: a visible notice in the switcher's place with a countdown and "Retry now" (separate surface, see the backend-down critique). Suggested command: /impeccable harden.

## Persona Red Flags

**The presenter:** on the live stage sees "Earth Analyst (stable)" and "Earth Analyst (dev)" side by side and must remember which one is safe; looks for Act 2 second and finds the archaeologist below it.

**The back-row architect:** reads "deployed from demo-stable" on the projector and wonders whether they are watching a staging build.

## Minor Observations

- The "Agent" label is 11 px tracked caps (allowed by the Back Row Rule).
- The description wraps to two lines for three options at 340 px; the deck lines are shorter and fit on one.

## Questions to Consider

- Should the switcher name the act number at all? (No: the run order no longer matches the numbers.)

Questions answered by the approved brief: scope is every Group A item; direction is DESIGN.md (One Spotlight Rule, Back Row Rule).
