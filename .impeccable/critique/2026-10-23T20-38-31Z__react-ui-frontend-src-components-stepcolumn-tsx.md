---
target: "Methane Watch following beat: step column, legend, brief card (before the bars)"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-bars/react-ui/frontend/src/components/StepColumn.tsx"
target_fingerprint: "sha256:8c943a0f3e7e573fbe890c7f5c4ad229f472ea8b40ff3dde1471e3f57f9a7a61"
target_path: /Users/tsteske/Documents/repos/sample-geospatial-agent-on-aws-main/.worktrees/methane-bars/react-ui/frontend/src/components/StepColumn.tsx
timestamp: 2026-10-23T20-38-31Z
slug: react-ui-frontend-src-components-stepcolumn-tsx
closed: true
---
Method: dual-agent (A: kirocrew-worker, design review · B: kirocrew-worker, detector and browser overlay)
Target: the Methane Watch following beat before the bars change: the step column (`react-ui/frontend/src/components/StepColumn.tsx`, with `TipBoard.tsx`, `PassFilmstrip.tsx`, `RecordTimeline.tsx`, `utils/steps.ts`), the map's methane legend (`MapView.tsx` renderLegend, `utils/layerStack.ts`, `utils/methaneLayers.ts`) and the brief card (`BriefCard.tsx`, `utils/record.ts`). Evidence: the `methane-watch-record` replay at 1920x1080 and 1280x720 on branch methane-bars (develop 4ec4763 frontend), DOM geometry and the source. Assessment A could not view the PNGs (no image tool in its session) and worked from DOM geometry and pixel statistics.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | A new follow step would have no plan stage; in the end frame the plan strip is scrolled 943 px out of view |
| 2 | Match System / Real World | 2 | "Cue", "fine-scale", "candidate passes", "within noise", the agent's layer title "TROPOMI CH4 Anomaly" |
| 3 | User Control and Freedom | 3 | The card's scroll-into-view jumps past the board and timeline; back is a manual 940 px scroll |
| 4 | Consistency and Standards | 2 | Dates in four formats on one screen (ISO in layer rows, "7 to 21 Oct 2026", "Jan 2025", "since 2025-01-01") |
| 5 | Error Prevention | 3 | Numbers from manifests only; "Methane recurs here: Low" under "Unconfirmed methane tip" invites misreading |
| 6 | Recognition Rather Than Recall | 2 | The why (timeline) sits about 1,000 px above the what (decision line) |
| 7 | Flexibility and Efficiency | 3 | Restack, Show all, prepared prompts; no jump from the card to the followed site's record |
| 8 | Aesthetic and Minimalist Design | 2 | "+122.6 ppb" printed 3 times, "Carbon Mapper … 7 km" 4 times, the decision told twice |
| 9 | Error Recovery | 3 | "could not be checked", "Try again"; an unknown tool shows raw (`stepName` "follow site") |
| 10 | Help and Documentation | 3 | Legends in words; the timeline key lists "methane seen" with no seen marks |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** specific to this product (plan strip, ice tip board, EMIT filmstrip, the record timeline's colour-is-source and shape-is-result grammar, the brief's chain). The risk is volume, not genericness: the end frame is 2.6 screens at 1080, and the bars change adds the map as a third place that tells the same story as the timeline and the card.

**Deterministic scan:** `impeccable detect --json react-ui/frontend/src` printed `[]` (exit 0); the five target files alone `[]`. The detector was confirmed live on a synthetic gradient-text file (exit 2).

**Visual overlays:** injection worked at both sizes (10 findings default, 15 with all steps). Real, outside this change's scope: the basemap plate covers 33% of the "© Esri" attribution (known). False positives: `ai-color-palette` on the tip board's 4 px bars (the TROPOMI ice ramp, data-tied), `cramped-padding` on the two prepared-prompt buttons (32 px box, 14 px text, centred), `text-occlusion` in the brief chain (a wrapping inline span's two-line box), `clipped-overflow-container` on the full-viewport roots (intentional).

## Overall Impression

The argument is drawn well up to the following beat, then said three times (timeline foot, card line, and the coming decision line) and shown once only after the column has scrolled past it. The single biggest opportunity: one home per point. The follow step carries the decision, each bar layer's display step carries its date, the card carries the recommendation, and the timeline carries the marks, not the words.

## What's Working

- Provenance discipline: every number and name on these surfaces is read from a tool manifest or the stage's own tables; no model text reaches them.
- The record timeline's grammar: colour says the source, shape says what a look found, one bracket says the gap. It is the picture the bars now tell on the map.
- The ppb-is-cool, ppm·m-is-hot split already holds (the board's ice bars, plasma for EMIT), so tip bars in ice and record bars in plasma fit the system.

## Priority Issues

**[P1] The follow decision would be told three times, and the end frame shows only the last.** The timeline foot (`RecordTimeline.tsx:97-107`) and the card's line (`BriefCard.tsx:60-77`, `record.ts:178-200`) already say the gap; a follow line would be a third copy. Fix: the decision lives under the follow step (code-written from follow.json); the timeline foot drops its gap words when a follow manifest exists; the card keeps the recommendation and the days, never the date again. Suggested command: /impeccable distill

**[P1] The steps where the plate lines go are empty and fold away.** "Put it on the map" appears three times with no line (`groupDetail` returns null for `display_visual`); the collapsed end frame shows only pinned groups (`StepColumn.tsx:153,173-177`); `follow_site` has no step name or plan stage. Fix: name the follow step and the two bar displays, give each its plate line as `.step-detail` (15 px), pin them like the board and the cue; plain displays stay unpinned. Suggested command: /impeccable clarify

**[P1] Copy leans on method words.** "fine-scale" in three sentences, "Cue", "within noise", "Methane recurs here: Low" under an unconfirmed title. Fix: plain words in the new lines ("close look", "methane in the air than usual"), and keep the card's existing words unless the change touches them. Suggested command: /impeccable clarify

**[P2] Dates in four formats; the new legend rows would add more.** Fix: every new stage date through `dayMonthYear` / `windowWords`, each bar layer's date once in its legend row and once in its plate line. Suggested command: /impeccable clarify

**[P2] Two kinds of bars, one legend grammar not yet settled.** TROPOMI's legend leaves past zoom 8 (its raster cap) and a capped tip-bar layer would vanish at the bars' zoom; both bar kinds would read "taller column, more methane"; Carbon Mapper is mint on the map and timeline. Fix: one uncapped legend row per bar layer with its date, units in the note, Carbon Mapper's source line beside its bars, and its name in the row (plasma is its unit, ppm·m). Suggested command: /impeccable colorize

## Persona Red Flags

**The presenter on a projector:** to show why the agent followed, scrolls about 940 px (1080) or 1,100 px (720) back up while talking; at 720 the card's status is below the fold.

**A back-row audience member:** timeline marks 10 px, the TROPOMI band an 8 px sliver at the right of a 22-month axis; the tip board bars 4 px.

**Sam (keyboard, screen reader):** per-mark dates are `title` only; the gap bracket is `aria-hidden`; the plan strip's `aria-current` exists only while live.

## Minor Observations

- "following" joins the area name as one string for a screen reader.
- The chain (15 px) leads the 19 px title; title and verdict values are both 19 px.
- `.map-layers__count` is 13 px mono.
- No em or en dashes found in rendered text.

## Questions to Consider

- If the record bars stand the plume up on the map, does the column still need the timeline's words, or only its marks?
- Should Carbon Mapper keep its mint when it becomes columns, or is plasma right because the unit is the same as EMIT's?
- For an unconfirmed case, should the end frame land on the follow step (the reason) rather than the card (the verdict)?

Questions skipped: the presenter's approved brief (2026-10-23, items A to E) already fixes the direction and scope for this change (tip bars then record bars, a code-written decision line, legend rows with dates, plain words); the P1s and P2s above are taken into the build, and the out-of-scope findings (attribution overlap, card verdict wording, 13 px layer count) are left as they are.
