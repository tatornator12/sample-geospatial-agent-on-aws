"""show_terrain (requirement 3): copied from the pre-built cache into the session, never read
live, with the render hint the map and inspect_image agree on."""
import asyncio
import json

from conftest import SESSION


def _run(coro):
    return asyncio.run(coro)


def test_hillshade_is_copied_into_the_session_with_a_grey_hint(tools, fake_s3):
    body = json.loads(_run(tools.show_terrain("newark-octagon", "hillshade")))
    key = f"session_data/{SESSION}/terrain/hillshade_newark-octagon.tif"
    assert body["s3_url"].endswith(key) and fake_s3.copies == [(f"{tools.CACHE_PREFIX}/newark-octagon_hillshade.tif", key)]
    assert body["render"] == {"kind": "raster", "colormap": "gray", "rescale": [1, 255], "group": "terrain",
                              "legend": "Hillshade", "bounds": body["bounds"]}
    assert body["source"]["dataset"].startswith("USGS 3DEP 1 m")


def test_relief_uses_the_sites_stretch(tools):
    standing = json.loads(_run(tools.show_terrain("newark-great-circle", "lrm")))
    assert standing["s3_url"].endswith("/terrain/lrm_newark-great-circle.tif")
    assert standing["render"]["colormap"] == "rdbu_r" and standing["render"]["rescale"] == [-1.0, 1.0]
    ploughed = json.loads(_run(tools.show_terrain("hopeton-earthworks", "lrm")))
    assert ploughed["s3_url"].endswith("/terrain/lrm03_hopeton-earthworks.tif")
    assert ploughed["render"]["rescale"] == [-0.3, 0.3] and ploughed["stretch_m"] == 0.3


def test_session_names_match_the_shared_inspection_styles(tools):
    from utils.inspection import index_style
    assert index_style(tools.session_name("x", "hillshade", 1.0)).name == "hillshade"
    assert index_style(tools.session_name("x", "lrm", 1.0)).name == "lrm"
    assert index_style(tools.session_name("x", "lrm", 0.3)).name == "lrm03"


def test_bad_inputs_and_a_missing_cache_object(tools, fake_s3):
    assert json.loads(_run(tools.show_terrain("newark-octagon", "slope")))["error"].startswith("product must be")
    assert json.loads(_run(tools.show_terrain("../etc", "lrm")))["error"] == tools.REFUSAL
    assert json.loads(_run(tools.show_terrain("not-a-site", "lrm")))["error"] == tools.REFUSAL
    fake_s3.fail_copy = True
    assert "build_site_catalogue" in json.loads(_run(tools.show_terrain("newark-octagon", "lrm")))["error"]
    assert all(dest.startswith(f"session_data/{SESSION}/terrain/") for _, dest in fake_s3.copies)
