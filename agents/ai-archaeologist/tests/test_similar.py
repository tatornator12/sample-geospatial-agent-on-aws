"""Where else they built like this (requirement 5, option B): ranked by the record's form, only
catalogue sites, the same complex listed apart."""
import asyncio
import json


def _run(coro):
    return asyncio.run(coro)


def test_form_terms_read_the_records_words(tools):
    assert {"circle", "ditch", "enclosure"} <= tools.form_terms("a circular enclosure whose walls surround an interior ditch")
    assert tools.form_terms("an octagon joined by parallel walls to a circle") >= {"octagon", "circle", "avenue"}
    assert "effigy" in tools.form_terms("an effigy mound in the shape of a serpent")
    assert tools.form_terms("") == set()


def test_from_the_great_circle_only_catalogue_sites_sharing_a_form(tools):
    body = json.loads(_run(tools.find_similar_sites("newark-great-circle", top_k=5)))
    ids = [m["site_id"] for m in body["matches"]]
    assert ids and set(ids) <= set(tools.catalogue()) and "newark-great-circle" not in ids
    assert "newark-octagon" not in ids
    assert [s["name"] for s in body["same_complex"]] == ["Octagon Earthworks"]
    assert all(m["shared_form"] for m in body["matches"]) and all(m["distance_km"] >= 10 for m in body["matches"])
    assert "circle" in body["matches"][0]["shared_form"] and body["matches"][0]["same_culture"]
    assert "public record" in body["method"]


def test_top_k_is_bounded_and_unknown_sites_are_refused(tools):
    assert len(json.loads(_run(tools.find_similar_sites("newark-great-circle", top_k=50)))["matches"]) <= 8
    assert len(json.loads(_run(tools.find_similar_sites("newark-great-circle", top_k="x")))["matches"]) <= 3
    assert json.loads(_run(tools.find_similar_sites("lost-city")))["error"] == tools.REFUSAL
