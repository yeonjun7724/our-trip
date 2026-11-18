"""ODsay LAB public transit adapter (primary transit provider).

Verified against https://lab.odsay.com/guide/releaseReference (2026-11-18):
- GET https://api.odsay.com/v1/api/searchPubTransPathT  SX,SY,EX,EY (lon/lat), OPT, SearchType,
  SearchPathType, lang, apiKey. There is NO departure-time parameter -> results are "current".
- subPath.trafficType 1 subway / 2 bus / 3 walk; inter-city 4 train / 5 express bus /
  6 intercity bus / 7 air. lane[] has busNo / name / subwayCode. No bus colour field.
- loadLane?mapObject=0:0@<info.mapObj> returns lane[].section[].graphPos[{x,y}].
- Error codes: -98 within 700 m, -99 no result, 3/4/5 no stop, 6 out of area, -8/-9 bad input.
- Live probe: invalid key -> {"error":[{"code":"500","message":"[ApiKeyAuthFailed] ..."}]}.
- Results pages must show "powered by www.ODsay.com".
"""
from __future__ import annotations

import hashlib

from ..config import get_settings
from ..schemas.transit import RouteLeg, RouteOption
from .base import AuthFailed, BadRequest, NoData, ProviderRuntime, QuotaExceeded, Unsupported, Upstream, http_client

BASE = "https://api.odsay.com/v1/api"
ATTRIBUTION = "powered by www.ODsay.com"
runtime = ProviderRuntime(name="ODSAY", min_interval_s=0.5, max_per_minute=10)

TRAFFIC = {1: "SUBWAY", 2: "BUS", 3: "WALK", 4: "TRAIN", 5: "EXPRESS_BUS", 6: "INTERCITY_BUS", 7: "AIR"}


class TooClose(NoData):
    code = "TOO_CLOSE"
    user_message = "출발지와 도착지가 너무 가까워요(약 700m 이내). 도보 경로를 확인해 주세요."


def configure() -> None:
    s = get_settings()
    runtime.configured = bool(s.odsay_api_key)
    runtime.enabled = s.enable_transit_api


def raise_for_error(data: dict, http_status: int) -> None:
    err = data.get("error")
    if not err:
        return
    e = err[0] if isinstance(err, list) else err
    code = str(e.get("code", ""))
    msg = str(e.get("message") or e.get("msg") or "")
    if "ApiKeyAuthFailed" in msg or "apikey" in msg.lower():
        raise AuthFailed(msg, http_status)
    if "limit" in msg.lower() or "초과" in msg or http_status == 429:
        raise QuotaExceeded(msg, http_status)
    if code == "-98":
        raise TooClose(msg)
    if code in ("-99", "3", "4", "5"):
        raise NoData(f"{code} {msg}")
    if code == "6":
        raise Unsupported(msg)
    if code in ("-8", "-9"):
        raise BadRequest(msg, http_status)
    # ODsay reports server errors as code "500" inside an HTTP 200 body: treat as retryable 5xx
    raise Upstream(f"{code} {msg}", 500 if code == "500" else http_status)


async def _get(path: str, params: dict) -> dict:
    s = get_settings()
    # The ODsay key is registered for the URI platform (our app domain). Verified 2026-11-18:
    # ODsay authenticates such keys by the Referer header (Origin alone is rejected).
    async with http_client(12) as c:
        r = await c.get(f"{BASE}/{path}", params={**params, "apiKey": s.odsay_api_key},
                        headers={"Referer": s.public_base_url.rstrip("/") + "/"})
    if r.status_code == 429:
        raise QuotaExceeded("HTTP 429", 429)
    try:
        data = r.json()
    except ValueError as exc:
        raise Upstream(f"invalid JSON (HTTP {r.status_code})", r.status_code) from exc
    raise_for_error(data, r.status_code)
    if r.status_code >= 400:
        raise Upstream(f"HTTP {r.status_code}", r.status_code)
    return data


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize(data: dict, origin: dict, dest: dict) -> list[RouteOption]:
    result = data.get("result") or {}
    options: list[RouteOption] = []
    for idx, path in enumerate(result.get("path") or []):
        info = path.get("info") or {}
        raw_legs = path.get("subPath") or []
        legs: list[RouteLeg] = []
        for j, sp in enumerate(raw_legs):
            mode = TRAFFIC.get(int(sp.get("trafficType", 0) or 0), "UNKNOWN")
            lanes = sp.get("lane") or []
            if isinstance(lanes, dict):
                lanes = [lanes]
            names = [str(l.get("busNo") or l.get("name") or "") for l in lanes if (l.get("busNo") or l.get("name"))]
            start = {"lat": _num(sp["startY"]), "lon": _num(sp["startX"])} if sp.get("startX") else None
            end = {"lat": _num(sp["endY"]), "lon": _num(sp["endX"])} if sp.get("endX") else None
            if mode == "WALK":  # ODsay walk subPaths carry no coordinates: take them from neighbours
                prev = raw_legs[j - 1] if j > 0 else None
                nxt = raw_legs[j + 1] if j + 1 < len(raw_legs) else None
                start = {"lat": _num(prev["endY"]), "lon": _num(prev["endX"])} if prev and prev.get("endX") else origin
                end = {"lat": _num(nxt["startY"]), "lon": _num(nxt["startX"])} if nxt and nxt.get("startX") else dest
            legs.append(RouteLeg(
                mode=mode, duration_minutes=_num(sp.get("sectionTime")), distance_m=_num(sp.get("distance")),
                start_name=sp.get("startName"), end_name=sp.get("endName"), start=start, end=end,
                line_name=" / ".join(names) or None, stop_count=int(sp["stationCount"]) if sp.get("stationCount") else None,
                provider_refs={"startID": sp.get("startID"), "endID": sp.get("endID"),
                               "subwayCode": lanes[0].get("subwayCode") if lanes else None,
                               "busID": lanes[0].get("busID") if lanes else None},
            ))
        bus_n = int(info.get("busTransitCount") or 0)
        sub_n = int(info.get("subwayTransitCount") or 0)
        rides = bus_n + sub_n if (bus_n or sub_n) else (int(info["transitCount"]) if info.get("transitCount") else None)
        transfers = max(rides - 1, 0) if rides is not None else None
        pay = info.get("payment", info.get("totalPayment"))
        lines = [l.line_name for l in legs if l.mode != "WALK" and l.line_name]
        oid = hashlib.sha1(f"odsay:{idx}:{info.get('mapObj')}:{lines}".encode()).hexdigest()[:12]
        options.append(RouteOption(
            option_id=oid, provider="ODSAY", total_minutes=_num(info.get("totalTime")),
            fare_krw=int(pay) if _num(pay) is not None else None, transfer_count=transfers,
            walk_distance_m=_num(info.get("totalWalk")), legs=legs, lines=lines,
            geometry_ref=info.get("mapObj"), has_geometry=bool(info.get("mapObj")),
        ))
    if not options:
        raise NoData("no path")
    return options


async def search(origin: dict, dest: dict) -> list[RouteOption]:
    params = {"SX": f"{origin['lon']:.6f}", "SY": f"{origin['lat']:.6f}",
              "EX": f"{dest['lon']:.6f}", "EY": f"{dest['lat']:.6f}", "OPT": 0, "lang": 0}

    async def run():
        return normalize(await _get("searchPubTransPathT", params), origin, dest)

    key = "path:" + ":".join(str(v) for v in params.values())
    return await runtime.call(key, "transit.route", run, cache_seconds=get_settings().odsay_cache_seconds)


async def lane_geometry(map_obj: str) -> dict:
    """GeoJSON FeatureCollection for a path's ride segments (class 1 bus, 2 subway)."""
    async def run():
        data = await _get("loadLane", {"mapObject": f"0:0@{map_obj}", "lang": 0})
        feats = []
        for lane in (data.get("result") or {}).get("lane") or []:
            cls = int(lane.get("class", 0) or 0)
            for sec in lane.get("section") or []:
                coords = [[_num(p.get("x")), _num(p.get("y"))] for p in sec.get("graphPos") or []]
                coords = [c for c in coords if None not in c]
                if len(coords) >= 2:
                    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                                  "properties": {"mode": "BUS" if cls == 1 else "SUBWAY" if cls == 2 else "UNKNOWN",
                                                 "lane_type": lane.get("type"), "source": "ODSAY"}})
        return {"type": "FeatureCollection", "features": feats}
    return await runtime.call(f"lane:{map_obj}", "transit.geometry", run,
                              cache_seconds=get_settings().odsay_cache_seconds)
