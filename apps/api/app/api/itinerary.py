from __future__ import annotations

from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..errors import AppError
from ..models import ItineraryItem, Place, RailReservation, TransportLeg, Trip, TripDay, TripMember
from ..security.auth import current_member
from ..services import itinerary_service as svc
from .common import CITY_LABELS, conflict, get_trip, log_activity
from .places import place_out

router = APIRouter(prefix="/api", tags=["itinerary"])


def _legs(db: Session, trip_id: str) -> dict:
    out = {}
    for l in db.scalars(select(TransportLeg).where(TransportLeg.trip_id == trip_id)).all():
        if l.to_item_id:
            out[(l.from_item_id, l.to_item_id)] = l
    return out


def _day(db: Session, trip: Trip, day_id: str) -> TripDay:
    d = db.get(TripDay, day_id)
    if d is None or d.trip_id != trip.id:
        raise AppError(404, "DAY_NOT_FOUND", "날짜를 찾을 수 없어요.")
    return d


def itinerary_payload(db: Session, trip: Trip, member: TripMember, compute_walks: bool = True) -> dict:
    db.expire_all()  # sessions keep objects after commit; reload relationships for a fresh view
    trip = db.get(Trip, trip.id)
    legs = _legs(db, trip.id)
    days = []
    assigned: set[str] = set()
    for d in trip.days:
        lodging = db.get(Place, d.lodging_place_id) if d.lodging_place_id else None
        tl = svc.build_timeline(trip, d, legs, lodging, compute_walks)
        assigned |= {i.place_id for i in d.items if i.place_id}
        days.append({"id": d.id, "day_number": d.day_number, "travel_date": d.travel_date,
                     "primary_city": d.primary_city, "primary_city_label": CITY_LABELS.get(d.primary_city),
                     "start_time": d.start_time.strftime("%H:%M"), "version": d.version,
                     "lodging": {"id": lodging.id, "name": lodging.name, "has_location": lodging.latitude is not None}
                     if lodging else None, **tl})
    places = db.scalars(select(Place).where(Place.trip_id == trip.id)).all()
    unassigned = [place_out(p, trip, member) for p in places if p.id not in assigned and p.category != "LODGING"]
    return {"trip_id": trip.id, "buffer_minutes": trip.station_buffer_minutes, "walking_speed_kmh": trip.walking_speed_kmh,
            "days": days, "unassigned": unassigned,
            "notes": ["도보 시간은 OSMnx 보행 네트워크로 계산한 추정치예요.",
                      "대중교통 구간은 사용자가 조회해 저장한 경로의 소요시간만 반영해요."]}


@router.get("/trips/{trip_id}/itinerary")
async def get_itinerary(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    return await run_in_threadpool(itinerary_payload, db, trip, member)


class OrderEntry(BaseModel):
    item_id: str | None = None
    place_id: str | None = None


class ItineraryWrite(BaseModel):
    day_id: str
    base_version: int
    items: list[OrderEntry]


@router.post("/trips/{trip_id}/itinerary")
async def write_itinerary(trip_id: str, body: ItineraryWrite, member: TripMember = Depends(current_member),
                          db: Session = Depends(get_db)):
    """Set the full ordered list for one day (used for reorder, add, and applying an approved proposal)."""
    trip = get_trip(db, member, trip_id)
    day = _day(db, trip, body.day_id)
    if body.base_version != day.version:
        raise conflict({"day_id": day.id, "version": day.version})
    existing = {i.id: i for i in day.items}
    seen: set[str] = set()
    new_items: list[ItineraryItem] = []
    for idx, e in enumerate(body.items):
        if e.item_id:
            it = existing.get(e.item_id) or db.get(ItineraryItem, e.item_id)
            if it is None:
                raise AppError(404, "ITEM_NOT_FOUND", "일정 항목을 찾을 수 없어요.")
            src_day = db.get(TripDay, it.trip_day_id)
            if src_day.trip_id != trip.id:
                raise AppError(404, "ITEM_NOT_FOUND", "일정 항목을 찾을 수 없어요.")
            if it.trip_day_id != day.id:  # moved from another day
                src_day.version += 1
                it.trip_day_id = day.id
        elif e.place_id:
            p = db.get(Place, e.place_id)
            if p is None or p.trip_id != trip.id:
                raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
            it = ItineraryItem(trip_day_id=day.id, kind="PLACE", place_id=p.id, updated_by=member.id)
            db.add(it)
        else:
            raise AppError(422, "INVALID_ENTRY", "item_id 또는 place_id가 필요해요.")
        if it.id and it.id in seen:
            raise AppError(422, "DUPLICATE_ENTRY", "같은 항목이 두 번 들어 있어요.")
        it.sort_order = idx
        db.flush()
        seen.add(it.id)
        new_items.append(it)
    for iid, it in existing.items():
        if iid not in seen:
            if it.kind == "RAIL":
                raise AppError(422, "RAIL_ITEM_REQUIRED", "열차 일정은 여기서 뺄 수 없어요. 철도 예약에서 날짜를 바꾸거나 삭제해 주세요.")
            db.delete(it)
    day.version += 1
    log_activity(db, member, "ITINERARY_UPDATED", f"{member.nickname}님이 DAY {day.day_number} 일정을 바꿨어요")
    db.commit()
    db.refresh(trip)
    return await run_in_threadpool(itinerary_payload, db, trip, member)


class ItemPatch(BaseModel):
    version: int
    visit_status: str | None = None
    stay_minutes: int | None = Field(default=None, ge=0, le=720)
    planned_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    clear_planned_start: bool = False
    is_fixed: bool | None = None


@router.patch("/itinerary-items/{item_id}")
def patch_item(item_id: str, body: ItemPatch, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    it = db.get(ItineraryItem, item_id)
    day = db.get(TripDay, it.trip_day_id) if it else None
    if it is None or day.trip_id != member.trip_id:
        raise AppError(404, "ITEM_NOT_FOUND", "일정 항목을 찾을 수 없어요.")
    if body.version != it.version:
        raise conflict({"item_id": it.id, "version": it.version, "visit_status": it.visit_status})
    if body.visit_status is not None:
        if body.visit_status not in ("PLANNED", "VISITED", "SKIPPED"):
            raise AppError(422, "INVALID_STATUS", "방문 상태가 올바르지 않아요.")
        it.visit_status = body.visit_status
    if body.stay_minutes is not None:
        it.stay_minutes = body.stay_minutes
    if body.planned_start:
        h, m = map(int, body.planned_start.split(":"))
        it.planned_start = time(h % 24, m % 60)
    if body.clear_planned_start:
        it.planned_start = None
    if body.is_fixed is not None and it.kind == "PLACE":
        it.is_fixed = body.is_fixed
    it.version += 1
    it.updated_by = member.id
    name = it.place.name if it.place else "열차"
    if body.visit_status == "VISITED":
        log_activity(db, member, "VISITED", f"{member.nickname}님이 '{name}' 방문 완료를 체크했어요")
    else:
        log_activity(db, member, "ITEM_UPDATED", f"{member.nickname}님이 '{name}' 일정을 수정했어요")
    db.commit()
    return {"id": it.id, "version": it.version, "visit_status": it.visit_status}


class LegIn(BaseModel):
    from_item_id: str | None = None
    to_item_id: str
    mode: str
    duration_minutes: int | None = Field(default=None, ge=0, le=1440)
    transfer_count: int | None = Field(default=None, ge=0, le=10)
    summary: str | None = Field(default=None, max_length=300)
    source: str = "USER"  # ODSAY | OSMNX | USER
    checked_at: datetime | None = None


@router.post("/trips/{trip_id}/legs", status_code=201)
def save_leg(trip_id: str, body: LegIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    """Save the user's chosen leg (summary only — no provider payload/geometry is stored)."""
    trip = get_trip(db, member, trip_id)
    if body.mode not in ("WALK", "BUS", "SUBWAY", "TRAIN", "TRANSIT", "TAXI_EXTERNAL", "UNKNOWN"):
        raise AppError(422, "INVALID_MODE", "이동수단이 올바르지 않아요.")
    to = db.get(ItineraryItem, body.to_item_id)
    if to is None or db.get(TripDay, to.trip_day_id).trip_id != trip.id:
        raise AppError(404, "ITEM_NOT_FOUND", "일정 항목을 찾을 수 없어요.")
    existing = db.scalar(select(TransportLeg).where(TransportLeg.trip_id == trip.id,
                                                    TransportLeg.from_item_id == body.from_item_id,
                                                    TransportLeg.to_item_id == body.to_item_id))
    leg = existing or TransportLeg(trip_id=trip.id, trip_day_id=to.trip_day_id, from_item_id=body.from_item_id,
                                   to_item_id=body.to_item_id)
    leg.mode = body.mode
    leg.duration_minutes = body.duration_minutes
    leg.transfer_count = body.transfer_count
    leg.summary = body.summary
    leg.schedule_source = body.source
    leg.checked_at = body.checked_at or datetime.now(timezone.utc)
    leg.verification_status = {"ODSAY": "ESTIMATED", "OSMNX": "ESTIMATED"}.get(body.source, "USER_ENTERED")
    if not existing:
        db.add(leg)
    log_activity(db, member, "LEG_SAVED", f"{member.nickname}님이 이동 방법을 저장했어요")
    db.commit()
    return {"id": leg.id}


@router.delete("/legs/{leg_id}")
def delete_leg(leg_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    leg = db.get(TransportLeg, leg_id)
    if leg is None or leg.trip_id != member.trip_id:
        raise AppError(404, "LEG_NOT_FOUND", "이동 구간을 찾을 수 없어요.")
    db.delete(leg)
    db.commit()
    return {"ok": True}


class OptimizeIn(BaseModel):
    day_id: str | None = None


@router.post("/trips/{trip_id}/optimize")
async def optimize(trip_id: str, body: OptimizeIn, member: TripMember = Depends(current_member),
                   db: Session = Depends(get_db)):
    """Returns proposals only. The user applies one via POST /itinerary (explicit approval)."""
    trip = get_trip(db, member, trip_id)
    members = [m.id for m in sorted(trip.members, key=lambda m: m.created_at)]
    if body.day_id:
        day = _day(db, trip, body.day_id)
        lodging = db.get(Place, day.lodging_place_id) if day.lodging_place_id else None
        return {"kind": "ORDER", **(await run_in_threadpool(svc.optimise_day, trip, day, lodging))}
    places = db.scalars(select(Place).where(Place.trip_id == trip.id)).all()
    assigned = {i.place_id for d in trip.days for i in d.items if i.place_id}
    return {"kind": "DAY_ASSIGNMENT", "suggestions": svc.suggest_days(trip, places, assigned, members),
            "note": "추천은 참고용이에요. 승인한 항목만 일정에 들어가요."}


class CheckIn(BaseModel):
    trip_id: str
    day_id: str | None = None


@router.post("/itinerary/check-connections")
async def check_connections(body: CheckIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, body.trip_id)
    payload = await run_in_threadpool(itinerary_payload, db, trip, member)
    out = []
    for d in payload["days"]:
        if body.day_id and d["id"] != body.day_id:
            continue
        for e in d["entries"]:
            if e["kind"] == "RAIL":
                out.append({"day_number": d["day_number"], **{k: e[k] for k in (
                    "item_id", "name", "origin", "destination", "arrival_at_station", "departure", "slack_minutes",
                    "buffer_minutes", "connection", "connection_label", "connection_note", "schedule_source",
                    "reservation_status")}})
    return {"connections": out, "buffer_minutes": trip.station_buffer_minutes,
            "buffer_note": "여유시간은 공식 탑승 규정이 아니라 사용자가 정한 계획 버퍼예요.",
            "labels": svc.CONNECTION_LABELS}
