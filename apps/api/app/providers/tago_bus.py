"""TAGO 버스정류소정보 (15098534) + 버스도착정보 (15098530).

Operation paths verified on 2026-11-18 by gateway probing. Field names from the official
listings: nearby op -> gpslati, gpslong, nodeid, nodenm, citycode (fixed 500 m radius);
through-routes op -> routeid, routeno, routetp, startnodenm, endnodenm; arrivals op ->
nodeid, nodenm, routeid, routeno, routetp, arrprevstationcnt, vehicletp, arrtime (seconds).
City support is discovered at runtime from each service's own city-code list — it is
never assumed that Busan/Gyeongju/Pohang behave the same.
"""
from __future__ import annotations

from ..config import get_settings
from .base import ProviderRuntime, http_client
from .tago_common import tago_get_all

STOP_BASE = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService"
ARR_BASE = "https://apis.data.go.kr/1613000/ArvlInfoInqireService"
NEARBY_RADIUS_M = 500  # fixed by the provider

stops_runtime = ProviderRuntime(name="TAGO_BUS_STOP", min_interval_s=0.1, max_per_minute=60)
arrivals_runtime = ProviderRuntime(name="TAGO_BUS_ARRIVAL", min_interval_s=0.2, max_per_minute=30)


def configure() -> None:
    s = get_settings()
    for rt in (stops_runtime, arrivals_runtime):
        rt.configured = bool(s.tago_api_key)
        rt.enabled = s.enable_transit_api


def _key() -> str:
    return get_settings().tago_api_key


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def nearby_stops(lat: float, lon: float) -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, STOP_BASE, "getCrdntPrxmtSttnList", _key(),
                                       {"gpsLati": f"{lat:.6f}", "gpsLong": f"{lon:.6f}"}, max_pages=3)
        out = []
        for i in items:
            la, lo = _f(i.get("gpslati")), _f(i.get("gpslong"))
            if la is None or lo is None or not i.get("nodeid"):
                continue
            out.append({"node_id": str(i["nodeid"]), "name": i.get("nodenm"), "city_code": str(i.get("citycode")),
                        "stop_no": str(i["nodeno"]) if i.get("nodeno") not in (None, "") else None,
                        "lat": la, "lon": lo})
        return out
    return await stops_runtime.call(f"near:{lat:.4f}:{lon:.4f}", "bus.nearby", run, cache_seconds=3600)


async def stop_routes(city_code: str, node_id: str) -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, STOP_BASE, "getSttnThrghRouteList", _key(),
                                       {"cityCode": city_code, "nodeid": node_id})
        return [{"route_id": i.get("routeid"), "route_no": str(i.get("routeno")), "route_type": i.get("routetp"),
                 "start": i.get("startnodenm"), "end": i.get("endnodenm")} for i in items]
    return await stops_runtime.call(f"routes:{city_code}:{node_id}", "bus.routes", run, cache_seconds=3600)


async def stop_city_codes() -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, STOP_BASE, "getCtyCodeList", _key(), {})
        return [{"city_code": str(i.get("citycode")), "city_name": i.get("cityname")} for i in items]
    return await stops_runtime.call("citycodes", "bus.citycodes", run, cache_seconds=86400)


async def arrival_city_codes() -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, ARR_BASE, "getCtyCodeList", _key(), {})
        return [{"city_code": str(i.get("citycode")), "city_name": i.get("cityname")} for i in items]
    return await arrivals_runtime.call("citycodes", "arrival.citycodes", run, cache_seconds=86400)


async def arrivals(city_code: str, node_id: str) -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, ARR_BASE, "getSttnAcctoArvlPrearngeInfoList", _key(),
                                       {"cityCode": city_code, "nodeId": node_id}, max_pages=2)
        out = []
        for i in items:
            sec = i.get("arrtime")
            out.append({
                "route_id": i.get("routeid"), "route_no": str(i.get("routeno")) if i.get("routeno") is not None else None,
                "route_type": i.get("routetp"),
                "arrival_seconds": int(sec) if str(sec).isdigit() else None,
                "remaining_stops": int(i["arrprevstationcnt"]) if str(i.get("arrprevstationcnt", "")).isdigit() else None,
                "vehicle_type": i.get("vehicletp"),
            })
        out.sort(key=lambda a: a["arrival_seconds"] if a["arrival_seconds"] is not None else 10**9)
        return out
    ttl = get_settings().tago_arrival_cache_seconds
    return await arrivals_runtime.call(f"arr:{city_code}:{node_id}", "arrival.stop", run, cache_seconds=ttl)
