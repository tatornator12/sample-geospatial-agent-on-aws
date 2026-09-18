# Spike: 1 m 3DEP LiDAR DEM → hillshade + local relief model over Newark Earthworks

**Date:** 2026-09-17 · **Timebox:** 2 h, used ~9 min of wall clock for the full path
**Question:** Can we fetch a USGS 1 m DEM tile for a known earthwork, render hillshade + LRM
locally with GDAL, and serve the result through the project's TiTiler — and is the earthwork
geometry actually visible at this resolution?

**Verdict: proven.** The Great Circle, Octagon, and Observatory Circle are all unambiguously
visible in both the hillshade and the LRM. Wall relief is ~2–2.7 m in the DEM transect. End-to-end
(TNM API → download → GDAL → COG → S3 → TiTiler preview) worked on the first pass.

## What was tried

1. **Tile discovery** — TNM Access API, one call, HTTP 200 in 0.64 s:
   `GET https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital Elevation Model (DEM) 1 meter&bbox=-82.46,40.028,-82.445,40.040`
   → exactly 1 product: **`USGS_1M_17_x37y444_OH_Statewide_Phase2_2020_B20.tif`**
   (pub. 2023-11-02, 311,928,200 bytes, bbox −82.525…−82.406 / 40.010…40.102 — covers both the
   Great Circle and the Octagon). `downloadURL` is public prd-tnm S3, no auth.
2. **Download** — `curl` from `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/OH_Statewide_Phase2_2020_B20/TIFF/...`:
   HTTP 200, 311,928,200 bytes in **44.1 s** (~7.1 MB/s). Tile is 10012×10012 px, 1 m,
   **EPSG:26917** (NAD83 / UTM 17N) — targets must be reprojected before `-projwin`.
3. **Locating the earthworks** — the prompt's Great Circle coordinate (40.0339, −82.4527 →
   UTM 376057, 4432531) is ~1.6 km southwest of the real ring. First hillshade showed the circle
   clipped at the window edge; wall-crossing scans on E–W transects located the true center at
   UTM (377913, 4433290) = **lon −82.43110, lat 40.04101**, crest-to-crest diameter **363 m**
   (documented ~366 m). Final 3×3 km subset: `-projwin 375500 4435400 378500 4432400` (covers
   Great Circle + Octagon + Observatory Circle).
4. **Rendering** (GDAL 3.13.1 CLI, all sub-second on the 3000×3000 subset):
   - `gdaldem hillshade -az 315 -alt 45 subset.tif hillshade.tif` (0.23 s)
   - LRM low-pass: `gdalwarp -tr 20 20 -r average` then `gdalwarp -tr 1 1 -r bilinear` back,
     `gdal_calc.py --calc="A-B"` → Float32 residual; LRM range −5.48…+7.98 m, p01 −0.94 / p99 +1.00,
     rendered with `gdaldem color-relief` on a diverging blue–white–red ramp pinned at ±1 m.
   - PNGs (subset only): `docs/spikes/lidar_hillshade.png` (1500², 1,111,411 B),
     `docs/spikes/lidar_lrm.png` (900², 1,755,511 B) — both <2 MB as required.
5. **TiTiler path** (how the demo would serve it):
   - `gdal_translate -of COG -co COMPRESS=DEFLATE` → 6,292,332 B COG, uploaded to
     `s3://geospatial-agent-on-aws-419324627248/spikes/lidar/newark_hillshade_cog.tif`.
   - `GET /prod/cog/info?url=s3://…` with `x-api-key`: **HTTP 200 in 0.34 s** (correct CRS 26917,
     3000×3000, uint8, overviews 2/4/8).
   - `GET /prod/cog/preview.png?url=s3://…&max_size=512`: **HTTP 200 in 0.24 s**, 512×512 PNG.
     **Gotcha:** without `Accept: image/png` API Gateway returns the body base64-encoded
     (`iVBORw0KGgo…` ASCII, 244,984 B); with the header it's binary PNG (183,737 B). Clients must
     send the Accept header.
6. No pip installs were needed (venv rasterio 1.5.0 / numpy 2.4.6 sufficient; GDAL CLI did the heavy lifting).

## What worked / is the geometry visible?

Yes — clearly, in both products:

- **Hillshade** (`lidar_hillshade.png`): the Great Circle reads as a complete crisp ring with its
  east-side entrance gap; the Octagon's eight wall segments and the attached Observatory Circle
  (and connecting parallel walls) are fully traceable. Golf-course features inside the Octagon are
  also visible (it sits on a country club).
- **LRM** (`lidar_lrm.png`): the Great Circle shows the classic bank-with-interior-ditch signature —
  a red (positive) wall ring hugged by a blue (negative) inner ditch ring. Octagon walls trace as
  thin positive lineations. The ±1 m stretch suppresses the urban background enough that the
  earthworks pop.
- **DEM transect** (E–W at y=4433290 through the measured center, baseline median 262.87 m):
  | feature | elevation | vs baseline |
  |---|---|---|
  | west wall crest (x=377731) | 264.75 m | **+1.87 m** |
  | west interior ditch (x=377743) | 260.30 m | **−2.58 m** |
  | interior mound (Eagle Mound, x=377925) | 265.12 m | +2.25 m |
  | east interior ditch (x=378081) | 260.22 m | **−2.65 m** |
  | east wall crest (x=378094) | 265.55 m | **+2.68 m** |
  Wall-to-ditch local relief up to **5.3 m** across ~13 m horizontally — far above 1 m DEM noise.
  Crest-to-crest diameter 363 m.

## Access path (recipe for the agent tool)

```
target lat/lon
  → TNM Access API (datasets="Digital Elevation Model (DEM) 1 meter", small bbox)   ~0.6 s
  → curl downloadURL (public prd-tnm S3, ~300 MB per 10 km tile)                    ~45 s
  → reproject target to tile CRS (usually UTM), gdal_translate -projwin ~3 km       ~1 s
  → gdaldem hillshade -az 315 -alt 45                                               <1 s
  → LRM: gdalwarp 20 m avg → 1 m bilinear → gdal_calc A-B → color-relief ±1 m       ~2 s
  → gdal_translate -of COG → s3://…/spikes/… → TiTiler /cog/info + /cog/preview.png ~1 s/req
```
Alternative worth trying next: 3DEP tiles are COGs on public S3, so TiTiler (or rasterio) could
read the tile *in place* with range requests and skip the 300 MB download entirely; hillshade/LRM
would then need a small compute step server-side or a pre-rendered COG like this spike used.

## Cost & latency observed

- TNM API: free, 0.64 s. Tile download: free (public bucket), 312 MB / 44 s on this connection.
- GDAL processing: ~2.5 s total for a 3×3 km subset on this laptop.
- TiTiler: 0.24–0.34 s per request against the 6 MB COG. S3 storage: 6.3 MB uploaded (negligible).
- Whole spike path: under 10 minutes wall clock including exploration and misplaced-coordinate fix.

## Verdict

**Feasible for the archaeology act.** A 1 m 3DEP DEM resolves 2,000-year-old earthwork walls at
~2–2.7 m relief with strong signal-to-noise; hillshade alone is demo-quality, and the LRM adds a
diagnostic bank/ditch signature. The full data path to the project's TiTiler works with the
existing API key. Two operational notes: (1) verify/derive earthwork coordinates from the data —
the seed coordinate here was ~1.6 km off; (2) TiTiler clients must send `Accept: image/png`.
Per the working agreement, targets must remain public, already-known sites (Newark Earthworks is
a National Historical Park / World Heritage site).

## Artifacts

- `docs/spikes/lidar_hillshade.png` — hillshade, 3×3 km subset, az 315 / alt 45.
- `docs/spikes/lidar_lrm.png` — local relief model, diverging ±1 m stretch.
- `s3://geospatial-agent-on-aws-419324627248/spikes/lidar/newark_hillshade_cog.tif` — COG used for the TiTiler test.
