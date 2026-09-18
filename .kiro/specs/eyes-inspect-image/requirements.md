# eyes-inspect-image — requirements (DRAFT, to be written Monday Sep 22)

> Week 2 spec (Sep 22–26). Seeded at gate G1 per the roadmap cadence: requirements and
> design are written and approved on Monday before any code. This stub only pins the
> scope agreed in `.kiro/specs/ROADMAP.md`; do not implement from it.

## Scope (from the roadmap)

Act 1 gains "eyes": the agent visually inspects the imagery it analyzes.

- A tool that renders selected rasters/scenes to images the model actually looks at
  (multimodal inspection), so the agent can reject cloudy/broken scenes and describe what
  it sees before analysis.
- An evidence gallery in the chat stream: the images the agent inspected, as chips the
  presenter can enlarge (bounded UI surface per steering).
- A cloudy-scene golden prompt added to `scripts/golden_prompts.json`, passing against dev.

## Gate (Friday Sep 26)

Tool + gallery + cloudy-scene golden prompt pass.

## Inputs to Monday's session

- Spike learnings that inform this spec: TiTiler needs `Accept: image/png` behind API
  Gateway; plume/scene COGs render in ~0.3 s warm; per-agent `render` hints on
  `display_visual` are the demo UI contract.
- Constraints: Back Row rule (evidence legible from distance), no new runtime — this lands
  on `geospatial_agent_dev` via `DEPLOY_TARGET=dev`.
