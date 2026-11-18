from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import AppError
from ..models import ActivityLog, Place, Trip, TripDay, TripInvite, TripMember
from ..security.auth import (aware, current_member, end_session, hash_token, new_token, optional_member,
                             start_session, utcnow)
from .common import CITIES, CITY_LABELS, conflict, get_trip, log_activity

router = APIRouter(prefix="/api", tags=["trips"])
PASS_TYPES = {"SELECT_3", "CONTINUOUS_7", "UNDECIDED"}


class TripCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    nickname: str = Field(min_length=1, max_length=40)
    start_date: date | None = None
    end_date: date | None = None
    departure_station_id: str | None = None
    departure_station_name: str | None = None
    return_station_id: str | None = None
    return_station_name: str | None = None
    rail_pass_type: str = "UNDECIDED"
    day_cities: list[str] = ["busan", "gyeongju", "pohang", "pohang"]
    seed_candidates: bool = True

    @field_validator("rail_pass_type")
    @classmethod
    def _pass(cls, v):
        if v not in PASS_TYPES:
            raise ValueError("invalid pass type")
        return v

    @field_validator("day_cities")
    @classmethod
    def _cities(cls, v):
        if not v or len(v) > 14 or any(c not in CITIES for c in v):
            raise ValueError("invalid day cities")
        return v


class TripPatch(BaseModel):
    version: int
    title: str | None = Field(default=None, max_length=120)
    start_date: date | None = None
    end_date: date | None = None
    departure_station_id: str | None = None
    departure_station_name: str | None = None
    return_station_id: str | None = None
    return_station_name: str | None = None
    rail_pass_type: str | None = None
    station_buffer_minutes: int | None = Field(default=None, ge=0, le=180)
    walking_speed_kmh: float | None = Field(default=None, ge=2.0, le=7.0)
    clear_dates: bool = False


def trip_out(db: Session, trip: Trip, me: TripMember | None = None) -> dict:
    return {
        "id": trip.id, "title": trip.title, "start_date": trip.start_date, "end_date": trip.end_date,
        "timezone": trip.timezone, "departure_station_id": trip.departure_station_id,
        "departure_station_name": trip.departure_station_name, "return_station_id": trip.return_station_id,
        "return_station_name": trip.return_station_name, "rail_pass_type": trip.rail_pass_type,
        "station_buffer_minutes": trip.station_buffer_minutes, "walking_speed_kmh": trip.walking_speed_kmh,
        "version": trip.version, "updated_at": trip.updated_at,
        "members": [{"id": m.id, "nickname": m.nickname, "role": m.role, "is_me": me is not None and m.id == me.id}
                    for m in sorted(trip.members, key=lambda m: m.created_at)],
        "days": [{"id": d.id, "day_number": d.day_number, "travel_date": d.travel_date, "primary_city": d.primary_city,
                  "primary_city_label": CITY_LABELS.get(d.primary_city), "start_time": d.start_time.strftime("%H:%M"),
                  "lodging_place_id": d.lodging_place_id, "version": d.version} for d in trip.days],
    }


def _seed_places(db: Session, trip: Trip, owner: TripMember | None) -> int:
    path = get_settings().seed_dir / "candidates.json"
    if not path.exists():
        return 0
    n = 0
    for c in json.loads(path.read_text("utf-8")):
        has = c.get("latitude") is not None
        db.add(Place(trip_id=trip.id, name=c["name"], city=c["city"], category=c.get("category", "ATTRACTION"),
                     latitude=c.get("latitude"), longitude=c.get("longitude"),
                     coordinate_source=c.get("coordinate_source") or "NONE" if has else "NONE",
                     osm_ref=c.get("osm_ref"), provider="SEED", created_by=None,
                     memo="초기 추천 후보 (확정 일정 아님)" + ("" if has else " · 위치 미확정 — 지도에서 직접 지정해 주세요")))
        n += 1
    return n


def _sync_days(trip: Trip) -> None:
    for d in trip.days:
        d.travel_date = trip.start_date + timedelta(days=d.day_number - 1) if trip.start_date else None


@router.post("/trips", status_code=201)
def create_trip(body: TripCreate, response: Response, db: Session = Depends(get_db)):
    if body.start_date and body.end_date and body.end_date < body.start_date:
        raise AppError(422, "INVALID_DATES", "종료일이 시작일보다 빨라요.")
    cities = list(body.day_cities)
    if body.start_date and body.end_date:
        n = (body.end_date - body.start_date).days + 1
        if n > 14:
            raise AppError(422, "TRIP_TOO_LONG", "여행 기간은 14일 이하로 설정해 주세요.")
        cities = (cities + [cities[-1]] * n)[:n]
    recovery = new_token()
    trip = Trip(title=body.title.strip(), start_date=body.start_date, end_date=body.end_date,
                departure_station_id=body.departure_station_id, departure_station_name=body.departure_station_name,
                return_station_id=body.return_station_id, return_station_name=body.return_station_name,
                rail_pass_type=body.rail_pass_type, cities=sorted(set(cities)), recovery_key_hash=hash_token(recovery))
    db.add(trip)
    db.flush()
    owner = TripMember(trip_id=trip.id, nickname=body.nickname.strip(), role="OWNER")
    db.add(owner)
    for i, c in enumerate(cities, start=1):
        db.add(TripDay(trip_id=trip.id, day_number=i, primary_city=c))
    db.flush()
    db.refresh(trip)
    _sync_days(trip)
    seeded = _seed_places(db, trip, owner) if body.seed_candidates else 0
    log_activity(db, owner, "TRIP_CREATED", f"{owner.nickname}님이 여행방을 만들었어요")
    start_session(db, response, owner)
    db.commit()
    db.refresh(trip)
    return {"trip": trip_out(db, trip, owner), "recovery_key": recovery, "seeded_places": seeded,
            "recovery_notice": "복구 키는 지금 한 번만 보여요. 기기를 바꾸거나 쿠키가 지워졌을 때 여행방 주인으로 다시 들어올 수 있어요."}


@router.get("/me")
def me(member: TripMember | None = Depends(optional_member), db: Session = Depends(get_db)):
    if member is None:
        return {"authenticated": False}
    return {"authenticated": True, "member": {"id": member.id, "nickname": member.nickname, "role": member.role},
            "trip_id": member.trip_id}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    end_session(db, request, response)
    db.commit()
    return {"ok": True}


@router.get("/trips/{trip_id}")
def read_trip(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    return trip_out(db, get_trip(db, member, trip_id), member)


@router.patch("/trips/{trip_id}")
def patch_trip(trip_id: str, body: TripPatch, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    if body.version != trip.version:
        raise conflict(trip_out(db, trip, member))
    data = body.model_dump(exclude_unset=True, exclude={"version", "clear_dates"})
    if body.rail_pass_type is not None and body.rail_pass_type not in PASS_TYPES:
        raise AppError(422, "INVALID_PASS", "내일로 패스 종류가 올바르지 않아요.")
    for k, v in data.items():
        if k in ("start_date", "end_date") or v is not None:
            setattr(trip, k, v)
    if body.clear_dates:
        trip.start_date = trip.end_date = None
    if trip.start_date and trip.end_date:
        if trip.end_date < trip.start_date:
            raise AppError(422, "INVALID_DATES", "종료일이 시작일보다 빨라요.")
        n = (trip.end_date - trip.start_date).days + 1
        if n > 14:
            raise AppError(422, "TRIP_TOO_LONG", "여행 기간은 14일 이하로 설정해 주세요.")
        days = list(trip.days)
        if n > len(days):
            for i in range(len(days) + 1, n + 1):
                trip.days.append(TripDay(trip_id=trip.id, day_number=i, primary_city=days[-1].primary_city if days else "busan"))
        elif n < len(days):
            extra = [d for d in days if d.day_number > n]
            if any(d.items for d in extra):
                raise AppError(409, "DAYS_HAVE_ITEMS", "줄어드는 날짜에 일정이 있어요. 먼저 일정을 옮긴 뒤 기간을 줄여 주세요.")
            for d in extra:
                trip.days.remove(d)
                db.delete(d)
    db.flush()
    _sync_days(trip)
    trip.version += 1
    log_activity(db, member, "TRIP_UPDATED", f"{member.nickname}님이 여행 정보를 수정했어요")
    db.commit()
    db.refresh(trip)
    return trip_out(db, trip, member)


class DayPatch(BaseModel):
    version: int
    start_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    primary_city: str | None = None
    lodging_place_id: str | None = None
    clear_lodging: bool = False


@router.patch("/trips/{trip_id}/days/{day_id}")
def patch_day(trip_id: str, day_id: str, body: DayPatch, member: TripMember = Depends(current_member),
              db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    day = db.get(TripDay, day_id)
    if day is None or day.trip_id != trip.id:
        raise AppError(404, "DAY_NOT_FOUND", "날짜를 찾을 수 없어요.")
    if body.version != day.version:
        raise conflict({"day_id": day.id, "version": day.version})
    if body.start_time:
        h, m = map(int, body.start_time.split(":"))
        day.start_time = datetime.min.replace(hour=h % 24, minute=m % 60).time()
    if body.primary_city:
        if body.primary_city not in CITIES:
            raise AppError(422, "INVALID_CITY", "도시가 올바르지 않아요.")
        day.primary_city = body.primary_city
    if body.lodging_place_id:
        p = db.get(Place, body.lodging_place_id)
        if p is None or p.trip_id != trip.id:
            raise AppError(404, "PLACE_NOT_FOUND", "숙소 장소를 찾을 수 없어요.")
        day.lodging_place_id = p.id
    if body.clear_lodging:
        day.lodging_place_id = None
    day.version += 1
    log_activity(db, member, "DAY_UPDATED", f"{member.nickname}님이 DAY {day.day_number} 설정을 바꿨어요")
    db.commit()
    return {"id": day.id, "version": day.version}


# ---------- invites ----------

class InviteJoin(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    nickname: str | None = Field(default=None, max_length=40)
    rejoin_member_id: str | None = None


def _invite_by_token(db: Session, token: str) -> TripInvite:
    inv = db.scalar(select(TripInvite).where(TripInvite.token_hash == hash_token(token)))
    if inv is None or inv.revoked_at:
        raise AppError(404, "INVITE_INVALID", "초대 링크가 올바르지 않거나 취소되었어요.")
    if inv.used_at:
        raise AppError(410, "INVITE_USED", "이미 사용된 초대 링크예요. 새 링크를 받아 주세요.")
    if aware(inv.expires_at) < utcnow():
        raise AppError(410, "INVITE_EXPIRED", "초대 링크가 만료되었어요. 새 링크를 받아 주세요.")
    return inv


@router.post("/trips/{trip_id}/invites", status_code=201)
def create_invite(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    if member.role != "OWNER":
        raise AppError(403, "OWNER_ONLY", "초대 링크는 여행방을 만든 사람만 만들 수 있어요.")
    token = new_token()
    s = get_settings()
    inv = TripInvite(trip_id=trip.id, token_hash=hash_token(token), created_by=member.id,
                     expires_at=utcnow() + timedelta(hours=s.invite_hours))
    db.add(inv)
    log_activity(db, member, "INVITE_CREATED", f"{member.nickname}님이 초대 링크를 만들었어요")
    db.commit()
    return {"invite_id": inv.id, "url": f"{s.public_base_url.rstrip('/')}/join#{token}", "token": token,
            "expires_at": inv.expires_at}


@router.get("/trips/{trip_id}/invites")
def list_invites(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    get_trip(db, member, trip_id)
    rows = db.scalars(select(TripInvite).where(TripInvite.trip_id == trip_id).order_by(TripInvite.created_at.desc())).all()
    now = utcnow()
    return [{"id": i.id, "created_at": i.created_at, "expires_at": i.expires_at,
             "state": "REVOKED" if i.revoked_at else "USED" if i.used_at else "EXPIRED" if aware(i.expires_at) < now else "ACTIVE"}
            for i in rows]


@router.delete("/invites/{invite_id}")
def revoke_invite(invite_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    inv = db.get(TripInvite, invite_id)
    if inv is None or inv.trip_id != member.trip_id:
        raise AppError(404, "INVITE_NOT_FOUND", "초대 링크를 찾을 수 없어요.")
    if member.role != "OWNER":
        raise AppError(403, "OWNER_ONLY", "여행방을 만든 사람만 취소할 수 있어요.")
    inv.revoked_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/invites/preview")
def preview_invite(body: InviteJoin, db: Session = Depends(get_db)):
    inv = _invite_by_token(db, body.token)
    trip = db.get(Trip, inv.trip_id)
    return {"trip_title": trip.title, "members": [{"id": m.id, "nickname": m.nickname, "role": m.role} for m in trip.members]}


@router.post("/invites/join")
def join(body: InviteJoin, response: Response, db: Session = Depends(get_db)):
    inv = _invite_by_token(db, body.token)
    if body.rejoin_member_id:
        member = db.get(TripMember, body.rejoin_member_id)
        if member is None or member.trip_id != inv.trip_id:
            raise AppError(404, "MEMBER_NOT_FOUND", "참여자를 찾을 수 없어요.")
    else:
        if not body.nickname or not body.nickname.strip():
            raise AppError(422, "NICKNAME_REQUIRED", "닉네임을 입력해 주세요.")
        member = TripMember(trip_id=inv.trip_id, nickname=body.nickname.strip(), role="MEMBER")
        db.add(member)
        db.flush()
    inv.used_at = utcnow()
    log_activity(db, member, "MEMBER_JOINED", f"{member.nickname}님이 여행방에 들어왔어요")
    start_session(db, response, member)
    db.commit()
    return {"trip_id": inv.trip_id, "member": {"id": member.id, "nickname": member.nickname, "role": member.role}}


class Recover(BaseModel):
    trip_id: str
    recovery_key: str = Field(min_length=10, max_length=200)


@router.post("/trips/recover")
def recover(body: Recover, response: Response, db: Session = Depends(get_db)):
    trip = db.get(Trip, body.trip_id)
    if trip is None or not trip.recovery_key_hash or trip.recovery_key_hash != hash_token(body.recovery_key):
        raise AppError(404, "RECOVERY_INVALID", "여행방 ID 또는 복구 키가 올바르지 않아요.")
    owner = next((m for m in trip.members if m.role == "OWNER"), None)
    start_session(db, response, owner)
    log_activity(db, owner, "OWNER_RECOVERED", f"{owner.nickname}님이 복구 키로 다시 들어왔어요")
    db.commit()
    return {"trip_id": trip.id}


@router.get("/trips/{trip_id}/activity")
def activity(trip_id: str, limit: int = 30, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    get_trip(db, member, trip_id)
    rows = db.scalars(select(ActivityLog).where(ActivityLog.trip_id == trip_id)
                      .order_by(ActivityLog.id.desc()).limit(min(limit, 100))).all()
    names = {m.id: m.nickname for m in db.get(Trip, trip_id).members}
    return [{"id": r.id, "action": r.action, "summary": r.summary, "member": names.get(r.member_id),
             "is_me": r.member_id == member.id, "created_at": r.created_at} for r in rows]


# ---------- shared trip: no room creation, open the map and pick your name ----------

class BootstrapIn(BaseModel):
    member_id: str | None = None
    nickname: str | None = Field(default=None, max_length=40)
    access_code: str | None = Field(default=None, max_length=200)


def _default_trip(db: Session) -> Trip:
    trip = db.scalar(select(Trip).where(Trip.is_default.is_(True)).order_by(Trip.created_at).limit(1))
    if trip:
        return trip
    trip = Trip(title="부산·경주·포항 내일로", is_default=True, cities=["busan", "gyeongju", "pohang"],
                rail_pass_type="UNDECIDED")
    db.add(trip)
    db.flush()
    for i, c in enumerate(["busan", "gyeongju", "pohang", "pohang"], start=1):
        db.add(TripDay(trip_id=trip.id, day_number=i, primary_city=c))
    db.flush()
    _seed_places(db, trip, None)
    db.commit()
    db.refresh(trip)
    return trip


def _check_code(code: str | None) -> None:
    import hmac as _h
    need = get_settings().access_code
    if need and not _h.compare_digest((code or "").strip(), need):
        raise AppError(403, "ACCESS_CODE_REQUIRED", "입장 코드가 맞지 않아요.")


@router.get("/bootstrap")
def bootstrap_info(db: Session = Depends(get_db)):
    trip = _default_trip(db)
    return {"trip_title": trip.title, "access_code_required": bool(get_settings().access_code),
            "members": [{"id": m.id, "nickname": m.nickname}
                        for m in sorted(trip.members, key=lambda m: m.created_at)]}


@router.post("/bootstrap")
def bootstrap(body: BootstrapIn, response: Response, db: Session = Depends(get_db)):
    _check_code(body.access_code)
    trip = _default_trip(db)
    if body.member_id:
        member = db.get(TripMember, body.member_id)
        if member is None or member.trip_id != trip.id:
            raise AppError(404, "MEMBER_NOT_FOUND", "참여자를 찾을 수 없어요.")
    else:
        name = (body.nickname or "").strip()
        if not name:
            raise AppError(422, "NICKNAME_REQUIRED", "이름을 입력해 주세요.")
        member = TripMember(trip_id=trip.id, nickname=name, role="OWNER" if not trip.members else "MEMBER")
        db.add(member)
        db.flush()
        log_activity(db, member, "MEMBER_JOINED", f"{member.nickname}님이 들어왔어요")
    start_session(db, response, member)
    db.commit()
    return {"trip_id": trip.id, "member": {"id": member.id, "nickname": member.nickname}}
