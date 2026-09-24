---
name: Agentic AI for Earth
description: A planetarium show for geospatial agents; one luminous Earth, a docent's captions, one amber spotlight.
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
  caption:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.005em"
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
  caption-band:
    backgroundColor: "{colors.dome}"
    textColor: "{colors.fog}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    padding: "14px 20px"
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

An exhibit hall after hours. One luminous Earth fills the room, and the agent is the docent whose captions appear only when they add meaning. The screen is a stage read by an audience of technical leaders from the back of a room, not a workstation read by its operator: the map runs edge to edge, the rails around it never reflow, and everything the agent does lands as a numbered step or a spotlit finding pinned to the place it belongs. The presenter types one line or picks a prepared prompt; the room never needs the transcript.

The world refuses the two default arrangements of the category. It is not a dark dashboard of panels with a chat column, and it is not a light SaaS chat with a map in a card. It is also, by the presenter's own words, never a hacker console: no phosphor green, no monospace walls, no blinking cursors. Materials are a matte deep blue-grey surround, soft spotlight falloff, and exhibit label plates framed by hairlines. Colour is spent with discipline: one amber accent marks whatever is active, and data colour lives only on the layer being looked at.

Density is low and sizes are large. Nothing on the stage sits below 15px, the docent's caption sits at 24px (32px on very large screens), and numerics are tabular so columns of coordinates and dates align. Motion follows one grammar: an exponential ease-out from a visible default, used where it shows the agent working and nowhere else.

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
- **Dome** (#0f141b): the ground. Page background, the exhibit rail, the caption band, and the text colour on amber buttons.
- **Plate** (#161c25): panels that float over the map (step column, console, layers, draw rail, basemap), usually at 88–96% opacity over a backdrop blur.
- **Raised Plate** (#1d2530): popups and nested surfaces one level above a plate.
- **Fog** (#e9eef3): primary text and icons; the docent's caption.
- **Label Grey** (#8fa3b8): secondary text, plate titles, quiet controls, placeholders, and the names of hidden layers. Tinted from the dome, never a neutral grey.
- **Hairline** (rgba(233, 238, 243, 0.14)) and **Strong Hairline** (rgba(233, 238, 243, 0.24)): etched rules and plate frames. The strong value marks focus-within on the console and the outline of secondary buttons.
- **Hover Wash** (rgba(233, 238, 243, 0.06)): the only hover treatment on quiet controls and rows.

### Signals
- **Signal Red** (#ff7a70): errors and the Stop / Clear-drawing actions. Used as text on a transparent button, never as a fill.
- **Signal Green** (#7bd88f): completed states in the step column and tool timeline.

### Data colour on the map
Map layers keep their scientific palettes: the RdYlGn change-scan ramp, cyan boundaries and hotspot outlines, purple protected areas, and the similarity ramp (a single violet hue from `#e8dcf5` to `#5b2a86`, lighter = less alike, deeper = more alike, with the example drawn as a dashed cyan outline and white 24 px mono rank labels with a dark halo). These are evidence, not UI, and are not restyled to the accent. The similarity group carries the stage's only legend: a ramp bar with "less alike" / "more alike" labels at 15 px.

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
- **Caption** (400, 24px, 1.35, 32px above 2200px wide): the docent's current sentence in the caption band. Up to three lines; older text is clipped, not scrolled.
- **Title** (600, 18px, 1.4): dense headings inside plates and on secondary pages.
- **Body** (400, 16px, 1.5): running text; 15px is the floor for anything on the stage (layer names, transcript, buttons).
- **Label** (600, 12px, 0.12em, uppercase, Bricolage Grotesque): plate titles ("Layers", "Transcript", "Prepared"), speaker labels, group titles (11px inside the layers plate).
- **Mono** (400, 14px, 1.4, tabular-nums): coordinates, dates, areas, counts, session ids, tool parameters.

### Named Rules
**The Back Row Rule.** Nothing on the stage is set below 15px except tracked uppercase labels. If it must be read from the room, it is 24px or larger.
**The Tabular Rule.** Every numeric value is set in Atkinson Hyperlegible Mono with tabular figures, including inside prose captions when a number is the point.
**The Two Voices Rule.** Bricolage Grotesque names; Atkinson Hyperlegible speaks. The display face never sets a sentence.

## Layout

The stage is a fixed frame with one live window. The map fills the viewport below a 56px exhibit rail; every control floats over it in absolute-positioned plates, 16px from the edges, and nothing pushes the map around.

- **Exhibit rail** (top, 56px): title left, sections centre, quiet sign-out right. The active section is lit amber with an underline.
- **Step column** (left, 296px wide, 360px above 2200px): appears only while or after the agent works. Grows downward to `calc(100% - 300px)` and scrolls inside itself.
- **Caption band and console** (bottom centre, `min(1040px, 100% - 480px)`): the docent's sentence, the presenter's single input line with Send / Stop, transcript toggle and new-session, then prepared prompts as label plates with the session id in mono at the right.
- **Layers plate** (top right, 320px): groups in a fixed order (change detection, similar places, satellite imagery, spectral indices, boundaries), each row a checkbox, a name that flies the map to the layer, and a remove control.
- **Draw rail** (bottom left, 40px icon buttons in a column) and **Basemap plate** (bottom right).
- **Transcript drawer** (right, `min(520px, 100% - 360px)`): slides over the layers plate when opened; closes with the same control. Rails never reflow; only the map and its plates change.

Spacing steps are 4, 8, 16, 24, 32, 40px. Inside plates: 14–16px padding, 6–10px gaps between rows, 36–40px control heights. Secondary pages (gallery, technology) use a centred column at readable measure with the same plates and tokens.

## Elevation & Depth

Depth is layered and lit rather than stacked. Plates are semi-transparent (88–96%) over a 6–10px backdrop blur so the map shows through as a glow, framed by a hairline and lifted with a real shadow tinted by the dome. The shadow says "this floats over the planet"; the blur says "it belongs to the same room". Interactive states never change elevation; they change wash or colour.

### Shadow Vocabulary
- **Level 1** (`box-shadow: 0 1px 2px rgba(3, 6, 10, 0.5)`): hairline-adjacent lift for inline chips.
- **Level 2** (`box-shadow: 0 4px 12px rgba(3, 6, 10, 0.45)`): the console and basemap plate.
- **Level 3** (`box-shadow: 0 10px 28px rgba(3, 6, 10, 0.5)`): the step column, caption band, layers plate, transcript drawer and popups.
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
- **Corner Style:** 10px (12px for the caption band, console and transcript).
- **Background:** plate (#161c25) at 88–96% over blur; the caption band alone uses the dome at 88% so the sentence reads as projected text.
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

### Step column (signature)
A numbered list of the agent's tool calls for the current turn, with exactly one lit marker. Each row: an 8px dot (amber with a 5px amber-wash halo while running, signal green when done) beside a two-digit mono step number, then the tool name in body 15px (17px, weight 600, with a small amber "working" label on the lit step). At most nine steps show; earlier ones collapse to a mono "+n earlier" line. The plate rises into place (8px translate, 360ms) and never reflows the map.

### Caption band (signature)
The docent's current sentence at 24px fog on a dome-tinted plate, up to three lines, with an amber speaker label ("Agent", "Ready") in the label style at the left and three breathing amber dots while streaming. It is the one thing the room is meant to read.

### Map furniture
Layers plate, draw rail and basemap plate share the plate language. Rows are 36px with a checkbox, a name button (hover amber) and a 32px remove icon; hidden layers fall back to label grey. The compare action is an outline button. Drawn shapes on the map wear amber with a dome stroke; MapLibre popups and attribution take the plate and label colours.

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
