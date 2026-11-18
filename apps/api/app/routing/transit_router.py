"""Nearby stops (TAGO + OSM), bus arrivals, and public-transit routing (ODsay).

TMAP is intentionally not used (project decision 2026-11-18). When ODsay is unavailable we
return a clear status plus official external-map links — never invented routes.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from starlette.concurrency import run_in_threadpool

from ..config import KST
from ..providers import odsay, tago_bus
from ..providers.base import AuthFailed, NoData, NotConfigured, ProviderError, QuotaExceeded, Unsupported
from ..schemas.common import DataStatus, Freshness
from ..schemas.transit import (ArrivalPrediction, ArrivalsResponse, NearbyStopsResponse, RouteOption,
                               StopSourceRef, TransitRouteResponse, TransportStop)
from ..services.external_links import directions
from . import osmnx_engine as eng

RADII = (300, 500, 800, 1000)


def _norm(name: str | None) -> str:
    n = re.sub(r"[\s·.()\-]|정류장|정류소|버스|역$", "", name or "")
    return n.lower()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _osm_stops(lat: float, lon: float, radius: int) -> list[dict]:
    reg = eng.registry()
    seen: set[str] = set()
    out = []
    for z in reg.zones.values():
        if not z.contains(lat, lon, margin_m=-radius):
            continue
        for f in reg.stops_geojson(z.zone_id)["features"]:
            p = f["properties"]
            if p["osm_id"] in seen:
                continue
            slon, slat = f["geometry"]["coordinates"]
            d = float(eng.haversine(lat, lon, slat, slon))
            if d <= radius:
                seen.add(p["osm_id"])
                out.append({**p, "lat": slat, "lon": slon, "d": d})
    return out


def _merge(osm: list[dict], tago: list[dict], lat: float, lon: float, arrival_codes: set[str] | None) -> list[TransportStop]:
    stops: list[TransportStop] = []
    fetched = _now()
    for t in tago:
        d = float(eng.haversine(lat, lon, t["lat"], t["lon"]))
        rt = None if arrival_codes is None else (t["city_code"] in arrival_codes)
        stops.append(TransportStop(
            key=f"TAGO:{t['city_code']}:{t['node_id']}", name=t["name"], kind="BUS", lat=t["lat"], lon=t["lon"],
            straight_distance_m=round(d, 1), stop_number=t.get("stop_no"),
            sources=[StopSourceRef(provider="TAGO", stop_id=t["node_id"], city_code=t["city_code"], realtime_supported=rt)],
            freshness=Freshness(status=DataStatus.VERIFIED_STATIC, provider="TAGO", fetched_at=fetched)))
    for o in osm:
        dup = None
        for s in stops:
            if s.kind != o["kind"]:
                continue
            gap = float(eng.haversine(s.lat, s.lon, o["lat"], o["lon"]))
            same_name = _norm(s.name) and (_norm(s.name) == _norm(o["name"]) or _norm(o["name"]) in _norm(s.name)
                                           or _norm(s.name) in _norm(o["name"]))
            limit = 30 if o["kind"] == "BUS" else 200
            if gap <= limit and (same_name or (o["kind"] == "BUS" and not o["name"] and gap <= 10)):
                dup = s
                break
        if dup:
            # Same physical stop shown once; provider IDs are kept side by side, never converted.
            dup.sources.append(StopSourceRef(provider="OSM", stop_id=o["osm_id"], realtime_supported=False))
            continue
        stops.append(TransportStop(
            key=f"OSM:{o['osm_id']}", name=o["name"], kind=o["kind"], lat=o["lat"], lon=o["lon"],
            straight_distance_m=round(o["d"], 1), stop_number=o.get("ref"),
            sources=[StopSourceRef(provider="OSM", stop_id=o["osm_id"], realtime_supported=False)],
            freshness=Freshness(status=DataStatus.VERIFIED_STATIC, provider="OSM",
                                note="OpenStreetMap 기여자 데이터(ODbL), 그래프 빌드 시점 기준")))
    return stops


async def nearby_stops(lat: float, lon: float, radius: int, speed_kmh: float = 4.0) -> NearbyStopsResponse:
    if radius not in RADII:
        radius = min(RADII, key=lambda r: abs(r - radius))
    providers: dict[str, str] = {}
    notes: list[str] = []
    tago: list[dict] = []
    arrival_codes: set[str] | None = None
    if tago_bus.stops_runtime.usable:
        try:
            tago = [t for t in await tago_bus.nearby_stops(lat, lon)
                    if float(eng.haversine(lat, lon, t["lat"], t["lon"])) <= radius]
            providers["TAGO_BUS_STOP"] = "OK"
            if radius > tago_bus.NEARBY_RADIUS_M:
                notes.append("TAGO 근접 정류소 검색은 반경 500m까지만 제공돼요. 그 바깥은 OSM 정류장만 보여요.")
        except NoData:
            providers["TAGO_BUS_STOP"] = "EMPTY"
        except ProviderError as exc:
            providers["TAGO_BUS_STOP"] = exc.code
        if tago:
            try:
                arrival_codes = {c["city_code"] for c in await tago_bus.arrival_city_codes()}
            except ProviderError:
                arrival_codes = None
    else:
        providers["TAGO_BUS_STOP"] = "NOT_CONFIGURED"
        notes.append("TAGO API 키가 없어 OpenStreetMap 정류장만 보여요. 실시간 도착정보는 제공되지 않아요.")
    osm = await run_in_threadpool(_osm_stops, lat, lon, radius)
    providers["OSM"] = "OK" if eng.registry().zones else "GRAPH_MISSING"
    stops = _merge(osm, tago, lat, lon, arrival_codes)

    if stops:
        walks = await run_in_threadpool(eng.walk_distances_from, lat, lon, [(s.lat, s.lon) for s in stops],
                                        radius * 2.0 + 300)
        for s, w in zip(stops, walks):
            s.walk_status = w["status"]
            if w["status"] == "OK":
                s.walk_distance_m = w["distance_m"]
                s.walk_minutes = eng.minutes_for(w["distance_m"], speed_kmh)
    stops.sort(key=lambda s: (s.walk_distance_m if s.walk_distance_m is not None else s.straight_distance_m * 1.4))
    return NearbyStopsResponse(origin={"lat": lat, "lon": lon}, radius_m=radius, stops=stops[:60],
                               source_notes=notes, providers=providers)


async def stop_routes(stop_key: str) -> list[str] | None:
    parts = stop_key.split(":", 2)
    if parts[0] != "TAGO" or len(parts) != 3 or not tago_bus.stops_runtime.usable:
        return None
    try:
        return sorted({r["route_no"] for r in await tago_bus.stop_routes(parts[1], parts[2]) if r["route_no"]})
    except NoData:
        return []


async def arrivals(stop_key: str) -> ArrivalsResponse:
    now = _now()
    parts = stop_key.split(":", 2)
    if parts[0] != "TAGO" or len(parts) != 3:
        return ArrivalsResponse(stop_key=stop_key, status="UNSUPPORTED_STOP",
                                message="실시간 도착정보를 제공하지 않는 정류장입니다.",
                                freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="OSM"))
    city, node = parts[1], parts[2]
    unavailable = Freshness(status=DataStatus.UNAVAILABLE, provider="TAGO", fetched_at=now)
    if not tago_bus.arrivals_runtime.usable:
        return ArrivalsResponse(stop_key=stop_key, status="NOT_CONFIGURED",
                                message="TAGO API 키가 설정되지 않아 도착정보를 확인할 수 없어요.", freshness=unavailable)
    try:
        codes = {c["city_code"] for c in await tago_bus.arrival_city_codes()}
        if codes and city not in codes:
            return ArrivalsResponse(stop_key=stop_key, status="UNSUPPORTED_REGION",
                                    message="이 지역은 TAGO 버스도착정보를 제공하지 않아요.", freshness=unavailable)
        items = await tago_bus.arrivals(city, node)
        if not items:
            raise NoData("empty")
        return ArrivalsResponse(stop_key=stop_key, status="OK", arrivals=[ArrivalPrediction(**a) for a in items],
                                freshness=Freshness(status=DataStatus.LIVE, provider="TAGO", fetched_at=_now(),
                                                    note="공급자 예측값이며 도착을 보장하지 않아요."))
    except NoData:
        return ArrivalsResponse(stop_key=stop_key, status="EMPTY", message="현재 도착정보를 확인할 수 없습니다.",
                                freshness=Freshness(status=DataStatus.LIVE, provider="TAGO", fetched_at=_now()))
    except QuotaExceeded:
        return ArrivalsResponse(stop_key=stop_key, status="QUOTA_EXCEEDED",
                                message="TAGO 호출 한도를 넘었어요. 잠시 후 다시 시도해 주세요.", freshness=unavailable)
    except AuthFailed:
        return ArrivalsResponse(stop_key=stop_key, status="AUTH_FAILED",
                                message="TAGO 인증에 실패했어요. API 키 활용신청 상태를 확인해 주세요.", freshness=unavailable)
    except ProviderError:
        return ArrivalsResponse(stop_key=stop_key, status="UPSTREAM_ERROR",
                                message="현재 도착정보를 확인할 수 없습니다.", freshness=unavailable)


def _attach_walk_geometry(options: list[RouteOption], speed_kmh: float) -> None:
    for opt in options:
        for leg in opt.legs:
            if leg.mode == "WALK" and leg.geometry is None and leg.start and leg.end \
                    and None not in (leg.start.get("lat"), leg.end.get("lat")):
                r = eng.walk_route(leg.start["lat"], leg.start["lon"], leg.end["lat"], leg.end["lon"], speed_kmh)
                if r["status"] == "OK":
                    leg.geometry = r["geometry"]
                    leg.geometry_source = "OSMNX"


async def route(origin: dict, dest: dict, departure: datetime | None, speed_kmh: float = 4.0) -> TransitRouteResponse:
    links = directions(origin, dest)
    now = _now()
    basis_note = None
    if departure:
        basis_note = ("ODsay 경로 검색은 출발시각 지정을 지원하지 않아요. 아래 결과는 조회 시점 기준이며 "
                      f"{departure.astimezone(KST):%m/%d %H:%M} 운행을 보장하지 않아요.")
    attempted = []
    if not odsay.runtime.configured:
        return TransitRouteResponse(
            status="NOT_CONFIGURED", message="대중교통 경로 API(ODsay)가 설정되지 않았어요. 외부 지도 길찾기를 이용해 주세요.",
            attempted=[{"provider": "ODSAY", "result": "NOT_CONFIGURED"}],
            freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now), external_links=links)
    try:
        options = await odsay.search(origin, dest)
    except odsay.TooClose as exc:
        return TransitRouteResponse(status="TOO_CLOSE", message=exc.user_message, provider="ODSAY",
                                    attempted=[{"provider": "ODSAY", "result": "TOO_CLOSE"}],
                                    freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now),
                                    external_links=links)
    except NoData:
        return TransitRouteResponse(status="NO_ROUTE", message="공급자가 반환한 대중교통 경로가 없어요.", provider="ODSAY",
                                    attempted=[{"provider": "ODSAY", "result": "NO_DATA"}],
                                    freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now),
                                    external_links=links, attribution=odsay.ATTRIBUTION)
    except Unsupported as exc:
        return TransitRouteResponse(status="NO_ROUTE", message=exc.user_message, provider="ODSAY",
                                    attempted=[{"provider": "ODSAY", "result": "OUT_OF_AREA"}],
                                    freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now),
                                    external_links=links)
    except QuotaExceeded:
        attempted.append({"provider": "ODSAY", "result": "QUOTA_EXCEEDED"})
        return TransitRouteResponse(status="QUOTA_EXCEEDED", message="ODsay 호출 한도를 넘었어요. 외부 지도 길찾기를 이용해 주세요.",
                                    attempted=attempted, external_links=links,
                                    freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now))
    except (NotConfigured, ProviderError) as exc:
        attempted.append({"provider": "ODSAY", "result": exc.code})
        return TransitRouteResponse(status="UNAVAILABLE", message=exc.user_message, attempted=attempted,
                                    external_links=links,
                                    freshness=Freshness(status=DataStatus.UNAVAILABLE, provider="ODSAY", fetched_at=now))
    await run_in_threadpool(_attach_walk_geometry, options, speed_kmh)
    return TransitRouteResponse(
        status="OK", provider="ODSAY", options=options, attempted=[{"provider": "ODSAY", "result": "OK"}],
        time_basis="CURRENT", time_basis_note=basis_note, requested_departure=departure,
        attribution=odsay.ATTRIBUTION, external_links=links,
        freshness=Freshness(status=DataStatus.SCHEDULED, provider="ODSAY", fetched_at=now,
                            note="공급자 계산 경로이며 실시간 혼잡·지연은 반영되지 않을 수 있어요."))


def sort_options(options: list[RouteOption], key: str) -> list[RouteOption]:
    inf = float("inf")
    if key == "transfers":
        return sorted(options, key=lambda o: (o.transfer_count if o.transfer_count is not None else inf,
                                              o.total_minutes or inf))
    if key == "walk":
        return sorted(options, key=lambda o: (o.walk_distance_m if o.walk_distance_m is not None else inf,
                                              o.total_minutes or inf))
    return sorted(options, key=lambda o: o.total_minutes if o.total_minutes is not None else inf)


async def gather_safe(*aws):
    return await asyncio.gather(*aws, return_exceptions=True)
