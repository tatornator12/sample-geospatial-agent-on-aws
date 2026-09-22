# Model bake-off — 2026-09-18

Same agent image (dev runtime, eyes enabled), same seven golden prompts, one pass per model,
models swapped by env-only runtime update. Raw per-model reports (`*.json`) are written next to
this file by `scripts/bakeoff.py` and are gitignored; this note is the record.

| prompt | Sonnet 4.6 | Sonnet 5 | Fable 5.1 |
|---|---|---|---|
| vegetation-central-park | 59 s ok | 58 s ok | error |
| wildfire-palisades | 64 s ok | 56 s ok | error |
| water-folsom-lake | 52 s ok | 76 s ok | error |
| vegetation-hyde-park | 35 s ok | 55 s ok | error |
| scan-colorado | 40 s ok | 40 s ok | error |
| drawn-polygon-ndvi | 35 s ok | 41 s ok | error |
| cloudy-scene | 38 s ok | 38 s ok | error |
| **total** | **322 s, 7/7** | **365 s, 7/7** | **0/7** |
| prose written (chars) | 12,020 | 6,939 | — |

## Findings

1. **Sonnet 5 is not faster here.** It passed everything with correct tool ordering and wrote
   42 % less prose, yet the pass took 13 % longer overall (365 s vs 322 s). Per model round trip
   it is slower, and this agent makes ~10 round trips per prompt; it also geocoded twice on
   Hyde Park (extra trips). Single pass, so treat ±15 s per prompt as noise (Hyde Park on
   Sonnet 5 took 80 s in a probe run and 55 s here); the total-time direction is consistent.
2. **Both Sonnets see accurately.** Every inspection sentence named the right features
   (Serpentine, the JKO Reservoir, Folsom's exposed shoreline bands, Palisades burn scars).
   Sonnet 4.6 is more vivid and quantitative ("wide pale/tan exposed shoreline bands …
   significant drought drawdown"); Sonnet 5 is terser and once reasoned explicitly about the
   candidate list ("closest available date to Nov 15 within the window is 2025-09-26 — later
   autumn scenes were cloudier"). Neither misjudged a scene.
3. **Two integration facts surfaced, both fixed or documented:**
   - Sonnet 5, Opus 5 and Fable reject `temperature` ("`temperature` is deprecated for this
     model"). The agent now omits it for those families (`config.model_kwargs()`); Sonnet 4.6
     keeps 0.1.
   - **Fable 5.1 cannot run in this account yet:** every request fails with
     `data retention mode 'default' is not available for this model`. That is an account-side
     Bedrock enablement for this frontier model (a data-retention mode must be chosen for it
     in Bedrock model access), not a code path. Nothing was measured for Fable.

## Decision

Keep **Claude Sonnet 4.6** on both runtimes. Sonnet 5 is a viable, accurate alternative but
offers no speed gain for this workload, so there is no case for changing the live model seven
weeks out. Fable 5.1 stays the accuracy fallback if rehearsals ever show scene misjudgment,
and would need the Bedrock data-retention enablement first. Re-run with
`python scripts/bakeoff.py` after any prompt change that alters round-trip count; freeze the
model at the Nov 3 feature freeze.

Speed, if wanted, comes from the agent, not the model. Measured the same afternoon:

- **Pre-warming buys less than expected while the runtime is warm.** `scripts/prewarm.py`
  timed a trivial prompt on a fresh session at 2.7–3.3 s and on the same session again at
  1.7 s, so a new session costs ~1.5 s once the runtime is serving. Its real value is
  insurance against a fully cold runtime (first call after a deploy or a long idle), which is
  what PRODUCT.md's ">30 s" refers to. The stage adopts `/?session=<uuid>&agent=<id>` so a
  warmed session can be used on stage.
- **Where the first 8 s go:** not container boot but per-request work plus the first model
  turn (ArcGIS MCP tool listing, session manager, agent build, then the model writing its
  opening sentence and first tool calls).
- **Display rides along** (prompt: `display_visual` in the same response as the next tool call)
  took hold at the TCI step — `display_visual` and `run_bandmath` now arrive 0.3 s apart
  instead of a round trip apart — and saved ~5 s on a Hyde Park trace (43.5 → 38.5 s). The
  geometry-display fold did not take in that trace. Across the seven golden prompts the
  totals were 322 s before and 323 s after: one round trip per prompt is inside the ±10 s
  run-to-run noise, so this is a real but small win.
- **Geocoding was the fattest remaining target:** 8.6 → 21.8 s of the Hyde Park trace. The
  ArcGIS geocoder returned London, Ontario for "Hyde Park, London" and the model spent an
  extra round trip re-geocoding. The prompt now asks for the country in the first call for
  ambiguous names; the next trace geocoded "Hyde Park, London, United Kingdom" once (9 tool
  calls instead of 10). The OSM boundary lookup itself (~4–5 s) is network-bound.
- **Net effect on the same warm prompt, same model, same afternoon: 43.5 s → 31.2 s** (fold +
  first-call geocoding), a 28 % shorter turn with identical results on the map.
- **A genuinely cold runtime is ~30 s to the first tool call.** The first invoke after the
  version-18 deploy took 32.2 s to reach the first tool (vs 6.5 s warm a minute later). That
  is the case `scripts/prewarm.py` exists for: run it after every deploy and before each act.
- A shorter final report: measured and shipped the same evening, see the addendum below.

## Addendum: the final report is now spoken, not written (2026-09-18, dev v20)

`scripts/eval.py` now records `report_seconds` / `report_chars` (the prose after the last tool
call, i.e. what the room waits on) and keeps `report_text` in the JSON for review. Same model,
same seven prompts, same afternoon, one pass each:

| | v19 (headings + table + bullets) | v20 (2–3 sentences, list exception for scans) |
|---|---|---|
| passed | 7/7 | 7/7 |
| total | 288 s | **254 s (−12 %)** |
| final report, all prompts | 39.6 s / 8,562 chars | **15.6 s / 2,940 chars** |
| per prompt | 2.5–8.0 s | 0–4.7 s |

The earlier "7–8 s per turn" estimate was the upper end; the honest range on the long report was
2.5–8 s (8–14 % of a turn). The cut saves 2–5 s per prompt and the caption band now shows the
whole answer, e.g. *"Hyde Park on 2026-07-29: mean NDVI 0.47, with 45% of the park in dense or
very dense vegetation and 54% in light vegetation, and only 0.6% bare. The park is in healthy
mid-summer condition; …"* The two reports read in full (Hyde Park, Colorado scan) quoted the
tool figures exactly; `report_text` is stored from now on so every run can be checked. Detail is
still one question away because the tool results stay in the session history.

Frontend insurance shipped with it: `docentCaption` (`src/utils/caption.ts`) never speaks table
rows, separators or horizontal rules and strips blockquote markers, so if a model ever writes a
table again the band keeps showing the sentence before it instead of assembling fragments
mid-stream.

### Follow-up 2026-09-22 (dev v21): the record came back

Presenter feedback after testing v20: the transcript drawer lost the detailed breakdown, and the
caption band clipped the longer spoken answers. The format is now two-part — a compact table or
tight bullet list for the transcript (≤ ~120 words, exact tool values), then ONE plain 1–2
sentence paragraph that the caption band shows. Same seven prompts: **278 s total, 7/7, final
report 24.9 s / 6,025 chars** (v19: 288 s / 39.6 s; v20: 254 s / 15.6 s). ~10 s of report time
bought the record back; the caption still speaks only the closing sentences. Shipped alongside:
the caption speaks only complete sentences while streaming, removed tool calls leave a paragraph
break instead of gluing sentences ("…the scene.The NDVI…"), and event footprints (burn scars)
get a right-sized AOI via `create_bbox_from_coordinates(radius_meters=…)` — the Palisades run
now inspects 1024×1019 px over a 14×14 km box in one call instead of starting at 95×113 px.

## Addendum: pre-warm is now automatic

The stage fires `POST /api/agent/prewarm` for every new session id (page load, New session,
agent switch). The agent answers `{"prewarm": true}` with `warm` once its container is up, no
model call, nothing in the session history; a prompt that lands mid-warm waits for the boot
instead of colliding with it. Measured on a just-deployed (cold) runtime: the warm-up absorbed
a 23.7 s boot and the real prompt on that session reached its first tool call in 6.1 s.
`scripts/prewarm.py` remains for the two cases the UI cannot cover: right after a deploy (warm
the new image before anyone opens the stage) and a runtime that has sat idle for hours before
the show. Runtimes also expose `lifecycleConfiguration.idleRuntimeSessionTimeout` (currently
900 s); raising it for show day would keep warmed sessions alive across an act. Not changed yet.
