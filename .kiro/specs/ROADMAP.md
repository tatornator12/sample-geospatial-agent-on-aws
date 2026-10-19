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
| 3 | Dark Vessels (decided Oct 12; Ground Motion lite dropped) | 8 | It investigates, gathers evidence, and acts with approval |
| 4 | AI Archaeologist | 4 | Same eyes and similarity, a new domain: discovery |
| — | Intro 2 min, close 2 min (teaser of the act not shown + observability trace) | 4 | |

## Specs, in order

| # | Spec folder | Week | Gate (Friday) | Status |
|---|---|---|---|---|
| 1 | `demo-foundation` | Sep 15–19 | G1: dev runtime reachable from local UI via switcher; eval script runs; 4 spike notes | **G1 passed Sep 18** |
| 2 | `eyes-inspect-image` | Sep 22–26 | tool + gallery + cloudy-scene golden prompt pass | built and verified Sep 18 (dev v19, eval 7/7); formal gate run Sep 26 |
| 3 | `similarity-search` | Sep 29–Oct 3 | G2: Release 1 promoted to `demo-stable`; Act 1 rehearsed (7 min) | built Sep 24; **G2 promoted Sep 24** (`deployed-2026-09-24`, stable v70 + CloudFront; UI build fix `deployed-2026-09-24-1712`); Act 1 rehearsal pending |
| 4 | `methane-hunter` | Oct 6–17 | G3: Release 2; two agents in switcher; Acts 1–2 rehearsed | **Release 2 promoted Oct 12** (`deployed-2026-10-12`: Earth stable v72, Methane stable v3, CloudFront UI); user signed in and sees both agents; Turkmenistan cleared for the stage (13.1, Oct 12); Acts 1–2 rehearsal pending |
| 5 | `ai-archaeologist` | Oct 20–24 (started early) | closer works on a public site; **Act 3 decision written down** | spec **approved Oct 12** (all 8 decisions); Act 3 decided Oct 12: Dark Vessels |
| 6 | `act3-dark-vessels` | Oct 16–30 (started early; Act 4 landed early) | G4: Release 3; full 30-minute run-through | spec second version Oct 15: **the Galápagos Marine Reserve** (GFW licence cleared Oct 16), **approved Oct 16** (all decisions; the silent-vessel beat in the run; orchid candidates); G4 moves to Friday Oct 30 (Oct 31 is a Saturday in 2026); spikes `docs/spikes/dark-vessels.md`, `docs/spikes/galapagos.md`; detector, plan, prediction and coverage modules built; day 1 records on file; the cache built (six passes, 110 files) and the agent package written (71 tests), star pass `s1d-20261012t0018` with 4 candidates on both detectors; the `taskings/*` grant written, live at G4; **on its dev runtime Oct 19** (`dark_vessels_dev`, eval 7/7); next the stage (tasks 4 and 5) |
| 7 | `demo-readiness` | Nov 3–7 | freeze Nov 3; runbook, backup videos, prewarm, 2 timed rehearsals | not started |

Act 3 carries a prediction component (the user, Oct 13), about one minute of its eight, written
into the `act3-dark-vessels` spec as a requirement: (1) "where could it have gone": the area a
vessel could reach from its last AIS position at a stated top speed through an AIS gap, tested
against the Sentinel-1 detections inside it; (2) "when can we look again": the next Sentinel-1
pass from ESA's published acquisition plan (availability to check in that spec's spike). No
trained forecasting model and no accuracy claims.

Backlog, in this order, after Dark Vessels and only if the replay cases and rehearsal week are
done:
1. **Archaeologist, bounded discovery** (the user, Oct 14). A mound detector on the 1 m local
   relief model that runs only inside a known site's documented boundary and scores what it
   finds against the record ("the LiDAR shows 23 mounds at Mound City; the record lists 23");
   anything outside the recorded features is never drawn or counted aloud. Needs a boundary
   source per site (the frames are plain 3 km squares; UNESCO component polygons or NPS unit
   boundaries are the candidates) and a design decision added to the archaeologist spec. The
   known-sites-only rule stands: no candidate outside a documented site is ever shown, and
   general scanning of imagery for undiscovered sites is out (PRODUCT.md; looting, NHPA 304,
   ARPA 9, tribal consultation).
2. Forecasting with weather data (the user, Oct 13). Not specced; nothing else waits on it.
3. **Archaeologist, true 3D banks** (the user, Oct 14; spike first). Stand the 3D ground on the
   site's own 1 m DEM instead of the global tiles, so the Great Circle's bank rises out of the
   ground at its real height. Blocked on two things a spike must answer: MapLibre allows one
   terrain source per map, and the 3 km site DEM has no data past its frame, so the ground drops
   off a cliff at the edge. Candidates: a blended terrarium tile (site DEM inside, global tiles
   outside) served from the bucket, or clipping the camera to the frame. The raking light,
   dissolve and cross-section shipped Oct 14 without it.

After the demo (the user, Oct 14; never before Nov 9): **move the three agents to Claude Sonnet
5.5.** The Oct 14 bake-off (`docs/bakeoff/README.md`) kept Sonnet 4.6 for the stage because 5.5
asked a clarifying question on the drawn-polygon prompt and narrates its looks tersely; it was
otherwise 7/8, 12/12, 7/7 and closes a turn six times faster. The move is a prompt retune (a
"never ask, run the default" line and a "say what you see before the next call" line in the
shared RESPONSE STYLE block), `MODEL_ID` on each `.env`, a full bake-off per agent, then the
usual dev → stable promotion. Haiku 5.5 is not on the list.

Cut list if behind (in this order, never touching the foundation, eyes, similarity, replay
cases or rehearsal week): live AIS (keep replay) → Archaeologist shrinks to a 90-second
teaser → Methane keeps only the replay case. (Ground Motion, first on the list, was dropped
Oct 12 when Dark Vessels was chosen for Act 3.)

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
