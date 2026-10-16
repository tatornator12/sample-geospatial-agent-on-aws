# Spike: Act 3 in Galápagos waters (Global Fishing Watch and Sentinel-1)

**Date:** 2026-10-15 · **Timebox:** half a day · **Question:** do the Galápagos waters support the act
(dark targets inside the marine reserve, vessels that go silent near it, the squid fleet's season, and
predictions we can check), and how do they compare with the Yellow Sea and the Santa Barbara Channel?
**Data:** Global Fishing Watch API v3 (token from `agents/dark-vessels/.env`; identity fields stripped
in the client before anything is printed or stored), Planetary Computer `sentinel-1-grd`.

## Verdict

**The Galápagos works, but not as the act was imagined.** The radar sees the marine reserve every three
days and finds a handful of targets with no AIS on most passes; history predicts where they will be
well (the 1% of the water with the most dark targets in 2023–25 held 22% of 2026's). Two of the
imagined beats do not hold for 2026: the squid fleet did not come to the Galápagos this year (it
stayed off Peru and Chile), and vessels that go silent near the reserve do so outside it, rarely
while the radar is looking.

## Findings

1. **What the radar sees.** Sentinel-1 frames cover about −94° to −88° and −2.5° to +2.5°: the
   Galápagos Marine Reserve and the water around it. Not the EEZ edge, where the fleet usually works.
   Reserve box (−92.7, −2.1, −88.6, 2.4), last 12 months: 242 frames on 117 days.
2. **Dark targets in the reserve** (GFW SAR detections, unmatched to AIS, region `public-mpa-all`
   11753): 412 (2019), 135, 138, 85, 52, 41 (2024), 109 (2025), 183 (2026 to Oct 12). Matched: 346
   to 803 a year (the tourist fleet broadcasts). 148 of 2026's 183 are more than 10 km from the five
   ports; the densest are off Santa Cruz and Isabela (−0.5, −90.5). Reserve box: 2.4 dark targets
   per radar day, 37% of all detections.
3. **The fleet's season** (squid-jigger fishing effort north of 8°S): 2025 Mar 37,282 h, Jun 14,363,
   Jul 33,955, Aug 24,103. 2026: May 848 h, then none. 2026 Jun–Sep: 34,000 to 43,000 h a month off
   Peru (8–20°S), 2,000 to 10,000 off Chile. Every year 2017–2025 had a June–August season near the
   Galápagos; 2026 did not.
4. **Vessels that go silent** (GFW intentional AIS-off events, −95.5 to −86.5, −4.5 to 4.0):
   5,659 events 2023 to 2026 (gear buoys 3,336, fishing 1,448, unknown 511); median 47 h; **2 start
   inside the reserve**.
5. **The silent-vessel moment.** Since 2023, 29 times a radar pass imaged a vessel's last position
   during its silence; 5 of those had a GFW dark target within reach (12 kn); none inside the
   reserve. The best: 2024-03-06 00:26 UTC (Sentinel-1A), a fishing vessel's AIS off 12 h before the
   pass just west of the reserve (−1.11, −92.76), back on 30 h after it went off, 26 km away; one
   dark target 51 km from where it went off.
6. **Predictions, checked on 2026** (fitted on 2023–25, 0.05° cells):
   - Dark targets, reserve box: the top 1% of the water held 22% of 2026's (21.7× chance), the top
     5% held 37% (7.4×).
   - Dark targets, Santa Barbara Channel: top 1% 20% (20.5×), top 5% 47% (9.5×), top 10% 58%.
   - Where vessels go silent (0.25° cells): top 10% held 15% (1.5×). Weak.
   - Rerun with `predict.py` on the reserve's own polygon, leaving out water within 10 km of the
     five ports (the reserve's own boats), each cell spread over its neighbours: 147 dark targets
     in 2026; the top 1% of the water held 26% (25.9×), the top 5% held 53% (10.6×), the top 10%
     held 66% (6.6×). The three patrol boxes it proposes (0.2° squares, about 22 km): north of
     Santa Cruz (−0.45, −90.50; 8% of past dark targets), west of Isabela (−0.20, −91.45; 6%),
     south-east of Santa Cruz (−0.65, −90.10; 4%). The current plans give each a full Sentinel-1D
     look within ten days (Oct 17 00:25 or Oct 24 00:17 UTC).
   - What the radar will cover: the S1C plan to Nov 7 has no IW take over the reserve; the S1D
     plan to Nov 5 has six (orbits 106, 128, 33, 55; 24 to 54% of the reserve each).
7. **Our own detector agrees with GFW's.** CA-CFAR on the raw 2024-03-06 pass (VV, read at 40 m, a
   90 × 90 km window in 2.1 s, GCP affine): 8 targets; GFW's one dark target that day matched one of
   ours within 0.58 km.
8. **The other waters, last 12 months:**

   | Water | Dark targets | Share dark | Radar days | Dark per radar day | AIS-off events |
   |---|---|---|---|---|---|
   | Galápagos reserve box | 276 | 37% | 117 | 2.4 | 133 |
   | Yellow Sea (122–125°E, 33.5–37.5°N) | 9,749 | 31% | 114 | 85.5 | 0 |
   | Santa Barbara Channel and sanctuary | 1,009 | 51% | 181 | 5.6 | 0 |

   GFW publishes no AIS-off events in the Yellow Sea or the Santa Barbara Channel (its method leaves
   out water near shore and water with poor reception); silences there would come from raw AIS.

## The API, as found

- Cloudflare refuses Python's default User-Agent (`error code: 1010`); send one.
- One report at a time per user; at most 366 days per report; `group-by` is required (`GEARTYPE`
  for SAR and fishing effort; presence takes only identity groupings, so the client strips them).
- Reports and events carry vessel names, MMSI, IMO numbers and flags unless stripped: the build must
  strip them before anything is cached.
- Region layers exist for the reserve (`public-mpa-all` 11753, from WDPA) and the Galápagos EEZ
  (`public-eez-areas` 8403).
- Rate limits were never close: the whole spike used a few hundred requests of 50,000 a day.

## What it means for the act

- "Who is in the reserve without broadcasting" works on most passes: one to three dark targets
  inside the reserve, our detector and GFW's side by side.
- The strongest prediction is "where to look": a hotspot map from history, shown with its 2026 check
  (22% of 2026's dark targets in 1% of the water). It is honest, measured and easy to read.
- The fleet becomes "where is it now, and when does it come back": GFW's AIS to four days ago shows
  it off Peru; its 2017–25 seasons give the return the pattern expects. A prediction the pattern
  made for 2026 that did not come true is itself a lesson worth one sentence.
- The silent-vessel reveal is rare and loose here (five moments in four years, none inside the
  reserve); with realistic speeds the reach shrinks and the moment may not hold. Treat it as
  optional in the Galápagos.

## Caveats

- GFW's SAR detections are larger vessels only; small boats without AIS are not in them.
- Unmatched is not dark by intent: GFW's matching has its own limits, and the reserve's own boats
  (tourism, artisanal fishing) may not broadcast.
- Licence: GFW's terms are non-commercial (CC BY-NC 4.0) and need attribution ("Powered by Global
  Fishing Watch."); whether a vendor demo counts as commercial advantage is pending AWS legal and a
  note to GFW (the user, Oct 15). The Galápagos act goes ahead only with a yes by Oct 20.

## Artifacts

- `/tmp` scripts (throwaway): `gfw_client.py`, `gal_spike_a.py` to `gal_spike_d.py`; results in
  `/tmp/gal_spike/` (identity stripped). The reserve boundary from GFW: `/tmp/gal_spike/gmr.geojson`.
