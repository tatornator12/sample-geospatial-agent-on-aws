"""ESA's acquisition plan, on a fixture cut from the real S1D plan of Oct 16, 2026 (five placemarks:
three IW takes over the Galapagos, one EW take, one IW take elsewhere). No network."""
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from shapely.geometry import Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plan  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "s1d_mp_user_20261016t175423_20261105t200200.kml"
# The Galapagos Marine Reserve's bounding box (the reserve itself is the GFW / WDPA polygon).
RESERVE = box(-92.67, -2.08, -88.58, 2.35)


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def parsed():
    return plan.parse_plan(FIXTURE.read_bytes())


def test_reads_the_period_and_every_take(parsed):
    period, takes = parsed
    assert period == (utc(2026, 10, 16, 17, 54, 23), utc(2026, 11, 5, 20, 2, 0))
    assert len(takes) == 5
    first = min(takes, key=lambda t: t.start)
    assert first.satellite == "S1D" and first.mode == "EW"
    iw = [t for t in takes if t.mode == "IW"]
    assert {t.relative_orbit for t in iw} >= {106, 128, 33}
    assert all(t.footprint.is_valid and t.stop > t.start for t in takes)


def test_next_looks_over_the_reserve_soonest_first(parsed):
    _, takes = parsed
    # The box is larger than the reserve: orbit 128 covers 24% of the reserve but under 20% of the box.
    looks = plan.next_looks(takes, RESERVE, after=utc(2026, 10, 16, 12), min_share=0.1)
    got = [(lk.take.start.isoformat()[:16], lk.take.relative_orbit) for lk in looks]
    assert got == [("2026-10-17T00:25", 106), ("2026-10-18T11:49", 128), ("2026-10-24T00:17", 33)]
    assert all(0.1 <= lk.share <= 1.0 for lk in looks)
    assert [lk.take.relative_orbit for lk in plan.next_looks(takes, RESERVE, utc(2026, 10, 16, 12))] == [106, 33]
    d = looks[0].as_dict()
    assert d["satellite"] == "S1D" and d["start"] == "2026-10-17T00:25:37Z" and d["polarisation"] == "DV"


def test_a_pass_already_over_is_not_a_next_look_and_ew_is_left_out(parsed):
    _, takes = parsed
    later = plan.next_looks(takes, RESERVE, after=utc(2026, 10, 18, 12), min_share=0.1)
    assert [lk.take.relative_orbit for lk in later] == [33]
    assert all(lk.take.mode == "IW" for lk in plan.next_looks(takes, box(-180, -90, 180, 90), utc(2026, 10, 1), min_share=0))


def test_past_the_plan_nothing_is_invented(parsed):
    period, takes = parsed
    assert plan.next_looks(takes, RESERVE, after=period[1]) == []


def test_a_small_box_needs_the_share_asked_for(parsed):
    _, takes = parsed
    hotspot = box(-90.6, -0.6, -90.4, -0.4)          # off Santa Cruz
    any_cover = plan.next_looks(takes, hotspot, utc(2026, 10, 16), min_share=0.01)
    full = plan.next_looks(takes, hotspot, utc(2026, 10, 16), min_share=0.99)
    assert len(full) <= len(any_cover)
    assert all(lk.share >= 0.99 for lk in full)


def test_a_strip_across_the_antimeridian_stays_whole():
    ring = plan._ring("179.0,10.0,0 -179.0,10.0,0 -179.0,12.0,0 179.0,12.0,0")
    assert ring.bounds == pytest.approx((179.0, 10.0, 181.0, 12.0))
    assert plan.coverage(ring, box(-180.0, 10.5, -179.5, 11.5)) == pytest.approx(1.0)
    assert plan.coverage(ring, box(179.5, 10.5, 180.0, 11.5)) == pytest.approx(1.0)
    assert plan.coverage(Polygon([(0, 0), (1, 0), (1, 1)]), box(0, 0, 0, 0)) == 0.0


def test_newest_plan_per_satellite_from_the_listing_page():
    html = """
      <a href="/documents/d/sentinel/s1c_mp_user_20261013t173113_20261102t193900">1</a>
      <a href="/documents/d/sentinel/s1c_mp_user_20261016t170705_20261107t193600">2</a>
      <a href="https://documents/d/sentinel/s1d_mp_user_20261008t182319_20261015t200700">3</a>
      <a href="/documents/d/sentinel/s1d_mp_user_20261016t175423_20261105t200200">4</a>
      <a href="/documents/247904/4742709/Sentinel-1B_MP_20220114T160000_20220203T180000.kml">old</a>
    """
    assert plan.plan_links(html) == {
        "s1c": "/documents/d/sentinel/s1c_mp_user_20261016t170705_20261107t193600",
        "s1d": "/documents/d/sentinel/s1d_mp_user_20261016t175423_20261105t200200",
    }


def test_a_placemark_without_its_fields_is_skipped():
    doc = ('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>x</name>'
           '<Placemark><name>bad</name><LinearRing><coordinates>0,0,0 1,0,0 1,1,0</coordinates></LinearRing></Placemark>'
           '</Document></kml>')
    period, takes = plan.parse_plan(doc)
    assert period is None and takes == []
