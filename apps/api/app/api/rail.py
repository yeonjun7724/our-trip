from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import KST
from ..db import get_db
from ..errors import AppError
from ..models import ItineraryItem, RailReservation, TripMember
from ..providers import tago_train
from ..providers.base import NoData, ProviderError
from ..routing import osmnx_engine as eng
from ..security.auth import current_member
from ..services import rail_service as rs
from .common import get_trip, log_activity

router = APIRouter(prefix="/api", tags=["rail"])


@router.get("/rail/stations")
async def stations(q: str = "", member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    return await rs.search_stations(db, q)


@router.post("/rail/stations/refresh")
async def refresh(member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    return {"updated": await rs.refresh_stations(db)}


@router.get("/rail/vehicle-kinds")
async def kinds(member: TripMember = Depends(current_member)):
    try:
        return {"kinds": await tago_train.vehicle_kinds(), "provider": "TAGO"}
    except NoData:
        return {"kinds": [], "provider": "TAGO"}
    except ProviderError as exc:
        raise rs.provider_error(exc) from exc


@router.get("/rail/timetable")
async def timetable(dep: str = Query(min_length=3, max_length=40), arr: str = Query(min_length=3, max_length=40),
                    day: date = Query(alias="date"), grade: str | None = None, train_type: str | None = None,
                    from_hour: int | None = Query(default=None, ge=0, le=23),
                    to_hour: int | None = Query(default=None, ge=0, le=23),
                    member: TripMember = Depends(current_member)):
    if dep == arr:
        raise AppError(422, "SAME_STATION", "출발역과 도착역이 같아요.")
    return await rs.timetable(dep, arr, day, grade, from_hour, to_hour, train_type)


@router.get("/rail/transfer-candidates")
async def transfer(dep: str, via: str, arr: str, day: date = Query(alias="date"),
                   min_transfer: int = Query(default=15, ge=3, le=120), member: TripMember = Depends(current_member)):
    return await rs.transfer_candidates(dep, via, arr, day, min_transfer)


@router.get("/rail/station-locations")
def station_locations(name: str = Query(min_length=1, max_length=40), member: TripMember = Depends(current_member)):
    """OSM railway stations whose name contains the query — position candidates for the user to confirm.
    This links a map position to a reservation; it does not equate OSM and TAGO station IDs."""
    q = name.replace("역", "").strip()
    reg = eng.registry()
    out, seen = [], set()
    for z in reg.zones.values():
        for f in reg.stops_geojson(z.zone_id)["features"]:
            p = f["properties"]
            if p["kind"] != "RAIL" or not p.get("name") or q not in p["name"] or p["osm_id"] in seen:
                continue
            seen.add(p["osm_id"])
            lon, lat = f["geometry"]["coordinates"]
            out.append({"name": p["name"], "lat": lat, "lon": lon, "osm_id": p["osm_id"], "zone": z.zone_id})
    return {"candidates": out, "source": "OSM", "note": "지도 위치 후보예요. 맞는 역인지 확인한 뒤 선택해 주세요."}


class ReservationIn(BaseModel):
    train_number: str | None = Field(default=None, max_length=20)
    train_type: str | None = Field(default=None, max_length=40)
    origin_station_id: str | None = None
    origin_station_name: str = Field(min_length=1, max_length=80)
    destination_station_id: str | None = None
    destination_station_name: str = Field(min_length=1, max_length=80)
    travel_date: date | None = None
    scheduled_departure: datetime | None = None
    scheduled_arrival: datetime | None = None
    from_timetable: bool = False  # picked from a TAGO timetable result shown in the app
    schedule_checked_at: datetime | None = None
    reservation_status: str = "PLANNED"
    user_notes: str | None = Field(default=None, max_length=1000)
    origin_lat: float | None = None
    origin_lon: float | None = None
    destination_lat: float | None = None
    destination_lon: float | None = None
    add_to_itinerary: bool = True


class ReservationPatch(BaseModel):
    version: int
    reservation_status: str | None = None
    user_notes: str | None = Field(default=None, max_length=1000)
    origin_lat: float | None = None
    origin_lon: float | None = None
    destination_lat: float | None = None
    destination_lon: float | None = None


def res_out(r: RailReservation) -> dict:
    return {k: getattr(r, k) for k in (
        "id", "train_number", "train_type", "origin_station_id", "origin_station_name", "destination_station_id",
        "destination_station_name", "travel_date", "scheduled_departure", "scheduled_arrival", "schedule_source",
        "schedule_checked_at", "reservation_status", "user_notes", "origin_lat", "origin_lon", "destination_lat",
        "destination_lon", "version")} | {
        "status_label": {"PLANNED": "예매 전", "RESERVED": "예매 완료(사용자 표시)", "CANCELLED": "취소"}.get(r.reservation_status)}


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=KST) if dt is not None and dt.tzinfo is None else dt


@router.post("/trips/{trip_id}/rail-reservations", status_code=201)
def add_reservation(trip_id: str, body: ReservationIn, member: TripMember = Depends(current_member),
                    db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    if body.reservation_status not in ("PLANNED", "RESERVED", "CANCELLED"):
        raise AppError(422, "INVALID_STATUS", "예약 상태가 올바르지 않아요.")
    dep, arr = _aware(body.scheduled_departure), _aware(body.scheduled_arrival)
    if dep and arr and arr <= dep:
        raise AppError(422, "INVALID_TIMES", "도착 시각이 출발 시각보다 빨라요.")
    travel_date = body.travel_date or (dep.astimezone(KST).date() if dep else None)
    r = RailReservation(
        trip_id=trip.id, train_number=body.train_number, train_type=body.train_type,
        origin_station_id=body.origin_station_id, origin_station_name=body.origin_station_name,
        destination_station_id=body.destination_station_id, destination_station_name=body.destination_station_name,
        travel_date=travel_date, scheduled_departure=dep, scheduled_arrival=arr,
        schedule_source="TAGO_TIMETABLE" if body.from_timetable and dep else "USER_ENTERED",
        schedule_checked_at=body.schedule_checked_at if body.from_timetable else None,
        reservation_status=body.reservation_status, user_notes=body.user_notes, created_by=member.id,
        origin_lat=body.origin_lat, origin_lon=body.origin_lon,
        destination_lat=body.destination_lat, destination_lon=body.destination_lon,
        station_coordinate_source="OSM" if body.origin_lat is not None else None)
    db.add(r)
    db.flush()
    if body.add_to_itinerary:
        rs.link_reservation_to_day(db, trip, r, rs.day_for_date(db, trip, travel_date))
    log_activity(db, member, "RAIL_ADDED", f"{member.nickname}님이 {r.origin_station_name}→{r.destination_station_name} 열차를 추가했어요")
    db.commit()
    return res_out(r)


@router.get("/trips/{trip_id}/rail-reservations")
def list_reservations(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    get_trip(db, member, trip_id)
    rows = db.scalars(select(RailReservation).where(RailReservation.trip_id == trip_id)
                      .order_by(RailReservation.scheduled_departure.asc().nulls_last())).all()
    return [res_out(r) for r in rows]


@router.patch("/rail-reservations/{res_id}")
def patch_reservation(res_id: str, body: ReservationPatch, member: TripMember = Depends(current_member),
                      db: Session = Depends(get_db)):
    r = db.get(RailReservation, res_id)
    if r is None or r.trip_id != member.trip_id:
        raise AppError(404, "RESERVATION_NOT_FOUND", "열차 기록을 찾을 수 없어요.")
    if body.version != r.version:
        raise AppError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했어요.", {"current": res_out(r)})
    if body.reservation_status:
        if body.reservation_status not in ("PLANNED", "RESERVED", "CANCELLED"):
            raise AppError(422, "INVALID_STATUS", "예약 상태가 올바르지 않아요.")
        r.reservation_status = body.reservation_status
    if body.user_notes is not None:
        r.user_notes = body.user_notes
    for k in ("origin_lat", "origin_lon", "destination_lat", "destination_lon"):
        if getattr(body, k) is not None:
            setattr(r, k, getattr(body, k))
            r.station_coordinate_source = "OSM"
    r.version += 1
    log_activity(db, member, "RAIL_UPDATED", f"{member.nickname}님이 {r.origin_station_name}→{r.destination_station_name} 열차 정보를 바꿨어요")
    db.commit()
    return res_out(r)


@router.delete("/rail-reservations/{res_id}")
def delete_reservation(res_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    r = db.get(RailReservation, res_id)
    if r is None or r.trip_id != member.trip_id:
        raise AppError(404, "RESERVATION_NOT_FOUND", "열차 기록을 찾을 수 없어요.")
    for it in db.scalars(select(ItineraryItem).where(ItineraryItem.rail_reservation_id == r.id)).all():
        db.delete(it)
    db.delete(r)
    log_activity(db, member, "RAIL_DELETED", f"{member.nickname}님이 열차 기록을 삭제했어요")
    db.commit()
    return {"ok": True}


@router.get("/trips/{trip_id}/rail-pass")
def rail_pass(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    return rs.pass_check(db, get_trip(db, member, trip_id))
