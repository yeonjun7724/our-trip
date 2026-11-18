from __future__ import annotations

from sqlalchemy.orm import Session

from ..errors import AppError
from ..models import ActivityLog, Trip, TripMember


def log_activity(db: Session, member: TripMember, action: str, summary: str) -> None:
    db.add(ActivityLog(trip_id=member.trip_id, member_id=member.id, action=action, summary=summary[:200]))


def get_trip(db: Session, member: TripMember, trip_id: str) -> Trip:
    if member.trip_id != trip_id:
        raise AppError(404, "TRIP_NOT_FOUND", "여행방을 찾을 수 없거나 접근 권한이 없어요.")
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise AppError(404, "TRIP_NOT_FOUND", "여행방을 찾을 수 없어요.")
    return trip


def conflict(current: dict) -> AppError:
    return AppError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.",
                    {"current": current})


CITY_LABELS = {"busan": "부산", "gyeongju": "경주", "pohang": "포항", "other": "기타"}
CITIES = set(CITY_LABELS)
CATEGORIES = {"ATTRACTION", "CAFE", "FOOD", "LODGING", "SHOPPING", "STATION", "ETC"}
