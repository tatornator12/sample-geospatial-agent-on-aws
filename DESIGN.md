---
name: Agentic AI for Earth
description: A planetarium show for geospatial agents; one luminous Earth in space, a docent's answers, one amber spotlight.
colors:
  dome: "#0f141b"
  plate: "#161c25"
  plate-raised: "#1d2530"
  fog: "#e9eef3"
  label-grey: "#8fa3b8"
  spotlight-amber: "#f5a524"
  spotlight-amber-hover: "#ffbd4f"
  amber-wash: "rgba(245, 165, 36, 0.16)"
  hairline: "rgba(233, 238, 243, 0.14)"
  hairline-strong: "rgba(233, 238, 243, 0.24)"
  hover-wash: "rgba(233, 238, 243, 0.06)"
  signal-error: "#ff7a70"
  signal-success: "#7bd88f"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bricolage Grotesque, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  answer:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Bricolage Grotesque, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "8px"
  plate: "10px"
  lg: "12px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.spotlight-amber}"
    textColor: "{colors.dome}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.spotlight-amber-hover}"
    textColor: "{colors.dome}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.label-grey}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 14px"
  button-quiet-hover:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.fog}"
  button-on:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.spotlight-amber}"
    rounded: "{rounded.md}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.signal-error}"
    rounded: "{rounded.md}"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.fog}"
    rounded: "{rounded.plate}"
    padding: "14px 16px"
  plate-title:
    textColor: "{colors.label-grey}"
    typography: "{typography.label}"
  label-plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.fog}"
    rounded: "6px"
    height: "32px"
    padding: "0 12px"
  label-plate-hover:
    textColor: "{colors.spotlight-amber}"
  stage-answer:
    textColor: "{colors.fog}"
    typography: "{typography.answer}"
    padding: "12px 0 8px"
  input-console:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.fog}"
    rounded: "{rounded.lg}"
    padding: "8px 8px 8px 16px"
  nav-rail:
    backgroundColor: "{colors.dome}"
    textColor: "{colors.fog}"
    height: "56px"
    padding: "0 24px"
  nav-item-active:
    textColor: "{colors.spotlight-amber}"
---

# Design System: Agentic AI for Earth

## Overview

**Creative North Star: "The Planetarium Show"**

An exhibit hall after hours. One luminous Earth fills the room, and the agent is the docent whose answers appear only when they add meaning. The screen is a stage read by an audience of technical leaders from the back of a room, not a workstation read by its operator: the map runs edge to edge, the rails around it never reflow, and everything the agent does lands as a numbered step or a spotlit finding pinned to the place it belongs. The presenter types one line or picks a prepared prompt; the room never needs the transcript.

The world refuses the two default arrangements of the category. It is not a dark dashboard of panels with a chat column, and it is not a light SaaS chat with a map in a card. It is also, by the presenter's own words, never a hacker console: no phosphor green, no monospace walls, no blinking cursors. Materials are a matte deep blue-grey surround, soft spotlight falloff, and exhibit label plates framed by hairlines. Colour is spent with discipline: one amber accent marks whatever is active, and data colour lives only on the layer being looked at.

Density is low and sizes are large. Nothing on the stage sits below 15px, the agent's answer sits at 19px at the foot of the step column (22px on very large screens), and numerics are tabular so columns of coordinates and dates align. Motion follows one grammar: an exponential ease-out from a visible default, used where it shows the agent working and nowhere else. The one exception is the watch globe, which drifts slowly at rest (1.5° a second) and speeds up while the agent works, so the speed-up itself says "working".

**Key Characteristics:**
- Map-first: the canvas fills the frame; every control is a plate floating over it.
- One accent: spotlight amber marks the active act, step, layer, finding or primary action.
- Exhibit plates: mid-dark panels with hairline frames, blur, and a real shadow.
- Hyperlegible type at projector sizes; Bricolage Grotesque only for titles and labels.
- Tabular mono for every number, coordinate and identifier.
- Motion only where it shows work happening (steps arriving, plates rising, the working dots).

## Colors

A deep blue-grey dome with fog-white text and a single warm accent; hairlines rather than borders, washes rather than fills.

### Primary
- **Spotlight Amber** (#f5a524): the only accent. The active section on the exhibit rail, the lit step marker, the primary Send button, the active draw mode, checked toggles, focus rings, drawn shapes on the map, and the docent's speaker label. Hover brightens to **Warm Amber** (#ffbd4f). **Amber Wash** (rgba(245, 165, 36, 0.16)) backs selected rows and "on" toggles so the accent can sit behind text without shouting.

### Neutral
- **Dome** (#0f141b): the ground. Page background, the exhibit rail, and the text colour on amber buttons. Behind the watch globe the ground is space: a deep navy radial (`#0c1422` to `#070a10`) with 220 still stars (fog and a pale blue, 18–85% opacity, a seeded field so every load shows the same sky), and a thin `#2b4a66` atmosphere at the globe's limb that fades out by zoom 7.
- **Plate** (#161c25): panels that float over the map (step column, console, layers, draw rail, basemap), usually at 88–96% opacity over a backdrop blur.
- **Raised Plate** (#1d2530): popups and nested surfaces one level above a plate.
- **Fog** (#e9eef3): primary text and icons; the agent's answer.
- **Label Grey** (#8fa3b8): secondary text, plate titles, quiet controls, placeholders, and the names of hidden layers. Tinted from the dome, never a neutral grey.
- **Hairline** (rgba(233, 238, 243, 0.14)) and **Strong Hairline** (rgba(233, 238, 243, 0.24)): etched rules and plate frames. The strong value marks focus-within on the console and the outline of secondary buttons.
- **Hover Wash** (rgba(233, 238, 243, 0.06)): the only hover treatment on quiet controls and rows.

### Signals
- **Signal Red** (#ff7a70): errors and the Stop / Clear-drawing actions. Used as text on a transparent button, never as a fill.
- **Signal Green** (#7bd88f): completed states in the step column and tool timeline.

### Data colour on the map
Map layers keep their scientific palettes: the RdYlGn change-scan ramp, cyan boundaries and hotspot outlines, purple protected areas, and the similarity ramp (a single violet hue from `#e8dcf5` to `#5b2a86`, lighter = less alike, deeper = more alike, with the example drawn as a dashed cyan outline and white 24 px mono rank labels with a dark halo). These are evidence, not UI, and are not restyled to the accent. The layers plate carries the stage's legends, under its list: a ramp bar at 15 px, with "less alike" / "more alike" for similarity and `0` / `1,500+ ppm·m` in the mono face for methane. **A raster that draws nothing says so:** after ten failed tiles and not one drawn (a file name the model mistyped, TiTiler down, the venue network), its row reads "LiDAR did not load" (a terrain product) or "Did not load" in the error colour at 15 px in place of its ramp strip, and its legend leaves the plate, so the presenter never describes a layer the room cannot see; the first tile that draws clears it, and a 404 past a raster's edge never counts (`utils/tileHealth.ts`). Dark Vessels' radar passes are not flagged; Act 3 keeps its own sweep. Geometries never wait on the basemap: a geometry that lands while tiles stream goes on the map once the style's JSON is in (`utils/styleReady.ts`), so two layers that arrive in one tick both land.

Methane (Act 2) uses matplotlib's plasma ramp (`#0d0887` → `#7e03a8` → `#cc4778` → `#f89540` → `#f0f921`) over a fixed 0–1,500 ppm·m, so every plume reads on one legend and anything stronger saturates to yellow. Plume rasters render through TiTiler with that ramp. The footprints show the ranking, not the count: ranks 1–3 are lit with a plasma outline graduated by peak enhancement, a 10% fill and 24 px mono labels (`#1  8,130.7 ppm·m`, fog on a dome halo, placed at the plume centre with collision checks); every other footprint is a fog hairline (40% opacity, brighter before triage). **The Dim Rule:** while a methane layer, a change-detection raster or a regional scan grid is visible the basemap dims (brightness 0.45, saturation −0.6, 600 ms), because plasma only reads on dark ground and a grid of half-transparent squares vanished into satellite imagery at state scale; it comes back when the last such layer is hidden or removed. **The ramp fits the plume:** a plume raster, its footprints and the EMIT pass window with its columns are scaled from 500 ppm·m to a round number near 85% of their own peak (never below 1,500), so a 6,000 ppm·m plume is not one flat yellow and the legend shows the actual range. The camera follows the act: footprints fit on arrival, the plume raster fits to its own bounds, the ground scene after it tightens further, always padded clear of the step column, console and layers plate.

Methane Watch (Act 2, the mission) adds four data layers, each with its own legend row (**The One Ramp Per Unit Rule:** plasma is ppm·m, ice (cmocean, navy to pale cyan) is ppb; the two never share a bar, and neither magma nor viridis is used because both share plasma's dark-purple-to-yellow ends and read as one scale: ppb is cool, ppm·m is hot). **The watch globe:** choosing the Methane Hunter (or resetting its session) puts the agent's last cached baseline on the globe before any prompt, so the act's resting state is the globe with every repeat site and the nine watch-area outlines; the mission's own baseline step then replaces it. When the baseline lands the map switches to MapLibre's globe projection facing the watch areas, sized so the whole globe sits in space between the plates, and turns: 1.5° a second at rest, 4° while the agent works; it stops when a methane raster takes the frame and while the presenter holds the map, and never starts under `prefers-reduced-motion`. Sites are fog dots (2.5–6 px by dates seen); sites seen on five or more dates carry a 2 px fog ring and a `×N` mono label at 18 px; watch areas are dashed fog hairlines (50%). Dates are a count, not a measurement, so sites are fog, never a data ramp; the legend's sites key draws a dot and a ring. The **TROPOMI** composite renders in ice over 0–60 ppb at 75% opacity and is hidden above zoom 8, so its ~4 km cells tip the eye without walling off the EMIT finding (the frontend enforces the cap and the ramp even when a hint or a recording says otherwise). Past its cap its row in the layers plate says "Shows only when zoomed out" in label grey and its legend leaves the plate; selecting its name flies out to zoom 7.5, where it draws. The **EMIT pass window** is plasma, masked below 500 ppm·m so the ground shows through. The **columns** stand one per enhanced pixel, 0.25 m per ppm·m, on the same plasma ramp at 90%, read at a 55° tilt with a −20° bearing; the ground scene that follows keeps the tilt. Clearing the map returns it to a flat, upright Mercator view.

**The tips on the globe.** As each TROPOMI scan finishes, its watch area gets a mark at its strongest hotspot: an ice dot sized and coloured by the anomaly on the legend's own 0–60 ppb ramp (6–16 px), a fog stroke (heavier where EMIT can look), and a two-line mono label at 17 px: the area's short name and `+86 ppb`. The marks vanish above zoom 5, where the composite itself takes over. The step column carries the same nine as the **tip board** under the scan step: one row per area, strongest first, the label with its country (from the stage's own table, never the model), the anomaly in mono, a 4 px bar in the same ice ramp, "TROPOMI only" where EMIT cannot look, a fog ring on the two sites EMIT was cued on and a filled dot plus "following" on the one the agent chose. Each cued row gains a third 15 px line with the reason for the choice once its passes are read, "2 of 4 candidate passes · latest 2025-08-20" (label grey, fog on the chosen row; the numbers and the date in mono; "latest <date>" never breaks), counted from the cue manifest's validated frames, never from the model. Country names on the board and the globe are the stage's, printed from numbers; the model only ever adds a place name through the geocoder.

The Earth Analyst's indices carry their legends the same way: one stacked row per index on the stage (NDVI red-yellow-green, NBR spectral, NDWI blues, change reversed red-yellow-green), the ends in words ("bare" to "dense vegetation", "no change" to "most change") rather than numbers. Every act now frames its finding clear of the plates (`STAGE_PADDING`), so a boundary or a scene lands in the window the room can see, not under the step column.

**The AI Archaeologist (Act 4) stands on the ground.** Each act has its own way of seeing: the Earth Analyst looks straight down at a flat Mercator map, the Methane Hunter watches a turning globe from space, and the archaeologist reads the ground the way a field survey does, from a low oblique angle. The first LiDAR product (a hillshade, a local relief model) stands the map up on a 3D ground (MapLibre `raster-dem` from the AWS Open Data Terrain Tiles, relief ×3), tilts the camera to 60° on a 35° bearing (looking north-east, across the hillshade's north-west light, so banks keep their shadows) and lands on the middle 1.2 km of the site's 3 km frame, so the earthwork fills the window and the rest of the frame runs out towards the horizon. A metre scale bar sits bottom-right in the mono face, and the legend prints the factor: "ground relief ×3, read from the south-west". The ground stays up until the map is cleared; a scene "from space" earlier in the act lands flat on the frame, and only the terrain tilts the view. The Dim Rule covers terrain rasters, so a grey hillshade never competes with the satellite basemap under it. **Terrain palettes are TiTiler's own:** the hillshade is `gray` 1–255 (its legend is a sentence: "1 m LiDAR, lit from the north-west: banks cast shadows, ditches catch them"); the local relief model is `rdbu_r` over ±1 m or ±0.3 m (ploughed sites), its legend worded at the ends ("lower −1 m" / "+1 m higher"), red is higher than its surroundings, blue is lower, so a bank is a red ring with a blue ring inside it. **The transect** is drawn by the stage from the tool's own GeoJSON: a 3 px fog line over a 5.5 px dome casing (the relief model's middle is near-white, and a bare fog line vanished into it; the casing is dome, not amber, because amber on the line is the section cursor's dot alone), a filled dot at each bank and a ring at each ditch, with 18 px mono labels (`bank +2.6 m`, `ditch −2.7 m`) in a dome halo, so the measurement sits on the earthwork it measures. Only the four marks that define the span carry a label (the outer banks and the inner ditches), placed with collision checks so a bank and its ditch 12 m apart take opposite sides and never print over each other; the crests inside the ring (Eagle Mound at the Great Circle) keep their dots and are read in the section as "rise +2.2 m", not "bank". Every figure is the tool's own (`utils/transectMarks.ts`): the map, the section and its description print the label `measure_profile` wrote, and wherever the stage rounds a height itself (the cursor's reading) it rounds the tool's way, an exact tie to the even tenth, so one mark never reads +2.2 m on the map and +2.3 m in the column. The site's frame is a dashed fog hairline. **The record at rest:** choosing the archaeologist puts the whole public catalogue on the map before any prompt, a fog dot per site, a ring for a World Heritage component, mono name labels, all gone above zoom 9 where the ground takes over. The marks come from the published record (`/api/archaeology/record`, derived from the catalogue by a script so the two cannot drift), never from the model, and nothing on the stage ever marks a place that is not already on the public record. **The rest view is the woodlands at dusk**, so the act reads as its own place before a word is said, not as the Methane Hunter's globe with different dots: the camera stands low over the southern Appalachians at 65° on a 290° bearing (looking west-north-west across the Mississippi into the sunset, fitted by projecting the marks, since `fitBounds` picks its zoom as if flat; at rest the step column is down, so the record takes the stage's whole width, 120 px in from the left edge, and keeps clear of the column only while steps are up), the continent is stood up on the same Terrain Tiles at relief ×6, a sky goes in with the last light on the horizon (`#4d3427` under a dome sky; the frame's own background carries the horizon colour so the edge of the Web Mercator world never shows as a hole), and a **rest relief** (a MapLibre `hillshade`, the `basic` model, sun at 260° and 28° high, a bone highlight `rgba(222, 204, 172, 0.5)`, shadows to near-black) lights the ridges and valleys the mound builders chose. The satellite basemap goes further down than the Dim Rule (brightness 0.3, fully grey), the dots stand upright to the room (viewport-aligned), the names are the places not the parks ("Cahokia Mounds", "Poverty Point"; the eight Hopewell components share one label at their middle, "Hopewell Ceremonial Earthworks, 8 sites"), a name never covers another named site's dot (an unseen glyph on each dot is placed first), every name draws at 15 px or more however far off it is (MapLibre shrinks a name with distance; each far one is sized up at the rest camera, `utils/restCamera.ts` `sizeAtLeast`), and the legend says what the view is ("relief ×6, a low sun from the west"). The relief sits on the floor of the stack with the basemap; the terrain, the sky and the tilt leave the moment the agent lands anything (the site's frame lands flat, as before), and the relief leaves when the ground comes up. Nothing moves at rest. **The dissolve:** a terrain product arrives at opacity 0 and dissolves in over 1.8 s, the imagery giving way to the ground (skipped under reduced motion). **The raking light:** with a hillshade, the agent also stages the site's own 1 m DEM (the hint names it; when the model drops it from the hint, as it sometimes does, the stage finds the `dem_<site>.tif` staged beside the `hillshade_<site>.tif` and checks it is there before it trades the paper for the light); the stage tiles it (TiTiler `algorithm=terrarium`) and lights it live, so the baked hillshade becomes a flat grey paper and MapLibre does the shading. The light uses MapLibre's `basic` hillshade model, which knows the sun's height: at a raking 25° the flat ground goes a shade darker than the paper and every bank's lit face goes to fog against a dome shadow. Once the camera lands the sun does the lesson itself over 12 s: it starts high (50°, the ground pale and the walls faint), sinks to 25° over the first 3 s so the walls stand up, then goes once round the earthwork in 9 s on a sine ease (never faster than about 63° a second, slow enough for the room to watch each bank's shadow swing) and settles at 315°, the way a field archaeologist walks a torch round a bank at dusk. **The light plate** (bottom right, above the metre scale, while a live hillshade is on the stage) makes the light a thing the presenter holds: a 120 px dial drawn as the room sees the map (turned with the camera's bearing, so the sun on the dial is where the light comes from on screen; drag it, or arrows by 5° and Page keys by 45°), the direction in words and mono ("from the north-west 315°"), a sun-height slider from 5° to 50° with what it does in words ("low: walls stand up", "high: the ground reads flat"), and a "Sweep the sun" button that replays the arrival. The sun on the dial is fog, amber only while it is held or focused. The legend sentence follows the sun ("lit from the south-east"). The 3D ground stays on the global tiles; only the light reads the site DEM. **The cross-section:** `measure_profile` carries its samples (≤600 points, offset from the baseline in metres), and the column draws the section under the "Measure across the earthwork" step: 128 px tall, a fog line drawn on left to right, every bank (dot) and ditch (ring) marked at its distance along the line but only the tallest bank and the deepest ditch labelled (the two figures the answer quotes, 15 px mono), three signed rules at most ("+2 m", "0", "−2 m"), and an `aria-label` that reads every mark as one sentence. A line's end is never a bank or a ditch (no ground past it to compare). The section is the measurement the room just heard, drawn. **It is also a slider along the line:** point at it (a mouse on hover, a finger while down, or the arrow keys, 5 m a step and 25 m with Shift) and an amber rule and dot stand at that distance, the caption under it becomes the reading in mono ("at 215 m, +1.9 m", in the caption's own cell so nothing moves), and the map puts an amber dot on the transect at the same distance with the same reading beside it (18 px mono), while the transect's own labels step aside. Point at the line on the map (within 28 px) and the section follows. Amber is right here: the cursor is the one thing the presenter is pointing at. **Answers in the column:** the agent leads with one sentence the room can repeat, tables are two columns at most with the documented figure beside the measurement in the same cell, and the table wraps inside the column (nothing scrolls sideways: a column the room cannot see is a column that is not there).

**Dark Vessels (Act 3) is the sea at night.** The ground is the seabed (a fixed "Seabed" base: shaded bathymetry, the islands as dark land with a fog coastline), and behind the canvas is the abyss (`#03070d`, like the globe's space, the one other place darker than the dome). There is one data colour, **Orchid** (`#f07ad8`): the candidates' rings and labels ("T01  no AIS", mono 16 px) and the history's heat (at 0.75 opacity, with a dome halo under the rings so a candidate never sinks into it). AIS is **Pale Cyan** (`#9fd3e6`): faint wakes, a four-hour comet trail, and a fog dot per vessel heard, so a dot always means a broadcast. The argument is drawn in its order. The radar arrives along the satellite's track, swept over 3.8 s from the edge the orbit came in at; the clock plate (top centre, 24 px lead, 17 px sub) names the pass. The targets land as fog rings, then the coverage: heard water as a faint fog wash, unproven water hatched and labelled "not evidence". Only 1.4 s after the coverage is on the map do the candidates turn orchid. The forecast shows the patrol boxes as fog lines with mono labels (rank and share over the next look's time), and the camera pulls out to the fleet off the coast and back after 7 s. Reserve-scale labels hide below zoom 6. **The officer's decision** is a plate bottom right: the box as a radio list, the candidates as checkboxes, and a mono summary. The chosen box takes a 3 px fog line and a 7% wash, the boxes not chosen step back to 40%, and a candidate left out turns grey with "left out". The plate's **Approve the tasking** is the only amber on the act. Once filed it reads "Filed by the officer at … UTC. The agent did not file it."

### Named Rules
**The One Spotlight Rule.** Amber marks exactly what is active. If two things on the same screen are amber, one of them is wrong.
**The No Black Rule.** The darkest value is the dome (#0f141b). Pure black and pure white never appear in the interface; text is fog, ground is dome.
**The Hairline Rule.** Panels are framed by 1px hairlines at 14–24% alpha and a real shadow. No 4px accent side-tabs, no coloured borders.

## Typography

**Display Font:** Bricolage Grotesque (with Atkinson Hyperlegible Next, system-ui fallback)
**Body Font:** Atkinson Hyperlegible Next (with system-ui fallback)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with ui-monospace, SF Mono, Menlo fallback)

**Character:** A characterful grotesque for the few words that name things (the show, the acts, the plate titles) over a hyperlegible humanist sans built to be read from the back row. The mono is the same family's monospace, so numbers sit in the same voice as the prose.

### Hierarchy
- **Display** (500, 40px, 1.1): page titles on the gallery and technology pages; never on the stage.
- **Headline** (500, 30px, 1.2): section headings on secondary pages.
- **Answer** (400, 19px, 1.4, 22px above 2200px wide): the agent's answer at the foot of the step column, its words after its last tool call; tables in it at 15px with tabular figures, scrolling sideways inside the column.
- **Title** (600, 18px, 1.4): dense headings inside plates and on secondary pages.
- **Body** (400, 16px, 1.5): running text; 15px is the floor for anything on the stage (layer names, transcript, buttons).
- **Label** (600, 12px, 0.12em, uppercase, Bricolage Grotesque): plate titles ("Layers", "Transcript", "Prepared"), speaker labels, group titles (11px inside the layers plate).
- **Mono** (400, 14px, 1.4, tabular-nums): coordinates, dates, areas, counts, session ids, tool parameters.

### Named Rules
**The Back Row Rule.** Nothing on the stage is set below 15px except tracked uppercase labels. If it must be read from the room, it is 24px or larger.
**The Stage Punctuation Rule.** The agents are told not to write em dashes; when one slips through, the answer and the transcript print it as a comma (a dash between two numbers reads "to"), so the room never sees a typographic habit stand in for a thought.
**The Tabular Rule.** Every numeric value is set in Atkinson Hyperlegible Mono with tabular figures, including inside prose answers when a number is the point.
**The Two Voices Rule.** Bricolage Grotesque names; Atkinson Hyperlegible speaks. The display face never sets a sentence.

## Layout

The stage is a fixed frame with one live window. The map fills the viewport below a 56px exhibit rail; every control floats over it in absolute-positioned plates, 16px from the edges, and nothing pushes the map around.

- **Exhibit rail** (top, 56px): title left, sections centre, quiet sign-out right. The active section is lit amber with an underline.
- **Step column** (left, `clamp(296px, 19vw, 380px)`): appears while the agent works and for the turn just finished. Its head is the plate's title and its minimize control (a chevron, the title, the step count in mono, the working dots while it works); minimized it is the head alone. Under the head: "Earlier in this session" once there is an earlier turn (below), the presenter's question (15px fog, three lines at most), the plan strip on one line, the steps (while the agent works, its latest finished sentence sits under the lit step), then the end of the turn: the brief card when the turn drafted one, else the answer under a hairline with the agent's name as its label. A failed turn says "The agent stopped before it answered" in the error colour instead of printing the exception; a prompt that never reached the stage backend says "The stage can't reach the backend. Check the connection, then send the prompt again." (`utils/turns.ts` `failedTurnLine`, the same line in an earlier turn's record). It grows down to the draw rail, or stops above the console where the two overlap on a narrow screen (measured), and scrolls inside itself; while the agent works the lit step and its sentence stay in view, and the answer scrolls into view when the turn ends.
- **Console** (bottom centre, `min(1040px, 100% - 480px)`): the presenter's single input line with Send / Stop, transcript toggle and new-session, then prepared prompts as label plates with the session id in mono at the right. There is no caption band: the answer lives in the step column, and the bottom of the stage stays map.
- **Layers plate** (top right, 320px; `calc(100% - 190px)` tall below 800px of height so it stops above the console): one list, **Drawn top first**, in draw order. Every layer the agent put on the map restacks: imagery, boundaries, footprints, sites, columns. A 2×3-dot grip (32×36, always visible) leads each row, and the map follows live while a row is held. Each row is a checkbox, a name that flies the map to the layer (two lines at most; the full name is its title and accessible name), a 56×4px ramp strip under a measured layer (an index, a plume, the footprints, the columns, TROPOMI) that ties it to its legend, and a remove control. Legends sit under the list, one per ramp among the layers the map is drawing, the top row's first, keys last; the compare action is the plate's foot. **Where a new layer lands:** a vector on top of everything; the watch baseline under the other vectors and over the imagery; a finding raster (NDVI, NBR, NDWI, change, a plume) at the top of the imagery, under the vectors drawn over it; true-colour imagery at the bottom, just above the basemap. The presenter's own order is kept: a layer that lands later never moves the others. The stack always stays under the presenter's drawn shapes and the globe's tips.
- **Draw rail** (bottom left, 40px icon buttons in a column; not on the AI Archaeologist's act, where a shape drawn over unrecorded ground is the one way the stage could look as if it marked a new site, so the step column runs down to where the rail would sit) and **Basemap plate** (bottom right).
- **Transcript drawer** (right, `min(520px, 100% - 360px)`): slides over the layers plate when opened; closes with the same control. Rails never reflow; only the map and its plates change.

Spacing steps are 4, 8, 16, 24, 32, 40px. Inside plates: 14–16px padding, 6–10px gaps between rows, 36–40px control heights. Secondary pages (gallery, technology) use a centred column at readable measure with the same plates and tokens.

- **Replay cases** (`/use-cases`): the display title "Replay cases" and one line on what a replay is, then one section per act in show order, headed by the act's room name (no act numbers), its cases in a grid of plates. Each available case has one button, "Open the replay", that covers its plate, so the whole card opens it and Tab, Enter and Space work as on any button; it is quiet at rest (label grey on a strong hairline) and amber only under the pointer or the keyboard's focus, when the whole card takes the 2px amber ring, so at most one call to action on the page is amber. A metric's value never breaks: when it cannot sit beside its label it takes the next line. A case not yet recorded says "Coming soon" in label grey and has no button. The images are decoration beside the case's heading.
- **How it works** (`/technology`): one screen at 1080p for a mixed room, in the order of the intro deck's slide 4: a lead (one AgentCore runtime per agent, a foundation model choosing and chaining tools over real data, a person decides), then two columns, "What each agent works with" (the four agents in show order, their data) and "How a turn runs" with "A person decides". Display title, headline sections, 17px body in label grey; no cards, no expanders, no amber.

## Elevation & Depth

Depth is layered and lit rather than stacked. Plates are semi-transparent (88–96%) over a 6–10px backdrop blur so the map shows through as a glow, framed by a hairline and lifted with a real shadow tinted by the dome. The shadow says "this floats over the planet"; the blur says "it belongs to the same room". Interactive states never change elevation; they change wash or colour.

### Shadow Vocabulary
- **Level 1** (`box-shadow: 0 1px 2px rgba(3, 6, 10, 0.5)`): hairline-adjacent lift for inline chips.
- **Level 2** (`box-shadow: 0 4px 12px rgba(3, 6, 10, 0.45)`): the console and basemap plate.
- **Level 3** (`box-shadow: 0 10px 28px rgba(3, 6, 10, 0.5)`): the step column, layers plate, transcript drawer and popups.
- **Level 4** (`box-shadow: 0 18px 44px rgba(3, 6, 10, 0.55)`): modal overlays such as the compare view.

### Named Rules
**The Floating Plate Rule.** Anything over the map is a plate: blur, hairline, Level 2 or 3 shadow. Never an opaque box with a hard edge, never a card inside a card.

## Shapes

Softly rounded and quiet. Plates use 10–12px corners, controls 8px, rows and small plates 6px, chips and code 4px, markers are circles. There are no pill buttons and no sharp corners. Frames are 1px hairlines; there is no thick border anywhere. Icons are a single set drawn on a 16px grid at 1.75px stroke in currentColor; emoji and unicode glyphs never stand in for icons.

## Components

### Buttons
Quiet by default, lit when primary or active. Same height everywhere (40px; 32–36px inside dense plates).
- **Shape:** gently rounded (8px); icon-only buttons are 40×40 squares with the same radius.
- **Primary:** amber fill (#f5a524) with dome text (#0f141b), weight 600, padding 0 14px. One per plate. Hover brightens to #ffbd4f.
- **Quiet:** transparent with label-grey text; hover shows the hover wash and turns the text fog.
- **On (toggled):** amber wash background with amber text and `aria-pressed`.
- **Danger:** transparent with signal-red text; used for Stop and Clear.
- **Outline (secondary action inside a plate):** transparent, strong hairline border; hover turns border and text amber.
- **Focus:** a 2px amber ring offset by 2px, shared by every control.
- **Disabled:** 45–55% opacity, not-allowed cursor, no colour change.

### Label plates (chips)
- **Style:** 32px tall, 6px radius, plate background at 88% with blur, hairline border, fog text at 14px weight 500.
- **State:** hover turns border and text amber; disabled fades to 45%. Used for prepared prompts and small metadata.

### Plates (containers)
- **Corner Style:** 10px (12px for the console and transcript).
- **Background:** plate (#161c25) at 88–96% over blur.
- **Shadow Strategy:** Level 3 for anything that holds content, Level 2 for single-line controls.
- **Border:** 1px hairline; strong hairline on focus-within.
- **Internal Padding:** 14–16px; 10–12px in dense lists.
- **Titles:** the label style in label grey, top-left, with a mono count where there is one.

### Inputs / Fields
- **Style:** borderless textarea inside the console plate; transparent background, fog text at 17px, label-grey placeholder, amber caret; grows with content to 120px then scrolls.
- **Focus:** the console's border shifts to the strong hairline; the field itself shows no ring (the plate is the field).
- **Disabled:** while the agent works the placeholder reads "Working… press Esc to stop"; Enter sends, Shift+Enter breaks a line, Esc stops.

### Navigation (exhibit rail)
- 56px, dome background, hairline underneath. Title in Bricolage Grotesque 20px; sections as quiet 15px links centred; the active one is amber with a 2px underline; sign-out is a quiet button at the right.
- **The act picker** (left of sign-out) names the act on stage and lists the acts in show order by the room's names (Earth Analyst, AI Archaeologist, Methane Watch, Dark Vessels), each with the intro deck's line under it, never a runtime suffix, a deploy note or an act number (`utils/acts.ts`). Dev runtimes are offered only in rehearsal (the dev server, or a tab opened with `?dev=1`; `?dev=0` ends it) under a "Rehearsal" label, each named for its act with its `?agent=` id in mono; the live site never offers them. `?agent=<id>` ids are unchanged; one the picker does not offer lands on the backend's default act.
- **The backend notice** takes the picker's place while the stage backend cannot be reached: "Can't reach the stage backend." in the error colour over "Retrying in 8 s." in label grey (the count in mono, every second), and a quiet "Retry now". The list is asked for again after 2, 4, 8 and 16 s, then every 30 s; the first answer brings the picker back. Meanwhile the stage keeps the act its URL names, so the console's prompts and placeholder stay that act's.

### Step column (signature)
A numbered list of the agent's tool calls for the current turn, with exactly one lit marker. Each row: an 8px dot (amber with a 5px amber-wash halo while running, signal green when done) beside a two-digit mono step number at 15px, then the tool name in body 15px (17px, weight 600, with an amber "working" label on the lit step at 15px, weight 600, in sentence case, never tracked caps, so it fits beside the name at 1280 as the small caps did and the lit row does not grow on every step; kept whole: a long name takes it to the next line). At most nine steps show; earlier ones fold behind a quiet "Show n earlier steps" button at 15px ("Hide the earlier steps" when open), finished or still working, and the lit step stays last. Consecutive calls of one tool are one step ("Scan 9 watch areas"), with a 15px label-grey line under it naming what it covered (the tool's own watch-area names only) or what it followed ("Following the TROPOMI tip", then the cued point in mono). For the Earth Analyst the line names the scene window ("Scenes from 2025-07-17 to 2025-09-15") with the scenes it turned down in mono ("skipping 2025-09-06"), and for change the area and the method it chose ("About 9,500 km², so an embedding scan"; "Pixel by pixel, for areas up to 5,000 km²"), printed only from validated dates and numeric inputs. For the AI Archaeologist the measure step says whose line it is, "NW–SE, the agent's line" when the agent chose a bearing from the local relief or "The record's verified line" on the Great Circle, from the stage's own table of the tool's four bearings. The plate rises into place (8px translate, 360ms) and never reflows the map.

A Methane Watch turn adds a **plan strip** above the steps (Baseline · Tip · Cue · Check · Brief in the display face at 15px; while working the current stage is amber, done stages fog, the rest label grey) and a **pass filmstrip** under the cue step: one 44px frame per EMIT pass judged, newest first, candidates with a 2px fog frame, rejected passes at 45%, and one 15px line saying the verdicts in words ("5 candidates · 2 too weak · 1 cloud or gap"). A frame opens the evidence plate with the tool's reason. With two sites cued, each strip is headed by its area label in mono. In the end frame the site the agent did not follow keeps its labelled summary line (its frames stay in the full list), so both sites' self-checks stay on screen. The scan step (with its tip board) and the cue step stay pinned while later steps push earlier ones behind "Show n earlier steps". The three **ground-record checks** are steps of their own ("Check for heat", "Check what is mapped nearby", "Check the public registry") with a 15px line naming the source and window (VIIRS, 30 nights; Overture Maps, 2 km; OGIM public registry, operators of record, 2 km).

### Brief card (signature, the end frame)
When a turn drafts a brief, the step column becomes the end frame: the plan strip, the tip board with its tallies, the chosen site's filmstrip and the other site's summary line, then the brief card, with the full step list behind a quiet "Show all n steps". The card's heading leads with its state in label grey at regular weight ("Draft brief", "Filed brief"; it parts from the title by weight as well as colour; the amber belongs to the decision, and the plan strip turns all fog once the turn is done) and the title in the display face at 19px, written by the tool from the evidence and the geocoded place ("Recurring methane near Jincheng City, Shanxi Province, China"), never from the watch area; then the where line, the coordinates in mono in the step column's format (`35.51, 112.44`, never broken) and, in label grey, "tipped by the <watch area> watch area" as provenance, not location; then the count sentence with its window ("2 of 6 passes read since 2025-01-01 are candidates; EMIT looked 11 times in all", numbers in mono), running on in the same paragraph with **the last look**, so a recurring site is never read as active today: "Last EMIT look Aug 20 2025. Latest sign: TROPOMI, 14 days to Oct 10 2026 (about 4 km cells)." with the dates and numbers in mono (a date never breaks across lines), from the tools' own records only (the newest pass in the manifest of the cue on the card's site, and the TROPOMI tip whose hotspot is that site, both to 2 decimals), never from the draft's model-written observations; without a tip only the first sentence shows, without a manifest there is no line; then **the verdict**, the two lines the room restates with their values at 19px ("Methane recurs here" / **Moderate**, "Cause" / **unconfirmed until a ground or aircraft check**); then the decision, so title, verdict and decision fit the column's first screen at 1080p; then, below it, the **ground record** (the checks' sentences, written by the tools from their own numbers, never by the model; the registry's lines, the OGIM or GEM field and the GEM coal mine on record, are the only place an owner or operator of record is ever named), the unconfirmed hypotheses with their assessment in fog at weight 600 and "What would confirm each" as a quiet underlined toggle, and "Gaps and next look" with its count, closed until asked. The decision is "Approve and file" (primary, with the working dots while filing) and "Request another look" (quiet). If the draft takes longer than a beat the card says "Drafting the brief" with the working dots; if it never loads it names the brief id and offers "Try again", never a silent end frame. The column's foot fades while more lies below. The backend files the brief; the card then says "Filed by the analyst at … UTC. The agent did not file it." In a replay case the card is read-only and says the decision is made live. Its data comes from the draft in S3 through the backend, never from the model's text.

### The answer (signature)
The agent's own words after its last step, at 19px fog at the foot of the step column, under a hairline and the agent's name in the label style. It is the whole answer, not a tail of it: a ranking table, the registry's operators of record and the closing sentence all read on the stage, so the room never has to be pointed at the transcript. (It replaced the caption band, which showed only the last paragraph of a long answer, and cost 95 to 160px of the stage's middle.)

### Earlier turns and the agent's own words
**Earlier in this session** sits above the question once the session has an earlier turn: the label style, then one disclosure row per earlier turn (a chevron, the question on one line at 15px fog, "· n steps" in mono label grey), the latest four, older ones behind "Show n more". A row opens that turn's record in the column, one at a time: "A record of this turn. The map shows the latest." in label grey, its steps with their chips, filmstrips and sections (no tip board), and its answer. It is a record, not a replay: the map never changes when a record opens. A new turn closes any open record.

**The agent's words while it works:** its latest finished sentence, in quotation marks at 15px fog (90%), under the lit step's name. It changes at most every 2.5 s with a 240ms fade from 35% (none under reduced motion), never repeats a sentence, and is a polite live region. A sentence a chip's Saw line prints is said once, under the chip: the line keeps the sentence before it (or stays empty) and moves on with the next sentence that is not a Saw. **Saw:** under an evidence chip, what the agent said it saw after it looked, at 15px fog with "Saw:" in label grey, outside the chip's button; the evidence plate then reads "Asked:" with the question in label grey and "Saw:" with the words in fog at 18px. Without the agent's words the plate keeps the question alone, as before (replays, a filmstrip frame's reason, Dark Vessels, which shows no Saw line). Both lines are the model's own sentences as written: markdown off, the stage's punctuation, a bracketed technical aside left out, and a sentence that names a tool, a file, a URL or code dropped, never edited; capped at 120 and 140 characters with an ellipsis at a word.

### Map furniture
Layers plate, draw rail and basemap plate share the plate language. Rows are 36px with a checkbox, a name button (hover amber) and a 32px remove icon; hidden layers fall back to label grey. The compare action is an outline button. Drawn shapes on the map wear amber with a dome stroke; MapLibre popups and attribution take the plate and label colours.

**Restacking.** A press on a grip becomes a drag after 4px of travel; below that it is a click. The held row rides vertically on a raised plate (`--plate-raised`, Level 2, a strong hairline); its neighbours slide out of the way on `transform` (180ms ease-out, instant under reduced motion); where it will land is a full-height amber-wash band with a 1px amber hairline. The list scrolls under a row held near the plate's top or bottom edge. Escape, or a drop off the plate (onto the map), puts the list and the map back; a drop that overshoots the list inside the plate lands at the clamped end. A landed row washes amber for 300ms. Every drag has a non-drag path: on a grip, the arrow keys move a row one place and Home / End to the top and the bottom, with focus kept on that row's grip; a click lifts a row (its grip turns amber and pressed) and a click on another row's grip, now amber-outlined as a target, puts it there; Escape or a press elsewhere puts it down. Each move is announced in words ("NDVI moved to the top, drawn over every other layer.").

## Do's and Don'ts

### Do:
- **Do** keep the map edge to edge and float every control over it as a plate with blur, a 1px hairline and a Level 2–3 shadow.
- **Do** spend amber on exactly one active thing per region: the lit act, the current step, the primary button, the active draw mode.
- **Do** set every number in Atkinson Hyperlegible Mono with tabular figures, and every stage text at 15px or larger.
- **Do** use the label style (Bricolage Grotesque 12px, 0.12em, uppercase, label grey) for plate titles and speaker labels, and only for those.
- **Do** animate with the exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) on opacity, transform, colour and shadow, and only where it shows the agent working.
- **Do** draw icons from the single 16px stroke set in currentColor.
- **Do** keep scientific palettes on map data (RdYlGn change ramp, cyan boundaries, purple protected areas) and never restyle evidence to the accent.

### Don't:
- **Don't** lay the page out as a chat column beside a map, or put the map inside a card.
- **Don't** use pure black or pure white, neutral greys, Roboto or system fonts, or any second accent colour.
- **Don't** add accent side-tabs, coloured borders, cards inside cards, or opaque hard-edged boxes over the map.
- **Don't** use emoji or unicode glyphs as icons, spinners as the only progress signal, or anything that blinks.
- **Don't** transition layout properties (width, height, left, top, margin, padding); move with transform and fade with opacity.
- **Don't** let anything read as a hacker console: no phosphor green, no monospace paragraphs, no scanlines, no cursor blink.
