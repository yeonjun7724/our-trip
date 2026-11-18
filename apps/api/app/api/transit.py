from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..db import get_db
from ..errors import AppError
from ..models import ApiUsageLog, Trip, TripMember
from ..providers import odsay, provider_registry, tago_bus
from ..providers.base import NoData, ProviderError
from ..routing import osmnx_engine as eng
from ..routing import transit_router as tr
from ..schemas.common import DataStatus, NamedPoint
from ..security.auth import current_member
from ..services import geocode

router = APIRouter(prefix="/api", tags=["transit"])


class WalkIn(BaseModel):
    origin: NamedPoint
    destination: NamedPoint
    speed_kmh: float | None = None


@router.post("/routes/walking")
async def walking(body: WalkIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    speed = body.speed_kmh or db.get(Trip, member.trip_id).walking_speed_kmh or 4.0
    r = await run_in_threadpool(eng.walk_route, body.origin.lat, body.origin.lon,
                                body.destination.lat, body.destination.lon, speed)
    feature = {"type": "Feature", "geometry": r["geometry"], "properties": {"mode": "WALK", "source": "OSMNX"}} \
        if r["geometry"] else None
    return {**r, "feature": feature,
            "freshness": {"status": DataStatus.ESTIMATED if r["status"] == "OK" else DataStatus.UNAVAILABLE,
                          "provider": "OSMNX", "note": "OpenStreetMap 보행 네트워크 기반 추정"},
            "attribution": "© OpenStreetMap contributors (ODbL)"}


@router.get("/transit/stops/nearby")
async def nearby(lat: float = Query(ge=33, le=39), lon: float = Query(ge=124, le=132), radius: int = 500,
                 member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    speed = db.get(Trip, member.trip_id).walking_speed_kmh or 4.0
    return await tr.nearby_stops(lat, lon, radius, speed)


@router.get("/transit/stops/{stop_key:path}/arrivals")
async def arrivals(stop_key: str, member: TripMember = Depends(current_member)):
    return await tr.arrivals(stop_key)


@router.get("/transit/stops/{stop_key:path}/routes")
async def stop_routes(stop_key: str, member: TripMember = Depends(current_member)):
    try:
        routes = await tr.stop_routes(stop_key)
    except ProviderError as exc:
        return {"stop_key": stop_key, "routes": None, "status": exc.code}
    return {"stop_key": stop_key, "routes": routes, "status": "OK" if routes is not None else "UNSUPPORTED_STOP"}


class TransitIn(BaseModel):
    origin: NamedPoint
    destination: NamedPoint
    departure_at: datetime | None = None
    sort: str = "time"  # time | transfers | walk


@router.post("/transit/routes")
async def transit_routes(body: TransitIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    speed = db.get(Trip, member.trip_id).walking_speed_kmh or 4.0
    res = await tr.route(body.origin.model_dump(), body.destination.model_dump(), body.departure_at, speed)
    res.options = tr.sort_options(res.options, body.sort)
    return res


class GeometryIn(BaseModel):
    map_obj: str


@router.post("/transit/routes/geometry")
async def route_geometry(body: GeometryIn, member: TripMember = Depends(current_member)):
    try:
        return {"status": "OK", "provider": "ODSAY", "geometry": await odsay.lane_geometry(body.map_obj),
                "attribution": odsay.ATTRIBUTION}
    except ProviderError as exc:
        return {"status": exc.code, "message": exc.user_message, "geometry": None}


@router.get("/transit/regions")
async def regions(member: TripMember = Depends(current_member)):
    """Which of our cities each TAGO bus service actually lists (discovered, not assumed)."""
    wanted = {"busan": "부산", "gyeongju": "경주", "pohang": "포항"}
    out = {}
    for svc_name, fn in (("bus_stops", tago_bus.stop_city_codes), ("bus_arrivals", tago_bus.arrival_city_codes)):
        try:
            codes = await fn()
            out[svc_name] = {k: next(({"city_code": c["city_code"], "city_name": c["city_name"]}
                                      for c in codes if c["city_name"] and v in c["city_name"]), None)
                             for k, v in wanted.items()}
        except NoData:
            out[svc_name] = {k: None for k in wanted}
        except ProviderError as exc:
            out[svc_name] = {"status": exc.code}
    return out


@router.get("/geocode/search")
async def geocode_search(q: str, city: str | None = None, member: TripMember = Depends(current_member)):
    return {"results": await geocode.search(q, city), "source": "OSM_NOMINATIM",
            "attribution": "© OpenStreetMap contributors (ODbL), Nominatim"}


@router.get("/providers/status")
def providers_status(db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).date()
    rows = db.execute(select(ApiUsageLog.provider, ApiUsageLog.outcome, func.count())
                      .where(ApiUsageLog.request_date == today)
                      .group_by(ApiUsageLog.provider, ApiUsageLog.outcome)).all()
    usage: dict[str, dict] = {}
    for p, o, n in rows:
        usage.setdefault(p, {})[o or "UNKNOWN"] = n
    return {"providers": [{**s, "usage_today": usage.get(s["provider"], {})} for s in provider_registry.statuses()],
            "walking": eng.registry().info(),
            "notes": ["VERIFIED는 이 서버 인스턴스에서 실제 정상 응답을 받은 뒤에만 표시돼요.",
                      "TMAP은 사용하지 않아요. ODsay를 쓸 수 없을 때는 외부 지도 길찾기 링크를 안내해요."]}
