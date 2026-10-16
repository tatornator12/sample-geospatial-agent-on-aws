"""The builder's Global Fishing Watch API v3 client for Act 3 (Dark Vessels). Offline use only: the
runtime never calls GFW and never holds its token.

The token is read from agents/dark-vessels/.env (gitignored) and is never printed. Every response
passes through `scrub` before it is returned, so nothing downstream can print or store a vessel's
name, MMSI (ssvid), IMO number, call sign, flag, owner or GFW vessel id.

API notes from the Oct 15 spike: Cloudflare refuses Python's default User-Agent (error 1010); one
report at a time per user; at most 366 days per report; `group-by` is required for some datasets.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / "agents" / "dark-vessels" / ".env"
BASE = "https://gateway.api.globalfishingwatch.org/v3"
USER_AGENT = "agentic-ai-for-earth-demo/0.2 (offline build)"
# Compared case-insensitively: SAR rows carry `vesselIDs`, presence rows `vesselId` (Oct 16 probe).
IDENTITY = {"name", "shipname", "shipName", "ssvid", "mmsi", "imo", "callsign", "callSign", "flag", "flags",
            "nShipname", "nCallsign", "ownerName", "owner", "operator", "registryInfo", "selfReportedInfo",
            "combinedSourcesInfo", "registryOwners", "registryPublicAuthorizations", "vesselIds", "vesselIDs",
            "id_vessel", "vessel_id", "vesselId"}
_IDENTITY = {k.lower() for k in IDENTITY}
_PSEUDO: dict[str, int] = {}     # vessel id -> a number in order of first sight; this process only, never stored


def _token() -> str:
    if not ENV.exists():
        raise SystemExit(f"GFW_API_TOKEN: {ENV} is missing (the builder's laptop only)")
    for line in ENV.read_text().splitlines():
        if line.startswith("GFW_API_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"GFW_API_TOKEN missing from {ENV}")


def scrub(o):
    """The response with every identity field removed, at any depth."""
    if isinstance(o, dict):
        return {k: scrub(v) for k, v in o.items() if k.lower() not in _IDENTITY}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    return o


_KEY_RE = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"\s*:')
_MMSI_LIKE = re.compile(r"(?<![\d.])\d{9}(?![\d.])")      # nine digits on their own (not inside a decimal)


def scan_identity(text: str) -> list[str]:
    """What in a file's text could identify a vessel: a JSON key from IDENTITY (any case) or a
    nine-digit number standing alone (MMSI-like). Empty when clean. The build runs this on every
    file before anything is uploaded, and fails on any finding."""
    found = sorted({f"key {k}" for k in _KEY_RE.findall(text) if k.lower() in _IDENTITY})
    found += [f"nine-digit number {m}" for m in sorted(set(_MMSI_LIKE.findall(text)))[:5]]
    return found


def pseudonymise(o):
    """Give every row that carries a `vesselId` a number `k` in its place (the same vessel the same
    number, within this process only), so tracks can be joined and vessels counted once an hour.
    The number is not derived from the id and the mapping is never written; `scrub` then drops the id."""
    if isinstance(o, dict):
        vid = o.get("vesselId")
        out = {k: pseudonymise(v) for k, v in o.items()}
        if isinstance(vid, str) and vid:
            out["k"] = _PSEUDO.setdefault(vid, len(_PSEUDO) + 1)
        return out
    if isinstance(o, list):
        return [pseudonymise(v) for v in o]
    return o


def call(method: str, path: str, params: dict | None = None, body: dict | None = None, timeout=180, retries=4,
         keys: bool = False):
    """One API call; the response scrubbed (and pseudonymised first when `keys`)."""
    out = _request(method, path, params, body, timeout, retries)
    return scrub(pseudonymise(out) if keys else out)


def _request(method: str, path: str, params: dict | None, body: dict | None, timeout: int, retries: int):
    q = ("?" + urllib.parse.urlencode(params, doseq=True, safe="[]:,")) if params else ""
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(BASE + path + q, data=data, method=method,
                                     headers={"Authorization": f"Bearer {_token()}", "Content-Type": "application/json",
                                              "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode(errors="replace")
            if e.code in (429, 502, 503, 524) and attempt < retries - 1:
                time.sleep(8 * (attempt + 1))
                if e.code == 524:   # the report kept running server-side: fetch it
                    try:
                        return _request("GET", "/4wings/last-report", None, None, timeout, 1)
                    except SystemExit:
                        pass
                continue
            raise SystemExit(f"GFW {method} {path} -> HTTP {e.code}: {msg}")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"GFW {method} {path} -> {type(e).__name__}")
    raise SystemExit("GFW: retries exhausted")


def report(dataset: str, area: dict, date_range: str, temporal: str, spatial: str = "LOW",
           group_by: str | None = None, filters: str | None = None, aggregate: bool = False,
           keys: bool = False) -> dict:
    """A 4Wings report (`date_range` "YYYY-MM-DD,YYYY-MM-DD", end exclusive) over `area`: a GeoJSON
    FeatureCollection, or a region {"dataset": "public-mpa-all", "id": 11753}. With `keys`, rows that
    name a vessel get a number `k` in its place (see `pseudonymise`)."""
    params = {"datasets[0]": dataset, "date-range": date_range, "temporal-resolution": temporal,
              "spatial-resolution": spatial, "format": "JSON", "spatial-aggregation": str(aggregate).lower()}
    if group_by:
        params["group-by"] = group_by
    if filters:
        params["filters[0]"] = filters
    body = {"region": area} if "dataset" in area and "id" in area else {"geojson": area}
    return call("POST", "/4wings/report", params=params, body=body, keys=keys)


def events(dataset: str, geometry: dict, start: str, end: str, extra: dict | None = None, page=500, max_pages=40) -> list:
    rows, offset = [], 0
    for _ in range(max_pages):
        body = {"datasets": [dataset], "startDate": start, "endDate": end, "geometry": geometry, **(extra or {})}
        out = call("POST", "/events", params={"limit": page, "offset": offset}, body=body)
        entries = out.get("entries", [])
        rows += entries
        nxt = out.get("nextOffset")
        if not entries or nxt in (None, offset) or len(entries) < page:
            break
        offset = nxt
    return rows


def context_layer(dataset: str, region_id: int | str) -> dict:
    """One region of a reference layer as a GeoJSON Feature (e.g. public-mpa-all 11753, the reserve)."""
    return call("GET", f"/datasets/{dataset}/context-layers/{region_id}", timeout=120)
