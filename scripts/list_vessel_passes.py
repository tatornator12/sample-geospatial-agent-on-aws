"""Act 3 passes on file (task 1.1): every Sentinel-1 pass over the Galápagos Marine Reserve from
2025 to the newest GFW day, GFW's radar detections on each, the coverage rule on the best, and the
star chosen by design decision 3, into agents/dark-vessels/data/passes_v1.json.

  .venv/bin/python scripts/list_vessel_passes.py [--until 2026-10-13] [--shortlist 8]
  .venv/bin/python scripts/list_vessel_passes.py --until 2026-11-03 --newest 6 --min-share 0.2 --append

With --append (the rerun, R7.2), the passes on file are kept as they are and the newest IW passes
after them, up to GFW's newest radar day, whose footprint covers at least --min-share of the reserve,
are added with role `on_file`, at most --newest of them. No star and no candidate filter: the
footprint share only selects. It prints GFW's newest radar and AIS days (the runbook's step 2).

A pass is one satellite's frames on one orbit on one day (Planetary Computer `sentinel-1-grd`).
GFW's detections (public-global-sar-presence, region public-mpa-all 11753, so inside the reserve
only) are joined to a pass by day and footprint. A detection is set aside as `port` within 10 km of
the five ports (data/reserve_v1.geojson). For the shortlist (the newest passes with at least two
unmatched detections away from the ports), the AIS presence around the pass goes through
coverage.py; an unmatched detection in heard water is a candidate.

The star is the most recent pass with at least two candidates inside the reserve. Both detectors
are required for a candidate. Ours runs at the build (task 2.1), so until then every count here is
GFW's alone and the file says `provisional`.

The silent-vessel pass is the Oct 15 spike's moment search (GFW AIS-off events to Oct 11, 2026
against 1,116 scenes), re-read at 6 kn (design component 8).

Needs the builder's GFW token and the network. Prints no identity: the client scrubs every response
and numbers vessels per process (scripts/vessels_gfw.py).
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agents" / "dark-vessels"
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(AGENT))
import vessels_gfw as gfw  # noqa: E402
import ais_coverage as cv  # noqa: E402
from predict import Grid  # noqa: E402

OUT = AGENT / "data" / "passes_v1.json"
RECORDS = AGENT / "data" / "reserve_v1.geojson"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
REGION = {"dataset": "public-mpa-all", "id": 11753}
SAR = "public-global-sar-presence:latest"
PRESENCE = "public-global-presence:latest"
PLATFORM = {"sentinel-1a": "Sentinel-1A", "sentinel-1b": "Sentinel-1B", "sentinel-1c": "Sentinel-1C", "sentinel-1d": "Sentinel-1D"}
PORT_KM = 10.0
SILENT = {  # Case 8 of the Oct 21 spike (docs/spikes/galapagos-recent-silences.md, section 3), at 6 kn (task 15);
    # Mar 6 2024 (docs/spikes/galapagos.md, finding 5) before it. Distances by water, measured on its built targets.
    "sensed_day": "2026-04-01", "satellite": "Sentinel-1A", "pass_time": "2026-04-01T00:26Z",
    "gap": {"type": "fishing", "off_h_before_pass": 6.6, "silent_h": 355.9, "back_on_km": 476.6,
            "off": [-91.9463, -1.8199]},
    "speed_kn": 6, "reach_km": 73, "dark_in_reach_km": [9.4, 72.1], "dark_out_of_reach": 6,
    "plan": {"name": "s1a_mp_user_20260327t172127_20260416t194000",
             "key": "vessels/cache/plan/s1a_mp_user_20260327t172127_20260416t194000.kml",
             "look": "2026-04-01T00:26:26Z"},
    "why": "Case 8 of the Oct 21 spike (docs/spikes/galapagos-recent-silences.md): the AIS went off 6.6 h before the "
           "pass, 33 km outside the reserve, and ESA's S1A plan published Mar 27 already held the look; at 6 kn the "
           "reach is 73 km, touching the reserve. Tighter than Mar 6 2024 (12 h, 133 km). Sentinel-1A has since "
           "stopped, so it is an earlier pass",
}


def km(a, b):
    p = math.pi / 180
    h = math.sin((b[1] - a[1]) * p / 2) ** 2 + math.cos(a[1] * p) * math.cos(b[1] * p) * math.sin((b[0] - a[0]) * p / 2) ** 2
    return 12742.0176 * math.asin(math.sqrt(h))


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))


def stac_items(bbox, start, end):
    body = {"collections": ["sentinel-1-grd"], "bbox": list(bbox), "datetime": f"{start}T00:00:00Z/{end}T00:00:00Z", "limit": 250}
    items, url = [], STAC
    for _ in range(40):
        page = post(url, body)
        items += page["features"]
        nxt = next((ln for ln in page.get("links", []) if ln.get("rel") == "next"), None)
        if not nxt:
            break
        url, body = nxt["href"], nxt.get("body", body)
    return items


def passes_from(items, reserve):
    """Frames grouped into passes: one platform, one relative orbit, sensed within 10 minutes."""
    rows = []
    for it in items:
        p = it["properties"]
        rows.append((p.get("platform", "").lower(), p.get("sat:relative_orbit"), p.get("sat:orbit_state"),
                     datetime.fromisoformat(p["datetime"].replace("Z", "+00:00")), it["id"], shape(it["geometry"])))
    rows.sort(key=lambda r: (r[0], r[1], r[3]))
    out = []
    for r in rows:
        last = out[-1] if out else None
        if last and last["_key"] == (r[0], r[1]) and r[3] - last["_t1"] <= timedelta(minutes=10):
            last["scenes"].append(r[4]); last["_fp"].append(r[5]); last["_t1"] = r[3]
            continue
        out.append({"_key": (r[0], r[1]), "_t0": r[3], "_t1": r[3], "_fp": [r[5]], "scenes": [r[4]],
                    "satellite": PLATFORM.get(r[0], r[0]), "relative_orbit": r[1], "orbit_state": r[2]})
    for ps in out:
        fp = unary_union(ps["_fp"])
        ps["_footprint"] = fp
        ps["reserve_share"] = round(fp.intersection(reserve).area / reserve.area, 3)
        mid = ps["_t0"] + (ps["_t1"] - ps["_t0"]) / 2
        ps["sensed"] = mid.strftime("%Y-%m-%dT%H:%M:%SZ")
        ps["_time"] = mid
        ps["pass_id"] = f"s{ps['satellite'][-2:].lower()}-{mid.strftime('%Y%m%dt%H%M')}"     # e.g. s1d-20261012t0018
    return [p for p in out if p["reserve_share"] > 0.01]


def sar_rows(start: date, end: date, matched: bool):
    """GFW's radar detections inside the reserve, one row per day and 0.01 deg cell."""
    rows, a = [], start
    while a < end:
        b = min(end, a + timedelta(days=365))
        out = gfw.report(SAR, REGION, f"{a},{b}", "DAILY", "HIGH", group_by="GEARTYPE",
                         filters=f"matched='{str(matched).lower()}'")
        for ent in out.get("entries", []):
            for _, rs in ent.items():
                for r in rs or []:
                    rows.append({"day": r["date"][:10], "lon": r["lon"], "lat": r["lat"], "n": int(r.get("detections", 1)),
                                 "matched": matched})
        a = b
        time.sleep(1)
    return rows


def parse_hour(s: str) -> datetime:
    s = s.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d %H"):
        try:
            return datetime.strptime(s[:len(datetime(2000, 1, 1).strftime(fmt))], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"unparsed hour: {s!r}")


def presence_fixes(pass_time: datetime, area: dict) -> list[cv.Fix]:
    """The AIS presence in the hours around the pass, one keyless fix per vessel per hour."""
    a = (pass_time - cv.WINDOW).date()
    b = (pass_time + cv.WINDOW).date() + timedelta(days=1)
    out = gfw.report(PRESENCE, area, f"{a},{b}", "HOURLY", "HIGH", group_by="VESSEL_ID", keys=True)
    rows = []
    for ent in out.get("entries", []):
        for _, rs in ent.items():
            for r in rs or []:
                if "k" in r:
                    rows.append((r["k"], parse_hour(r["date"]), r["lon"], r["lat"]))
    if out.get("nextOffset"):
        raise SystemExit(f"presence report for {pass_time:%Y-%m-%d %H:%M} was paged (nextOffset); page it before trusting it")
    return cv.fixes_from_tracks(rows, pass_time)


def sensed_at(e: dict) -> datetime:
    return datetime.fromisoformat(e["sensed"].replace("Z", "+00:00"))


def iw_only(items: list[dict]) -> list[dict]:
    """The frames in Interferometric Wide swath mode (the mode the passes on file are in)."""
    return [i for i in items if i["properties"].get("sar:instrument_mode") == "IW"]


def pick_new(passes: list[dict], on_file: dict, newest: int, min_share: float, last_day: date) -> list[dict]:
    """The rerun's rule (R7.2): the newest `newest` passes after the newest pass on file, sensed on or
    before `last_day` (GFW's newest radar day), whose footprint covers at least `min_share` of the
    reserve. No star and no candidate filter."""
    known = {e["pass_id"] for e in on_file["passes"] + [on_file["silent_vessel"]]}
    after = max(sensed_at(e) for e in on_file["passes"])
    ok = [p for p in passes if p["pass_id"] not in known and p["_time"] > after and p["_time"].date() <= last_day
          and p["reserve_share"] >= min_share]
    return sorted(ok, key=lambda p: p["_time"], reverse=True)[:newest]


def appended(on_file: dict, picked: list[dict], min_share: float) -> dict:
    """The file with the picked passes after the passes on file, which are kept as they are."""
    note = f"on file by the rerun's rule: among the newest IW passes over at least {min_share:.0%} of the reserve"
    new = [{"pass_id": p["pass_id"], "role": "on_file", "satellite": p["satellite"], "sensed": p["sensed"],
            "orbit_state": p["orbit_state"], "relative_orbit": p["relative_orbit"], "scenes": p["scenes"],
            "reserve_share": p["reserve_share"], "provisional": True, "note": note}
           for p in sorted(picked, key=lambda p: p["_time"])]
    return {**on_file, "passes": on_file["passes"] + new}


def gfw_newest_days(until: date, area: dict) -> tuple[date | None, date | None]:
    """GFW's newest radar day (a detection in the reserve) and newest AIS day (a vessel heard over it),
    in the 30 days before `until`."""
    start = until - timedelta(days=30)
    radar = [d["day"] for d in sar_rows(start, until, False) + sar_rows(start, until, True)]
    rep = gfw.report(PRESENCE, area, f"{start},{until}", "DAILY", "LOW", group_by="VESSEL_ID", keys=True)
    ais = [r["date"][:10] for ent in rep.get("entries", []) for _, rs in ent.items() for r in rs or []]
    return (date.fromisoformat(max(radar)) if radar else None, date.fromisoformat(max(ais)) if ais else None)


def append(until: date, newest: int, min_share: float) -> int:
    on_file = json.loads(OUT.read_text())
    rec = json.loads(RECORDS.read_text())
    reserve = shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))
    w, s, e, n = reserve.bounds
    area = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": mapping(box(w - 0.3, s - 0.3, e + 0.3, n + 0.3))}]}
    after = max(sensed_at(x) for x in on_file["passes"])
    radar_day, ais_day = gfw_newest_days(until, area)
    print(f"GFW's newest radar day {radar_day}, newest AIS day {ais_day} (before {until})")
    if radar_day is None:
        raise SystemExit("GFW has no radar day in the 30 days before --until: nothing to add")
    passes = passes_from(iw_only(stac_items((w, s, e, n), after.date().isoformat(), until.isoformat())), reserve)
    picked = pick_new(passes, on_file, newest, min_share, radar_day)
    for p in sorted(picked, key=lambda p: p["_time"]):
        late = ais_day is None or p["_time"].date() >= ais_day
        print(f"  add {p['pass_id']} {p['sensed']} orbit {p['relative_orbit']} {p['orbit_state']}, footprint "
              f"{p['reserve_share']:.0%}" + ("; GFW's AIS may not cover its window yet" if late else ""))
    if not picked:
        print(f"no pass after {after:%Y-%m-%d} qualifies; {OUT.relative_to(ROOT)} unchanged")
        return 0
    OUT.write_text(json.dumps(appended(on_file, picked, min_share), ensure_ascii=False, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(picked)} passes added; {len(on_file['passes'])} kept as they were")
    return 0


def main(argv):
    until = date.fromisoformat(argv[argv.index("--until") + 1]) if "--until" in argv else date(2026, 10, 13)
    if "--append" in argv:
        if "--newest" not in argv:
            raise SystemExit("--append needs --newest N")
        newest = int(argv[argv.index("--newest") + 1])
        min_share = float(argv[argv.index("--min-share") + 1]) if "--min-share" in argv else 0.2
        if newest < 1 or not 0 < min_share <= 1:
            raise SystemExit("--newest is at least 1 and --min-share is in (0, 1]")
        return append(until, newest, min_share)
    if "--newest" in argv or "--min-share" in argv:
        raise SystemExit("--newest and --min-share go with --append")
    shortlist = int(argv[argv.index("--shortlist") + 1]) if "--shortlist" in argv else 8
    rec = json.loads(RECORDS.read_text())
    reserve = shape(next(f["geometry"] for f in rec["features"] if f["properties"]["kind"] == "reserve"))
    ports = [f["geometry"]["coordinates"] for f in rec["features"] if f["properties"]["kind"] == "port"]
    rp = prep(reserve)
    w, s, e, n = reserve.bounds

    t0 = time.time()
    items = stac_items((w, s, e, n), "2025-01-01", until.isoformat())
    passes = passes_from(items, reserve)
    print(f"Sentinel-1: {len(items)} frames, {len(passes)} passes over the reserve, 2025-01-01 to {until} ({time.time() - t0:.0f}s)")

    t0 = time.time()
    dets = sar_rows(date(2025, 1, 1), until, False) + sar_rows(date(2025, 1, 1), until, True)
    print(f"GFW radar detections in the reserve: {len(dets)} cells ({time.time() - t0:.0f}s)")
    by_day: dict[str, list] = {}
    for d in dets:
        d["port_km"] = round(min(km((d["lon"], d["lat"]), p) for p in ports), 1)
        by_day.setdefault(d["day"], []).append(d)
    orphan = 0
    for ps in passes:
        fp = prep(ps["_footprint"].buffer(0.05))
        mine = [d for d in by_day.get(ps["_time"].date().isoformat(), []) if fp.contains(Point(d["lon"], d["lat"]))]
        ps["_dets"] = mine
        ps["gfw"] = {"matched": sum(d["n"] for d in mine if d["matched"]),
                     "unmatched": sum(d["n"] for d in mine if not d["matched"]),
                     "unmatched_away_from_ports": sum(d["n"] for d in mine if not d["matched"] and d["port_km"] >= PORT_KM)}
    seen = {id(d) for ps in passes for d in ps["_dets"]}
    orphan = sum(1 for d in dets if id(d) not in seen)
    print(f"  joined to passes: {len(seen)}; on no pass footprint: {orphan}")

    # Coverage on the shortlist: the newest passes with at least two unmatched detections away from the ports.
    step = 0.05
    grid = Grid(round(math.floor(w / step) * step, 2), round(math.floor(s / step) * step, 2),
                round(math.ceil(e / step) * step, 2), round(math.ceil(n / step) * step, 2), step)
    h, wd = grid.shape
    water = np.array([[rp.contains(Point(grid.west + (c + .5) * step, grid.south + (r + .5) * step)) for c in range(wd)] for r in range(h)])
    area = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": mapping(box(w - 0.3, s - 0.3, e + 0.3, n + 0.3))}]}
    short = sorted([p for p in passes if p["gfw"]["unmatched_away_from_ports"] >= 2], key=lambda p: p["_time"], reverse=True)[:shortlist]
    for ps in short:
        t0 = time.time()
        fixes = presence_fixes(ps["_time"], area)
        heard = cv.heard_cells(fixes, grid, ps["_time"], water=water)
        away = [d for d in ps["_dets"] if not d["matched"] and d["port_km"] >= PORT_KM]
        cand = sum(d["n"] for d in away if cv.is_heard(heard, grid, d["lon"], d["lat"]))
        ps["coverage"] = {"heard_share": round(cv.heard_share(heard, water), 3), "fixes": len(fixes),
                          "candidates": cand, "unproven": sum(d["n"] for d in away) - cand}
        print(f"  {ps['pass_id']} {ps['sensed']} share {ps['reserve_share']:.0%}: unmatched away {sum(d['n'] for d in away)}, "
              f"heard {ps['coverage']['heard_share']:.1%} ({len(fixes)} fixes), candidates {cand} ({time.time() - t0:.0f}s)")
        time.sleep(1)

    ranked = sorted([p for p in short if p.get("coverage", {}).get("candidates", 0) >= 2], key=lambda p: p["_time"], reverse=True)
    if not ranked:
        raise SystemExit("no pass on the shortlist has two candidates: widen --shortlist")
    star, alternates = ranked[0], ranked[1:5]

    def entry(ps, role, note):
        return {"pass_id": ps["pass_id"], "role": role, "satellite": ps["satellite"], "sensed": ps["sensed"],
                "orbit_state": ps["orbit_state"], "relative_orbit": ps["relative_orbit"], "scenes": ps["scenes"],
                "reserve_share": ps["reserve_share"], "gfw": ps["gfw"], "coverage": ps.get("coverage"),
                "provisional": True, "note": note}

    on_file = [entry(star, "star", "the most recent pass with at least two candidates inside the reserve (decision 3)")]
    on_file += [entry(p, "alternate", "a recent pass with at least two candidates") for p in alternates]
    # The silent vessel's pass: that day's frames over where its AIS went off.
    lon, lat = SILENT["gap"]["off"]
    day = date.fromisoformat(SILENT["sensed_day"])
    sv = [p for p in passes_from(stac_items((lon - 1, lat - 1, lon + 1, lat + 1), day.isoformat(), (day + timedelta(days=1)).isoformat()), reserve)
          if p["satellite"] == SILENT["satellite"] and p["_footprint"].contains(Point(lon, lat))]
    if len(sv) != 1:
        raise SystemExit(f"the silent vessel's pass: {len(sv)} candidates on {day}")
    silent = {"pass_id": sv[0]["pass_id"], "role": "silent_vessel", "sensed": sv[0]["sensed"], "orbit_state": sv[0]["orbit_state"],
              "relative_orbit": sv[0]["relative_orbit"], "scenes": sv[0]["scenes"], "reserve_share": sv[0]["reserve_share"], **SILENT}
    out = {
        "version": "v1", "built": date.today().isoformat(), "until": until.isoformat(),
        "rule": {"heard": "a 0.05 deg cell is heard when, in at least one hour of the three either side of the pass, two "
                          "or more different broadcasting vessels were heard within 30 km of it",
                 "candidate": "no AIS match, at least 10 km from a port, in heard water, seen by both detectors",
                 "star": "the most recent pass with at least two candidates inside the reserve"},
        "provisional": "every count is GFW's detector alone; ours runs at the build (task 2.1) and a candidate needs both",
        "sources": ["Microsoft Planetary Computer, sentinel-1-grd (Copernicus Sentinel data)",
                    "Global Fishing Watch API v3: public-global-sar-presence, public-global-presence (Powered by Global Fishing Watch.)"],
        "summary": {"passes": len(passes), "with_two_unmatched_away": sum(p["gfw"]["unmatched_away_from_ports"] >= 2 for p in passes),
                    "shortlist": [p["pass_id"] for p in short]},
        "passes": on_file,
        "silent_vessel": silent,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: star {star['pass_id']} ({star['coverage']['candidates']} candidates, heard "
          f"{star['coverage']['heard_share']:.1%}); alternates {[p['pass_id'] for p in alternates]}; silent vessel {SILENT['sensed_day']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
