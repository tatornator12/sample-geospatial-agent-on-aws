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


def test_a_short_newest_plan_does_not_hide_the_longer_ones_later_takes():
    """Oct 19, 2026: ESA's newest S1D plan ran only to Oct 25, over the Oct 16 plan to Nov 5."""
    html = """
      <a href="/documents/d/sentinel/s1d_mp_user_20260915t185252_20261205t204800">odd, long, too old</a>
      <a href="/documents/d/sentinel/s1d_mp_user_20261012t184114_20261018t204800">superseded, ended</a>
      <a href="/documents/d/sentinel/s1d_mp_user_20261013t173113_20261102t193900">inside the Oct 16 one</a>
      <a href="/documents/d/sentinel/s1d_mp_user_20261016t175423_20261105t200200">long</a>
      <a href="/documents/d/sentinel/s1d_mp_user_20261019t190903_20261025t210300">short, newest</a>
      <a href="https://documents/d/sentinel/s1d_mp_user_20261019t190903_20261025t210300">same, malformed</a>
      <a href="/documents/d/sentinel/s1a_mp_user_20260625t173940_20260630t194000">retired</a>
      <a href="/documents/d/sentinel/s1c_mp_user_20261019t173103_20261108t193600">one</a>
    """
    assert plan.plan_chain(html, now=utc(2026, 10, 19, 20)) == {
        "s1c": ["/documents/d/sentinel/s1c_mp_user_20261019t173103_20261108t193600"],
        "s1d": ["/documents/d/sentinel/s1d_mp_user_20261019t190903_20261025t210300",
                "/documents/d/sentinel/s1d_mp_user_20261016t175423_20261105t200200"],
    }
    # Once the short plan has ended, only the long one is left.
    assert plan.plan_chain(html, now=utc(2026, 10, 26))["s1d"] == ["/documents/d/sentinel/s1d_mp_user_20261016t175423_20261105t200200"]


def test_merged_takes_follow_the_newest_plan_for_each_date():
    def take(day, orbit):
        return plan.DataTake("S1D", "IW", "DV", utc(2026, 10, day), utc(2026, 10, day, 0, 1), orbit, 1000 + day,
                             box(-92, -2, -89, 1))
    newer = ((utc(2026, 10, 19, 19), utc(2026, 10, 25, 21)), [take(24, 33)])
    # The older plan's Oct 18 and Oct 24 fall inside the newer plan's reach: the newer one governs.
    older = ((utc(2026, 10, 16, 17), utc(2026, 11, 5, 20)), [take(18, 128), take(24, 33), take(29, 106)])
    merged = plan.merge_takes([newer, older])
    assert [(t.start.day, t.relative_orbit) for t in merged] == [(24, 33), (29, 106)]        # no duplicate, Oct 29 kept
    looks = plan.next_looks(merged, box(-91.55, -0.3, -91.35, -0.1), after=utc(2026, 10, 19, 20))
    assert [lk.take.start.day for lk in looks] == [24, 29]


def test_a_placemark_without_its_fields_is_skipped():
    doc = ('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>x</name>'
           '<Placemark><name>bad</name><LinearRing><coordinates>0,0,0 1,0,0 1,1,0</coordinates></LinearRing></Placemark>'
           '</Document></kml>')
    period, takes = plan.parse_plan(doc)
    assert period is None and takes == []
