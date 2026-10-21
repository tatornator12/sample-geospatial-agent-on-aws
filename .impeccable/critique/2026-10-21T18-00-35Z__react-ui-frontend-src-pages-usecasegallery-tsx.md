---
target: the replay gallery
total_score: 15
max_score: 36
na_heuristics: 9
p0_count: 1
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/pages/UseCaseGallery.tsx"
target_fingerprint: "sha256:b025980b1742f3afab39544bf4e29337d04fc07664b02c1c539fb463799808d2"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/stage-fixes-2/react-ui/frontend/src/pages/UseCaseGallery.tsx
timestamp: 2026-10-21T18-00-35Z
slug: react-ui-frontend-src-pages-usecasegallery-tsx
closed: true
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed in this workflow step; Assessment A written before the detector output was read)

Target: the replay gallery, `/use-cases` (`pages/UseCaseGallery.tsx`), headless Chrome at 1920×1080 and 1280×720 (`/tmp/stage-fixes-2/shots/before/gallery-*.jpg`), keyboard walk with Tab.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Coming Soon" is the only state; nothing says a replay calls no agent |
| 2 | Match System / Real World | 1 | "Featured Impact Scenarios", "Pre-loaded satellite analysis scenarios with quantifiable environmental impact metrics": the sample's marketing, not "replay cases" (the rail's own word) |
| 3 | User Control and Freedom | 3 | A case opens on the stage and the rail brings you back |
| 4 | Consistency and Standards | 1 | Eight amber "View Analysis →" blocks against the One Spotlight Rule; the page title is an `<h2>`; "Coming Soon" in title case |
| 5 | Error Prevention | 3 | The coming-soon card cannot be opened |
| 6 | Recognition Rather Than Recall | 1 | No act grouping: at 1280 only Act 1's three cases show above the fold and the presenter must remember which card belongs to which act |
| 7 | Flexibility and Efficiency | 0 | No case is keyboard-reachable: Tab goes from "Sign out" to the page container and back to the rail |
| 8 | Aesthetic and Minimalist Design | 2 | Images and metrics are good; the amber blocks shout louder than the cases |
| 9 | Error Recovery | n/a | No error states on this page (the stage owns a failed load) |
| 10 | Help and Documentation | 2 | Nothing says what a replay is or that the map still needs the network |
| **Total** | | **15/36** | Poor: inaccessible and off-brand |

## Design Specificity Verdict

LLM assessment: category-interchangeable. Same-size image cards with an amber full-width CTA under each is the default SaaS gallery; nothing ties it to the four acts or the show order. The imagery is the product's own and is the part worth keeping.

Deterministic scan: `impeccable detect --json react-ui/frontend/src/pages/UseCaseGallery.tsx`: `[]` (0 findings). The detector does not see the eight amber CTAs as a problem; the One Spotlight Rule does.

Visual overlays: not injected (headless capture only).

## Overall Impression

The cases are real and the images are strong; the page around them is the sample's. Biggest opportunity: group by act in show order, make every case a real button, and let amber appear only on the one card under the presenter's hand.

## What's Working

- Real figures per case, labelled, values in weight 600.
- The case images are the product's own map renders.

## Priority Issues

- **[P0] No case can be opened from the keyboard.** Why: PRODUCT.md requires presenter controls to be keyboard reachable under stage conditions; the cards are `div onClick` with no role or tabindex. Fix: each card's action is a `<button type="button">` whose `::after` covers the card, so Enter and Space work natively and the whole card stays clickable; a visible 2 px amber ring on the card while its button has focus. Suggested command: /impeccable harden.
- **[P1] Eight amber calls to action.** Why: the One Spotlight Rule; amber should mark the one thing the presenter is about to do. Fix: a quiet button at rest (label grey, hairline), amber only on hover and `:focus-visible`. Suggested command: /impeccable quieter.
- **[P1] No act grouping, no show order.** Why: the presenter looks for "the archaeologist's replay" and scans eight cards. Fix: one section per act in show order with the act's room name as an `<h2>`, no act numbers. Suggested command: /impeccable layout.
- **[P1] Wrong title and subline.** Why: the rail says "Replay cases"; the page says "Featured Impact Scenarios". Fix: `<h1>` "Replay cases" and one honest line on what a replay is. Suggested command: /impeccable clarify.

## Persona Red Flags

**The presenter (keyboard, under stage lights):** Tabs past "Sign out" and lands nowhere; has to reach for the mouse to open the fallback replay mid-act.

**The back-row architect:** sees eight identical amber bars and no sign of which act each case belongs to.

## Minor Observations

- Image `alt` repeats the heading (screen readers read the name twice); the images are decorative next to the `<h3>`.
- Inline styles throughout; hover lifts the card with a transform (motion that shows no work).

## Questions to Consider

- Should the Act 3 card show at all while it is coming soon? (Yes, unchanged: the Act 3 run owns it.)

Questions answered by the approved brief: scope is every Group A item (title, grouping, keyboard, one amber call to action, Act 3 card byte for byte); direction is DESIGN.md.
