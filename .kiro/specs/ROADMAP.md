# Nov 9 demo program: roadmap

Demo: Monday Nov 9, 2026, 30-minute slot. Builder: one person. Start: Sept 15, 2026
(40 working days). This file is the index; each release is its own spec folder with
`requirements.md`, `design.md`, `tasks.md`. Specs are created at the start of their week,
not all up front, so requirements reflect what the data spikes actually showed.

## The show (four acts, one platform)

| Act | Agent | Minutes | What the audience learns |
|---|---|---|---|
| 1 | Current agent + eyes + similarity | 7 | The agent sees imagery and finds places by example |
| 2 | Methane Hunter (or Ground Motion Sentinel) | 7 | It senses the invisible and triages at scale |
| 3 | Dark Vessels (or Ground Motion lite) | 8 | It investigates, gathers evidence, and acts with approval |
| 4 | AI Archaeologist | 4 | Same eyes and similarity, a new domain: discovery |
| — | Intro 2 min, close 2 min (teaser of the act not shown + observability trace) | 4 | |

## Specs, in order

| # | Spec folder | Week | Gate (Friday) | Status |
|---|---|---|---|---|
| 1 | `demo-foundation` | Sep 15–19 | G1: dev runtime reachable from local UI via switcher; eval script runs; 4 spike notes | **G1 passed Sep 18** |
| 2 | `eyes-inspect-image` | Sep 22–26 | tool + gallery + cloudy-scene golden prompt pass | built and verified Sep 18 (dev v19, eval 7/7); formal gate run Sep 26 |
| 3 | `similarity-search` | Sep 29–Oct 3 | G2: Release 1 promoted to `demo-stable`; Act 1 rehearsed (7 min) | built Sep 24; **G2 promoted Sep 24** (`deployed-2026-09-24`, stable v70 + CloudFront); Act 1 rehearsal pending |
| 4 | `methane-hunter` | Oct 6–17 | G3: Release 2; two agents in switcher; Acts 1–2 rehearsed | not started |
| 5 | `ai-archaeologist` | Oct 20–24 | closer works on a public site; **Act 3 decision written down Oct 24** | not started |
| 6 | `act3-dark-vessels` or `act3-ground-motion-lite` | Oct 27–31 | G4: Release 3; full 30-minute run-through | not started |
| 7 | `demo-readiness` | Nov 3–7 | freeze Nov 3; runbook, backup videos, prewarm, 2 timed rehearsals | not started |

Cut list if behind (in this order, never touching the foundation, eyes, similarity, replay
cases or rehearsal week): Ground Motion → live AIS (keep replay) → Archaeologist shrinks to
a 90-second teaser → Methane keeps only the replay case.

## Spec-driven cadence

- Monday: write/refresh `requirements.md` and `design.md` for the week's spec; approve before code.
- Tuesday–Thursday: execute `tasks.md` top to bottom; every task names its tests.
- Friday: run the gate (pytest, vitest, `npm run design:check`, `scripts/eval.py`),
  promote only if green, rehearse what exists, record the gate result at the bottom of the
  spec's `tasks.md`.

## Baselines recorded Sep 15

- Impeccable detector on `react-ui/frontend/src`: 6 findings (overused font Roboto ×2,
  side-tab accent borders ×3 in ToolCallDisplay/Technology, layout-property transition ×1
  in Chat.tsx). Target: 0 on every touched surface.
- Live runtime: `geospatial_agent_on_aws`, code tagged `deployed-2026-09-15` on `demo-stable`.
  Superseded Sep 24 by `deployed-2026-09-24` (Release 1: foundation + eyes + similarity, stable v70, CloudFront UI redeployed).
