# Spike: recent silences near the Galápagos (can Act 3 predict forward from one?)

**Date:** 2026-10-20 · **Question:** is there a recent "vessel went silent" case near the Galápagos Marine
Reserve that the agent can predict forward from (where it could be by water by ESA's next Sentinel-1
look), how often do such cases occur, and what is the fallback? **Data:** Global Fishing Watch API v3,
ESA's Sentinel-1 acquisition plans, Planetary Computer `sentinel-1-grd`. Identity fields were stripped
in the client before anything was written; cases are numbered here only.

## Short answer

**No usable recent silence to predict forward from.** From Aug 1 to the data's end (Oct 16, 2026), 50
intentional AIS-off events started within 100 km of the reserve (gear buoys excluded), but only 6 are
classified vessels (4 fishing, 1 cargo, 1 other) and none of those 6 had a planned Sentinel-1 look over
its last position within 72 hours. The other 44 are of unknown type and behave like unclassified gear;
one of them (Case 7) had a look 13 h later while still silent, with no dark target in reach. None was
still open at the data's end: GFW publishes a gap only once the AIS comes back on.

Over the last 12 months there were **2 usable forward cases** (definition below), both seen by
Sentinel-1A, which stopped imaging after June 2026: a base rate of **0.17 a month**, and **0 since July**.
The Nov 5 rerun has **about an 8% chance** of adding one (12% if unknown-type transmitters count). The
best recent moment is **Case 8, 2026-04-01 00:26 UTC (Sentinel-1A)**, tighter than Mar 6 2024: AIS off
6.6 h before the pass, 33 km outside the reserve, two GFW dark targets within reach by water at 6 kn,
the nearest 9.8 km from where it went off. The prediction that is recent by construction is the hotspot
map checked on each next pass (refitted before each 2026 pass, its top 5% of the water held 46% of the
dark targets those passes found).

## Latest data (queried 2026-10-20)

| Dataset | Version | Ends |
|---|---|---|
| `public-global-gaps-events:latest` (AIS-off events) | v5.0 | 2026-10-16; latest event starts Oct 16 10:49, ends Oct 16 22:53 UTC |
| `public-global-presence:latest` (AIS positions) | v5.0 | 2026-10-16; last hourly fix Oct 16 23:00 UTC |
| `public-global-sar-presence:latest` (radar detections) | v5.0 | 2026-10-18; latest day with detections in the box Oct 17 |
| ESA acquisition plans (listing) | 236 plans | oldest Feb 10 2026, newest Oct 20 2026 (S1D to Nov 9, S1C to Nov 8, S1A ended Jun 30) |
| Planetary Computer `sentinel-1-grd` | 1,085 scenes | Oct 3 2024 to Oct 18 2026 over the box |

The AIS-derived data lags 4 to 5 days and the radar detections about 3. The Nov 5 rerun should see
AIS-off events to about Nov 1.

## 1. AIS-off events near the reserve, Aug 1 to Oct 16, 2026

Intentional AIS-off events (GFW `intentionalDisabling`, every event the API returned was flagged so)
whose AIS went off within 100 km of the reserve's outer edge: 57, of which 7 gear buoys (excluded) and
**50 others: unknown 44, fishing 4, cargo 1, other 1, carrier 0**. None started inside the reserve.

- Durations: median 32 h (range 12 to 1,396 h; GFW's events are 12 h or longer by definition); 22
  under 24 h, 10 from 24 to 72 h, 18 over 72 h.
- Distance to the reserve's edge: median 68 km, range 24 to 100 km; 5 within 50 km.
- Still open at the data's end: **0**. None of the 3,036 events returned for Oct 2024 to Oct 2026 lacks
  an end; a silence open on Oct 16 will only appear once the AIS returns.

The six classified vessels:

| Case | Type | AIS off (UTC) | Silent | Edge of reserve | Back on, from off | Next planned look over its last position |
|---|---|---|---|---|---|---|
| 1 | fishing | Aug 6 16:58 | 130 h | 87 km N | 176 km | none in the plans to Aug 27 |
| 2 | fishing | Aug 11 23:06 | 427 h | 73 km NW | 56 km | none to Sep 2 |
| 3 | other | Aug 19 15:25 | 378 h | 62 km SW | 629 km | S1D Aug 30 00:25, 249 h later, still silent |
| 4 | cargo | Sep 7 20:13 | 26 h | 91 km E | 471 km | none to Sep 26 |
| 5 | fishing | Sep 10 23:28 | 40 h | 42 km S | 418 km | none to Oct 1 |
| 6 | fishing | Oct 7 20:19 | 167 h | 100 km S | 844 km | none to Oct 27 |

The 44 unknown-type events look like unclassified gear: all 44 carry GFW's low reception figure typical
of low-power (Class B) transmitters (about 50 satellite positions a day, against 275 to 325 for Cases 1,
2, 4, 5 and 6), 28 of 44 went off within 3 h and 50 km of another event, 28 went off between 10:00 and
17:00 UTC, and their implied speeds are a median 1.3 kn (at most 5.6). Case 3 shares the low reception
figure, went off within 4 h and 15 km of two unknown-type units and came back on within 6 km and 21
minutes of one of them, so it may be gear on a vessel.

## 2. Forward reach to the next look, per case

As of the moment each AIS went off, using only the plans ESA had published by then (a plan's file-name
start stamp taken as its publication time), the first IW take whose footprint holds the last position:

- **Cases 1, 2, 4, 5, 6:** no look planned over the last position anywhere in the plan horizon (19 to 22
  days), and Planetary Computer has no scene over those positions from the off time to Oct 18 either.
  They went off 42 to 100 km north, south or east of the reserve. One 12-day cycle of S1D's IW takes
  (four relative orbits) covers 88% of the reserve but only 34% of the water within 100 km outside it.
- **Case 3:** first look S1D Aug 30 00:25 UTC (relative orbit 106), 249 h after it went off; reach 2,770
  km at 6 kn, 4,620 km at 10 kn. The area says nothing.
- **Unknown-type events:** 3 of 44 had a planned look within 72 h. **Case 7** (Sep 10 11:14, 65 km
  outside the reserve): S1D Sep 11 00:25, 13.2 h later, still silent, acquired; reach 146 km at 6 kn
  (244 km at 10 kn), touching the reserve (22% of the 10 kn reach is reserve water), the look covers 43%
  of the 10 kn reach; **no GFW dark target within reach**; AIS back on 16.7 h after, 52 km away. The other
  two came back on before the look (one 1.5 h before it).

Speeds: **6 kn and 10 kn.** 6 kn is the median implied speed (straight line over the gap) of vessel-type
gaps of 12 to 48 h within 100 km of the reserve (5.7 kn, n = 83) and the floor `reachable_area` already
uses; 10 kn is above their 90th percentile (8.9 kn) and a usual transit speed for an industrial fishing
vessel. Implied speeds are lower bounds (straight line, whole gap). Fishing gaps overall: median 0.7 kn,
90th percentile 5.9 kn.

Plans: the runtime's cached plans (`vessels/cache/plan/`, newest plans only, Oct 16 to 19) cannot replay
an older case. ESA's listing still carries every plan since Feb 10 2026, so the build can fetch the plan
as published at a case's off time; before that date the acquisition record has to stand in. Every
planned look checked was acquired (11 of 11 in the 12-month set), so the stand-in is sound. Once the
reverse happened: a scene was acquired over a last position 1 h after the AIS went off (2.4°S, at the
frame's edge) that the plan's footprint did not quite hold.

The plans for the demo window: the Oct 20 S1D plan (to Nov 9 20:07) holds IW looks over the water
within 100 km of the reserve on Oct 24 00:17 (orbit 33), Oct 25 11:41 (55), Oct 29 00:25 (106) and Oct 30
11:49 (128), and **none from Oct 31 to Nov 9**; the S1C plan has none at all. The Oct 16 S1D plan had the
same gap. On Nov 9 the next look will be whatever a plan published after today says (orbit 106's
12-day cycle gives Nov 10 00:25, not yet planned).

## 3. A recent backward check (2025 to 2026)

AIS-off events from Jan 1 2025 to Oct 16 2026, intentional, not gear, within 100 km: 292. Of these, **35
had a Sentinel-1 IW pass over their last position during the silence** (72 passes); 17 passes came
within 48 h of the AIS going off and 5 within 24 h. GFW dark targets (radar detections with no AIS
match, anywhere in that pass's frames) within reach by water, at 6 kn and at the Oct 15 spike's 12 kn
for comparison:

- Pass within 24 h of going off: **1 event at 6 kn (Case 8), 2 at 12 kn** (the second, Jun 17 2025, has
  its target 292 km away inside a 383 km reach, which says nothing).
- Any delay: 11 events at 6 kn, 12 at 12 kn; 7 had a dark target inside the reserve within reach, but
  all 7 needed 30 h or more of silence (a reach of 333 km or more at 6 kn).

**Case 8** (fishing): AIS off 2026-03-31 17:50 UTC, 33 km outside the reserve. ESA's S1A plan published
Mar 27 (`s1a_mp_user_20260327t172127_20260416t194000`) had the look: S1A 2026-04-01 00:26 UTC, relative
orbit 106, acquired (`S1A_IW_GRDH_1SDV_20260401T002621_20260401T002650_063878_0808AA`), 6.6 h later.
Reach 73 km at 6 kn (122 km at 10 kn), touching the reserve (25% of the 10 kn reach is reserve water);
the frame covers 78% of the 10 kn reach. The pass had 8 GFW dark targets in its frames (2 inside the
reserve), 2 within reach at 6 kn, at 9.8 and 71 km by water, both outside the reserve. AIS back on Apr 15,
356 h after, 477 km away. The event is already in the cached `history_v1.json`; its pass is not on file.

**Case 9** (fishing): AIS off 2026-05-30 19:23, 69 km outside; S1A May 31 00:26 (5.1 h later, acquired);
reach 56 km at 6 kn, 94 km at 10 kn (touching the reserve only at 10 kn); no dark target in that pass;
AIS back on 17.2 h after, 63 km away. An honest "the look found nothing" case.

## 4. Base rate and the Nov 5 rerun

**Usable forward case**, defined: (a) a GFW intentional AIS-off event; (b) a classified vessel type
(fishing, carrier, cargo, passenger or other; not gear, not unknown); (c) the AIS went off inside the
reserve or within 100 km of its outer edge; (d) ESA's plans as published at that moment hold a Sentinel-1
IW take whose footprint holds the last position, starting within 24 h, and covering at least a fifth of
the by-water reach at 10 kn (`next_look`'s rule); (e) the AIS was still off when that take started; (f)
the take was acquired (the scene is in Planetary Computer). Before Feb 10 2026 the acquisition record
stands in for (d).

Last 12 months (Oct 17 2025 to Oct 16 2026): 167 events met (a) and (c) (unknown 72, fishing 65,
passenger 15, other 14, cargo 1). **Usable: 2** (Case 8 in March, Case 9 in May; every other month 0),
**0.17 a month**; the same 2 with a 12 h or 48 h limit. Counting unknown types: 3 (adds Case 7 in
September), 0.25 a month. What stopped the rest: no look over the last position within 48 h (156), looks
covering under a fifth of the reach (7), AIS back on before the look (1).

Why the rate has fallen: Sentinel-1A passed over at least a fifth of the reserve 6 to 8 times a month
(Oct 2025 to Jun 2026) and has stopped; S1D does so 3 to 4 times a month (28 radar days touching the
reserve from Jul 1 to Oct 18); S1C plans no IW over these waters. Since July: 0 usable (1 counting
unknown types).

**The Nov 5 rerun** adds about 16 days of AIS-off events (Oct 16 to about Nov 1), holding six planned S1D
looks over this water (Oct 17, 18, 24, 25, 29, 30). At the 12-month rate, P(at least one usable case) =
1 − e^(−0.17 × 16/30.4) ≈ **8%** (12% counting unknown types); at the post-S1A rate it is lower. Any case
it finds will already be closed (back on), so it is a replayed forward prediction, not an open one.

**Fallback if none:** make the prediction "where to look on the next pass", which is recent by
construction and checked pass by pass. Refit `predict.py` (forecast_tools settings: spread 1, 0.05°
cells, away from the five ports) on everything before each 2026 radar day and check that day:

| Checked on | Radar days with dark targets | Dark targets | Top 5% of the water held | Days with one or more in the top 5% | Three patrol boxes (1.0% of the water) held | Days with one or more in a box |
|---|---|---|---|---|---|---|
| 2026 (to Oct 17) | 49 | 156 | 71 (46%, 9× chance) | 33 (67%) | 26 (17%, 16×) | 15 (31%) |
| Jul 1 to Oct 17 | 17 | 54 | 22 (41%, 8×) | 11 (65%) | 5 (9%, 9×) | 4 (24%) |

Dark targets away from the ports were seen on 17 of the 28 radar days touching the reserve since July
(61%). The newest pass in the data (Oct 17) had 1, outside the top 5%. If a replayed reach beat is still
wanted, Case 8 is the one to build.

Other recent-data angle checked: vessels quiet at the data's end (AIS presence, last fix within 100 km of
the reserve, no fix anywhere from 98°W to 83°W and 7°S to 6°N for 12 h or more by Oct 16 23:00): 136
transmitters; 92 within 10 km of a port; of the 44 away from ports, 40 are inside the reserve (mostly
passenger and local boats) and the 4 outside are gear. 7 vessel-type units heard in 12 or more of the 48
hours before going quiet, all inside the reserve. This is not GFW's intentional-disabling test (which
needs the gap closed and good reception), so it cannot be called "went dark".

## Method

- **GFW** through `scripts/vessels_gfw.py` (explicit User-Agent, every response scrubbed; the token was
  parsed from `agents/dark-vessels/.env` into the process environment only):
  - `POST /v3/events`, `datasets: [public-global-gaps-events:latest]`, `geometry` the build's gaps box
    (95.5°W to 86.5°W, 4.5°S to 4.0°N), `startDate`/`endDate` in four windows from 2024-10-01 to
    2026-10-21 (events overlapping the window), `limit=500` with offset paging; 3,036 events, deduplicated
    on start and off position; kept fields: start, end, type, off and on positions, hours, km, implied
    knots, intentional flag, reception figures, distance from shore and port.
  - `GET /v3/datasets/{id}` for each dataset's end date.
  - `POST /v3/4wings/report`, `public-global-sar-presence:latest`, DAILY, HIGH (0.01°), `group-by=GEARTYPE`,
    `filters[0]=matched='false'` and `'true'`, the same box, windows of at most 366 days from 2024-10-01 to
    2026-10-20.
  - `POST /v3/4wings/report`, `public-global-presence:latest`, HOURLY, HIGH, `group-by=VESSEL_ID` (ids
    replaced by per-process numbers in the client, never written), 98°W to 83°W, 7°S to 6°N, 2026-10-06
    to 2026-10-20.
- **ESA**: the acquisition-plan listing page, and per case the plans published by the off time through
  `plan.plan_chain` and `plan.merge_takes` (119 KML files fetched); IW takes only.
- **Planetary Computer STAC**: `sentinel-1-grd` over the box, 2024-10-01 to 2026-10-21, IW only, to check
  that planned looks were acquired and for the backward check.
- **Reserve and distances**: `agents/dark-vessels/data/reserve_v1.geojson` (GFW `public-mpa-all` 11753,
  from WDPA; islands as holes). The outer edge is the exterior rings filled; distance to it in an
  azimuthal equidistant projection centred at 0.4°S 90.6°W. Distance by water: `reach.by_water` (land from
  the same file, 8-connected, no corner cutting) on a grid round the last position of 0.02° (reaches to
  450 km), 0.04° (to 900 km) or 0.06°. A footprint's share of the reach is counted on that grid; the reach
  touches the reserve when the by-water distance to the nearest reserve water cell is within it.
- Scratch scripts under `/tmp/act3-spike/`, deleted at the end.

## Caveats

- GFW's AIS-off events are 12 h or longer and appear only after the AIS returns; "still silent at the
  data's end" cannot come from them. Its vessel types are classifications; "unknown" is common here.
- The plan's publication time is taken from its file-name start stamp; within an hour or so of the off
  time this could misplace a plan.
- GFW's radar detections are larger vessels only; unmatched is not dark by intent. Candidates, never
  accusations.
- Not verified: the runtime's cached plans in S3 (`vessels/cache/plan/`) were not read; ESA's listing was
  used directly. Whether Cases 3 and 7 are gear or vessels. Why Case 8 was not on the Oct 15 spike's
  shortlist (that check may have used a different reach rule or target set).
- Licence as in `docs/spikes/galapagos.md` ("Powered by Global Fishing Watch.").

## Notes for the design

- Do not plan Act 3 around a fresh, still-open silence: GFW cannot show one, there were none usable from
  Aug 1 to Oct 16, and the rerun has about an 8% chance of adding one.
- A forward reach beat can be honest only as a replay: "as of the moment the AIS went off, ESA's plan
  said the next look was X". Case 8 (Apr 1 2026) is tighter than Mar 6 2024 (the Oct 15 spike's best
  since 2023: 12 h, nearest target 51 km): 6.6 h, 73 km at 6 kn, touching the reserve, two dark targets
  in reach (nearest 9.8 km), none inside the reserve, back on 15 days later. It needs its S1A pass built and the Mar 27 S1A plan cached; the event is already in
  `history_v1.json`. Sentinel-1A has since stopped, so it is an earlier pass, said plainly.
- If the rerun finds a usable case under the definition above, it can replace Case 8 automatically; the
  build should test the definition, not pick by hand.
- The prediction that is recent by construction is the hotspot map checked on the next pass: 46% of 2026's
  dark targets fell in the top 5% of the water (41% since July), and one or more fell there on two passes
  in three. Patrol boxes are weaker since July (one or more on 4 of 17 days).
- `next_look` must keep saying "not planned yet": the current S1D plan has no look over these waters from
  Oct 31 to Nov 9, so on Nov 9 the next look depends on a plan not yet published.
- Coverage is the binding constraint: only S1D images these waters, four relative orbits on a 12-day
  cycle, covering 88% of the reserve but 34% of the water within 100 km outside it. The water just west
  of the reserve, where 34 of the 50 recent silences started (west of 92.2°W), had its next looks from
  orbit 106 only (00:25 UTC every 12 days); the positions of Cases 1, 2, 4, 5 and 6 had none at all.
- Speeds to state: 6 kn (median implied speed of 12 to 48 h vessel gaps here) and 10 kn (above their 90th
  percentile).
- A "quiet now" list from AIS presence is not evidence of going dark here (mostly boats in port or local
  boats inside the reserve).
