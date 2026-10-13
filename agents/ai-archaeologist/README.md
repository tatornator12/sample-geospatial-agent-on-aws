# AI Archaeologist (Act 4)

Looks at sites already on the public record the way an archaeologist does: Sentinel-2 true colour
from space, then 1 m LiDAR (USGS 3DEP) as a hillshade and a local relief model, a profile across
the walls, and the other recorded sites that share the form. Spec: `.kiro/specs/ai-archaeologist/`.

**Known sites only.** Every location comes from `data/sites_v1.json` (28 sites whose locations
UNESCO, the National Park Service, or a state or tribal steward already publish). A name that is
not in it gets "I only work with sites already on the public record." and no coordinates. No tool
in this agent can place an arbitrary point. Never add a site whose record is address-restricted.

| Tool | What it does |
|---|---|
| `find_known_site(name)` | the record (culture, period, designation, source) and the site's frame |
| `show_terrain(site_id, product)` | copies the pre-built `hillshade` or `lrm` COG into the session, with its render hint |
| `measure_profile(site_id, transect?)` | banks, ditches and the span along the verified transect, from the cached DEM |
| `find_similar_sites(site_id)` | catalogue sites sharing the record's described form (design decision 4, option B) |

Shared from the platform: `display_visual`, `inspect_image`, `get_rasters`, ArcGIS
`reverse_geocode`.

## Terrain

Built offline, never on stage (a live 3 x 3 km read of 3DEP took 44 s):

```
AWS_PROFILE=main ../../.venv/bin/python ../../scripts/build_site_catalogue.py --dry-run   # 1 m coverage
AWS_PROFILE=main ../../.venv/bin/python ../../scripts/build_site_catalogue.py --site newark-octagon
```

Writes `s3://<bucket>/archaeology/cache/v1/<id>_{dem,hillshade,lrm}.tif` and `manifest.json`, plus
previews in `/tmp/arch_preview/` for checking centres by eye. A site's `lrm_stretch_m` is 1.0 for
standing walls and 0.3 for walls ploughed down to tens of centimetres (Hopeton, Seip).

## Run, deploy, test

```
DEPLOY_TARGET=dev ./deploy.sh                            # ai_archaeologist_dev, reads .env.dev
DEPLOY_TARGET=stable CONFIRM_STABLE=yes ./deploy.sh      # ai_archaeologist (with Release 3, G4)
../../.venv/bin/python ../../scripts/eval.py --agent archaeologist --target dev
../../.venv/bin/python -m pytest -q
```

No data token is needed (3DEP is public). `.env.example` lists the keys; `.env` and `.env.dev`
are gitignored.
