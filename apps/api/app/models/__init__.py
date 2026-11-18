"""ORM models. Only user-created trip data and license-permitted static data are stored.

No table stores raw ODsay / TMAP / TAGO responses (see docs/API_POLICY.md).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, Time, UniqueConstraint, JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Seoul")
    departure_station_id: Mapped[str | None] = mapped_column(String(40))
    departure_station_name: Mapped[str | None] = mapped_column(String(80))
    return_station_id: Mapped[str | None] = mapped_column(String(40))
    return_station_name: Mapped[str | None] = mapped_column(String(80))
    rail_pass_type: Mapped[str] = mapped_column(String(20), default="UNDECIDED")
    cities: Mapped[list] = mapped_column(JSON, default=list)
    station_buffer_minutes: Mapped[int] = mapped_column(Integer, default=20)
    walking_speed_kmh: Mapped[float] = mapped_column(Float, default=4.0)
    recovery_key_hash: Mapped[str | None] = mapped_column(String(64))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    members: Mapped[list["TripMember"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    days: Mapped[list["TripDay"]] = relationship(back_populates="trip", cascade="all, delete-orphan",
                                                 order_by="TripDay.day_number")


class TripMember(Base):
    __tablename__ = "trip_members"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    nickname: Mapped[str] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(10), default="MEMBER")  # OWNER | MEMBER
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    trip: Mapped[Trip] = relationship(back_populates="members")


class MemberSession(Base):
    __tablename__ = "member_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    member_id: Mapped[str] = mapped_column(ForeignKey("trip_members.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    member: Mapped[TripMember] = relationship()


class TripInvite(Base):
    __tablename__ = "trip_invites"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Place(Base):
    __tablename__ = "places"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(20))  # busan | gyeongju | pohang | other
    category: Mapped[str] = mapped_column(String(20), default="ATTRACTION")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    # USER_PICKED | OSM_NOMINATIM | OSM_SEED | NONE
    coordinate_source: Mapped[str] = mapped_column(String(20), default="NONE")
    osm_ref: Mapped[str | None] = mapped_column(String(40))
    original_share_url: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(10), default="MANUAL")  # NAVER | KAKAO | MANUAL | SEED
    provider_place_id: Mapped[str | None] = mapped_column(String(40))
    memo: Mapped[str | None] = mapped_column(Text)
    stay_minutes: Mapped[int] = mapped_column(Integer, default=60)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    votes: Mapped[list["PlaceVote"]] = relationship(cascade="all, delete-orphan")


class PlaceVote(Base):
    __tablename__ = "place_votes"
    __table_args__ = (UniqueConstraint("place_id", "member_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str] = mapped_column(ForeignKey("trip_members.id", ondelete="CASCADE"))
    preference: Mapped[str] = mapped_column(String(10))  # MUST | GOOD | MAYBE | SKIP
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class TripDay(Base):
    __tablename__ = "trip_days"
    __table_args__ = (UniqueConstraint("trip_id", "day_number"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    day_number: Mapped[int] = mapped_column(Integer)
    travel_date: Mapped[date | None] = mapped_column(Date)
    primary_city: Mapped[str] = mapped_column(String(20))
    start_time: Mapped[time] = mapped_column(Time, default=time(9, 0))
    lodging_place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    trip: Mapped[Trip] = relationship(back_populates="days")
    items: Mapped[list["ItineraryItem"]] = relationship(cascade="all, delete-orphan",
                                                         order_by="ItineraryItem.sort_order")


class RailReservation(Base):
    __tablename__ = "rail_reservations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    transport_leg_id: Mapped[str | None] = mapped_column(String(32))
    train_number: Mapped[str | None] = mapped_column(String(20))
    train_type: Mapped[str | None] = mapped_column(String(40))
    origin_station_id: Mapped[str | None] = mapped_column(String(40))
    origin_station_name: Mapped[str] = mapped_column(String(80))
    destination_station_id: Mapped[str | None] = mapped_column(String(40))
    destination_station_name: Mapped[str] = mapped_column(String(80))
    origin_lat: Mapped[float | None] = mapped_column(Float)
    origin_lon: Mapped[float | None] = mapped_column(Float)
    destination_lat: Mapped[float | None] = mapped_column(Float)
    destination_lon: Mapped[float | None] = mapped_column(Float)
    station_coordinate_source: Mapped[str | None] = mapped_column(String(20))
    travel_date: Mapped[date | None] = mapped_column(Date)
    scheduled_departure: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # TAGO_TIMETABLE (picked from an official timetable response) | USER_ENTERED
    schedule_source: Mapped[str] = mapped_column(String(20), default="USER_ENTERED")
    schedule_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reservation_status: Mapped[str] = mapped_column(String(12), default="PLANNED")  # PLANNED|RESERVED|CANCELLED
    user_notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ItineraryItem(Base):
    __tablename__ = "itinerary_items"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_day_id: Mapped[str] = mapped_column(ForeignKey("trip_days.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="PLACE")  # PLACE | RAIL
    place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"))
    rail_reservation_id: Mapped[str | None] = mapped_column(ForeignKey("rail_reservations.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    planned_start: Mapped[time | None] = mapped_column(Time)
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    stay_minutes: Mapped[int | None] = mapped_column(Integer)
    visit_status: Mapped[str] = mapped_column(String(10), default="PLANNED")  # PLANNED | VISITED | SKIPPED
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    place: Mapped[Place | None] = relationship()
    rail: Mapped[RailReservation | None] = relationship()


class TransportLeg(Base):
    """A user-selected travel leg between two consecutive itinerary items.

    Stores only the user's plan summary (mode, minutes, label, provider, when checked) —
    never the raw provider response or route geometry.
    """
    __tablename__ = "transport_legs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    trip_day_id: Mapped[str | None] = mapped_column(ForeignKey("trip_days.id", ondelete="CASCADE"))
    from_item_id: Mapped[str | None] = mapped_column(ForeignKey("itinerary_items.id", ondelete="CASCADE"))
    to_item_id: Mapped[str | None] = mapped_column(ForeignKey("itinerary_items.id", ondelete="CASCADE"))
    mode: Mapped[str] = mapped_column(String(16))  # WALK|BUS|SUBWAY|TRAIN|TRANSIT|TAXI_EXTERNAL|UNKNOWN
    origin_label: Mapped[str | None] = mapped_column(String(120))
    destination_label: Mapped[str | None] = mapped_column(String(120))
    origin_lat: Mapped[float | None] = mapped_column(Float)
    origin_lon: Mapped[float | None] = mapped_column(Float)
    destination_lat: Mapped[float | None] = mapped_column(Float)
    destination_lon: Mapped[float | None] = mapped_column(Float)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    transfer_count: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(String(300))
    departure_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    arrival_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    schedule_source: Mapped[str | None] = mapped_column(String(20))  # ODSAY | TMAP | OSMNX | USER
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # USER_ENTERED | SCHEDULED | ESTIMATED | UNAVAILABLE | STALE
    verification_status: Mapped[str] = mapped_column(String(16), default="USER_ENTERED")
    booking_status: Mapped[str | None] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RailStation(Base):
    """Official TAGO station list (data.go.kr 이용허락범위 제한 없음). ID is the TAGO nodeid."""
    __tablename__ = "rail_stations"
    station_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    city_code: Mapped[str | None] = mapped_column(String(10))
    city_name: Mapped[str | None] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(20), default="TAGO")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ApiUsageLog(Base):
    __tablename__ = "api_usage_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(20), index=True)
    endpoint_category: Mapped[str] = mapped_column(String(40))
    request_date: Mapped[date] = mapped_column(Date, index=True)
    status_code: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str | None] = mapped_column(String(24))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(30))
    summary: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Expense(Base):
    """Shared trip expense, split equally among split_member_ids."""
    __tablename__ = "expenses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    amount: Mapped[int] = mapped_column(Integer)  # KRW
    category: Mapped[str] = mapped_column(String(16), default="ETC")
    paid_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    split_member_ids: Mapped[list] = mapped_column(JSON, default=list)
    day_number: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChecklistItem(Base):
    __tablename__ = "checklist_items"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(120))
    group: Mapped[str] = mapped_column(String(16), default="PACK")  # PACK | TODO
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlaceComment(Base):
    __tablename__ = "place_comments"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("trip_members.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
