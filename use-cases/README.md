# Use Cases

This directory contains pre-configured scenarios for the geospatial agent. Each scenario includes geometry, satellite imagery (COGs), and narrative descriptions that provide instant-load demo experiences.

## Directory Structure

```
use-cases/
├── la-fires-2025/          # 2025 LA Palisades Fire burn analysis
├── lake-mead-water/        # Lake Mead water level change (2020-2025)
├── amazon-deforestation/   # Amazon rainforest deforestation monitoring
└── [scenario-id]/
    ├── config.json          # Scenario metadata and dates
    ├── geometry.geojson     # Area of interest boundary (EPSG:4326)
    ├── narrative.md         # Description shown in the UI
    ├── before/
    │   ├── tci-YYYY-MM-DD.tif   # True Color Image (before event)
    │   └── ndvi|nbr|ndwi-YYYY-MM-DD.tif  # Index raster (before)
    └── after/
        ├── tci-YYYY-MM-DD.tif   # True Color Image (after event)
        └── ndvi|nbr|ndwi-YYYY-MM-DD.tif  # Index raster (after)
```

A case can instead list its own map (a recorded case): `config.json` carries `"agent"` (the act
the stage switches to) and `"assets": {"layers": [{"file", "title", "render", "delay_ms"}]}`.
Layers name files inside the case folder, never URLs; the backend validates them and the UI
re-validates each `render` hint. `delay_ms` (a whole number, 0 to 15,000) holds a layer back so the
one before it stands alone first, as it did live: the Octagon's hillshade lands 8 s after its true
colour. Tool-call URLs use the placeholder bucket `s3://bucket/use-cases/<id>/…`, `inspections/`
holds what the agent looked at (the evidence chips), and each recorded `inspect_image` call carries
`saw`, what the agent said it saw (the chip's "Saw:" line; the stage bounds it as it does live).

## Recording a case

Each act has a builder that invokes its dev runtime once, in a fresh session, with the stage's plate
word for word, and copies what the room saw into the case folder:

- Earth Analyst: `scripts/build_earth_replay_case.py --case palisades|places-like`
- Methane Hunter: `agents/methane-hunter/build_replay_case.py --case permian|watch`
- AI Archaeologist: `agents/ai-archaeologist/build_replay_case.py --case octagon|great-circle`
  (`--hold-terrain-ms`, 8000 for the Octagon)

All three take `--out` (anywhere), `--sid-file` (the session id) and `--stream-file` (the raw stream,
which names the bucket: keep it out of the repo), and write the words they show the room without em
or en dashes.

**Preview first.** An overwrite is recorded under a preview id (`<id>-take1`) into a scratch folder,
staged to its own prefix `use-cases/<id>-take1/` (nothing live reads it), played on a local stage at
`/?scenario=<id>-take1&agent=<act>`, and only then copied to the real id: move its placeholder URLs
to the real id with a JSON walk, back up every object the sync will overwrite, then
`aws s3 sync <folder>/ s3://<S3_BUCKET_NAME>/use-cases/<id>/` (never `--delete`: the `use-cases/`
prefix also backs the live site). A new case is recorded under its real id directly.

**Numbers check.** Every figure a case shows (the narrative, the config's description, each `saw`,
each layer's title and description, and a gallery card's metrics with `--extra`) must come from that
session's tools:

    scripts/replay_numbers.py --case <folder> --session <sid> --bucket <S3_BUCKET_NAME> [--extra "46.1 km²"] [--dump <dir>]

It reads the session the runtime persisted (`sessions/session_<sid>/`), matches each figure to a
tool result or input at its shown precision and units, prints where each came from, and exits 1
when one is not found. `--dump` saves the session's tool outputs for the record.

## Included Scenarios

| Scenario | Location | Analysis Type | Time Range |
|---|---|---|---|
| `la-fires-2025` | Los Angeles, CA | Recorded: NBR before and after, change maps (Earth Analyst) | Nov 2024, Jan 2025 |
| `earth-places-like-central-park` | New York State | Recorded: Clay embedding similarity search (Earth Analyst) | Jul 2025 |
| `lake-mead-water` | Nevada/Arizona | Normalized Difference Water Index (NDWI) | Sep 2020 - Oct 2025 |
| `amazon-deforestation` | Amazon Basin | Normalized Difference Vegetation Index (NDVI) | Dec 2020 - Sep 2025 |
| `methane-permian-2024` | Permian Basin, TX/NM | Recorded: NASA EMIT CH4 plume ranking (ppm·m) + Sentinel-2 ground | Jan - Dec 2024 |
| `methane-watch-mission` | Methane watch areas | Recorded: the Methane Watch mission and its draft brief | to Oct 2026 |
| `archaeologist-newark` | Newark, Ohio | Recorded: Sentinel-2, then 1 m LiDAR hillshade | Oct 2026 |

`la-fires-2025` keeps its earlier before/after files (`before/`, `after/`, `geometry.geojson`) in
the folder; its recorded `assets.layers` is what the stage shows.

## Notes

- All raster files are Cloud Optimized GeoTIFFs (COGs) for streaming via TiTiler.
- Geometry files use EPSG:4326 (WGS84) coordinate system.
- Scenarios are loaded in the frontend via the Use Case Gallery page.
