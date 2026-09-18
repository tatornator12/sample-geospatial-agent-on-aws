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

Speed, if wanted, comes from the agent, not the model: pre-warming sessions before each act
(startup is ~8–10 s of every fresh session), folding `display_visual` into the following tool
turn (~2 round trips per prompt), and a shorter final report.
