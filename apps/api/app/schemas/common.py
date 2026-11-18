from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class DataStatus(str, Enum):
    USER_ENTERED = "USER_ENTERED"      # 사용자 직접 입력
    VERIFIED_STATIC = "VERIFIED_STATIC"  # 검증된 정적 정보
    SCHEDULED = "SCHEDULED"            # 운행계획/시간표
    LIVE = "LIVE"                      # 실시간
    ESTIMATED = "ESTIMATED"            # 계산된 추정치
    UNAVAILABLE = "UNAVAILABLE"        # 조회 불가
    STALE = "STALE"                    # 유효기간 경과


class Freshness(BaseModel):
    """Every externally derived value carries where it came from and when."""
    status: DataStatus
    provider: str  # OSMNX | ODSAY | TMAP | TAGO | OSM | USER | NOMINATIM
    fetched_at: datetime | None = None
    note: str | None = None


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class NamedPoint(LatLon):
    label: str | None = None


class ExternalLink(BaseModel):
    label: str
    url: str
