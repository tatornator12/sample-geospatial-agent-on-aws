---
version: 1
slug: "react-ui-frontend-src-pages-chat-tsx"
primary_target: "react-ui/frontend/src/pages/Chat.tsx"
related_targets: ["react-ui/frontend/src/components/ChatSidebar.tsx","react-ui/frontend/src/components/MapView.tsx","react-ui/frontend/src/components/Navigation.tsx"]
---

# Surface: the Stage (Chat page: map, docent, specimens)

Scope: the presenter's live screen for all four acts. Visitor mode: Operate (the presenter completes tasks; the room reads the result).
Audience: AWS customer technical leaders and architects, watching a projector from across a room; they never operate it.
Job: the presenter selects an act, issues a prompt or a replay case, and narrates while the agent works; the room must read where the agent is, what it found, and the map, in that order, within three seconds.
Proof/content: live Sentinel-2 imagery and index layers, GeoJSON boundaries and hotspots, evidence chips (images the agent inspected), numbers with units, protected-area overlays, replay cases.
Constraints: MapLibre map behaviour, layer semantics, draw tools, swipe compare and scenario packs keep working; the chat is a control channel, not the room's reading matter; mouse and keyboard at a podium; no hacker-console look; "wow" is the success word.
Memorable moment: the spotlight, a soft amber sweep to whatever the agent just put on the map while everything else dims.
Unresolved: projector resolution; whether the transcript drawer opens by default during rehearsal.

## Direction contract

THESIS: An exhibit hall after hours: one luminous Earth fills the room and the agent is the docent whose captions appear only when they add meaning. It refuses the category's two arrangements, the dark dashboard of panels with a chat column, and the light SaaS chat with a map in a card.

OWN-WORLD: Restrained palette. A mid-dark dome ground (deep blue-grey, never black), fog-white captions, label grey, and one accent, spotlight amber, that marks the active act, step, layer or finding; data colour lives only on the active layer and everything inactive recedes to monochrome. Materials: matte surround, soft spotlight falloff, exhibit label plates framed by hairlines. Type: Bricolage Grotesque for exhibit titles and act names, Atkinson Hyperlegible Next for captions and controls (readable from the back row), Atkinson Hyperlegible Mono for every number, coordinate and identifier, tabular and unit-aligned. Motion: one grammar, the spotlight sweep, exponential ease-out from a visible default; nothing blinks.

STORY: The room sees a planet, then a lit act on the rail, then a docent caption saying what is happening, then evidence landing under a spotlight. They believe the agent is doing real work because each step is numbered and each finding is pinned to the place it belongs. The presenter types one line or picks a replay case; the room never needs the transcript.

FIRST VIEWPORT (1920×1080): the map edge to edge. Top: a slim exhibit rail, 56px, title "Agentic AI for Earth" left, the four acts as the agent switcher centre (active act lit amber with an underline), sign-out quiet at right. Left: a step column, visible while the agent works, numbered steps with one lit marker and the tool name beside each. Bottom: the caption band, the docent's current sentence at ≥24px across up to two lines, the presenter's input as one quiet line beneath, prepared prompts as small label plates, a transcript toggle at the right end. Right: the specimen rail, the layers panel as a list of label plates (name, date, legend swatch, visibility, zoom, remove), evidence chips stacking above it. Rails never reflow; only the map and its cards change. Primary action: the input line and the prepared prompts.

FORM: The Planetarium Show, candidate 5 of 7 on the grounded list (assigned by the roll), seed key 8e283055. Raised by the hand it beat: numbered step column with one lit marker (orizuru), leader-line callouts pinned to features (tensegrity), one tabular monospace register for numerics (datamatics), keyboard-first presenter shortcuts (phosphor), fixed frame with one live window (cd-rom), only the active item wears colour (saville).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
