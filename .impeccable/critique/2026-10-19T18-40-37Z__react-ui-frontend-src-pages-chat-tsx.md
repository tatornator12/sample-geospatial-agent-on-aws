---
target: the Stage under Act 3 (Dark Vessels), round 5 prototypes
total_score: 20
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx"
target_fingerprint: "sha256:119f267b757e27b878cdc9632b3489b0c06fb92c236154094f55f7359102d075"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/react-ui/frontend/src/pages/Chat.tsx
timestamp: 2026-10-19T18-40-37Z
slug: react-ui-frontend-src-pages-chat-tsx
---
Method: dual-agent (A: design review of the r5 prototype captures, below · B: detector, 0 findings). Persisted Oct 19 after the build.

# Assessment A: design review, Act 3 "Dark Vessels" stage (round 5 prototypes, pre-build)

What I checked: PRODUCT.md, DESIGN.md, the surface brief, the act3 design.md (§9, §11, run sheet, decisions 7/10/11) and requirements.md (req 9, 10, 12). I viewed all the listed r5 captures plus three sweep frames, and skimmed MapView.tsx (rest views are state flags keyed off landed layers: `globeOn`, `groundOn`, `reliefOn`, `restOn`). I measured pixels in the PNGs (contrast, glyph heights, where the brightest pixels sit) and simulated colour-vision deficiency on the act's colours.

What I could not check: real motion (I only had stills and three sweep frames), the projector, the step column, layers plate and tasking plate over these frames, and the plate's actual font file. Every capture still shows Act 1 chrome: the switcher says "Earth Analyst (stable)", the prompts are Act 1's, and the base plate says "Esri satellite".

## Design specificity verdict (unanchored)
**Specific, but the motion carries it.** No other act could use this frame. The night chart, the islands as silhouettes, the three-day AIS long exposure and the radar strip laid on the sea are Act 3's own. They are clearly distinct from Act 1's flat imagery, Act 2's globe in space and Act 4's dusk oblique.

Two caveats:
- **In a still, the ground looks generic.** It reads as a dark ocean basemap with tracks. It is flat and north-up like Act 1, and Act 1's Esri imagery also shades the ocean in blue. Take the motion away (reduced motion, the frozen claim beats, a paused recording) and the identity drops to "ocean basemap". The frozen beats need their own signature: the radar strip and the rings, not the wakes.
- **"From below" never reads.** It is a night chart seen from above. That's fine; name it for what the room sees.

The rest frame is the strongest still in the act. The candidates frame is the weakest, because the brightest things in it are not the argument.

## Heuristics (0–4; 10 is n/a, so the max is 36)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | The plate says "Sentinel-1D radar … held at the pass" at sweep frame 00, before any radar has arrived. The sweep reveals in ten hard steps with no leading edge, so it reads as tiles loading. The claim beat has no count. |
| 2 | Match with the real world | 3 | "Where AIS was heard", "unproven: AIS not heard here" and "next look" are the officer's own words. The weak spots are "box %: its share of them", and the heat legend calling history "radar targets with no AIS" without the coverage condition. |
| 3 | User control and freedom | 2 | The presenter cannot pause or scrub the replay, and cannot step back a beat (show the grey claim again) except by digging in layer toggles. "Not now" on the tasking is specified. |
| 4 | Consistency and standards | 2 | Orchid means both today's candidates and the history heat. The dashed fog hairline means three things: the reserve, the islands' coasts (the reserve's holes) and the next pass's swath. `seen_once` is a faint dot, which breaks the act's own rule (ring = radar, dot = AIS). Prose is set in mono on the plate and area labels, against the Two Voices and Tabular rules. |
| 5 | Error prevention | 2 | The logic gates are strong: the stage owns the styles, numbers come from the tools, forbidden phrases are checked in the tools. But the prototype plate already says "31% of the reserve" while the tool is 29.8% and the run sheet says 30%. The plate isn't wired to the tool. |
| 6 | Recognition rather than recall | 2 | The camera goes close (claim) → wide (coverage) → close (candidates), so the room must remember where the grey rings were to see them turn. Legends live in a 15 px layers plate. T-ids carry no status. |
| 7 | Flexibility and efficiency | 3 | Four prepared prompts in run order, a replay case, keyboard paths and a pre-warmed runtime are all specified. |
| 8 | Aesthetic and minimalist design | 2 | The candidates frame carries about 13 layers when the argument needs 4. Wakes, dashed coasts, the radar's near-range wedge, the hatching and the heat haze all compete. |
| 9 | Recognise and recover from errors | 2 | "Unproven" is a designed outcome, which is good. What the map shows when `match_ais` refuses (no GFW data) is unspecified: grey rings forever, the plate saying what? |
| 10 | Help and documentation | n/a | The room never operates the stage. |
| | **Total** | **20 / 36** | |

## Cognitive load
**Checklist: 4 of 8 fail (high).**
- **Single focus fails.** In the candidates frame, 0.5% of pixels are the brightest. Of those, 4,792 of 10,369 (46%) fall at x 480–720, in the radar's near-range wedge over empty water. The candidates sit at x 900–1500.
- **Visual hierarchy fails.** By luminance (L), the radar wedge is 0.19, the traffic wakes 0.08 and the lit heard water 0.045 (the candidates' own background). The orchid rings come about fourth in what the eye reaches.
- **Working memory fails.** Ring identity is lost across camera moves. The 7% box share is spoken against the 45% check. In the silent-vessel beat (spec'd, not built) the room has to keep 2024 apart from 2026.
- **Minimal choices fails, as specified.** See the tasking below.
- **These pass:** chunking (the candidates form two spatial clusters of 3 and 4, though T05 and T06 overlap), grouping, one thing at a time (the beat order is the design's best idea), and progressive disclosure (grey first, colour after coverage).

**Decision points with more than 4 options:**
- **The tasking as spec'd: 12 controls.** 3 boxes, up to 7 candidate toggles, Approve and Not now.
- **The layers plate in this act:** about 10–12 layers by 6:00 (radar, targets, heard water, unproven water, heat, boxes, next pass, fleet, reserve, ports, AIS, reachable area). It also shares the right column with the tasking plate, so that side becomes a wall of two plates.

## Emotional journey
- **0:00 rest: calm wonder.** This is the best opening in the show, provided the replay's loop seam crossfades (the clock jumping back three days looks like a glitch).
- **0:20 the pass:** should be the first peak (the satellite arrives). It is currently a stepped reveal, which risks a valley.
- **1:00 the claim:** should be suspense ("who is unaccounted for?"). It is flat, because nothing on screen visibly changes state.
- **1:40 coverage:** the intellectual peak for technical leaders ("we checked whether we *could* hear before we accuse"). It currently reads as "another layer".
- **2:10 candidates:** the visual peak, and the orchid turn works. It comes early.
- **4:20 hotspot and 5:20 fleet:** sag. The heat is a pink glow with no drawn claim. The fleet's punchline ("in 2026 it did not come") has no drawn absence, just a small pale cloud off Peru that reads as weather.
- **6:00–7:10 the end:** the decision and the close line, neither prototyped. Peak-end says this is what the room keeps. Right now the act's strongest image is at minute 2 and its end is a plate.

## What's working
1. **Its own way of seeing.** The long-exposure network between the islands, the dark silhouettes and the frozen sea for the claim are something no other act has. They make radar-versus-AIS legible as a concept before a word is said.
2. **The argument's order is enforced by the stage, not the model.** Unmatched targets stay plain label-grey rings with no label until coverage lands. "A ring is what the radar saw, a dot is what AIS heard" is a shape grammar that survives colour loss. Colour discipline holds in every frame: no amber on the map (only the Send button and the Stage tab), no red, and the fleet's heat in the AIS hue keeps "cyan = AIS heard it" true.
3. **One plate, top centre, says what the room is looking at, dated.** "AIS replay 2026-10-12 00:17 UTC", "Where AIS was heard … 31% of the reserve", "7 candidates radar targets with no AIS, in heard water". It's the right device and the right copy instinct. It is just too small and set as mono prose (issue 4).

## Priority issues

### 1. [P0] The claim beat shows no claim, and the camera breaks the grey-to-orchid turn
- **What:** In 3_claim, a claimed target is a fog ring (#e9eef3) with a 10–15 px tie to an AIS head. An unclaimed one is a label-grey ring (#8fa3b8). Both are 22 px rings at about 1.5 px stroke; from the back row they are the same mark. The three-day wakes are the same colour and weight as the ties, and they run straight through the rings (T06, T07 and T04 all sit on wakes in 4b). Port boats are an unlabelled 10 px square. The plate carries no counts. Then 4a pulls the camera out and 4b pushes it back in.
- **Why it matters:** The run sheet gives this beat 40 s, and the presenter will be narrating an event the room can't see. A wake through a candidate ring reads as "a vessel's track reaches it", which is the opposite of the finding. Without a held camera, the room cannot see the *same* grey rings turn orchid, and that turn is the act's thesis.
- **Fix:**
  - **When the AIS freezes:** wakes drop from 13% to 4%, comet tails go off, and heads stay at the pass minute at 70%.
  - **Claim animation:** each claimed ring fills to an 8 px fog disc, a 2 px fog tie draws to its head over 400 ms (ease-out), then the pair dims to 45% after 800 ms. Explained marks recede.
  - **Ports:** a 10 px fog square, plus one 17 px label per port ("3 at port").
  - **Unexplained:** a 24 px label-grey ring, 1.5 px, no label.
  - **Plate:** "22 radar targets · 9 broadcasting · 3 at port · 10 not yet explained", with the numbers from `match_ais`.
  - **Camera:** hold one camera from the claim through coverage and candidates (the 3_claim framing already holds the heard and unproven shapes).
- **Command:** `/impeccable distill` (strip the wakes and ties down to the states), then `/impeccable animate` for the claim tie.

### 2. [P0] The hotspot heat paints history in the candidates' colour, so the stage calls water dark without a coverage check
- **What:** The heat ramp is orchid, the candidates' hue. Its source is GFW unmatched detections since 2023, with no heard-water rule, and the plate calls it "Radar targets with no AIS". In 5_hotspot, the T01 ring inside box 1 sits at 1.38:1 against the heat, and T02 at 2.2:1. The heat's 2.2-cell blur reads as glow, not data. The measured claim (top 5% of water held 45%) is not drawn anywhere. Box labels are "1 7%" at 18 px. One "next look Sentinel-1D Oct 17 00:25 UTC" label floats unanchored, and its swath is a dashed fog hairline identical to the reserve's boundary. That swath covers box 2 only.
- **Why it matters:** PRODUCT says coverage gaps are not evidence on their own. Here the act's only data colour, which so far meant "passed the coverage check", is spread over a third of the reserve. The room reads pink water as "where the dark vessels are", and a technical leader who reads the plate sees the rule broken. "7%" next to the spoken "45%" also sounds weak.
- **Fix:**
  - **Heat:** draw it as a fog density field (dome to fog, 30% at most). Add two contour lines, top 5% and top 10% of the water, the top-5% line labelled at 18 px: "top 5% of the water · held 45% of later dark targets". Orchid stays exclusively today's candidates, drawn on top with a 2 px dome under-stroke.
  - **Boxes:** each gets its own two-line label: 24 px mono "1 · 7% of past dark targets" over 17 px "S1D Oct 24 00:17 UTC".
  - **Next pass swath:** a 2 px fog line at 60% with a 6% fill, labelled at its edge, never dashed like the reserve.
- **Command:** `/impeccable colorize`.

### 3. [P1] The luminance budget is inverted: radar clutter, wakes and lit heard water outshine the candidates
- **What:** The single shared dB stretch leaves the near-range incidence gradient burning (L 0.19 at x 480–720 in 3 and 4b). Heard water is "lit softly" (L 0.045), and every candidate sits on heard water by definition. Measured orchid stroke against its immediate background in 4b: T01 2.6:1, T02 3.2:1, T03 3.7:1, T04–T07 4.5:1. A projector roughly halves these. The rest frame's ground is all at the floor: abyss L 0.006, platform 0.009, island interior 0.008. Islands against sea is about 1.1:1, and they survive only by their halo and the dashed coast, which is the reserve's holes drawn dashed and reads as a broken, glitchy coastline.
- **Why it matters:** The eye goes first to empty sea at the top-left of the strip. A radar-literate viewer recognises an un-normalised incidence gradient and marks the processing down. On a projector with room light, the rest frame's relief and silhouettes flatten into one slab.
- **Fix:**
  - **Radar display:** flatten the display COG across range (divide by a smoothed along-range mean) so sea clutter sits in one low band (about #2b3d4c to #3a5060, L ≤ 0.04). Only returns more than 6 dB over the local mean go towards fog. After the claim, drop the radar to 60%.
  - **Coverage:** don't lighten heard water. Darken unproven water (dome at 35%) and hatch it at 2 px every 14 px in 30% fog; 1 px hatching disappears on a projector. Outline heard water at 1.5 px in 50% fog.
  - **Ground:** lift the platform near the islands to about #1a3a50 so silhouettes reach 2:1 or more. Draw only the reserve's outer ring dashed; coasts get a solid 1 px fog line at 30%.
  - **Target:** candidate rings at least 4.5:1 against their background on the monitor.
- **Command:** `/impeccable quieter` (radar, wakes, coverage fill).

### 4. [P1] The Back Row Rule fails on every word the argument depends on
- **What (measured):**
  - Plate cap height is 10 px, so about 14 px type.
  - Candidate labels are about 16 px.
  - "heard water" and "unproven: AIS not heard here" are about 15–16 px, in mono, with blotchy glyph halos over the bright radar.
  - Box labels are 18 px; "next look" is about 15 px.
  - The plate is one tracked mono line with multi-space separators (`white-space: pre`), which reads as console prose.
  - The coverage plate says 31%; the tool says 29.8% and the run sheet says 30%.
- **Why it matters:** DESIGN.md says anything the room must read is 24 px or larger. The plate *is* the beat's caption ("7 candidates", "30% of the reserve"), and at 14 px it reads as a grey bar from the back. Mono prose breaks the Two Voices Rule and leans towards the console look the presenter has banned. A rigor act showing 31% while the presenter says 30% gives a technical leader the one discrepancy they will remember.
- **Fix:**
  - **Plate as two lines:** line 1 at 24 px fog, mono for numbers and dates, Atkinson for words ("7 candidates"). Line 2 at 17 px Atkinson, label grey ("radar targets with no AIS, in water where AIS was heard · candidates, not accusations"). Max width 760 px; every number bound to the tool's own field.
  - **Area labels:** 20 px Atkinson, weight 600.
  - **Candidates:** 30 px rings, 3 px orchid stroke, 18% orchid fill and a 2 px dome halo; labels 20 px mono weight 600.
  - **Island names:** 17 px label grey.
- **Command:** `/impeccable typeset`.

### 5. [P1] The two unprototyped beats carry the act's second story and its ending; spec them before the build
- **What the silent vessel (3:20) needs:**
  - **Hard date reset:** the Oct 12 layers go hidden (kept in the plate), and the plate crossfades over 600 ms to "Earlier pass 2024-03-06" at 24 px. If the room links the 2024 target to today's T01–T07, the beat has failed.
  - **The vessel's own track:** cyan, ending in a fog dot (AIS = dot) with "AIS off, 12 h before the pass" at 18 px.
  - **The reachable area, grown by water** over about 3 s, with the plate counting "+0 h → +12 h". Frame it so an island visibly splits the front: that bend is the "by water" proof. Draw it as a 1.5 px fog line with an 8% fill, labelled "reachable by water at 6 kn in 12 h, 133 km".
  - **The target inside:** a neutral fog ring, not orchid, so the pairing never reads as a match, labelled "radar target, 51 km from where it went quiet".
  - **The reveal last:** a second fog dot, "AIS back on, 30 h later, 26 km away", with no line between off and on (a line implies a route).
  - **Line 2 of the plate:** "I cannot say which, if any, of these it is."
  - At most 4 labels.
- **What the tasking (6:00) needs:**
  - **The draft's box pre-selected**, so the live act is one deliberate change (drop a candidate) and Approve.
  - **Selection:** an amber 2 px outline with an 8% amber wash. It is the officer's action, so amber is correct, the same as drawn shapes. Never amber on a candidate.
  - **A dropped candidate changes shape, not colour:** ring at 35%, dashed, label "T04 left out".
  - **Hit areas of 44 px or more** (T05 and T06 overlap at about 16 px apart), and a keyboard path through the plate's list.
  - **The plate:** "Box 1 · 6 of 7 candidates · S1D Oct 24 00:17 UTC, in 7 d 14 h" in mono 24 px, primary "Approve the tasking", quiet "Not now".
  - **Approving moves amber off the map:** the box goes to solid fog with "Filed", and the plate says "Filed by the officer at … UTC. The agent did not file it."
  - **Bookend:** on approve, the next pass's swath sweeps across the chosen box with the same motion as the opening sweep.
  - **Placement:** the tasking plate shares the right column with a tall layers plate, so collapse the layers plate's legends during the decision.
- **Why it matters:** These are the end the room remembers, and the decision that has to be visibly the officer's. Improvised at build time, they will inherit issues 1–4.
- **Command:** `/impeccable shape` (both beats), then `critique` on their prototypes.

## Persona red flags
**The presenter at the podium**
- The sweep is 2.5 s, shorter than one sentence. Make it 3.5–4 s, smooth, with a 2 px fog leading edge and a soft 120 px trailing gradient. Targets should pop as the edge passes; they don't in sweep_08 or sweep_16.
- During the claim beat there is nothing to point at.
- The camera moves three times in 70 s.
- The candidate rings are 22 px click targets, and two overlap.
- The replay can't be paused to point at a ferry.
- When Send is pressed, the replay must run forward to the pass minute (spinning clock, which also fills the wait) rather than jump to it.
- The base plate still offers "Esri satellite", which would destroy the act's look if touched. Lock it, or relabel it "Seabed".

**A technical leader in the back row**
- Can't read the 14 px plate.
- Sees 31% while hearing 30%.
- Sees the incidence gradient and dashed coasts as artefacts.
- Will ask:
  - "What about targets only one detector saw?" `seen_once` is never explained on screen; add "9 seen by one detector only, set aside" to line 2 of the claim plate.
  - "Is the heat map the same rule as the candidates?" It isn't.
  - "Why is the best box 7% when the map holds 45%?"
  - "Why do four of seven candidates sit outside every patrol box?"

**A colour-blind viewer**
- **Deuteranopia (simulated):** orchid becomes about (155,171,212). That is ΔE 13 from label grey and ΔE 13 from the AIS cyan, so the grey-to-orchid turn nearly vanishes and candidates look like AIS. Orchid's luminance (0.374) is about the same as label grey's (0.35), which is why. The turn must be carried by shape, size and fill (issue 4), and the unexplained grey ring should be dimmer.
- **Protanopia:** ΔE 27–32 between those pairs. Weak.
- **Tritanopia:** orchid and amber come out ΔE 13 apart. Relevant to the tasking's amber selection beside orchid rings, which is another reason a dropped candidate changes shape, not colour.

## Minor observations
- The file names look swapped: 2a_radar_grey shows the tinted render and 2b_radar_tint the raw grey. The raw grey burns the islands white and breaks the silhouettes; build the tinted one.
- `seen_once` as a "faint dot" contradicts "a dot is something AIS heard". Make it a 12 px dashed ring at 40%.
- The radar mosaic has a notched edge where two frames meet (top of the strip). Frame the strip with a 1 px fog hairline and the label "Sentinel-1D swath". Reserve water outside the pass is a third, unlabelled state in the coverage beat: dim it and say "the radar did not look here".
- No GFW attribution is visible in any capture (req 12.4). The MapLibre attribution text is about 12 px; consider putting "Data: Global Fishing Watch" on line 2 of the plate whenever GFW data is drawn.
- The fleet heat reads as cloud. Draw it as visible 0.1° cells in the AIS hue. Draw the expected season too: a dashed fog contour near the Galápagos, "where it fished Jun–Sep, 9 of 9 years", against "2026: off Peru", plus a 1,000 km scale bar in mono. The absence is the punchline, so draw it.
- Plate copy: "box %: its share of them" should become "box: its share of past dark targets". Use middots instead of runs of spaces.
- The AIS replay at rest is a second exception to "motion only where the agent works" (the globe drift is the first). Name it in DESIGN.md.
- With the step column up, the frames mostly fit the free window (about x 397–1568). San Cristóbal's label (x 1539–1636 in 5_hotspot) and the heat's east lobe run under the layers plate.

## Provocative questions
1. The hotspot is the one place on the stage where water is called dark without a coverage check, in the candidates' own colour. Is the act's rule a rule, or only a rule for today's pass?
2. Four of the seven candidates (T04–T07, round San Cristóbal) lie outside all three patrol boxes. When the officer approves box 1, what does the room conclude about the other four? Should a box be allowed to come from today's candidates, not only from history?
3. The act's signature is motion, yet the sea freezes for most of its eight minutes and the act ends on a plate. What if the end is the next pass sweeping across the chosen box with its countdown, so the act opens and closes with the satellite? And if the radar's job is to show targets, why show the room the sea clutter at all?

## After the build (Oct 19, dev v6, headless captures at 1920, 1728, 1512 and 1280)
- P0-1 (claim beat): the claim is marked at detect_vessels with a count on the clock ("22 radar targets · 4 accounted for by a broadcast · 3 at port · 15 not yet explained"); the camera holds through the grey-to-orchid turn; the candidates wait for the coverage, then 1.4 s.
- P0-2 (heat in the candidates' colour): kept orchid by the user's pick; mitigated with the heat at 0.75, a dome halo under the rings, the clock's "the heat is history, not today's candidates", and the forecast drawn after the coverage. Open with the user (fog heat as the alternative).
- P1-3 (luminance): coverage dims under the forecast and fleet beats; wakes held at 0.05 to 0.13.
- P1-4 (Back Row Rule): every stage label 15 px or more (clock 24/17, boxes 18, candidates 16).
- P1-5 (the two unprototyped beats): the silent vessel and the tasking built and captured; the reach fades in rather than growing by water (open).
- Tasking selection is fog, never amber: amber is the Approve button's alone (One Spotlight Rule), against the review's amber selection.
