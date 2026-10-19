# Design: act3-dark-vessels

Status: **Approved Oct 16.** Decisions 1, 2, 4, 5 and the EventBridge part of 6 were agreed on
Oct 15; 7 and 12 on Oct 16; 11 was closed by test; 3, 6, 8, 9 and 10 were approved on Oct 16 (the
user: "Orchid", "whatever your recommendation is", "go ahead", "your recommendations and add
silent-vessel beat").

## Overview

Two weeks, five pieces:

1. `agents/dark-vessels/`: a fourth AgentCore runtime with its own tools (`find_pass`,
   `detect_vessels`, `check_ais_coverage`, `match_ais`, `gather_evidence`, `predict_hotspots`,
   `fleet_pattern`, `next_look`, `reachable_area`, `draft_tasking`, `tasking_status`) and the
   platform's `display_visual` and `inspect_image`.
2. An offline build that caches the passes on file and everything the predictions need, from
   Planetary Computer (Sentinel-1 GRD) and the Global Fishing Watch API, identity stripped, into
   `vessels/cache/v1/`. The runtime never calls GFW and never holds its token.
3. The method, already built and tested: `cfar.py` (our detector), `plan.py` (ESA's acquisition
   plan), `predict.py` (the hotspot map, its held-out check and the patrol boxes).
4. The officer's decision: a patrol tasking chosen and approved on the map, filed by the backend.
5. The stage: a `maritime` render group, the targets by status, heard and unproven water, the
   hotspot map and patrol boxes, the fleet's heat, the next pass, a resting state, the radar's
   arrival, prepared prompts, a gallery card, a replay case and GFW's attribution.

Verified premises (Oct 15, `docs/spikes/galapagos.md`):

- Sentinel-1 frames cover about −94° to −88°, −2.5° to +2.5°: the reserve and the water around it,
  not the EEZ edge. Reserve box: 242 frames on 117 days in the last year.
- GFW radar detections inside the reserve (region `public-mpa-all` 11753), no AIS: 41 (2024), 109
  (2025), 183 (2026 to Oct 12); matched: 346 to 803 a year. 148 of 2026's 183 lie 10 km or more from
  the five ports.
- Our CA-CFAR on the raw 2024-03-06 pass (VV at 40 m, a 90 km window in 2.1 s, detection 0.5 s)
  matched GFW's one dark target that day within 0.58 km.
- `predict.py` on the reserve, ports left out, fitted on 2023–25, checked on 2026 (147 dark
  targets): top 1% of the water held 26% (25.9×), top 5% 53% (10.6×), top 10% 66% (6.6×).
  Patrol boxes: north of Santa Cruz (8% of past dark targets), west of Isabela (6%), south-east of
  Santa Cruz (4%).
- ESA's plans (Oct 16): S1D has six IW takes over the reserve to Nov 5 (orbits 106, 128, 33, 55;
  24 to 54% of it each); S1C has none. Each patrol box gets a full look within ten days.
- The squid fleet near the Galápagos (north of 8°S) every June to August 2017–2025; none in 2026
  after May (it stayed off Peru, 34,000 to 43,000 fishing hours a month, and Chile). The built
  fleet file's rule (present in at least half of the years) expects June to September; the agent
  says that.
- AIS-off events near the reserve: 5,659 in 2023–26 (fishing 1,448), 2 starting inside it; five
  moments since 2023 where a pass saw a silent vessel's water with a dark target in reach.
- GFW API: token works; Cloudflare needs a User-Agent; one report at a time, 366 days at most;
  responses carry identity unless stripped; the reserve and EEZ exist as region layers.
- How recent (Oct 16): GFW's radar detections reach Oct 12 (passes with dark targets in the radar
  box on Sep 30, Oct 5 and Oct 12) and its AIS presence reaches Oct 12 (hourly, about 3,500 vessel
  hours a day in the box). AIS for Oct 10 to 12 over the reserve: 279 vessels (passenger 134, other
  100, cargo 16, fishing 15), 218 of them moving more than 5 km; one hourly report took 2 s.
- The prediction on the newest data: fitted on 2023 to Jun 30, 2026 and checked on Jul 1 to
  Oct 12, 2026 (51 dark targets away from ports), the top 5% of the water held 55% (11.0×) and the
  top 10% held 76% (7.6×). Fitting on the last 12 months alone did worse (49% in the top 5%), so
  the map uses all history; the forward map adds everything to Oct 12. On the built cache's own
  history (Oct 16: 329 dark detections away from the ports, 49 in the hold-out) the same check
  gives 45% (9×) in the top 5% and 57% (5.7×) in the top 10%; that is the number the agent says.
  SPREAD 1 is the best of 0 to 3 on it (35%, 45%, 39%, 35%), so it stays.
- The seabed: the AWS Terrain Tiles carry bathymetry (zoom 7 over the islands: −3,851 to +2,115 m,
  92% of the tile under water), and MapLibre 6.11 draws it with a `color-relief` layer and a
  `hillshade`. Prototyped on the stage Oct 16 (below, component 11).
- Truly live AIS: not available from GFW (96 hours behind) or NOAA (months). aisstream.io offers a
  free live WebSocket that must be proxied through our server, with coverage from volunteer
  receivers that is unverified around the Galápagos; a coverage check needs a key (decision 11).

## Architecture

```
agents/dark-vessels/
  dark_vessels.py        entrypoint (the shared contract; tool list swapped)
  vessels_config.py      prompt + model kwargs
  cfar.py                our detector (built: 10 tests)
  plan.py                ESA's acquisition plan (built: 8 tests)
  predict.py             hotspot map, held-out check, patrol boxes (built: 6 tests)
  reach.py               water-only reachable area (Dijkstra on a grid; pure python heapq)
  pass_tools.py          find_pass, detect_vessels
  ais_tools.py           check_ais_coverage, match_ais, gather_evidence
  forecast_tools.py      predict_hotspots, fleet_pattern, next_look, reachable_area
  tasking_tools.py       draft_tasking, tasking_status
  data/passes_v1.json    the passes on file (curated)
  data/reserve_v1.geojson  the reserve, its zones, its ports (sources on every feature)
  deploy.sh  golden_prompts.json  build_replay_case.py  tests/

scripts/build_vessel_cache.py   (offline, builder-run; GFW token from agents/dark-vessels/.env)
  passes_v1.json → Planetary Computer STAC + SAS → each frame read in its own radar geometry at
    20 m (the 2x overview) → land mask → cfar (train 41, guard 15, k 6) → <pass>_targets.json;
    the frames mosaicked north-up → <pass>_vv.tif (COG, int16 centi-dB) + <pass>_display.tif (uint8)
  GFW per pass day: SAR detections matched / unmatched (0.01°), AIS presence ±3 h (one position per
    vessel per hour, 0.01°, no key) → into <pass>_targets.json and <pass>_presence.json; the replay:
    the three days to the pass as tracks under a random number per build (never derived from a
    vessel id), type and size class only → <pass>_replay.json
  --chips: a north-up 10 m chip (about 1.3 km) round each of our targets → <pass>_chip_<id>.tif
  GFW history: reserve dark detections daily 2023→, AIS-off events near the reserve 2023→,
    squid-jigger fishing effort monthly by 0.1° cell 2017→ → history_v1.json, fleet_v1.json
  → s3://<bucket>/vessels/cache/v1/… + manifest.json; a scan fails the build on any identity field
scripts/warm_vessels.py   ESA plan KMLs → vessels/cache/plan/ (the day before and the morning of)

model ── find_pass("latest")          → {pass_id, satellite, sensed, radar_s3_url, render}
      ── inspect_image → display_visual             "open water, the islands blanked out"
      ── detect_vessels(pass_id)       → {ours 16, gfw 12, both 6, port 3, targets 22}
      ── check_ais_coverage(pass_id)   → {heard_share 0.298, heard_s3_url, unproven_s3_url}
      ── match_ais(pass_id)            → {broadcasting 4, port 3, unproven 2, seen once 9, candidate 4}
      ── gather_evidence(pass_id)      → chips, nearest broadcast, zone, km to port and shore
      ── reachable_area()              → {Mar 6 2024, fishing, 6 kn, 12 h, 133 km, 1 target inside}
      ── predict_hotspots()            → {check: 45% in 5% (9×), heat_s3_url, boxes[3] + next looks}
      ── fleet_pattern()               → {June to September, 2026 missed, off Peru, heat_s3_url}
      ── next_look(box)                → {S1D Oct 24 00:17 UTC …, footprint_s3_url}
      ── draft_tasking(...)            → draft; stop. "Decision: the officer's."
UI    ── the officer picks a box and the candidates → Approve the tasking
         → POST /api/tasking/approve → taskings/<id>.md + snapshot (+ Slack) → tasking_status
```

## Components

### 1. The passes on file and the build

`data/passes_v1.json`: five to eight Sentinel-1 passes over the reserve, 2025–26, each with its
scene id, satellite, sensing time, orbit and share of the reserve, and a builder's note. The star
is chosen on day 1 by a rule set now (decision 3): at least two candidates inside the reserve in
heard water, seen by both detectors, the most recent pass that has them. The spike's 2024-03-06
pass stays on file for the silent-vessel beat.

Day 1 (Oct 16, `scripts/list_vessel_passes.py`, GFW's detector alone until the build adds ours):
217 Sentinel-1 passes over the reserve from Jan 1, 2025 to Oct 12, 2026, 51 of them with at least
two unmatched detections 10 km or more from a port. On the eight newest of those, the coverage
rule hears 23 to 37% of the reserve. The star is `s1d-20261012t0018` (Sentinel-1D, ascending,
orbit 33, 55% of the reserve): 7 candidates, heard 29.8%, none unproven. The alternates are Sep 30
(6 candidates), Sep 18 (5), Sep 7 (2, the descending orbit 55) and Aug 30 (2). The silent vessel's
pass is `s1a-20240306t0027`. The records (`scripts/build_vessel_records.py`) hold the reserve
(WDPA version 2026-10-01 through GFW, 0.0005° simplified, the islands as holes), the five ports
and 74 land polygons from the Terrain Tiles. That land covers 8,614 km², and 93% of it falls in
the reserve's holes. The reserve's internal zoning is left out because no licence was found.

The build reads each scene once (Planetary Computer, anonymous SAS, `/vsicurl/` reads of each
frame's 2x overview, 20 m, in its own radar geometry; the GCPs place each target), applies a land
mask (the 74 Terrain Tiles polygons, buffered 500 m), runs `cfar.detect` there, writes the north-up
crop (int16 centi-dB) and a display copy, and asks GFW. The 44 m mosaic was tried first and paired
only 5 of GFW's 12 on the star; at 20 m it pairs 6. GFW's other detections peak only 7.6 to 10.5
dB over the sea even at 10 m, so no CFAR that is not mostly speckle finds them (k 5 gives 87
targets, k 4 976): the two detectors stay side by side, and a candidate needs both. The build asks GFW
for that day's detections and the AIS presence around the pass. History for the predictions comes
from GFW in yearly reports (the 366-day limit), one at a time. Every GFW response passes through the
spike's scrub (names, MMSI, IMO, call signs, flags, vessel ids) before anything is written, and a
final scan of every cached file fails the build if any identity field or a 9-digit MMSI-like number
appears.

### 2. `find_pass` and `detect_vessels`

`find_pass` resolves "latest" or a date to a pass on file, copies its display COG into
`session_data/<sid>/vessels/`, and returns `render {raster, gray, group maritime, legend "Radar
backscatter", bounds}`. `detect_vessels` reads the cached targets (ours) and GFW's detections,
pairs them within 1 km, marks anything within 10 km of a port `port`, and writes one GeoJSON of
targets with `source` (ours, gfw, both) for the map.

### 3. `check_ais_coverage` and `match_ais`

Heard water (decision 3, `ais_coverage.py`, named so it never shadows the `coverage` package):
from the cached presence, a 0.05° cell is heard when, in
at least one hour of the three either side of the pass, two or more different broadcasting vessels
were heard within 30 km of it (proof that the receivers, mostly satellites here, could hear that
water then); otherwise unproven. Two vessels in the same hour is stricter than two across the
window, needs no link between one hour's positions and the next, and on the Oct 12 pass gives
29.8% of the reserve against 30.8% and the same seven candidates. The map draws the cells as one
rounded shape (closed and opened by about 3 km so no cell seams show), and the tool checks that
every target's status agrees with the drawn shape before it returns. The tool writes the heard and
unproven areas and a coverage record `match_ais` requires. `match_ais`
gives each target one status: `broadcasting` (GFW matched it), `port`, `unproven`, `candidate` (no
match, heard water, both detectors), `seen_once` (one detector only; never a candidate). It
rewrites the targets GeoJSON so the map's marks change in place.

### 4. `gather_evidence`

Per candidate (at most six): a 1.2 km chip from the 40 m crop (a COG in the session, so
`inspect_image` and the evidence gallery read it), both detectors' readings, the nearest
broadcasting vessel from the presence cache (km, minutes, type and size class only), the reserve
zone it lies in, km to the nearest port and shore, the fixed confidence sentence, and the innocent
explanations from a fixed list (`small_boat_no_ais`, `reception_or_equipment`, `transponder_off`,
`not_a_vessel`), each with what would confirm or rule it out.

### 5. `predict_hotspots` (prediction one)

`predict.py` on the cached reserve history, port water left out, cells of 0.05° spread over their
neighbours. Returns the held-out check (fit before Jan 1 of the latest year, test on that year),
the map (a COG of the score for the stage), and three patrol boxes of 0.2°, each with its share of
past dark targets and its next full looks from `plan.py`. The agent reads the check aloud the way
it was measured; the map's legend says "where dark targets were seen before".

### 6. `fleet_pattern` (prediction two)

From the cached squid-jigger fishing effort (monthly, 0.1° cells, 2017→): hours by month and zone
(near the Galápagos north of 8°S, off Peru 8 to 20°S, off Chile south of 20°S); the months the
pattern expects the fleet near the Galápagos (present in at least half of the years); each season
matched or missed; the latest month's heat as a COG. In 2026 the pattern expected June to September and
the fleet stayed off Peru; the agent says it in one sentence and shows where the fleet went.

### 7. `next_look`

`plan.py` over the cached plans (`vessels/cache/plan/`); a plan older than 24 h triggers one
refresh (8 s timeout: the listing page, then the KMLs); on failure, the cached plans with their
date. Per satellite the plans are a chain (`plan_chain`, `merge_takes`): the newest plan, then any
older plan still running past it, each date taken from the newest plan that covers it. ESA lays
six-day plans over three-week ones: on Oct 19 the newest S1D plan ran only to Oct 25, and taking
it alone dropped the Oct 29 look west of Isabela, so box 2 said "no look planned yet" although the
Oct 16 plan, still ESA's latest word for Oct 26 to Nov 5, has it. Plans published more than 21 days
ago are left out (the listing carries an odd S1D plan of Sep 15 to Dec 5). Returns the next IW
passes covering the asked share, and the first one's footprint for the map.

### 8. `reachable_area` (the silent vessel, decision 10)

`reach.py`: a 0.01° grid over the radar box (about 600 × 500 cells), the islands as obstacles from
the land mask, 8-connected, Dijkstra from the vessel's last position (pure python `heapq`, about a
second). The area is every cell within speed × hours; speed is stated (the gap's implied speed
rounded up, at least 6 kn, or the presenter's). Returns the area, the targets inside it, and where
the AIS came back on. In the run it plays on the best silent-vessel moment on file (today
2024-03-06: a fishing vessel's AIS off 12 h before the pass just west of the reserve; at 6 kn it
could have reached 133 km by water, and the day's one dark target lies 51 km from where it went
off; it came back on 30 h later, 26 km away). Day 1 reruns the moment search to Oct 12, 2026 and
takes a newer moment if one holds (it ran: none does, task 1.1).

### 9. The tasking and the officer's decision

`draft_tasking(box, candidate_ids, look, notes)`: the box one of `predict_hotspots`' three, the look
one of `next_look`'s passes, notes at most three sentences of 220 characters, checked for the
forbidden phrases and identifier patterns. The counts, coverage, candidates and check come from the
session's own records. Written to `session_data/<sid>/taskings/<id>.draft.json`.

The decision happens on the map, not in a card: the three boxes are drawn with their share and next
pass; selecting one lifts it; candidate marks can be toggled in or out; a tasking plate (bottom
right, the light plate's slot) shows the choice, a countdown to the look, and "Approve the tasking"
(primary) and "Not now" (quiet). Backend: `GET /api/tasking`, `POST /api/tasking/approve` on a
filing core lifted out of the brief route (draft from S3, never the browser; markdown, snapshot,
then `<id>.filed.json` last; idempotent; Slack fire-and-forget); the brief's tests stay green. Infra:
the backend role's `s3:PutObject` grant gains `session_data/*/taskings/*` (shown and confirmed
before deploy).

### 10. Prompt

The Methane Hunter's sections for the sea: HARD RULES (passes on file; the order pass, look,
detect, coverage, match, then words; candidates never accusations; type and size only, no flags;
predictions only as measured; never file anything), RESPONSE STYLE (no em dashes), FINAL REPORT,
CONFIDENCE, DISPLAY RIDES ALONG, LOOK BEFORE YOU ANALYSE, WORKFLOW (three turns), THE OFFICER'S
DECISION, UNITS (km and nautical miles at sea, knots, UTC, dB), ATTRIBUTION (say "data from Global
Fishing Watch" once when its data first appears).

### 11. The stage and the look (decision 7)

- `render.ts` gains the `maritime` group; `utils/vesselLayers.ts` owns the styles by group or file
  name so the stage wins over a drifting hint. Statuses read by shape and label as well as hue:
  `broadcasting` a fog dot tied by a hairline to its AIS position; `port` a small fog square;
  `unproven` a label-grey hollow ring with "not evidence"; `candidate` a ring in the act's one data
  colour, orchid #f07ad8 (chosen Oct 16 over lime and lilac: it holds against the cyan AIS and the
  radar and stays apart from the amber UI accent), with a mono label (`T07  no AIS`); `seen_once` a
  faint dot. Never red, never amber.
- **The way of seeing: the sea from below, at night** (prototyped Oct 16, `/tmp/vessels_look/`).
  The other acts look at land (a flat satellite map, a globe from space, the ground at dusk); this
  one looks at the water. The satellite basemap goes; the ground is the seabed from the Terrain
  Tiles' bathymetry, a `color-relief` from near-black abyss (#03070d at −4,200 m) through deep blue
  to the platform's lighter blue (#244c62 just under the surface), shaded at a low exaggeration; the
  islands are dark silhouettes (#0b0e12 to #161b22) with their names in label grey; the reserve is a
  dashed fog hairline. Flat and north-up: a chart, not a landscape.
- **The traffic in motion.** The latest three days of AIS on file play back on the seabed: every
  track's whole wake as a faint long exposure (13% opacity, the routes between the islands appear
  as a network), the last four hours as a comet tail (a `line-gradient` from clear to pale cyan
  #9fd3e6), and each vessel's head as a fog dot moving between its hourly positions (interpolated
  only across gaps of three hours or less; a longer gap breaks the wake). A clock plate at the top
  centre says what the room is watching in mono: "AIS 2026-10-12 12:00 UTC 193 vessels
  broadcasting". At rest it runs at about one hour every four seconds and loops; when the radar
  pass lands it stops at the pass's minute, so the claim beat happens on a frozen sea. Under reduced
  motion it shows the long exposure and the heads at the pass time, still. It is labelled as a
  replay with its date, never as live.
- Rest also shows the reserve, the ports as small marks, and "Powered by Global Fishing Watch." in
  the attribution.
- The radar arrives as a sweep along the satellite's ground track (a dome mask drawn back over about
  2.5 s; a dissolve under reduced motion); each target lights as the sweep passes it.
- The claim: each broadcasting vessel's track draws a hairline to its target; the targets left alone
  stay plain grey rings with no label, because nothing is called dark before the coverage check.
- Heard water is lit softly; unproven water is hatched with its label.
- Only then the candidates: the left-alone rings in heard water turn orchid, grow, and take their
  labels; the clock says "{n} candidates   radar targets with no AIS, in heard water".
- The beats as prototyped (Oct 16, five headless rounds on the stage with the Oct 12 data,
  `/tmp/vessels_beats/r5/`): rest, the radar grey and tinted (one shared dB stretch, never pure
  white, ten strips a scene for the sweep), the claim, coverage, candidates, the hotspot, the fleet.
  A ring is something the radar saw, a dot something AIS heard. The heat ramp is the candidates' hue
  (clear to orchid to a pale orchid-fog), its radius about 2.2 cells at every zoom so the surface
  reads as a field; patrol boxes say "k  NN%" at 18 px; the fleet's heat is in the AIS hue. Island
  names are placed per view, each hugging its own coast and scored against traffic, targets, other
  islands and the safe frame (hidden rather than clipped); coverage and next-look labels search a
  grid inside their region. The clock plate keeps its spaces (`white-space: pre`). The stage
  pre-loads the act's seabed tiles for every view before the beat (round 4's rest still was taken
  with its edge tiles missing).
- The prediction: the hotspot heat settles over the reserve, the three boxes outline, each with its
  share and the next pass's time; the next pass's swath crosses the frame at its planned angle.
- The fleet: the camera rises and pulls back two thousand kilometres to the fleet's lights off Peru
  (its fishing hours as heat), then comes back to the reserve.
- Three directions are prototyped headless before building (the islands' scale and the basemap, the
  radar's sweep and grey, the candidates' colour and the heat ramp), scored by Impeccable critique,
  then polished; detector 0.
- Step names: "Find the radar pass", "Find targets on the water", "Check where AIS could be heard",
  "Match targets to broadcasts", "Gather the evidence", "Predict where to look", "Read the fleet's
  pattern", "When the radar looks again", "Where it could have gone", "Draft the tasking", "Check
  the tasking". Prompts: "Who is in the reserve unseen?", "Has a vessel gone silent near here?",
  "Where should we look next?", "Draft the patrol tasking". Placeholder: "Ask about a radar pass
  over the reserve".

## Security and the language rules

Identity never reaches the bucket (stripped at the build, scanned before upload), so neither the
model nor the stage can show one. The GFW token stays on the builder's laptop in a gitignored file
and is never passed to a runtime, the frontend or a log. Forbidden phrases are checked in
`draft_tasking` and the replay builder, not only in the prompt. No agent tool writes outside
`session_data/<sid>/`; only the authenticated backend route files a tasking. The S3 allowlist is
unchanged (session copies only; the resting state has its own route). The one runtime read outside
AWS is ESA's plan, one host, bounded, cached.

## Error handling

- A pass not built: "the radar for that pass is not built (scripts/build_vessel_cache.py)".
- GFW data missing for a pass: `detect_vessels` returns ours only and says so; `match_ais` refuses
  (no matching, no candidates).
- The plan refresh fails: the cached plan with its date; no plan: no look is invented.
- `warm_vessels.py --check` fails loudly the morning of the show if a pass, the history or the plan
  is missing.

## Testing strategy

- pytest (no network): `cfar.py` 10, `plan.py` 8, `predict.py` 6 (done); the coverage rule and the
  tool order; matching and statuses; the fleet pattern on a synthetic series with one missed
  season; the reachable area around a synthetic island; the tasking validator, forbidden phrases
  and identifier patterns; the identity scan on a poisoned fixture; staging; prewarm and the replay
  prompt. Target ≥ 60.
- vitest: the `maritime` hints; the styles by status (never red or amber, never colour alone); the
  legends; stage copy; the tasking plate's states.
- Backend: the tasking routes (read, approve, idempotence, refusal); the brief's tests unchanged.
- Live (recorded in tasks.md): the build's seconds and bytes per pass; each beat's time on dev; the
  eval; the replay's network log.

## Act 3 run sheet (8 min)

| t | Beat | Prompt / action | What the room sees |
|---|---|---|---|
| 0:00 | Switch | Dark Vessels (pre-warmed) | The sea from below at night, the AIS replay in motion, the reserve and its ports |
| 0:20 | The pass | "Who is in the reserve unseen?" | The AIS stops at the pass's minute; the radar sweeps in along its track; chip; one sentence |
| 1:00 | The claim | (same turn) | Targets light up; broadcasting vessels claim theirs; the port boats set aside; the rest stay grey |
| 1:40 | Coverage | (same turn) | Heard water lit, unproven water hatched; "AIS was heard over 30% of the reserve" |
| 2:10 | Candidates | (same turn) | The grey rings in heard water turn orchid and take their labels: "candidates, not accusations" |
| 2:30 | Evidence | (same turn) | Chips, both detectors, the nearest broadcast, the zone |
| 3:20 | Gone silent | "Has a vessel gone silent near here?" | An earlier pass, dated plainly (Mar 6, 2024): the last broadcast, the area it could reach by water, the target inside it, then where the AIS came back on; "I cannot say which, if any, of these it is" |
| 4:20 | Where to look | "Where should we look next?" | The hotspot heat; "fitted on everything before July 2026, the top 5% of the water held 45% of the 49 dark targets seen since, 9 times what that much water holds by chance"; three patrol boxes with their next passes |
| 5:20 | The fleet | (same turn) | The camera pulls back to the fleet's lights off Peru; "it came in 9 of 9 years since 2017, and in 2026 it did not: in October 2026 it was off Peru" |
| 6:00 | Act | "Draft the patrol tasking" | The boxes on the map; the presenter picks one, drops a candidate, approves; "Filed by the officer. The agent did not file it." |
| 7:10 | Close | | "{n} candidates, not accusations; the radar looks again {next look}. The decision was the officer's." |

About 7:30 with 30 s in hand. Fallback if over 8:30: fold the evidence into the first answer's
chips, then shorten the silent vessel to its reveal. Cut-list fallback: the replay of the first
turn, then the tasking live.

## Decisions to approve

1. **Water: the Galápagos Marine Reserve** (agreed Oct 15). GFW's licence was cleared on Oct 16, so
   the Santa Barbara fallback (the first draft's design on NOAA's AIS) is retired.
2. **Passes on file only** (agreed Oct 15): the build caches everything; the runtime never calls GFW,
   Planetary Computer or NOAA; the one live read is ESA's plan.
3. **The coverage rule and the star pass** (approved Oct 16 as recommended): a 0.05° cell is heard
   when, in at least one hour of the three either side of the pass, two or more different
   broadcasting vessels were heard within 30 km of it (the same-hour form: stricter than two across
   the window, no link between hours needed; Oct 12: 29.8% against 30.8%, the same seven
   candidates); the drawn shape must agree with every target's status; a candidate needs heard
   water and both detectors; the star is the most recent pass with at least two candidates inside
   the reserve.
4. **The language** (agreed Oct 15): candidates with fixed sentences; type and size only; no names,
   identifiers or flags anywhere; forbidden phrases checked in tools.
5. **Predictions** (agreed Oct 15, the Oct 13 rule set aside): two, both transparent statistics with
   a measured held-out check: where dark targets will be (the hotspot map and patrol boxes) and the
   fleet's season (expected months, matched and missed seasons, where it is now).
6. **The action:** a patrol tasking chosen and approved on the map (a box, the candidates, the
   planned look), filed by the backend with a snapshot and Slack; EventBridge tabled (Oct 15). The
   backend role's `PutObject` grant gains `session_data/*/taskings/*` (approved Oct 16: "go ahead";
   written into `frontend-cdk` the same day, live at the G4 promotion's frontend deploy).
7. **The look: the sea from below, at night** (agreed Oct 16, look D): the seabed's bathymetry instead
   of a satellite basemap, the islands as silhouettes, the latest AIS replayed in motion (long
   exposure, comet tails, moving heads, a dated clock), frozen at the pass for the claim; then the
   radar's sweep, heard and unproven water, the hotspot heat and boxes, the pull-back to the fleet.
   The candidates' colour is orchid #f07ad8 and the heat ramp follows it (the user's pick, Oct 16).
11. **Live AIS: the dated replay** (tested Oct 16, closed): the stage shows the latest AIS on file in
    motion, labelled with its date (GFW, about four days behind; refreshed by the build). aisstream.io
    was tested on the user's key: ten minutes over the islands and the Gulf of Guayaquil heard
    nothing (no positions, static data, base stations, aids to navigation, safety or rescue
    messages), and ten minutes over the whole eastern Pacific from Peru to Panama heard 24
    positions, all north of 8° N; GFW hears a median 100 vessels an hour inside the reserve. Its
    receivers are on land and none reach Ecuador, Peru or the islands. The aiscast open feed heard
    nothing south of 12° N in three minutes. Live here would need paid satellite AIS (a contract and
    its own terms), not worth it before the freeze; no proxy is built.
12. **Freshness** (agreed Oct 16): the passes on file include the newest GFW-matched pass (Oct 12
    today); the build is rerun on Thursday Nov 5 (data only, after the code freeze) to add the newest
    pass and AIS and refit the prediction, and the act is rehearsed on that data Nov 6.
8. **Names** (approved Oct 16): agent id `vessels`, label "Dark Vessels", directory
   `agents/dark-vessels/`, runtimes `dark_vessels` / `dark_vessels_dev`, cache `vessels/cache/v1/`,
   replay case `vessels-<pass>`.
9. **Schedule** (approved Oct 16): dev only until G4 on **Friday Oct 30** (Oct 31 is a Saturday); the
   archaeologist's dev gate is Friday Oct 23; freeze Nov 3 unchanged.
10. **The silent-vessel beat is in the run** (the user, Oct 16: "add silent-vessel beat"): its own
    short turn after the evidence ("Has a vessel gone silent near here?"), on the best moment on file
    (today the Mar 6, 2024 case, dated plainly as an earlier pass), about a minute. The run sheet
    above has it at 3:20.
