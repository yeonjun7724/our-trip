from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import AppError
from ..models import ItineraryItem, Place, PlaceVote, Trip, TripMember
from ..routing.osmnx_engine import haversine
from ..security.auth import current_member
from ..services import link_parser
from ..services.external_links import place_links
from ..services.itinerary_service import priority
from .common import CATEGORIES, CITIES, CITY_LABELS, conflict, get_trip, log_activity

router = APIRouter(prefix="/api", tags=["places"])
COORD_SOURCES = {"USER_PICKED", "OSM_NOMINATIM"}
PREFS = {"MUST", "GOOD", "MAYBE", "SKIP"}


class PlaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    city: str
    category: str = "ATTRACTION"
    latitude: float | None = Field(default=None, ge=33, le=39)   # South Korea bounds
    longitude: float | None = Field(default=None, ge=124, le=132)
    coordinate_source: str | None = None
    osm_ref: str | None = None
    share_url: str | None = Field(default=None, max_length=1000)
    provider: str | None = None
    provider_place_id: str | None = Field(default=None, max_length=40)
    memo: str | None = Field(default=None, max_length=2000)
    stay_minutes: int = Field(default=60, ge=0, le=720)
    preference: str | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.city not in CITIES:
            raise ValueError("invalid city")
        if self.category not in CATEGORIES:
            raise ValueError("invalid category")
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be given together")
        if self.latitude is not None and self.coordinate_source not in COORD_SOURCES:
            raise ValueError("coordinate_source must be USER_PICKED or OSM_NOMINATIM")
        return self


class PlacePatch(BaseModel):
    version: int
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = None
    category: str | None = None
    latitude: float | None = Field(default=None, ge=33, le=39)
    longitude: float | None = Field(default=None, ge=124, le=132)
    coordinate_source: str | None = None
    osm_ref: str | None = None
    clear_location: bool = False
    memo: str | None = Field(default=None, max_length=2000)
    stay_minutes: int | None = Field(default=None, ge=0, le=720)


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "").lower()


def place_out(p: Place, trip: Trip, me: TripMember, assigned: dict[str, int] | None = None) -> dict:
    members = sorted(trip.members, key=lambda m: m.created_at)
    names = {m.id: m.nickname for m in members}
    pr = priority(p.votes, [m.id for m in members])
    return {
        "id": p.id, "name": p.name, "city": p.city, "city_label": CITY_LABELS.get(p.city), "category": p.category,
        "latitude": p.latitude, "longitude": p.longitude, "coordinate_source": p.coordinate_source,
        "has_location": p.latitude is not None, "osm_ref": p.osm_ref, "share_url": p.original_share_url,
        "provider": p.provider, "provider_place_id": p.provider_place_id, "memo": p.memo, "stay_minutes": p.stay_minutes,
        "created_by": names.get(p.created_by) if p.created_by else ("초기 후보" if p.provider == "SEED" else None),
        "created_by_me": p.created_by == me.id, "created_by_id": p.created_by,
        "updated_by": names.get(p.updated_by), "created_at": p.created_at, "updated_at": p.updated_at,
        "version": p.version,
        "votes": [{"member_id": m.id, "nickname": m.nickname, "preference": pr["votes"].get(m.id), "is_me": m.id == me.id}
                  for m in members],
        "my_vote": pr["votes"].get(me.id), "priority_score": pr["score"], "both_want": pr["both_want"],
        "excluded": pr["excluded"], "planned_day": (assigned or {}).get(p.id),
        "external_links": [l.model_dump() for l in place_links(p.name, p.latitude, p.longitude)],
    }


def _assigned(db: Session, trip: Trip) -> dict[str, int]:
    out = {}
    for d in trip.days:
        for it in d.items:
            if it.place_id:
                out.setdefault(it.place_id, d.day_number)
    return out


def _duplicates(db: Session, trip_id: str, name: str, lat, lon, exclude: str | None = None) -> list[dict]:
    rows = db.scalars(select(Place).where(Place.trip_id == trip_id)).all()
    out = []
    for r in rows:
        if r.id == exclude:
            continue
        same_name = _norm(r.name) == _norm(name) or (_norm(name) and (_norm(name) in _norm(r.name) or _norm(r.name) in _norm(name)))
        near = (lat is not None and r.latitude is not None and float(haversine(lat, lon, r.latitude, r.longitude)) < 60)
        if same_name or near:
            out.append({"id": r.id, "name": r.name, "city": r.city, "reason": "이름이 비슷해요" if same_name else "60m 이내 위치예요"})
    return out


@router.get("/trips/{trip_id}/places")
def list_places(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    rows = db.scalars(select(Place).where(Place.trip_id == trip_id).order_by(Place.created_at)).all()
    assigned = _assigned(db, trip)
    return [place_out(p, trip, member, assigned) for p in rows]


@router.post("/trips/{trip_id}/places", status_code=201)
def create_place(trip_id: str, body: PlaceIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    provider = "MANUAL"
    if body.share_url:
        m = link_parser.URL_RE.search(body.share_url)
        host = m.group(0).split("/")[2].lower() if m else ""
        provider = link_parser.provider_of(host) or "MANUAL"
    dups = _duplicates(db, trip_id, body.name, body.latitude, body.longitude)
    p = Place(trip_id=trip.id, name=body.name.strip(), city=body.city, category=body.category,
              latitude=body.latitude, longitude=body.longitude,
              coordinate_source=body.coordinate_source if body.latitude is not None else "NONE",
              osm_ref=body.osm_ref if body.coordinate_source == "OSM_NOMINATIM" else None,
              original_share_url=body.share_url, provider=provider,
              # Kakao/Naver place IDs are kept only as a link-back to the user's own bookmark.
              provider_place_id=body.provider_place_id if provider in ("NAVER", "KAKAO") else None,
              memo=body.memo, stay_minutes=body.stay_minutes, created_by=member.id, updated_by=member.id)
    db.add(p)
    db.flush()
    if body.preference in PREFS:
        db.add(PlaceVote(place_id=p.id, member_id=member.id, preference=body.preference))
    log_activity(db, member, "PLACE_ADDED", f"{member.nickname}님이 '{p.name}'을(를) 추가했어요")
    db.commit()
    db.refresh(p)
    return {"place": place_out(p, trip, member), "possible_duplicates": dups}


@router.patch("/places/{place_id}")
def patch_place(place_id: str, body: PlacePatch, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None or p.trip_id != member.trip_id:
        raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
    trip = db.get(Trip, p.trip_id)
    if body.version != p.version:
        raise conflict(place_out(p, trip, member))
    if body.city is not None and body.city not in CITIES:
        raise AppError(422, "INVALID_CITY", "도시가 올바르지 않아요.")
    if body.category is not None and body.category not in CATEGORIES:
        raise AppError(422, "INVALID_CATEGORY", "분류가 올바르지 않아요.")
    for k in ("name", "city", "category", "memo", "stay_minutes"):
        v = getattr(body, k)
        if v is not None:
            setattr(p, k, v.strip() if isinstance(v, str) and k == "name" else v)
    if body.clear_location:
        p.latitude = p.longitude = None
        p.coordinate_source, p.osm_ref = "NONE", None
    elif body.latitude is not None or body.longitude is not None:
        if body.latitude is None or body.longitude is None or body.coordinate_source not in COORD_SOURCES:
            raise AppError(422, "INVALID_LOCATION", "위치는 위도·경도와 출처(지도 선택/OSM 검색)를 함께 보내야 해요.")
        p.latitude, p.longitude, p.coordinate_source = body.latitude, body.longitude, body.coordinate_source
        p.osm_ref = body.osm_ref if body.coordinate_source == "OSM_NOMINATIM" else None
    p.version += 1
    p.updated_by = member.id
    log_activity(db, member, "PLACE_UPDATED", f"{member.nickname}님이 '{p.name}'을(를) 수정했어요")
    db.commit()
    db.refresh(p)
    return place_out(p, trip, member, _assigned(db, trip))


@router.delete("/places/{place_id}")
def delete_place(place_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None or p.trip_id != member.trip_id:
        raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
    for it in db.scalars(select(ItineraryItem).where(ItineraryItem.place_id == p.id)).all():
        db.delete(it)
    name = p.name
    db.delete(p)
    log_activity(db, member, "PLACE_DELETED", f"{member.nickname}님이 '{name}'을(를) 삭제했어요")
    db.commit()
    return {"ok": True}


class VoteIn(BaseModel):
    preference: str | None  # None clears


@router.post("/places/{place_id}/votes")
def vote(place_id: str, body: VoteIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None or p.trip_id != member.trip_id:
        raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
    if body.preference is not None and body.preference not in PREFS:
        raise AppError(422, "INVALID_PREFERENCE", "선호도 값이 올바르지 않아요.")
    v = db.scalar(select(PlaceVote).where(PlaceVote.place_id == p.id, PlaceVote.member_id == member.id))
    if body.preference is None:
        if v:
            db.delete(v)
    elif v:
        v.preference = body.preference
    else:
        db.add(PlaceVote(place_id=p.id, member_id=member.id, preference=body.preference))
    labels = {"MUST": "꼭 가고 싶어", "GOOD": "가면 좋아", "MAYBE": "고민 중", "SKIP": "이번에는 제외"}
    log_activity(db, member, "VOTED", f"{member.nickname}님: '{p.name}' {labels.get(body.preference, '선택 해제')}")
    db.commit()
    db.refresh(p)
    trip = db.get(Trip, p.trip_id)
    return place_out(p, trip, member, _assigned(db, trip))


class LinkIn(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


@router.post("/links/validate")
async def validate_link(body: LinkIn, member: TripMember = Depends(current_member)):
    return await link_parser.analyze(body.text)
