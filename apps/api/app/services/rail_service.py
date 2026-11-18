"""Rail: official TAGO station list, timetable lookup, transfer candidates, 내일로 day counting.

Pass rules: only the *mechanical* checks are implemented (distinct rail travel days vs.
3 for 선택 3일권; span vs. 7 days for 연속 7일권). Eligibility, usable trains, seat rules and
the selection window must be checked on the official Korail page — the official 내일로 page
could not be read during development (404), so nothing about them is hard-coded.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import KST
from ..errors import AppError
from ..models import ItineraryItem, RailReservation, RailStation, Trip, TripDay
from ..providers import tago_train
from ..providers.base import AuthFailed, BadRequest, NoData, NotConfigured, ProviderError, QuotaExceeded

KORAIL_URL = "https://www.korail.com"
STATION_TTL = timedelta(days=7)


def provider_error(exc: ProviderError) -> AppError:
    if isinstance(exc, NotConfigured):
        return AppError(503, "RAIL_NOT_CONFIGURED", "열차정보 API(TAGO) 키가 설정되지 않았어요. 코레일 공식 앱/홈페이지에서 확인해 주세요.",
                        {"external": KORAIL_URL})
    if isinstance(exc, AuthFailed):
        return AppError(502, "RAIL_AUTH_FAILED", "열차정보 API 인증에 실패했어요. data.go.kr 활용신청 승인 상태와 키를 확인해 주세요.")
    if isinstance(exc, QuotaExceeded):
        return AppError(429, "RAIL_QUOTA_EXCEEDED", "열차정보 API 호출 한도를 넘었어요. 잠시 후 다시 시도해 주세요.")
    if isinstance(exc, BadRequest):
        return AppError(400, "RAIL_BAD_REQUEST", "조회 조건(역 코드·날짜)을 공급자가 지원하지 않아요. 날짜 범위나 역을 확인해 주세요.")
    return AppError(502, "RAIL_UPSTREAM_ERROR", "열차정보 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.")


async def refresh_stations(db: Session) -> int:
    try:
        cities = await tago_train.city_codes()
        n = 0
        for c in cities:
            try:
                stations = await tago_train.stations_in_city(c["city_code"])
            except NoData:
                continue
            for s in stations:
                row = db.get(RailStation, s["station_id"])
                if row is None:
                    row = RailStation(station_id=s["station_id"])
                    db.add(row)
                row.name = s["name"]
                row.city_code = c["city_code"]
                row.city_name = c["city_name"]
                row.source = "TAGO"
                row.fetched_at = datetime.now(timezone.utc)
                n += 1
        db.commit()
        return n
    except ProviderError as exc:
        raise provider_error(exc) from exc


async def search_stations(db: Session, q: str) -> dict:
    latest = db.scalar(select(RailStation.fetched_at).order_by(RailStation.fetched_at.desc()).limit(1))
    refreshed = False
    if (latest is None or (datetime.now(timezone.utc) - (latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc))) > STATION_TTL) \
            and tago_train.runtime.usable:
        try:
            await refresh_stations(db)
            refreshed = True
        except AppError:
            if latest is None:
                raise
    if latest is None and not refreshed and not tago_train.runtime.usable:
        raise provider_error(NotConfigured("TAGO"))
    stmt = select(RailStation)
    if q:
        stmt = stmt.where(or_(RailStation.name.contains(q.strip()), RailStation.station_id == q.strip()))
    rows = db.scalars(stmt.order_by(RailStation.name).limit(40)).all()
    fetched = db.scalar(select(RailStation.fetched_at).order_by(RailStation.fetched_at.desc()).limit(1))
    return {"stations": [{"station_id": r.station_id, "name": r.name, "city_name": r.city_name} for r in rows],
            "source": "TAGO", "fetched_at": fetched}


def _filter(trains: list[dict], from_hour: int | None, to_hour: int | None, train_type: str | None) -> list[dict]:
    out = []
    for t in trains:
        dep = t["departure"]
        if dep and from_hour is not None and dep.hour < from_hour:
            continue
        if dep and to_hour is not None and dep.hour > to_hour:
            continue
        if train_type and train_type not in (t["train_type"] or ""):
            continue
        out.append(t)
    return out


async def timetable(dep: str, arr: str, day: date, grade: str | None, from_hour: int | None,
                    to_hour: int | None, train_type: str | None) -> dict:
    fetched = datetime.now(timezone.utc)
    try:
        trains = await tago_train.trains(dep, arr, day, grade)
    except NoData:
        return {"status": "NO_TRAINS", "direct_available": False, "trains": [], "provider": "TAGO", "fetched_at": fetched,
                "message": "이 날짜에 두 역 사이 직통 열차가 조회되지 않아요. 날짜가 공급 범위 밖이거나 직통편이 없을 수 있어요. "
                           "환승역을 지정해 환승 후보를 검토할 수 있어요."}
    except ProviderError as exc:
        raise provider_error(exc) from exc
    trains = _filter(trains, from_hour, to_hour, train_type)
    return {"status": "OK" if trains else "NO_MATCH", "direct_available": True, "trains": trains, "provider": "TAGO",
            "fetched_at": fetched, "data_status": "SCHEDULED",
            "message": None if trains else "조건(시간대·열차종류)에 맞는 열차가 없어요.",
            "notice": "운행계획(시간표) 기준이에요. 잔여석·지연은 제공되지 않으니 예매 전 코레일에서 확인해 주세요."}


async def transfer_candidates(dep: str, via: str, arr: str, day: date, min_transfer: int, max_wait: int = 120) -> dict:
    """Pair first-leg and second-leg trains at a user-chosen transfer station.

    Only pairs where arrival + min_transfer ≤ next departure (and wait ≤ max_wait) are kept.
    These are candidates built from two separate timetable queries, not a guaranteed connection.
    """
    fetched = datetime.now(timezone.utc)
    try:
        first = await tago_train.trains(dep, via, day)
    except NoData:
        first = []
    except ProviderError as exc:
        raise provider_error(exc) from exc
    try:
        second = await tago_train.trains(via, arr, day)
    except NoData:
        second = []
    except ProviderError as exc:
        raise provider_error(exc) from exc
    pairs = []
    for a in first:
        if not a["arrival"]:
            continue
        for b in second:
            if not b["departure"]:
                continue
            wait = (b["departure"] - a["arrival"]).total_seconds() / 60
            if min_transfer <= wait <= max_wait:
                pairs.append({"first": a, "second": b, "transfer_minutes": int(wait),
                              "total_minutes": int((b["arrival"] - a["departure"]).total_seconds() / 60)
                              if b["arrival"] and a["departure"] else None})
                break  # earliest feasible onward train for this first leg
    return {"status": "OK" if pairs else "NO_CANDIDATES", "candidates": pairs, "min_transfer_minutes": min_transfer,
            "provider": "TAGO", "fetched_at": fetched,
            "notice": "두 구간을 따로 조회해 시각만 맞춘 환승 후보예요. 실제 환승 가능 여부·승강장·지연은 보장되지 않으며 구간별로 각각 예매해야 해요."}


def rail_travel_days(db: Session, trip: Trip) -> list[dict]:
    rows = db.scalars(select(RailReservation).where(RailReservation.trip_id == trip.id,
                                                    RailReservation.reservation_status != "CANCELLED")).all()
    days: dict[date, list] = {}
    for r in rows:
        d = r.travel_date or (r.scheduled_departure.astimezone(KST).date() if r.scheduled_departure else None)
        if d:
            days.setdefault(d, []).append({"id": r.id, "train": f"{r.train_type or ''} {r.train_number or ''}".strip(),
                                           "route": f"{r.origin_station_name}→{r.destination_station_name}",
                                           "reservation_status": r.reservation_status})
    undated = [r.id for r in rows if not (r.travel_date or r.scheduled_departure)]
    return [{"date": d, "trains": v} for d, v in sorted(days.items())] + (
        [{"date": None, "trains": [{"id": i} for i in undated]}] if undated else [])


def pass_check(db: Session, trip: Trip) -> dict:
    days = rail_travel_days(db, trip)
    dated = [d["date"] for d in days if d["date"]]
    n = len(dated)
    warnings: list[str] = []
    if trip.rail_pass_type == "SELECT_3" and n > 3:
        warnings.append(f"열차 탑승일이 {n}일이에요. 선택 3일권은 3일만 쓸 수 있어 {n - 3}일은 별도 승차권이 필요해요.")
    if trip.rail_pass_type == "CONTINUOUS_7" and dated and (max(dated) - min(dated)).days + 1 > 7:
        warnings.append("첫 탑승일부터 마지막 탑승일까지 7일을 넘어요. 연속 7일권 기간을 벗어나는 탑승이 있어요.")
    if trip.start_date and trip.end_date and any(d < trip.start_date or d > trip.end_date for d in dated):
        warnings.append("여행 기간 밖의 열차 예약이 있어요.")
    if any(d["date"] is None for d in days):
        warnings.append("날짜가 없는 열차 기록이 있어 탑승일 계산에서 빠졌어요.")
    unreserved = sum(1 for d in days for t in d["trains"] if t.get("reservation_status") == "PLANNED")
    return {
        "pass_type": trip.rail_pass_type, "rail_days": days, "rail_day_count": n,
        "allowed_days": 3 if trip.rail_pass_type == "SELECT_3" else 7 if trip.rail_pass_type == "CONTINUOUS_7" else None,
        "unreserved_trains": unreserved, "warnings": warnings,
        "disclaimer": "내일로 패스는 좌석 예약을 보장하지 않아요. 연령·이용 가능 열차·좌석 지정 횟수 등 세부 조건은 코레일 공식 안내에서 최신 약관을 확인해 주세요.",
        "official_url": KORAIL_URL,
    }


def day_for_date(db: Session, trip: Trip, d: date | None) -> TripDay | None:
    if d is None:
        return None
    return db.scalar(select(TripDay).where(TripDay.trip_id == trip.id, TripDay.travel_date == d))


def link_reservation_to_day(db: Session, trip: Trip, res: RailReservation, day: TripDay | None) -> None:
    """Ensure exactly one RAIL itinerary item for the reservation, in the given day."""
    existing = db.scalar(select(ItineraryItem).where(ItineraryItem.rail_reservation_id == res.id))
    if day is None:
        if existing:
            db.delete(existing)
        return
    if existing and existing.trip_day_id == day.id:
        return
    if existing:
        db.delete(existing)
        db.flush()
    # place the train by departure time relative to fixed items; default: end of day
    order = max([i.sort_order for i in day.items] + [-1]) + 1
    db.add(ItineraryItem(trip_day_id=day.id, kind="RAIL", rail_reservation_id=res.id, sort_order=order, is_fixed=True))
    day.version += 1
