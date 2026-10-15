# Design: act3-dark-vessels

Status: **DRAFT Oct 15, awaiting approval** (nine decisions at the end).

## Overview

Two weeks, five pieces:

1. `agents/dark-vessels/`: a fourth AgentCore runtime with ten tools of its own (`find_pass`,
   `detect_vessels`, `check_ais_coverage`, `match_ais`, `gather_evidence`, `ais_gaps`,
   `reachable_area`, `next_look`, `draft_referral`, `referral_status`) and the platform's shared
   `display_visual` and `inspect_image` (ArcGIS `reverse_geocode` when reachable).
2. A curated catalogue of passes on file and an offline build that caches, per pass, the radar
   crop, its display rendering and its AIS (names and identifiers dropped) into
   `vessels/cache/v1/`. Nothing slow is read live; detection runs once per pass and is cached.
3. Three public records shipped with the agent: the oil platforms, the sanctuary and its marine
   reserves, and the land mask and shipping lanes the evidence is measured against.
4. The referral: a draft the tools validate, a card the officer approves on stage, a backend that
   files it. Built on the Methane Hunter's brief pattern, as its own record.
5. The stage: a `maritime` render group, the targets by status, the coverage gap, the reachable
   area, the next pass, a resting state and the radar's arrival, prepared prompts, a gallery card
   and a replay case.

Verified premises (Oct 15, read-only public queries from the builder's laptop):

- Planetary Computer STAC (`sentinel-1-grd`) answers in 0.5 s and still returns the spike's two
  frames for 2024-01-20 over the channel. May–June 2026: 67 passes over the channel box (S1A 26,
  S1D 23, S1C 18); Sep 1 to Oct 14, 2026: 20 (S1C and S1D only; S1A's last plan ends Jun 30). The
  anonymous SAS endpoint answers 200 in 0.35 s.
- `sentinel-1-rtc` also has items over the channel coast (EPSG:32611, `vv` and `vh` COGs, June
  2026). Whether it keeps open-water pixels is a day-1 check; if it does, it removes the GCP warp.
- NOAA AIS (`noaaocm.blob.core.windows.net/ais/csv2/csv{Y}/ais-{date}.csv.zst`): present for
  2024-01-20 (203 MB), 2025-01-20, 2025-09-30, 2026-01-20 and every month-end to 2026-06-30
  (196–272 MB a day); 2026-07-31 onward 404. AIS lags three to four months: every pass on file is
  historical, and a "live AIS" path cannot exist for the show's own week anyway.
- ESA's acquisition plan page lists KMLs per satellite (newest: S1C to Nov 6, S1D to Nov 4,
  2026; 3.2 and 2.6 MB). Parsing both for IW footprints over the channel took 0.1 s. Relative
  orbits 137 and 144 cover the whole channel (S1D Oct 19 01:57 and 13:56 UTC, S1C Oct 25 01:57 and
  13:58, S1D Oct 31 01:57 and 13:56); orbits 35, 42, 64 and 71 graze it (0–18%). Two whole-channel
  looks a week, and the plan is published about three weeks ahead.
- Public sources exist for the records: the sanctuary boundary (NOAA ONMS, InPort 41999), the
  Pacific OCS platforms (BOEM), state-water platforms (CDFW OSPR ds357). Fetched and checked on
  day 1.
- Runtimes are `network_mode: PUBLIC`, arm64, us-east-1. Nothing in the repo shows a runtime
  reaching Azure; the design does not need it to (the build runs on the laptop).

## Architecture

```
agents/dark-vessels/
  dark_vessels.py        entrypoint (the shared contract; tool list swapped)
  vessels_config.py      prompt + model kwargs (not config.py)
  pass_tools.py          find_pass, detect_vessels (CFAR in tiles, cached per pass)
  ais_tools.py           check_ais_coverage, match_ais, gather_evidence, ais_gaps (DuckDB over parquet)
  reach_tools.py         reachable_area (water grid, scipy Dijkstra), next_look (plan KML)
  referral_tools.py      draft_referral, referral_status
  cfar.py                two-parameter CA-CFAR on integral images (pure numpy; shared by the build)
  data/passes_v1.json    the passes on file (curated, versioned)
  data/platforms_v1.json the platforms, each with its public source
  data/cinms_v1.geojson  the sanctuary, its marine reserves, the shipping lanes, with sources
  requirements-agent.txt duckdb==1.5.3        Dockerfile.extra  httpfs pre-installed
  deploy.sh  golden_prompts.json  build_replay_case.py  tests/

scripts/build_vessel_cache.py   (offline, builder-run)
  passes_v1.json → Planetary Computer STAC + SAS → VV window over the channel → warp (GCPs) to
    EPSG:32611 at 10 m → <pass>_vv.tif (uint16, deflate, overviews) + <pass>_display.tif
    (uint8 dB at 20 m) → water mask (land + 500 m) → CFAR → <pass>_targets.json
  NOAA AIS day before / of / after → DuckDB: channel box, drop vessel_name, imo, call_sign;
    mmsi → a per-build pseudonymous key → ais/date=YYYY-MM-DD/part.parquet
  → s3://<bucket>/vessels/cache/v1/… + manifest.json
scripts/publish_vessel_record.py   the resting state: sanctuary, reserves, platforms, the star day's
  AIS trails (simplified) → vessels/cache/v1/rest_v1.geojson (served by /api/vessels/rest)
scripts/warm_vessels.py   the plan KMLs → vessels/cache/plan/ (day before and morning of the show)

model ── find_pass("2026-06-21")      → {pass_id, satellite, sensed, direction, orbit, coverage,
                                          radar_s3_url, render}  (or "I only investigate passes on file.")
      ── display_visual(radar) → inspect_image            "open water, bright points along the lanes"
      ── detect_vessels(pass_id)       → {targets 19, platforms 5, targets_s3_url, render(points)}
      ── check_ais_coverage(pass_id)   → {covered_share, gaps[{hours, km²}], gap_s3_url, tracks_s3_url}
      ── match_ais(pass_id)            → {broadcasting 7, coverage_gap 3, no_ais 4, targets_s3_url}
      ── gather_evidence(pass_id)      → per candidate: chip, nearest broadcast, reserve, shore, lane
      ── ais_gaps(pass_id)             → [{gap_id, type, length class, last seen, top speed}]
      ── reachable_area(pass_id, gap)  → {area_s3_url, kn, minutes, km, targets inside}
      ── next_look()                   → {passes[{satellite, start, orbit, share}], footprint_s3_url}
      ── draft_referral(...)           → draft card; stop. "Decision: the officer's."
UI    ── Approve and send → POST /api/referral/approve → referrals/<id>.md + snapshot + Slack
      ── "The officer approved and sent referral <id>" → referral_status(id) → "filed"
```

## Components

### 1. The passes on file (`data/passes_v1.json`) and the build

Five to eight passes, each a whole-channel IW frame with AIS for the day before, of and after:
the spike's pass (2024-01-20 14:01 UTC, the known-good fallback) and the best of a day-1 search
over January–June 2026 (S1A, S1C, S1D; morning and evening passes). Per entry: `pass_id` (our
short id, `s1c-20260621-1358`), `scene_id`, `satellite`, `sensed`, `direction`,
`relative_orbit`, `channel_share`, `ais_days`, `note` (one line on what the pass shows, for the
builder). The star pass is chosen on day 1 by a rule written down before the search (decision 1).

The build reads each scene once from the laptop (the spike's path: STAC, SAS signing, `/vsicurl/`
windowed reads of the tiled COG). The crop box is the channel and the sanctuary
(−120.65, 33.35, −118.85, 34.48; about 165 × 125 km). GRD frames are GCP-georeferenced: the build
warps with GDAL's GCP transformer to EPSG:32611 at 10 m and writes a COG; the display copy is
dB-scaled to uint8 at 20 m so TiTiler serves it in one request per tile. If `sentinel-1-rtc` keeps
water (day-1 check), the build reads the RTC COG instead and skips the warp. The cache path
carries its version; the manifest records per pass the bytes, seconds, bounds and the CFAR
parameters it was detected with.

AIS: the build downloads each day's national file (about 200 MB), filters it with DuckDB to the
crop box and keeps `base_date_time, latitude, longitude, sog, cog, heading, vessel_type, length,
transceiver`, plus a vessel key that replaces the MMSI (a per-build random salt, hashed, never
stored). `vessel_name`, `imo` and `call_sign` never reach the bucket. About 0.5 MB of parquet a day.

### 2. The records the agent measures against

- `data/platforms_v1.json`: every standing platform in the channel and sanctuary (BOEM Pacific OCS
  and the state's), name, position, operator status, source URL, retrieved date. The spike's four
  (Gail, Grace, Gilda, Gina) are a subset; the 800 m radius stays.
- `data/cinms_v1.geojson`: the sanctuary boundary (NOAA ONMS), its marine reserves and marine
  conservation area (federal and state, named as the record names them), the Santa Barbara Channel
  traffic separation scheme lanes, each feature with `source_url`. Licences checked on day 1.
- The land mask: a coastline good to tens of metres around the islands (OSM land polygons or NOAA
  shoreline; day 1 picks and notes the licence), buffered 500 m, rasterised per pass grid at build
  time and cached beside the crop.

### 3. `find_pass(date, when)` and `detect_vessels(pass_id)`

`find_pass` resolves a date (or "the latest on file") to one pass in the catalogue, copies its
display COG into `session_data/<sid>/vessels/`, and returns it with
`render {kind raster, colormap gray, rescale [1, 255], group maritime, legend "Radar backscatter",
bounds}`. A date not on file returns the fixed sentence and the list of passes.

`detect_vessels` reads `vessels/cache/v1/<pass>_targets.json` when present (the build and the warm
script fill it). On a miss it runs `cfar.py` over the cached crop in 2,048-pixel tiles with a
92-pixel overlap (guard 31 + train 61), so memory stays under 300 MB: dB domain, threshold
`μ_ring + max(5σ_ring, 6 dB)`, single pixels need +8 dB, clusters of 1–200 pixels, the water mask
applied first, and a sidelobe rule (a target within 300 m of a target 10 dB brighter is merged into
it; the spike's Platform Gail ghost). Each target: `id` (T01…), lon, lat, `peak_db`, `extent_m`,
`status` (`platform` within 800 m of the table, else `target`). The tool writes the targets as
GeoJSON and returns `render {kind points, group maritime, property status, label id}`.

### 4. `check_ais_coverage(pass_id)` and `match_ais(pass_id)`

DuckDB over the pass's cached parquet (httpfs, the Methane Hunter's `overture.py` pattern).

Coverage: 2 km cells over the crop's water. A cell is `covered` if any position was received in it
within ±60 min of the pass; `gap` if none was, but the same cell had traffic in at least three
other hours of the three days on file; `quiet` otherwise (no traffic expected, so silence there
proves nothing either way). Gap cells are unioned into polygons, each with the hours AIS was silent
there (the spike's: west of −119.9°, 10:00–21:00 UTC). The tool writes the gap polygons and the AIS
tracks within ±30 min of the pass (lines, `vessel_type` and a length class only) for the map, and a
coverage record under the session that `match_ais` requires.

Matching: positions interpolated along each vessel's track to the sensing time (when a track has
pings either side within 10 minutes), else the nearest ping within ±10 min; a target is
`broadcasting` when one lies within 500 m. An unmatched target in a `gap` or `quiet` cell is
`coverage_gap` (said aloud as "not evidence"); in a `covered` cell it is `no_ais`. Every target
carries the nearest broadcast's distance and minutes. The tool rewrites the targets GeoJSON with
the final status, so the map's marks change in place.

### 5. `gather_evidence(pass_id, target_ids)` and `ais_gaps(pass_id)`

Evidence, per `no_ais` target (all by default, at most six): a 1.2 km radar chip from the 10 m crop
(a COG under the session, so `inspect_image` and the evidence gallery read it), the nearest
broadcast (km, minutes, type, length class), inside the sanctuary or a named reserve (point in
polygon), km to the nearest shore and to the nearest lane, and the fixed confidence sentence. The
tool also returns `explanations` from a fixed list (`small_vessel_exempt`, `transponder_off`,
`equipment_or_reception`, `not_a_vessel`), each with what would confirm or rule it out.

Gaps: tracks with no position for at least 30 minutes spanning the sensing time, whose last
position was in a `covered` cell (silence where AIS could hear). Each gap: `gap_id` (G1…), type,
length class, last position and time, the first position after (if any), and the vessel's own top
speed over the six hours before (the 95th percentile of `sog`, rounded up to a knot, floor 6 kn).

### 6. `reachable_area(pass_id, gap_id, top_speed_kn)` and `next_look()`

Reachable: a 250 m grid over the crop (about 660 × 500 cells), land and islands as obstacles from
the same mask, 8-connected; `scipy.sparse.csgraph.dijkstra` from the last position gives water
distance to every cell (about 0.3 s). The area is every cell within `speed × minutes` (minutes from
the last ping to the sensing time), polygonised and simplified. Returned: the area, the speed and
where it came from ("its own top speed in the six hours before"), the minutes, the farthest km, and
the `no_ais` and `coverage_gap` targets inside, by id. Rendered as `kind vector, group maritime`.

Next look: `vessels/cache/plan/` holds the newest plan KML per satellite and its parsed IW
footprints; `next_look` returns the next passes after now covering at least 50% of the channel
(satellite, start UTC, relative orbit, share, plan file and period) and writes the first one's
footprint for the map. A cache older than 24 h triggers one refresh (8 s timeout; the plan page
lists the files, the newest per satellite is fetched); on failure it says the cached plan's date.
Never an orbit extrapolation.

### 7. The referral (`draft_referral`, `referral_status`) and its approval

The brief's pattern, its own record. `draft_referral(action, target_ids, gap_id, look, notes)`:
`action` from `patrol_look`, `second_radar_look`, `no_action`; `look` must be one of `next_look`'s
passes (by start time); `notes` at most three sentences of 220 characters. The tool reads the
counts, the coverage, the candidates and the reachable area from the session's own records,
checks every free-text field against the forbidden phrases (Requirement 9.1) and the identifier
patterns (MMSI-like 9-digit numbers, IMO numbers, call signs), writes
`session_data/<sid>/referrals/<id>.draft.json` and returns its markdown. `next_steps`: paste it,
then "Decision: the officer's.", then the closer; call no other tool.

Backend: `GET /api/referral` and `POST /api/referral/approve` beside the brief's routes, sharing a
small filing core lifted out of the brief route (read the draft from S3, never from the browser;
refuse a stale or malformed draft; write `<id>.md`, the PNG snapshot, then `<id>.filed.json` last;
idempotent; Slack fire-and-forget). The brief's own tests stay green through the lift. Frontend:
`ReferralCard` from the BriefCard's parts (state head "Draft referral" / "Sent referral", a title
written by the tool, the counts sentence, the verdict lines, the candidates, the next look, the
decision "Approve and send" / "Request another look"). Infra: the backend role's `s3:PutObject`
grant gains `session_data/*/referrals/*` beside `…/briefs/*` (confirmed with the user before it is
deployed).

### 8. Prompt

The Methane Hunter's sections, rewritten for the sea: HARD RULES (passes on file only; the order:
pass, look, detect, coverage, match, then words; candidates never accusations; no names or
identifiers; you never file or send a referral), RESPONSE STYLE (no em dashes; one sentence before
each call), FINAL REPORT (the counts sentence first, a record of at most 120 words, a spoken
closer of at most 240 characters), CONFIDENCE (the fixed sentences), DISPLAY RIDES ALONG,
LOOK BEFORE YOU ANALYSE, WORKFLOW (the three turns), THE OFFICER'S DECISION, UNITS (km and nautical
miles both for distance at sea, kn, UTC times, dB).

### 9. The stage

- `render.ts`: group `maritime`; no new kind (radar is `raster`, targets `points`, the rest
  `vector`). `utils/vesselLayers.ts` resolves hints by group or by file name (`/vessels/`,
  `/use-cases/vessels-`) and owns the styles, so the stage wins over a drifting hint.
- Targets by status (never colour alone, never red, never amber): `broadcasting` a fog dot with a
  hairline to its AIS position; `platform` a fog square outline; `coverage_gap` a label-grey hollow
  ring and "not evidence" at 15 px; `no_ais` a ring in the act's one data colour with a mono label
  (`T07  no AIS`). The act's data colour is chosen at critique (decision 7).
- AIS tracks: fog hairlines at 40%, the ±30 min heads at 80%. Coverage gap: a dashed fog outline
  with a diagonal hatch and its label ("AIS silent here 10:00–21:00 UTC: not evidence"). Reachable
  area: the data colour at 12% with a dashed outline, the last position as a ring ("last AIS
  13:12 UTC"), the label "11 kn × 47 min: up to 16 km over water". Next pass: a dashed fog hairline
  footprint and "Next look: Sentinel-1D, Nov 12, 01:57 UTC" (orbit 137's 12-day repeat after
  Oct 31; the label prints whatever the plan says, never this). The sanctuary and reserves: fog
  hairlines with names at 15 px. Every one has its legend row in words in the layers plate.
- Step names: "Find the radar pass", "Find targets on the water", "Check where AIS could hear",
  "Match targets to broadcasts", "Gather the evidence", "Find vessels that went silent", "Where it
  could have gone", "When the radar looks again", "Draft the referral", "Check the referral".
- Prepared prompts: "Who went unseen?" (fills "Who was in the sanctuary on June 21 without
  broadcasting AIS?", the date set by decision 1), "Where could it have gone?", "Draft the
  referral". Placeholder: "Ask about a radar pass on file".
- Resting state and the way of seeing (decision 7): `/api/vessels/rest` and a `Chat.tsx` effect
  like the archaeologist's.

## Security and the language rules

Names and identifiers never reach the bucket (the build drops them and keys vessels
pseudonymously), so neither the model nor the stage can show one. The forbidden phrases are
checked in `draft_referral` and in the replay builder, not only the prompt; the prompt names them
too. The referral is filed only by the authenticated backend route; no agent tool writes outside
`session_data/<sid>/`. The backend's S3 allowlist is unchanged (every layer is a session copy;
the resting state has its own route). The only external read at run time is the plan refresh, to
one host, bounded, with the cache as fallback.

## Error handling

- A pass missing from the cache: "the radar for that pass is not built
  (scripts/build_vessel_cache.py)", never a live read.
- A CFAR cache miss on stage is slow, not fatal (tiles, bounded memory); the warm script makes it a
  hit, and `warm_vessels.py --check` fails loudly the morning of the show if any is missing.
- No AIS for a pass day: `check_ais_coverage` says so and `match_ais` refuses (no coverage, no
  candidates).
- `reachable_area` for a gap with no last position in covered water, or minutes ≤ 0: an error that
  names the reason.
- The plan refresh fails: the cached plan with its date; no plan at all: "the acquisition plan is
  not cached" and no pass is invented.
- ArcGIS MCP down: places come from the records' own names (reserves, islands, lanes); the
  geocoder is never required.

## Testing strategy

- pytest (no network): CFAR on synthetic gamma speckle with planted point and 3 × 2 targets
  (recall and no false alarms over a flat sea at the thresholds), the tile seams (a target on a
  seam found once), the sidelobe merge; the platform radius; the coverage grid on a synthetic AIS
  table with a planted gap; the tool order (`match_ais` before coverage refuses); interpolation and
  the 500 m / 10 min match; the gap finder; the reachable area around a synthetic island (a point
  behind the island is farther by water than by air); the plan parser on a trimmed fixture KML;
  the referral validator, forbidden phrases and identifier patterns; the build's column drop (no
  `vessel_name`, `imo`, `call_sign`, `mmsi` in the parquet); staging; prewarm and the replay
  prompt. Target ≥ 40.
- vitest: `maritime` hints accepted and rejected; `vesselLayers` styles by status (and never red
  or amber); legends in words; stage copy; the referral card's states.
- Backend: `/api/referral` read, approve, idempotence, a refused draft, the brief's tests
  unchanged after the lift.
- Live (recorded in tasks.md): the build's seconds and bytes per pass; detect warm and cold on the
  dev runtime; each beat's time on dev; the eval; the replay's network log.

## Act 3 run sheet (8 min)

| t | Beat | Prompt / action | What the room sees |
|---|---|---|---|
| 0:00 | Switch | Agent switcher → Dark Vessels (pre-warmed) | The resting state: the sanctuary and its reserves at night, the platforms, the day's AIS traffic as fog trails (every vessel that broadcast) |
| 0:20 | The pass | "Who was in the sanctuary on June 21 without broadcasting AIS?" | The radar pass arrives over the water (decision 7); chip; one sentence on what it shows |
| 1:20 | Targets | (same turn) | Every vessel-sized target marked; the platforms set aside by name |
| 1:50 | Coverage | (same turn) | Where AIS could hear at that hour; the gap drawn; its targets "not evidence" |
| 2:30 | The answer | (same turn) | The targets turn to broadcasting or no AIS; "19 targets: 5 platforms, 7 broadcasting, 3 in a coverage gap, 4 with no AIS in covered water: candidates, not accusations" (numbers from the star pass) |
| 3:20 | Evidence | (same turn, or "Show me the evidence") | Four radar chips; the nearest broadcast; one inside a marine reserve; the innocent explanations |
| 4:30 | Where could it have gone | "A fishing vessel stopped broadcasting before the pass. Where could it have gone?" | The vessel's last position, its reachable water at its own top speed, the targets inside it |
| 5:30 | When can we look again | (same turn) | The next planned pass's footprint over the whole channel, with its date and time |
| 6:10 | Act | "Draft the referral" | The referral card; the presenter clicks "Approve and send"; "Sent by the officer. The agent did not send it." (Slack, if configured) |
| 7:30 | Close | | "Four candidates, not accusations; the radar looks again on Nov 12. The decision was the officer's." Hand-off to Act 4 |

Fallback if over 8:30 on rehearsal two: fold the evidence into the first answer's chips and drop
its beat. Cut-list fallback: the replay of the first turn, then the referral beat live.

## Decisions to approve

1. Water, persona and the star pass: the Santa Barbara Channel and the Channel Islands National
   Marine Sanctuary (the spike's water), the depicted sanctuary enforcement officer. The star pass
   is chosen on day 1 from five to eight whole-channel passes by a rule set now: at least two
   `no_ais` targets in covered water inside the sanctuary, at least one AIS gap spanning the pass
   with a target inside its reachable area, and a coverage gap on screen if any pass has one (the
   lesson is stronger shown than told). Fallback: the spike's 2024-01-20 pass.
2. Passes on file only. An offline build caches each pass and its AIS into `vessels/cache/v1/`;
   tools read only the bucket. No Planetary Computer or NOAA read at run time (AIS lags three to
   four months, so a live path could never show the show's own week); "live AIS" on the cut list is
   simply not built. Recommended: yes.
3. The coverage rule is enforced in tools: `match_ais` refuses before `check_ais_coverage`, and a
   silent target in a gap or quiet cell is `coverage_gap`, never a candidate.
4. The language rules: candidates with fixed confidence sentences; no vessel names, MMSI, IMO
   numbers or call signs anywhere (dropped at the build, so they cannot leak); vessels described by
   type and length class; the forbidden phrases checked in `draft_referral` and the replay builder.
5. The prediction is geometry, not a forecast: reachable water at a stated speed (the vessel's own
   six-hour top speed by default) on a water-only grid, tested against the targets inside it; the
   next look from ESA's live plan, forward from today (cached, refreshed daily), never an orbit
   extrapolation. No accuracy claims.
6. The action: a referral that asks for a patrol look or a second radar look at a named planned
   pass, drafted by the agent, approved and sent by the officer on stage, filed by the backend
   (markdown, map snapshot, Slack when configured). Its own record and card on the brief's filing
   core; the Methane Hunter's brief is not changed beyond the lift. The backend role's `PutObject`
   grant gains `referrals/` (an infra change, confirmed before deploy).
7. The way of seeing: the sea at night, flat and north-up (radar is a map, not a landscape): the
   basemap dark, the day's AIS traffic as fog trails (the lit world), the sanctuary and reserves as
   hairlines, nothing moving at rest. The radar pass arrives as a sweep along the satellite's
   ground track (a dome mask drawn back over about 2.5 s; a dissolve under reduced motion), and the
   act's one data colour for the candidates and the reachable area is chosen at Impeccable critique
   (never red, never amber).
8. Names: agent id `vessels`, label "Dark Vessels", directory `agents/dark-vessels/`, runtimes
   `dark_vessels` / `dark_vessels_dev`, cache `vessels/cache/v1/`, replay case
   `vessels-<pass_id>`.
9. Schedule: start Oct 16 (Act 4 landed early); dev only until G4. G4 is **Friday Oct 30**: the
   ROADMAP and the archaeologist spec say Oct 31, which is a Saturday in 2026 (and the
   archaeologist's "Friday Oct 24" gate is Friday Oct 23). Release 3 promotes all four agents
   together; freeze Nov 3 unchanged.
