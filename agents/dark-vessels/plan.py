"""When the radar looks again: ESA's published Sentinel-1 acquisition plan.

ESA publishes, per satellite, KML files of the planned data takes for the next three weeks or so
(https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-1/acquisition-plans). Each data
take is a placemark: the satellite, the mode (IW over most seas and coasts, EW over polar water, SM
rarely), polarisation, start and stop in UTC, absolute and relative orbit, and the footprint as a
ring of lon/lat points. This module reads those files and answers one question: after a given time,
which planned IW takes cover how much of an area. It never extrapolates an orbit: a time past the
plan's end is "not planned yet", never a guess.

Pure (bytes in, records out) so it is tested on a fixture cut from a real plan.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.affinity import translate

KML = "{http://www.opengis.net/kml/2.2}"
PLAN_NAME_RE = re.compile(r"^s1[a-d]_mp_user_(\d{8}t\d{6})_(\d{8}t\d{6})$")
LINK_RE = re.compile(r'href="(?:https?://[^"]*)?(/documents/d/sentinel/(s1[a-d])_mp_user_(\d{8}t\d{6})_(\d{8}t\d{6}))"')
PERIOD_RE = re.compile(r"Planned from (\S+) to (\S+)")


@dataclass(frozen=True)
class DataTake:
    satellite: str          # "S1C", "S1D"
    mode: str               # "IW", "EW", "SM"
    polarisation: str       # "DV" (VV+VH) and so on
    start: datetime         # UTC
    stop: datetime
    relative_orbit: int
    absolute_orbit: int
    footprint: Polygon      # lon/lat, unwrapped across the antimeridian (longitudes may pass 180)


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s.strip().replace("Z", "")).replace(tzinfo=timezone.utc)


def _ring(text: str) -> Polygon | None:
    pts = []
    for p in text.split():
        bits = p.split(",")
        if len(bits) >= 2:
            pts.append((float(bits[0]), float(bits[1])))
    if len(pts) < 3:
        return None
    # A strip that crosses the antimeridian jumps by ~360 degrees: unwrap it so the ring stays whole.
    out = [pts[0]]
    for lon, lat in pts[1:]:
        prev = out[-1][0]
        while lon - prev > 180:
            lon -= 360
        while lon - prev < -180:
            lon += 360
        out.append((lon, lat))
    poly = Polygon(out)
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly if not poly.is_empty else None


def parse_plan(data: bytes | str) -> tuple[tuple[datetime, datetime] | None, list[DataTake]]:
    """The plan's period (from its document name) and every data take in it."""
    root = ET.fromstring(data if isinstance(data, bytes) else data.encode("iso-8859-1"))
    name = root.findtext(f"{KML}Document/{KML}name") or ""
    m = PERIOD_RE.search(name)
    period = (_utc(m[1]), _utc(m[2])) if m else None
    takes = []
    for pm in root.iter(f"{KML}Placemark"):
        d = {x.get("name"): (x.findtext(f"{KML}value") or "").strip() for x in pm.iter(f"{KML}Data")}
        coords = pm.findtext(f".//{KML}coordinates")
        fp = _ring(coords) if coords else None
        try:
            take = DataTake(satellite=d["SatelliteId"], mode=d["Mode"], polarisation=d.get("Polarisation", ""),
                            start=_utc(d["ObservationTimeStart"]), stop=_utc(d["ObservationTimeStop"]),
                            relative_orbit=int(d["OrbitRelative"]), absolute_orbit=int(d["OrbitAbsolute"]),
                            footprint=fp)
        except (KeyError, ValueError):
            continue        # a placemark without the fields is not a data take
        if fp is not None:
            takes.append(take)
    return period, takes


def coverage(footprint: Polygon, area: BaseGeometry) -> float:
    """Share of `area` inside `footprint`, trying the footprint shifted by a turn either way."""
    if area.area <= 0:
        return 0.0
    best = 0.0
    for dx in (0.0, -360.0, 360.0):
        fp = footprint if dx == 0.0 else translate(footprint, xoff=dx)
        if fp.intersects(area):
            best = max(best, fp.intersection(area).area / area.area)
    return best


@dataclass(frozen=True)
class Look:
    take: DataTake
    share: float            # of the area, 0 to 1

    def as_dict(self) -> dict:
        t = self.take
        return {"satellite": t.satellite, "start": t.start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "stop": t.stop.strftime("%Y-%m-%dT%H:%M:%SZ"), "relative_orbit": t.relative_orbit,
                "polarisation": t.polarisation, "share": round(self.share, 2)}


def next_looks(takes: list[DataTake], area: BaseGeometry, after: datetime, min_share: float = 0.2,
               modes: tuple[str, ...] = ("IW",), limit: int = 5) -> list[Look]:
    """Planned takes after `after` that cover at least `min_share` of `area`, soonest first."""
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    looks = []
    for t in takes:
        if t.mode not in modes or t.stop <= after:
            continue
        share = coverage(t.footprint, area)
        if share >= min_share:
            looks.append(Look(t, share))
    looks.sort(key=lambda lk: lk.take.start)
    return looks[:limit]


def _stamp(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%dt%H%M%S").replace(tzinfo=timezone.utc)


PLAN_MAX_AGE_DAYS = 21      # ESA's usual horizon; an older plan is not the latest word on any day


def plan_chain(html: str, now: datetime, max_age_days: int = PLAN_MAX_AGE_DAYS) -> dict[str, list[str]]:
    """Per satellite, the plans on ESA's listing page that still say something about the future,
    newest first: the newest plan, then each older plan that runs past every newer one. ESA
    publishes short plans (about six days) over longer ones (about three weeks); a short newest plan
    must not hide the longer one's later takes, which are still the latest published word on those
    days. A plan wholly inside a newer one's period is superseded and left out, and so is one that
    has ended (a retired satellite's last plan) or was published more than `max_age_days` ago (the
    listing carries a few odd long plans, e.g. S1D's of Sep 15 to Dec 5, 2026)."""
    oldest = (now - timedelta(days=max_age_days)).strftime("%Y%m%dt%H%M%S")
    by: dict[str, set] = {}
    for path, sat, start, stop in LINK_RE.findall(html):
        if start >= oldest:
            by.setdefault(sat, set()).add((start, stop, path))
    out: dict[str, list[str]] = {}
    for sat, plans in sorted(by.items()):
        chain, reach = [], ""
        for start, stop, path in sorted(plans, reverse=True):      # the stamps sort as text
            if stop > reach:
                chain.append((stop, path))
                reach = stop
        chain = [path for stop, path in chain if _stamp(stop) > now]
        if chain:
            out[sat] = chain
    return out


def merge_takes(plans: list[tuple[tuple[datetime, datetime] | None, list[DataTake]]]) -> list[DataTake]:
    """One satellite's takes from a chain of plans (newest first, as plan_chain gives them): the
    newest plan's takes, then each older plan's takes from where the newer ones stop. Each date is
    governed by the newest plan that covers it, so a take dropped in a newer plan stays dropped."""
    out: list[DataTake] = []
    covered: datetime | None = None
    for period, takes in plans:
        out += takes if covered is None else [t for t in takes if t.start >= covered]
        end = period[1] if period else max((t.stop for t in takes), default=covered)
        if end is not None:
            covered = end if covered is None else max(covered, end)
    return out


def plan_links(html: str) -> dict[str, str]:
    """The newest plan per satellite on ESA's listing page: {"s1c": "/documents/d/sentinel/s1c_mp_user_…"}.

    The page also carries malformed links (`https://documents/d/...`); only the path is kept. Newest
    means the latest start stamp in the file name.
    """
    best: dict[str, tuple[str, str]] = {}
    for path, sat, start, _stop in LINK_RE.findall(html):
        if sat not in best or start > best[sat][0]:
            best[sat] = (start, path)
    return {sat: path for sat, (_, path) in sorted(best.items())}
