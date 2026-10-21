"""display_visual shows only files this session wrote (stage review Oct 20, act4 P0-2): a retyped
session URL is refused with the file the model most likely meant, so the LiDAR the answer
describes is the LiDAR on the map."""
import asyncio
import json

from conftest import BUCKET, SESSION


def _show(url, title="Seip Earthworks, local relief"):
    import display_tools
    return json.loads(asyncio.run(display_tools.display_visual(url, title)))


def _terrain(tools, site_id="seip-earthworks"):
    """show_terrain's own URL for the site's local relief (lrm03_ for a ploughed site like Seip)."""
    return json.loads(asyncio.run(tools.show_terrain(site_id, "lrm")))["s3_url"]


def test_a_file_the_session_wrote_passes(tools):
    url = _terrain(tools)
    assert url.endswith(f"session_data/{SESSION}/terrain/lrm03_seip-earthworks.tif")
    assert _show(url) == {"status": "success"}


def test_lrm_for_lrm03_is_refused_and_names_the_file_the_tool_wrote(tools):
    # The run-1 failure: the model wrote lrm_ for show_terrain's lrm03_ (same product, same site).
    url = _terrain(tools)
    out = _show(url.replace("lrm03_", "lrm_"))
    assert out["error"] == "That file is not in this session. Show the s3_url a tool returned, unchanged."
    assert out["did_you_mean"] == url


def test_a_punctuation_or_case_slip_is_matched(tools):
    url = _terrain(tools)
    assert _show(url.replace("seip-earthworks", "seip_earthworks"))["did_you_mean"] == url
    assert _show(url.replace("lrm03_seip", "LRM03_Seip"))["did_you_mean"] == url


def test_a_hillshade_is_matched_only_in_its_own_family(tools, fake_s3):
    hill = json.loads(asyncio.run(tools.show_terrain("seip-earthworks", "hillshade")))["s3_url"]
    _terrain(tools)
    out = _show(hill.replace("hillshade_seip-earthworks", "hillshade_seip_earthworks"))
    assert out["did_you_mean"] == hill
    # A hillshade asked for where only the relief was staged is not "meant" as the relief.
    fake_s3.objects.pop(hill[len(f"s3://{BUCKET}/"):])
    assert "did_you_mean" not in _show(hill)


def test_nothing_similar_is_refused_without_a_guess(tools):
    url = _terrain(tools)
    out = _show(url.replace("lrm03_seip-earthworks", "lrm_hopeton-earthworks"))
    assert "not in this session" in out["error"] and "did_you_mean" not in out
    out = _show(url.replace("lrm03_seip-earthworks.tif", "relief.tif"))
    assert "not in this session" in out["error"] and "did_you_mean" not in out


def test_files_outside_the_session_are_left_to_the_stage(tools):
    assert _show(f"s3://{BUCKET}/use-cases/archaeologist-great-circle/lrm_newark-great-circle.tif") == {"status": "success"}
    assert _show(f"s3://{BUCKET}/session_data/another-session/terrain/lrm_x.tif") == {"status": "success"}
    assert _show(None) == {"status": "success"}


def test_a_failing_list_call_still_refuses(tools, fake_s3):
    url = _terrain(tools)
    fake_s3.fail_list = True
    out = _show(url.replace("lrm03_", "lrm_"))
    assert "not in this session" in out["error"] and "did_you_mean" not in out
