"""TAGO 지하철정보 (15098554). Base https://apis.data.go.kr/1613000/SubwayInfo.

Operation paths verified by gateway probing on 2026-11-18. Response field names are not
printed on the listing and are parsed defensively. TAGO's keyword station search returns no
coordinates, so map positions of subway stations come from OpenStreetMap; the two are linked
only when the user/UI explicitly asks by name, and IDs are never converted between them.
"""
from __future__ import annotations

from ..config import get_settings
from .base import ProviderRuntime, http_client
from .tago_common import tago_get_all

BASE = "https://apis.data.go.kr/1613000/SubwayInfo"
runtime = ProviderRuntime(name="TAGO_SUBWAY", min_interval_s=0.1, max_per_minute=60)


def configure() -> None:
    s = get_settings()
    runtime.configured = bool(s.tago_api_key)
    runtime.enabled = s.enable_transit_api


async def search_stations(name: str) -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, BASE, "GetKwrdFndSubwaySttnList", get_settings().tago_api_key,
                                       {"subwayStationName": name}, max_pages=2)
        return [{"station_id": i.get("subwayStationId"), "name": i.get("subwayStationName"),
                 "route_name": i.get("subwayRouteName")} for i in items if i.get("subwayStationId")]
    return await runtime.call(f"kw:{name}", "subway.search", run, cache_seconds=86400)


async def timetable(station_id: str, daily_type: str, up_down: str) -> list[dict]:
    """dailyTypeCode 01 평일 / 02 토 / 03 일, upDownTypeCode U / D (per official listing)."""
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, BASE, "GetSubwaySttnAcctoSchdulList", get_settings().tago_api_key,
                                       {"subwayStationId": station_id, "dailyTypeCode": daily_type,
                                        "upDownTypeCode": up_down}, page_size=200, max_pages=3)
        return [{"dep_time": i.get("depTime"), "arr_time": i.get("arrTime"), "end_station": i.get("endSubwayStationNm"),
                 "station_name": i.get("subwayStationNm")} for i in items]
    return await runtime.call(f"tt:{station_id}:{daily_type}:{up_down}", "subway.timetable", run, cache_seconds=3600)
