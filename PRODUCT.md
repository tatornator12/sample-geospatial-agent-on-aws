# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the presenter.** One person (the builder) drives the product live during a
  30-minute slot on Monday Nov 9, 2026, on a projector, in front of an audience. They need
  predictable, rehearsable flows: pre-warmed agent runtimes, offline replay cases for every
  act, a fast path to switch agents, and no dead air while an agent works.
- **The audience: AWS customers' technical leaders and architects.** They watch; they do not
  touch the UI, log in, or get hands-on access afterwards. They evaluate whether agentic
  geospatial workflows are credible and buildable on AWS, and whether to start a follow-up
  engagement. They read from the back of a room, so everything on screen must be legible at
  distance and understandable without a mouse hovering over it.
- **Demo personas (depicted, not real users):** a GIS analyst, an EUDR compliance officer, a
  marine sanctuary enforcement officer, a methane regulator, an archaeologist. Their jobs
  frame each act; the product is not being handed to them.

## Product Purpose

Agentic AI for Earth is a live demonstration that AI agents can do real geospatial work on
AWS: perceive satellite imagery, sense signals people cannot see, investigate with evidence,
and act only with human approval. It exists to make "agentic geospatial on AWS" concrete for
decision-makers in 30 minutes. Success means the show runs end to end without a failure, the
audience can restate what the agents did and why it was trustworthy, and follow-up
conversations start.

## Positioning

One map, many agents. Every act runs on its own Amazon Bedrock AgentCore runtime with its own
tools and prompt, yet the audience sees one product: a shared map-and-chat shell and one
visual contract (`display_visual` with `render` hints) that every agent speaks. A single
monolithic assistant cannot truthfully claim this; the platform story is the headline.
Supporting proof, not the headline: everything runs on free and open data (Sentinel-2,
Sentinel-1, Clay embeddings, WDPA, EMIT, 3DEP, AIS), the agents encode geospatial rigor
(area guards, deterministic ranking, coverage-adjusted logic, explicit confidence), and
authoritative GIS data arrives through an ArcGIS Enterprise MCP alongside AWS.

## Operating Context

- Format: four acts of 4–8 minutes plus a 2-minute intro and close. Act 1 is the existing
  Earth Analyst agent with two new capabilities (visual inspection of imagery, similarity
  search on embeddings); Act 2 a Methane Hunter; Act 3 either Dark Vessels or Ground Motion
  Sentinel (decided Oct 24); Act 4 an AI Archaeologist as the closer. The act not shown
  appears as a short teaser in the close, alongside an observability trace of the agent's work.
- Environment: projector or large display (resolution unconfirmed; assume 1080p, plan for
  4K), conference network that may be slow; every act has a replay case that loads without
  live calls and a recorded backup video.
- Rituals: Friday release gates (tests, detector, golden prompts, promotion checklist,
  timed rehearsal); feature freeze Nov 3; rehearsals on the real projector resolution.
- Tooling in the loop: Kiro (spec-driven development), Strands Agents on AgentCore,
  MapLibre GL, TiTiler, DuckDB, the ArcGIS Enterprise MCP, Impeccable for design quality.
- Long-running steps are normal: AgentCore cold starts exceed 30 seconds; region scans and
  radar processing take tens of seconds. The presenter narrates over them; the UI must show
  the agent working rather than a blank wait.

## Capabilities and Constraints

Confirmed today (live runtime):
- Natural-language geospatial analysis over Sentinel-2: geocoding and boundary retrieval,
  NDVI/NDWI/NBR with per-class areas, two-date change detection (spectral composite + iMAD),
  state- and country-wide change hotspot scans on Clay embeddings, protected-area context and
  named protected-area display (WDPA), reverse geocoding, environmental impact figures,
  streaming chat with visible tool calls, map layers rendered through TiTiler, swipe compare,
  drawn areas of interest, three pre-computed scenario packs (LA fires, Lake Mead, Amazon field).
Planned for the demo (see `.kiro/specs/ROADMAP.md`):
- Visual inspection of imagery by the model, embedding similarity search, an agent switcher,
  Methane Hunter, AI Archaeologist, and one Act 3 agent; legend and opacity controls; an
  evidence gallery and tool timeline in the chat; a big-screen mode.
Constraints that future work must respect:
- Only public, already-known archaeological sites are shown; new candidates are never
  published or geolocated on screen.
- Maritime findings are "candidates" with stated confidence; terrestrial AIS coverage gaps
  are not evidence on their own; radar revisit means most gaps have no imagery.
- Area guards stay: pixel-level change detection is capped (5,000 km²); whole regions go to
  the embedding scan.
- Deploys name their target explicitly; the live runtime is never the place to try ideas.
Terminology the product uses: AOI (area of interest), scene, index (NDVI/NDWI/NBR), change
map, hotspot, embedding, replay case, act, agent, tool call, evidence chip, confidence.
Undecided (record, do not invent): Act 3 choice (Oct 24); projector resolution; whether the
demo UI changes are pushed to the public aws-samples repository.

## Brand Commitments

- Name for the demo: **Agentic AI for Earth**. Replaces "Geospatial Agent on AWS" in
  on-screen titles; the repository and sample name are unchanged. The agent may still refer
  to itself by role ("Earth Analyst", "Methane Hunter") rather than "GeoAgent".
- No Esri co-branding. AWS branding is not binding at this time (the AWS logo asset exists
  at `react-ui/frontend/public/AWS_logo_RGB_1c_White.png` and may be used or dropped).
- Voice: confident, precise, evidence-first. The agent states what it is doing in one
  sentence and leads with results; numbers carry units; places are named before coordinates.
- No UI constraints inherited from the open-source sample at this time; the demo UI may be
  demo-specific. Whether it is contributed upstream is undecided.

## Evidence on Hand

- Real analyses on real data: three scenario packs under `use-cases/` with Sentinel-2
  before/after imagery, index rasters and written narratives (Palisades fire severity, Lake
  Mead water loss 2020–2025, Rondônia field clearing vs the EUDR 2020 cutoff).
- Measured performance from the build log (internal, not third-party): a warm state-wide
  embedding scan completes in well under a minute; pixel-level change compute takes about
  2 seconds after downsampling.
- Architecture diagram `react-ui/frontend/public/geospatial-agent-on-aws.png`; scenario
  images `palisades_fire.png`, `amazon_eudr.png`, `lake_mead_drought.png`.
- Absent, and not to be fabricated: customer names, testimonials, third-party benchmarks,
  pricing, accuracy claims for the maritime or methane agents, any archaeological "discovery".

## Product Principles

1. **Show the agent working.** Every wait is filled with what the agent is doing, which tool
   it called, and what it found; never a spinner alone.
2. **Evidence before adjectives.** A claim on screen has a chip, a number with units, an
   overlay, or a citation next to it. Confidence is stated, and "I cannot confirm" is a valid,
   designed outcome.
3. **One platform, many agents.** New agents plug into the same shell and the same visual
   contract; consistency across acts is the proof of the platform story.
4. **Protect the live show.** Replay cases, dev runtimes, gated promotions and backups exist
   so nothing new is tried on the runtime that faces the audience.
5. **Legible from the back of the room.** If it cannot be read or understood at distance
   without hovering, it does not go on the presenter's screen.

## Accessibility & Inclusion

- Distance legibility: large type, high contrast, and no information that only appears on
  hover, because the audience reads a projector, not their own screen.
- Data colour must not rely on red/green alone (the current NDVI/change colormaps are
  red–yellow–green); pair hue with lightness or labels so colourblind viewers can read the map.
- Presenter controls (agent switcher, layer toggles, replay cases) must be keyboard reachable
  for reliable operation under stage conditions.
