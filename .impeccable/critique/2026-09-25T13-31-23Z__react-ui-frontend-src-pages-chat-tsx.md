---
target: the Stage with the Methane Hunter selected
total_score: 20
max_score: 36
na_heuristics: 9
p0_count: 2
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:21314838a6796a1dbe7a83de35548d6aaa5b87d7b42208ef07dec7ac742f03e6"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx
timestamp: 2026-09-25T13-31-23Z
slug: react-ui-frontend-src-pages-chat-tsx
closed: true
---
Method: dual-agent (A: general-task-execution, design review · B: general-task-execution, detector)

# Critique: the Stage with the Methane Hunter selected (Sep 25, 2026)

Target: `react-ui/frontend/src/pages/Chat.tsx` (MapView layers plate + map layers, ChatSidebar step column / caption band / console / prepared prompts, utils/evidence.ts). Visual truth: 1920×1080 headless captures of a live two-beat run on the local dev UI (`/tmp/methane-shots/`). Browser overlay skipped: no browser automation tool exposed.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Steps and working dots are good; the map never shows where the work landed |
| 2 | Match system / real world | 2 | Raw tool names; caption gives 31.88°N, 101.78°W instead of Midland; "(dev)" shown to the room |
| 3 | User control and freedom | 3 | Stop/Esc, Clear, per-row remove all present |
| 4 | Consistency and standards | 2 | Plume raster filed under Satellite imagery, detections styled as cyan boundaries; beat-2 caption runs 4 lines |
| 5 | Error prevention | 2 | Five Earth Analyst prompts one click away while Act 2 is live |
| 6 | Recognition rather than recall | 1 | No legend, no rank on the map; rank 1 looks like rank 39 |
| 7 | Flexibility and efficiency | 2 | No fly-to-finding; no prompts for this agent |
| 8 | Aesthetic and minimalist design | 2 | Detected + ranked footprints stack as double cyan outlines; layer titles wrap to 3 lines |
| 9 | Error recovery | n/a | No error occurred in the run |
| 10 | Help and documentation | 3 | Transcript carries the full record |
| **Total** | | **20/36** | **Acceptable (56%)** |

## Design Specificity Verdict

LLM assessment: generic. Nothing on screen says Act 2 beyond the agent label and caption text: 39 identical cyan outlines under "BOUNDARIES", the Earth Analyst's prompts and placeholder. The shell (plates, amber discipline, step column, caption) holds; the act has no look of its own.

Deterministic scan: `impeccable detect --json react-ui/frontend/src` exit 0, 0 findings; `npm run design:check` exit 0; no inline ignores. The detector judges CSS/markup craft, which is sound; every problem here is in data presentation and choreography, which it cannot see. Detector and review agree the shell is clean; the review found everything else.

## Overall Impression

The platform works and the shell is disciplined, but the act's peak (the invisible made visible: an 8,130.7 ppm·m plume in plasma, then the ground under it) is narrated, not shown. The map never moves; the rank-1 raster is a ~10 px dark speck at basin zoom on ochre imagery while the caption describes its yellow-white core. Biggest opportunity: camera + contrast for the plume beat.

## What's Working

- Step column + Sentinel-2 evidence chip under "06 inspect image": the most authored moment on screen.
- Caption voice: tabular mono numbers with units, honest limit sentence ("EMIT sees the methane, not its source.") lands as the end.
- Plate language and one-spotlight discipline hold across four plates; the second agent fits the shell, which is the platform story.

## Priority Issues

1. **[P0] The plume beat has no camera.** Map stays at basin extent across 1b → 2a → 2b. Fix: fly to the rank-1 footprint bbox (padded, clear of the caption band) when a methane raster lands; to the 3 km bbox on the ground step. Not in design §5. Command: animate, layout.
2. **[P0] The plume is invisible at basin scale and on this basemap.** Plasma's dark end on desert ochre, 2 km² at basin zoom, 0–1500 rescale vs an 8,130 peak. Fix: dim the basemap while a methane layer is active; label "#1 · 8,131 ppm·m · Midland"; legend shows "1500+" cap. Command: colorize, bolder.
3. **[P1] The ranking is not on the map.** Fix: planned graduated footprints + rank labels, plus ranked REPLACES detected (no stack), labels only for the top 3–5, detected tier as fog hairlines (dark plasma lines vanish on desert). Calms the real ~70 km granule 20240127T195904 that runs under the caption. Command: distill.
4. **[P1] Wrong-agent chrome.** Earth prompts, "Ask about any place on Earth", "(dev)". Fix: per-agent prompts (planned), per-agent placeholder, hide "(dev)" on stage. Command: adapt.
5. **[P2] Step column and captions read like logs.** "create bbox from coordinates", three "display visual" rows; plume's own inspect chip missing (root cause confirmed: `evidenceUrlsFor` only accepts `session_data/` sources, the plume lives in `methane/cache/`, while the inspection PNG is saved under the session); caption uses coordinates (reverse_geocode did not run in the UI beat 1) and beat 2's closer is 4 lines with a description (agent-side HARD RULE 2 slip on a follow-up prompt the eval does not cover). Command: clarify.

## Persona Red Flags

- Presenter: five wrong prompts a mis-click away; must point at an unseen speck; transcript drawer clips the caption band ("…in 2024 pe"); nothing confirms the raster rendered.
- Technical leader, back row: "which is the strongest?" is unanswered by the map; coordinates they cannot place; a caption describing colours they cannot see reads as the model making things up; "dev" undercuts production-grade.

## Minor Observations

- Four amber checkboxes + Send: allowed, but a methane row with a legend should carry the accent.
- "PREPARED" label and session id sit low-contrast over busy imagery.
- Layer title "Sentinel-2 True Colour — … 2023-12-28 - Dec 27 2023" duplicates the date.
- Cyan contradicts DESIGN.md: detections are not boundaries.

## Questions to Consider

- Should Act 2 default to a dark or muted basemap, since plasma only reads on dark ground?
- If the map flew to the plume itself, would the caption still need to describe colours?
- Is 39 the story, or is 3?
