---
target: How it works
total_score: 10
max_score: 24
na_heuristics: 1,5,7,9
p0_count: 1
p1_count: 2
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/pages/Technology.tsx"
target_fingerprint: "sha256:9d024ff4782fcb9d1ef275b27d5356167f990df622d4cb68db128d96d3d120ae"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/pages/Technology.tsx
timestamp: 2026-10-21T18-00-58Z
slug: react-ui-frontend-src-pages-technology-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A written before the detector output was read)

Target: "How it works", `/technology` (`pages/Technology.tsx`, 851 lines), headless Chrome at 1920×1080 and 1280×720 (`/tmp/stage-fixes-2/shots/before/howitworks-*.jpg`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | n/a | Static reading page |
| 2 | Match System / Real World | 1 | "GeoAgent", "ReAct", "System Prompt", "think Python functions": builder jargon for a mixed room |
| 3 | User Control and Freedom | 3 | Expanders open and close |
| 4 | Consistency and Standards | 1 | Titled "Technology" under a rail link "How it works"; "Geospatial Agent on AWS" contradicts the show's name (PRODUCT.md Brand Commitments) |
| 5 | Error Prevention | n/a | No input |
| 6 | Recognition Rather Than Recall | 2 | The content is behind five expanders without `aria-expanded` |
| 7 | Flexibility and Efficiency | n/a | Read, not operated |
| 8 | Aesthetic and Minimalist Design | 2 | Long, with a three-tier architecture section below the fold |
| 9 | Error Recovery | n/a | No error states |
| 10 | Help and Documentation | 1 | Says nothing about the four agents, their data, or who decides |
| **Total** | | **10/24** | Poor: the sample's page, not this show's |

## Design Specificity Verdict

LLM assessment: not this product. It describes one "GeoAgent" that "autonomously" plans tasks for "any location on earth"; the show has four agents, a shared map stage, and a person who decides. It also overclaims against the deck's slide 4 ("A foundation model calls tools"; how freely varies by act).

Deterministic scan: `impeccable detect --json react-ui/frontend/src/pages/Technology.tsx`: `[]` (0 findings).

Visual overlays: not injected (headless capture only).

## Overall Impression

The page is the open-source sample's. The biggest opportunity is a short, honest page that says what slide 4 says, in the same order, so the presenter can open it and the room hears the same story.

## What's Working

- The type scale and the dome colours are already the show's.

## Priority Issues

- **[P0] Wrong name and an overclaim.** Why: "Geospatial Agent on AWS" and "autonomously plan and execute" contradict the brand commitment and the deck's careful "calls tools". Fix: replace the page: "How it works", four agents in show order, one runtime each, a foundation model choosing and chaining tools over real data. Suggested command: /impeccable clarify.
- **[P1] Nothing about the four acts, their data, or the human decision.** Why: the page cannot back up the intro. Fix: one row per agent with its data sources (facts.md §3), a paragraph on how a turn runs, and "A person decides". Suggested command: /impeccable distill.
- **[P1] Content behind expanders with no `aria-expanded`.** Why: hidden content and an inaccessible control; a one-screen page needs neither. Fix: no expanders. Suggested command: /impeccable distill.
- **[P2] Typos ("reponses", "workflowdata").** Fix: gone with the rewrite. Suggested command: /impeccable clarify.

## Persona Red Flags

**The back-row architect:** reads "GeoAgent" and "autonomously" and has to reconcile it with the presenter saying "a person decides".

**The presenter:** cannot show this page during the intro without contradicting slide 4.

## Minor Observations

- An architecture PNG and a three-tier list below the fold: internal detail for this audience.

## Questions to Consider

- Should the page name the model? (The deck's notes say it aloud; the page keeps to "a foundation model", as slide 4's body does.)

Questions answered by the approved brief: copy follows slide 4 and facts.md; no overclaiming, no em dashes, British spelling, nothing internal.
