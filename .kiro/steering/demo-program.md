# Nov 9 demo program: working agreements

These rules apply to all work in this repo until the Nov 9, 2026 demo. Details and the
week-by-week plan live in `.kiro/specs/ROADMAP.md`; each release has its own spec under
`.kiro/specs/<spec-name>/`.

## Branches and releases
- `demo-stable` is what is deployed on the live demo runtime and CloudFront URL. Only
  `scripts/promote.sh` (or a deliberate, checklist-driven manual promotion) moves it.
- All work happens on `develop` (or short feature branches merged into `develop`).
- Every promotion is tagged `deployed-YYYY-MM-DD`. Never rewrite `demo-stable` history.
- Nothing new lands after Nov 3 (freeze); only fixes.

## Deploying
- `geo_agent/deploy.sh` and `deploy_with_langfuse.sh` refuse to run without
  `DEPLOY_TARGET=stable|dev`. Stable additionally requires `CONFIRM_STABLE=yes`.
- Use `DRY_RUN=1` to print the commands first. Use `DEPLOY_TARGET=dev` for anything
  experimental; it deploys a separate runtime (`geospatial_agent_dev`, or `DEV_AGENT_NAME`)
  with its own ECR repo and reads `.env.dev`.
- New agents live under `agents/<name>/` with their own runtime, prompt, tools and deploy
  target. The existing `geo_agent/` runtime is never where new ideas are tried.
- After every deploy, confirm the env vars persisted on the runtime and run one smoke invoke.

## Testing gates (Friday = release day)
- Python tools: pytest in `geo_agent/tests/` and `agents/*/tests/` with small fixtures.
- Frontend: vitest for `parsing.ts` and layer styling; `npm run design:check` (Impeccable
  detector) must exit 0 for files touched.
- Golden prompts: `scripts/eval.py` against the dev runtime before any promotion.
- Every agent ships one offline replay case that loads with no live calls.

## UI work
- The Impeccable skill is installed (`/impeccable <command>`). Run `critique` before touching
  a surface and `polish` after; the detector is the arbiter, never add ignores to silence it.
- Bounded surfaces only: agent switcher header, chat stream (tool timeline + evidence
  gallery), layers panel (legend + opacity), replay-case gallery, big-screen mode,
  per-agent layer styles driven by `render` hints on `display_visual`.
- Direction: map-first, dark, high-contrast data colors, a real typeface (not system
  defaults), monospace for identifiers and coordinates, no cards inside cards, motion only
  where it shows the agent working.

## Secrets and data
- Never commit `.env*`, `.bedrock_agentcore.yaml`, `*_role_info.json`, or
  `.kiro/settings/` (mcp.json holds a bearer token). All are gitignored; keep it that way.
- The ArcGIS MCP bearer token should move to Secrets Manager before the repo is shared.
- Archaeology work shows only public, already-known sites; never publish new candidates.
