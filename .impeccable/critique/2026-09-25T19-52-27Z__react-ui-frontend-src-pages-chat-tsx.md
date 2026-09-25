---
target: the Stage during the Methane Watch mission
total_score: 17
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:12762e0d3494efb2cfab39259a8ce7e59e91b6b92146ed075d46c8752bfd47f0"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx
timestamp: 2026-09-25T19-52-27Z
slug: react-ui-frontend-src-pages-chat-tsx
closed: true
---
Method: dual-agent (A: general-task-execution, design review · B: general-task-execution, detector)

# Critique: the Stage during the Methane Watch mission (Sep 25, 2026)

Target `react-ui/frontend/src/pages/Chat.tsx` (MapView, ChatSidebar, StepColumn). Visual truth: 1920×1080 frames of a live local mission run on `methane_hunter_dev` v7 (75 s). Browser overlay skipped: no browser automation tool exposed.

## Design Health Score: 17/36 (47%, Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 2 | Steps work; the map does not change while the agent works (t008–t020 identical) |
| 2 | Match real world | 2 | "scan tropomi", "site history"; caption "W3 — CHECK:" |
| 3 | Control | 3 | Stop/Esc, prepared plates |
| 4 | Consistency | 1 | Baseline filed under Boundaries; one plasma ppm·m ramp shown under the ppb TROPOMI row |
| 5 | Error prevention | 1 | A ~4 km TROPOMI cell becomes a viewport-sized pale-yellow wall over the ground and the candidate |
| 6 | Recognition | 2 | The plan appears once in the caption, then collapses into "+12 earlier" |
| 7 | Efficiency | 3 | Prepared plates |
| 8 | Minimalism | 1 | Final frame: flat yellow wall, muddy plates |
| 9 | Error recovery | 2 | "I cannot confirm" lives only in the transcript |
| 10 | Help | n/a | The audience never operates the UI |

## Design Specificity Verdict
Shell specific; act generic. The final frame is the act's worst. Detector: `impeccable detect --json react-ui/frontend/src` exit 0, 0 findings; `design:check` exit 0; no inline ignores. Every issue is data presentation and choreography.

## Priority Issues
1. [P0] TROPOMI anomaly raster covers the stage at ground zoom (single ~4 km cells saturate to the top of the ramp). Fix: hide it above zoom ~8, cap opacity, keep it under EMIT and never over Sentinel-2. (harden)
2. [P0] The human decision is not on the stage ("Status: DRAFT…" only in the transcript). Fix: the brief card as the end frame, with confidence words and Approve / Request another look. (shape, polish)
3. [P1] Plan and fan-out do not read (7 identical "scan tropomi" rows). Fix: pinned plan strip (Baseline · Tip · Cue · Brief, one lit); grouped fan-out step "Scan 7 watch areas" naming the areas; watch areas lit on the map. (distill, animate)
4. [P1] Adapt and self-check invisible (rejections only in the transcript; "strong signal" adjective). Fix: adapt line on the cue step; filmstrip with the reject reasons in words at ≥ 15 px; no step labels or adjectives in captions. (clarify)
5. [P2] Legends and units: one legend row per ramp; baseline in the Methane group (Dim Rule); TROPOMI ramp clearly different from plasma (magma is the same family). (colorize)
6. [P3] Hygiene: "Put it on the map" ×5, "+12 earlier" below the 15 px floor, layer names wrapping, em dashes in agent copy, "(dev)" in the switcher. (polish)

## Persona Red Flags
- Presenter: 30 s of an unchanged world map; the end frame pushes them into the transcript.
- National-security leader: asked "how confident" and sees no confidence on stage; no visible who-approves.

## Questions to Consider
- Which single frame should the room remember: the ringed globe or the brief with its empty decision?
- Do 3D columns over a named settlement contradict "EMIT sees the methane, not its source"?
- Should the map carry the fan-out (7 areas lighting at once) and the column become the log?

Questions skipped: the user asked to finish the remaining work before testing; the recommendations above are applied as the plan (planned globe, filmstrip, columns, brief card, plus fixes 1–6).
