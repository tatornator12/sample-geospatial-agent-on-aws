# Spike: Dark Vessels — Sentinel-1 CFAR vs AIS over the Santa Barbara Channel

**Date:** 2026-09-17/18 · **Timebox:** 2 h active work, used ≈115 min across two stints (the
first 55 min ran as a sub-agent that spent its budget on STAC/scene discovery and was cut off
by a 60-min executor cap; the run resumed next morning — wall clock spans that pause, active
work does not).
**Question:** Does one month of Channel Islands AIS load into DuckDB, does CFAR on one
Sentinel-1 scene produce offshore targets, and are any unmatched to AIS?
**Act 3 decision rule:** Dark Vessels only if unmatched targets exist.

## Verdict

**Decision rule satisfied — unmatched radar targets exist.** 19 CFAR detections over
~3,000 km² of open channel water; 5 classified as known oil platforms; of the remaining 14,
7 sit inside a *proven AIS receiver coverage gap* (not evidence, per the program's own rule)
and **7 are credible dark-vessel candidates in AIS-covered water** at the channel's east
entrance, 3.3–3.7 km from the nearest broadcast at scene time (match radius 500 m). All
seven cluster tightly at 34.20–34.21°N, −119.249..−119.257°E — consistent with the January
market-squid fleet (vessels under 65 ft are not required to carry AIS), i.e. candidates with
an innocent explanation, exactly the "candidates + stated confidence" framing the act needs.
The full pipeline (STAC scene search → windowed COG reads → CFAR → DuckDB AIS match) ran
end to end and is fast enough to demo.

## What was tried

1. **Scene search** — earth-search STAC (AWS) found `S1A_IW_GRDH_1SDV_20240120T015855…`
   with assets on `s3://sentinel-s1-l1c` (requester-pays, eu-central-1). **Dead end from this
   network:** every eu-central-1 S3 endpoint times out (generic endpoint 000 in 10 s) while
   us-east-1 answers in 0.18 s — region-level blackhole, not an auth problem. boto3
   head_object and GDAL /vsis3/ both hang.
2. **Pivot to Microsoft Planetary Computer** (same GRD archive, Azure west-europe, anonymous
   SAS signing, no account): STAC search 0.3 s, chose
   `S1A_IW_GRDH_1SDV_20240120T140050_20240120T140115_052191_064F17`
   (sensing 2024-01-20 14:01:02 UTC, **100 % channel coverage**). Same-day, different pass
   than the AWS pick (14:01 vs 01:59 UTC) — same AOI and AIS day, so the swap is neutral.
   The VV asset is a **tiled COG** (25 688×16 710 uint16, 1024-px blocks): open 0.8 s,
   2000²-px window ≈ 2 s via /vsicurl/. SAS tokens expire within hours — re-sign per run
   (`GET planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-grd`).
3. **CFAR** (`/tmp` script, numpy-only): dB domain; two-parameter CA-CFAR with ring
   statistics from integral images (train box 61 px, guard 31 px), threshold
   `μ_ring + max(5σ_ring, 6 dB)`, 1-px detections require +8 dB, cluster area 1–200 px,
   31-px border discarded. **Five hand-chosen pure-water windows** (~30 M px ≈ 3,000 km²,
   avoiding the coastal platform rows and island shores): west/mid/east channel lanes,
   south channel, east entrance. Read+detect: **19 s total, ~30 MB transferred**.
   → **19 clusters** (peak excess +11.3…+29.6 dB).
4. **AIS acquisition** — the documented MarineCadastre path is gone: the
   `coast.noaa.gov/htdata/CMSP/AISDataHandler/2024/` index still *lists* `AIS_2024_01_20.zip`
   but every file 404s (stale autoindex). The real location came from the NOAA InPort record
   (73064): **`https://noaaocm.blob.core.windows.net/ais/csv2/csv2024/ais-YYYY-MM-DD.csv.zst`**
   (Azure, zstandard CSV, ~200 MB/day national, snake_case columns
   `mmsi/base_date_time/latitude/longitude/…`). DuckDB reads `.csv.zst` directly.
5. **Matching** — scene-day AIS in the channel bbox: 24,448 rows / 114 vessels; 282 pings
   within ±10 min of sensing. Target matched if an AIS ping lies within 500 m in that window;
   platform-classified first (Gail ×2, Grace, Gilda, Gina — the four 30–79-px permanent
   scatterers landed exactly on published platform locations).
6. **AIS audit (why 7 of the unmatched don't count):** hourly ping counts show **zero pings
   west of −119.9° from 10:00–21:00 UTC** (the 14:01 scene sits mid-gap), while 00–09 h shows
   normal lane traffic there; nearest any-time ping to the western lane target is 5.2 km at
   05:12 UTC. That is a terrestrial-receiver coverage gap, and the program rule stands:
   coverage gaps are not evidence.
7. **DuckDB month path** — three days ingested end to end
   (19/20/21 Jan): ~200 MB national file → bbox filter → hive parquet in **1.0 s/day**
   (82,678 rows, 168 vessels, 1.6 MB parquet total). The bottleneck is the download
   (~3.5 min/day at ~1 MB/s here): a full month is ≈ 6 GB / ~1.8 h of downloading plus ~30 s
   of DuckDB. **Month not fully ingested inside the timebox — path proven, remainder is
   bandwidth arithmetic.**

## Access path (recipe)

```
STAC search (planetarycomputer …/api/stac/v1, sentinel-1-grd, bbox+date)      0.3 s
→ SAS sign the vv asset (…/api/sas/v1/token/sentinel-1-grd, anonymous)        0.2 s
→ rasterio /vsicurl/ windowed reads of the tiled COG (GCP georef)             ~2 s/window
→ CA-CFAR (integral-image ring stats, k=5σ ∧ ≥6 dB, area 1–200 px)            <1 s/window
→ AIS: noaaocm.blob.core.windows.net/ais/csv2/csv{Y}/ais-Y-m-d.csv.zst        ~3.5 min/day
→ duckdb read_csv_auto('….csv.zst') bbox filter → hive parquet                1 s/day
→ haversine match ±10 min / 500 m, platform table first                       <1 s
```

## Cost / latency observed

- Radar: ~30 MB Azure egress, free, anonymous. **The approved AWS requester-pays budget was
  not spent** — eu-central-1 is unreachable from this network (VPN-level), which the demo
  must plan around (use Planetary Computer, or in-region compute for the AWS bucket).
- AIS: 3 × ~200 MB free Azure downloads; DuckDB ingest 1 s/day; channel-filtered parquet
  0.5 MB/day.
- End-to-end scene→targets→match, warm: **under one minute** excluding the AIS day download.

## Caveats (binding for the act)

- Findings are **candidates with stated confidence**, never accusations; the east-entrance
  cluster has a mundane likely identity (squid fleet, AIS-exempt small vessels).
- AIS coverage gaps are not evidence: this scene proved a 11-hour, half-channel gap.
  Any Act 3 flow must show the coverage check on screen before calling anything "dark".
- Platform table (4 platforms, 800 m radius) must ship with the tool; without it the two
  biggest "vessels" in the scene are oil rigs.
- CFAR here is windowed and hand-masked; a production pass needs a real land/platform mask
  and sidelobe handling around very bright targets (Gail produced a 1-px satellite cluster).

## Artifacts

- `/tmp` scripts (throwaway per spike convention): cfar.py, match.py, ais_audit.py, ingest.py.
- `targets.json` / `match.json` summaries reproduced in this note; scene id
  `S1A_IW_GRDH_1SDV_20240120T140050_20240120T140115_052191_064F17`.
