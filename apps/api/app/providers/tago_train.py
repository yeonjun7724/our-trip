"""TAGO 열차정보 (data.go.kr 15098552). Base URL confirmed on the official listing:
https://apis.data.go.kr/1613000/TrainInfo

Korean operation names on the listing: 도시코드 목록 조회 / 출·도착지기반열차정보 조회 /
시·도별 기차역 목록조회 / 차량종류 목록 조회. The English operation paths below were
verified on 2026-11-18 by probing the gateway (existing op -> 403 key error, unknown op ->
400 NO_OPENAPI_SERVICE_ERROR). Response field names are not printed on the listing and
are parsed defensively; confirm with a live key (scripts/check_providers.py).
"""
from __future__ import annotations

from datetime import date, datetime

from ..config import KST, get_settings
from .base import NoData, ProviderRuntime, http_client
from .tago_common import tago_get_all

BASE = "https://apis.data.go.kr/1613000/TrainInfo"
OP_CITY_CODES = "GetCtyCodeList"
OP_STATIONS_BY_CITY = "GetCtyAcctoTrainSttnList"
OP_VEHICLE_KINDS = "GetVhcleKndList"
OP_TRAINS = "GetStrtpntAlocFndTrainInfo"

runtime = ProviderRuntime(name="TAGO_TRAIN", min_interval_s=0.15, max_per_minute=60)


def configure() -> None:
    s = get_settings()
    runtime.configured = bool(s.tago_api_key)
    runtime.enabled = s.enable_rail_api


def _key() -> str:
    return get_settings().tago_api_key


def parse_dt(v) -> datetime | None:
    if v in (None, ""):
        return None
    s = str(v).split(".")[0]
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=KST)
        except ValueError:
            continue
    return None


async def city_codes() -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, BASE, OP_CITY_CODES, _key(), {})
        return [{"city_code": str(i.get("citycode")), "city_name": i.get("cityname")} for i in items]
    return await runtime.call("citycodes", "train.citycodes", run, cache_seconds=86400)


async def stations_in_city(city_code: str) -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, BASE, OP_STATIONS_BY_CITY, _key(), {"cityCode": city_code})
        return [{"station_id": i.get("nodeid"), "name": i.get("nodename")} for i in items if i.get("nodeid")]
    return await runtime.call(f"stations:{city_code}", "train.stations", run, cache_seconds=3600)


async def vehicle_kinds() -> list[dict]:
    async def run():
        async with http_client() as c:
            items = await tago_get_all(c, BASE, OP_VEHICLE_KINDS, _key(), {})
        return [{"code": str(i.get("vehiclekndid")), "name": i.get("vehiclekndnm")} for i in items]
    return await runtime.call("kinds", "train.kinds", run, cache_seconds=86400)


async def trains(dep_id: str, arr_id: str, day: date, grade_code: str | None = None) -> list[dict]:
    """Planned trains between two official station IDs on a date. Raises NoData if none."""
    async def run():
        async with http_client(15) as c:
            items = await tago_get_all(c, BASE, OP_TRAINS, _key(), {
                "depPlaceId": dep_id, "arrPlaceId": arr_id,
                "depPlandTime": day.strftime("%Y%m%d"), "trainGradeCode": grade_code,
            }, page_size=100, max_pages=5)
        out = []
        for i in items:
            dep, arr = parse_dt(i.get("depplandtime")), parse_dt(i.get("arrplandtime"))
            out.append({
                "train_no": str(i.get("trainno")) if i.get("trainno") is not None else None,
                "train_type": i.get("traingradename"),
                "origin_name": i.get("depplacename"),
                "destination_name": i.get("arrplacename"),
                "departure": dep, "arrival": arr,
                "duration_minutes": int((arr - dep).total_seconds() // 60) if dep and arr else None,
                # Shown only because the provider returned it; never computed by us.
                "adult_fare_krw": int(i["adultcharge"]) if str(i.get("adultcharge", "")).isdigit() else None,
            })
        if not out:
            raise NoData("no trains")
        out.sort(key=lambda t: t["departure"] or datetime.max.replace(tzinfo=KST))
        return out
    return await runtime.call(f"trains:{dep_id}:{arr_id}:{day}:{grade_code}", "train.timetable", run,
                              cache_seconds=300)
