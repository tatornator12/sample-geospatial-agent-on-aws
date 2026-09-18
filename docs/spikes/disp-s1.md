# Spike: OPERA DISP-S1 access for "Ground Motion Sentinel"

Date: 2026-11 (timeboxed 2 h; actual ~5 min). Run from laptop (not us-west-2 compute).
Goal: open one DISP-S1 frame from the ASF Earthdata Cloud bucket (us-west-2) with an
Earthdata token and time a one-pixel displacement time-series extraction.

## Verdict (updated 2026-09-18 after ASF app approval)

**Unblocked and proven from the laptop.** The account owner approved ASF's Cumulus app; the
re-run checklist below then passed end to end. Measured:

| Step | Result |
|---|---|
| `s3credentials` on both ASF hosts with Bearer token | HTTP 200 in 1.3–1.6 s; temp creds valid ~1 h |
| HTTPS range-GET bytes 0–1023 of one granule | HTTP 206 via one redirect to CloudFront; valid HDF5 magic |
| Full granule download (newest F11116, 2026-01-26) | **381.7 MB in 9.2 s (41.7 MB/s)** |
| `h5py` open + one-pixel read of `/displacement` | 0.01 s; centre pixel = 0.0282 m, `recommended_mask` = 1; array 6898×9618 float64, chunks 256×256, 135 datasets |
| Temp S3 creds from the laptop (`boto3`, us-west-2 endpoint) | **403 / AccessDenied** on both a `head_object` and a ranged `get_object`: the credentials are in-region only, as expected |
| Frame stack Zarr reference (`short_wavelength_displacement.zarr.json.gz`) | HTTP 200, 17.8 MB gzipped → 536 MB JSON, 1.64 M chunk refs, all `s3://`; array `[389, 6898, 9618]`, chunks `[1, 256, 256]`, codecs shuffle + zlib-4 |
| One-pixel time series through the reference **over HTTPS** (rewrite `s3://…/<id>` → `https://cumulus.asf.earthdatacloud.nasa.gov/OPERA/…/<id>.nc`, ranged GET per chunk with the Bearer token) | HTTP 206 for every chunk, median chunk 13 KB; 32 chunks at 16-way parallel in 5.8 s → **~70 s projected for all 389 epochs** |

Ramifications for a "Ground Motion Sentinel" act:

- **The AgentCore runtime is in us-east-1, so direct S3 is out** (in-region-only creds). The
  HTTPS path is the one to build on and it supports ranged reads, so the chunked Zarr
  approach works from anywhere with only the bearer token: ~13 KB per epoch per pixel instead
  of 380 MB granules. Decoding needs `numcodecs` (shuffle + zlib); not installed, not tested.
- ~70 s for a full 9.6-year series is too slow live on stage but fine as a demo-prep step;
  the live act should read a pre-computed series (or fetch only the last ~40 epochs, ~7 s)
  and spend the stage time on the map. Fewer, larger parallel batches would also help.
- A whole-frame displacement map for one epoch (for the map layer) is a 380 MB download +
  reprojection; that is a prep step or a TiTiler COG built offline, not a live tool call.
- Token lifetime: Earthdata bearer tokens expire (60 days by default); the demo runbook must
  include refreshing `EARTHDATA_TOKEN` in the week before Nov 9.

The original (pre-approval) verdict and evidence are kept below for the record.

## Original verdict (2026-09-17, before approval)

**Blocked pending one-time Earthdata/ASF application approval.** The token is valid
(LPDAAC `s3credentials` returned 200 earlier the same day) but every ASF endpoint —
`s3credentials` on both hosts, HTTPS granule download, and the stack zarr reference —
returns the identical 403:

```json
{"error": "invalid_token", "status_code": 403,
 "error_description": "EULA Acceptance Failure",
 "resolution_url": "https://urs.earthdata.nasa.gov/approve_app?client_id=BO_n7nTIlMljdvU6kRRB3g"}
```

**Unblock (one-time, ~1 minute, needs the account owner in a browser):**
1. Open <https://urs.earthdata.nasa.gov/approve_app?client_id=BO_n7nTIlMljdvU6kRRB3g>
2. Log in with the Earthdata account that owns `EARTHDATA_TOKEN` (page is a plain
   Earthdata Login form; it cannot be scripted with the bearer token — verified HTTP 200
   login page, no API path).
3. Accept the application authorization + EULA it presents (this client_id is ASF's
   Cumulus distribution app; the page will show its name after login).
4. Re-test: `curl -s -H "Authorization: Bearer $EARTHDATA_TOKEN" https://cumulus.asf.earthdatacloud.nasa.gov/s3credentials`
   should return JSON with `accessKeyId`/`secretAccessKey`/`sessionToken`/`expiration`.

No credential, code, or infrastructure problem was found. Everything else needed for the
demo act is confirmed available (below).

## What was tried (all evidence from this run)

| Step | Result |
|---|---|
| CMR granule search, no auth (`short_name=OPERA_L3_DISP-S1_V1`, bbox `-121,35,-119,37`) | HTTP 200, 0.29 s, 20 entries |
| Frame count for F11116 (`readable_granule_name=*F11116*`, pattern) | HTTP 200, `cmr-hits: 389` |
| `s3credentials` @ `cumulus.asf.earthdatacloud.nasa.gov` with Bearer token | HTTP 403, 0.92 s, EULA body above |
| `s3credentials` @ `cumulus.asf.alaska.edu` (pre-flight host) | HTTP 403, 0.89 s, identical body |
| HTTPS range-GET (bytes 0–1023) of one `.nc` with Bearer token, `-L --location-trusted` | HTTP 403, 0 redirects, 184-byte EULA body |
| HTTPS GET of frame-stack `.zarr.json.gz` with Bearer token | HTTP 403, identical body |
| `approve_app` resolution URL, unauthenticated | HTTP 200 Earthdata Login page (interactive only) |

Steps 4–5 of the plan (download 3 granules, h5py pixel read, boto3/S3 cross-region test)
were unreachable — both access paths are behind the same gate. No displacement values
were read; none are quoted here.

## What worked / data inventory (no auth needed)

- **Frame F11116** (Sentinel-1 IW, VV) covers Central California subsidence country
  (bbox above also intersects F36542).
- **389 acquisitions** for F11116 = time-series length; span **2016-07-05 → 2026-01-26**
  (first/last `time_start` from CMR sort), i.e. ~9.6 years at ~12-day cadence.
- **Per-granule size** (20 newest): min 348.7 MB, max 440.8 MB, **mean 378.3 MB** NetCDF4/HDF5.
- Asset links per granule (both schemes captured):
  - HTTPS: `https://cumulus.asf.earthdatacloud.nasa.gov/OPERA/OPERA_L3_DISP-S1_V1/<id>/<id>.nc`
  - S3: `s3://asf-cumulus-prod-opera-products/OPERA_L3_DISP-S1_V1/<id>/<id>.nc` (us-west-2)
- **Shortcut for the demo:** each granule ships a `.zarr.json.gz` (kerchunk-style
  reference), and there is a **frame-level stack reference**
  `s3://asf-cumulus-prod-opera-products/OPERA_L3_DISP-S1_STACK_V1/OPERA_L3_DISP-S1_IW_F11116_VV_V1/OPERA_L3_DISP-S1_IW_F11116_VV_short_wavelength_displacement.zarr.json.gz`.
  Once unblocked, a one-pixel series across all 389 epochs should be readable via
  xarray + fsspec/kerchunk fetching only per-epoch chunks — no 378 MB downloads at all.
  (Needs `s3fs`/`kerchunk` pip installs; not installed, not tested this run.)

## Cost & latency observed / projected

- Observed: CMR queries 0.3 s; auth probes ~0.9 s each. No data transferred (403s).
- Projected full-file path at the assumed 20 MB/s laptop rate: 378 MB ≈ **19 s/granule**,
  3 granules ≈ 57 s (1.1 GB), **20-granule series ≈ 6.3 min / 7.6 GB**. Ample within a
  demo-prep step but not live on stage; the zarr-reference path is the live-demo option.
- Background knowledge to verify next run (not measured here): Earthdata Cloud temporary
  S3 credentials are typically restricted to in-region (us-west-2) use — direct `boto3`
  reads should be tested from the AgentCore runtime, with HTTPS as the anywhere fallback.

## Re-run checklist after approval

1. `s3credentials` curl above → expect 200 + temp creds.
2. HTTPS range-GET of one granule → expect 200/206 (or 302 to S3 presigned).
3. Download 3 F11116 granules, `h5py` open, read `/displacement` (or
   `short_wavelength_displacement`) at one fixed row/col, record MB + s each.
4. From us-west-2 compute: boto3 with temp creds against the stack zarr reference.

Extra pip installs this run: **none**.
