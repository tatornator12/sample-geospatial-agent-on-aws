---
target: the Stage under Act 4 (AI Archaeologist), before UI work
total_score: 15
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:e655a93d1240460dc757441c0fac018ac38bba92d439af50eeab89d5bff7d229"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx
timestamp: 2026-10-13T18-18-14Z
slug: react-ui-frontend-src-pages-chat-tsx
closed: true
---
Method: dual-agent (A: general-task-execution design review · B: general-task-execution detector + browser)
## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Put it on the map" lands nothing visible; hillshade tile failures at z0–z3 are silent |
| 2 | Match System / Real World | 2 | Raw tool names beside plain ones; no relief legend |
| 3 | User Control and Freedom | 3 | Fly-to, restack, Clear and Stop work |
| 4 | Consistency and Standards | 1 | Breaks the frame rule; inherits the Earth Analyst's prompts and placeholder |
| 5 | Error Prevention | 1 | parseRenderHint rejects the terrain hint (gray, rdbu_r, terrain); LRM renders raw floats; terrain rasters land under the scene |
| 6 | Recognition Rather Than Recall | 1 | No run-sheet prompts |
| 7 | Flexibility and Efficiency | 2 | Prepared row useless for this act |
| 8 | Aesthetic and Minimalist Design | 2 | Answer says everything twice; the map spends the frame on continents |
| 9 | Error Recovery | 1 | Hillshade row checked and "drawn" while drawing nothing |
| 10 | Help and Documentation | n/a | The room never operates the stage |
| **Total** | | **15/36** | **Poor** |
## Design Specificity Verdict
LLM assessment: fails. At rest and after both live turns (Newark Octagon; Great Circle measure) the act is the Earth Analyst renamed: flat Mercator world, Esri satellite, Central Park prepared plates, "Ask about any place on Earth". The camera never leaves the world view; the site never appears on the map; the hillshade shows only as a 228×128 chip. No perspective of its own.
Deterministic scan: `impeccable detect --json react-ui/frontend/src` exit 0, 0 findings. Browser overlay at rest (injection ok, live server :8400 started and stopped): cramped-padding ×3 on .docent-plate (false positive: fixed 32px height, 3 of 5 identical plates flagged), text-occlusion ×1 on MapLibre's "© Esri" under the basemap plate (pre-existing furniture). DOM: prepared plates 14px, session id 12px mono (pre-existing, all acts); Agent/Base/Prepared tracked labels 11–12px (allowed). Facts from the captures: camera on the world after both turns; layer names truncate ("1 m LiDAR hillshade (USGS…"); tables clipped at the column's right edge (turn 2: "MEA", "+1.8", "docu"; DOCUMENTED column never visible); TiTiler URL has a double slash and z0/z1/z3 tile requests fail (minzoom 0, no camera follow); turn 2 said "Put 2 layers on the map" but the plate gained one (transect did not land).
## Priority Issues
1. [P0] The reveal cannot happen: render.ts allowlists lack gray, rdbu_r, terrain; isFinding false so terrain rasters go to the bottom under the scene; followCamera methane-only so no fit and minzoom 0. Fix: allowlist with RAMP_ANCHORS; terrain group is a finding above imagery; follow the camera whenever hint.bounds exists; minzoom from bounds. /impeccable harden
2. [P1] No perspective of its own. Fix: low-oblique 3D ground view (raster-dem terrain from the cached DEM via TiTiler terrarium, verified 0.2–0.6 s/tile; hillshade or relief draped; pitch ~60°, dimmed monochrome basemap, metre scale bar). /impeccable shape, /impeccable animate
3. [P1] No copy of its own: stageCopy has no archaeologist key; STEP_NAMES lacks the four tools. Fix: three run-sheet prompts, placeholder "Name a known site, or ask how they built it", step names "Look up the public record", "Show the 1 m LiDAR", "Measure across the earthwork", "Find sites of the same form". /impeccable clarify
4. [P1] Answer tables cut off in the 380px column (measured vs documented clipped). Fix: two-column tables at most, lead with the room's line; the stage draws the transect from the tool's GeoJSON with mono bank/ditch labels. /impeccable distill
5. [P2] Legends and names: no relief legend; transect did not land; names truncate. Fix: relief legend in words and metres, hillshade key, short titles with provenance in the legend. /impeccable polish
## Persona Red Flags
Presenter: types prompts from memory; would drag the hillshade above the scene live with no sign that tiles failed. AWS architect: 35 s of world map, a thumbnail, a cut-off table; raw function names; agent three not speaking the shared visual contract. Archaeologist/steward: respectful wording, but a world map plus "any place on Earth" implies an open search the act refuses; exaggeration must be stated and copy must stay off the forbidden list.
## Minor Observations
Answer heading prints catalogue aliases as room copy; the Octagon's scene stays on top during the Great Circle turn; the hillshade chip is half scrolled off when the answer lands; "on AgentCore" 13px tracked (allowed).
## Questions (answered from the brief; the user asked for no check-ins)
1. Rest state: the 28 catalogue sites as fog marks over the eastern US; the first prompt dives to the ground. 2. Peak: the hillshade landing on the tilted ground over the dimmed scene; swipe stays as the follow-up. 3. Relief ×3 printed on the legend row; shading from the true DEM; the transect carries "how big".
