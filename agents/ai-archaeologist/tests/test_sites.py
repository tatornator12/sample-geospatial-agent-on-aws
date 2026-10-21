"""Known sites only (requirement 2): the catalogue's shape, name lookup, and the refusal that
carries no coordinates."""
import asyncio
import json
import re

from conftest import SESSION

COORD = re.compile(r"-?\d{1,3}\.\d{3,}")


def _run(coro):
    return asyncio.run(coro)


def test_the_catalogue_is_public_documented_and_well_formed(tools):
    sites = tools.catalogue()
    assert len(sites) == 28 and "town-creek-indian-mound" not in sites
    for sid, s in sites.items():
        assert tools.SITE_ID_RE.fullmatch(sid) and s["id"] == sid
        assert s["names"] and all(isinstance(n, str) and n for n in s["names"])
        assert s["source_url"].startswith(("https://", "http://")), sid
        assert s["designation"] and s["steward"] and s["form"] and s["culture"], sid
        lat, lon = s["centre"]["lat"], s["centre"]["lon"]
        assert 24 < lat < 50 and -125 < lon < -66, sid          # contiguous US: USGS 3DEP 1 m
        assert s["frame_half_m"] <= 1500 and s["lrm_stretch_m"] in (0.3, 1.0), sid
        for d in s["documented"]:
            assert d["source_url"].startswith(("https://", "http://")), sid
    newark = sites["newark-great-circle"]
    assert newark["centre"]["verified"] and len(newark["transect"]["coords"]) == 2


def test_names_resolve_exactly_then_on_the_core_name(tools):
    assert tools.resolve("Newark Octagon") == (["newark-octagon"], "name")
    assert tools.resolve("great circle earthworks") == (["newark-great-circle"], "name")
    assert tools.resolve("The Hopeton Earthworks!")[0] == ["hopeton-earthworks"]
    assert tools.resolve("Hopeton") == (["hopeton-earthworks"], "core")
    assert set(tools.resolve("Newark Earthworks")[0]) == {"newark-great-circle", "newark-octagon"}
    for nope in ("an undiscovered mound near Chillicothe", "", "x" * 200, None, 7):
        assert tools.resolve(nope)[0] == []


def test_an_unknown_place_gets_the_fixed_sentence_and_no_coordinates(tools, fake_s3):
    before = set(fake_s3.objects)
    out = _run(tools.find_known_site("a site nobody has found in the Scioto valley"))
    body = json.loads(out)
    assert body["error"] == tools.REFUSAL == "I only work with sites already on the public record."
    assert "Serpent Mound" in body["known_sites"] and not COORD.search(out)
    assert set(fake_s3.objects) == before                      # nothing written


def test_a_known_site_returns_its_record_and_writes_its_frame(tools, fake_s3):
    body = json.loads(_run(tools.find_known_site("Newark Octagon")))
    assert body["site_id"] == "newark-octagon" and body["designation"].startswith("UNESCO World Heritage")
    w, s, e, n = body["frame_bounds"]
    assert w < body["centre"]["lon"] < e and s < body["centre"]["lat"] < n
    key = f"session_data/{SESSION}/geometries/site_newark-octagon.geojson"
    assert body["frame_geometry_s3_url"].endswith(key)
    ring = json.loads(fake_s3.objects[key])["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == [w, s] and ring[2] == [e, n]
    assert body["source_url"].startswith("https://")
    assert "January 1, 2025" in body["public_note"]                        # no longer a golf course
    assert "public_note" not in json.loads(_run(tools.find_known_site("Serpent Mound")))


def test_the_record_says_which_sites_have_a_verified_line(tools):
    # The Great Circle is measured on the record's line; at the Octagon the agent chooses a bearing.
    assert json.loads(_run(tools.find_known_site("Great Circle Earthworks")))["has_verified_transect"] is True
    assert json.loads(_run(tools.find_known_site("Newark Octagon")))["has_verified_transect"] is False


def test_an_ambiguous_name_offers_the_sites_by_name_only(tools):
    out = _run(tools.find_known_site("Newark Earthworks"))
    body = json.loads(out)
    assert set(body["options"]) == {"Great Circle Earthworks", "Octagon Earthworks"} and not COORD.search(out)


def test_a_site_without_built_terrain_is_named_but_not_located(tools, fake_s3):
    tools._manifest_cache.update(at=10**12, body={"version": "v1", "sites": {}})
    out = _run(tools.find_known_site("Serpent Mound"))
    assert "not built yet" in json.loads(out)["error"] and not COORD.search(out)


def test_documented_feet_carry_metres(tools):
    rows = tools._documented(tools.catalogue()["newark-great-circle"])
    diameter = next(r for r in rows if r["dimension"] == "diameter")
    assert diameter["value"] == 1200 and diameter["value_m"] == 366
    wall = next(r for r in tools._documented(tools.catalogue()["fort-ancient"]) if r["unit"] == "ft")
    assert wall["value"] == 23 and wall["value_m"] == 7.0
