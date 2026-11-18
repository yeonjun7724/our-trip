"""Couple features: shared expenses + settlement, checklist, place comments,
day walking-route geometry (OSMnx), and weather (Open-Meteo)."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..errors import AppError
from ..models import ChecklistItem, Expense, Place, PlaceComment, Trip, TripDay, TripMember
from ..routing import osmnx_engine as eng
from ..security.auth import current_member
from .common import get_trip, log_activity

router = APIRouter(prefix="/api", tags=["together"])
EXPENSE_CATS = {"TRANSPORT", "FOOD", "CAFE", "LODGING", "TICKET", "SHOPPING", "ETC"}


# ---------------- expenses ----------------

class ExpenseIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    amount: int = Field(gt=0, le=50_000_000)
    category: str = "ETC"
    paid_by: str | None = None
    split_member_ids: list[str] | None = None
    day_number: int | None = Field(default=None, ge=1, le=14)


def _expense_out(e: Expense, names: dict[str, str]) -> dict:
    return {"id": e.id, "title": e.title, "amount": e.amount, "category": e.category, "paid_by": e.paid_by,
            "paid_by_name": names.get(e.paid_by or ""), "split_member_ids": e.split_member_ids,
            "split_names": [names.get(m, "?") for m in e.split_member_ids], "day_number": e.day_number,
            "created_at": e.created_at}


def settle(expenses: list[Expense], member_ids: list[str]) -> dict:
    """Equal split per expense; returns per-member paid/owed/balance and minimal transfers (greedy)."""
    paid = {m: 0.0 for m in member_ids}
    owed = {m: 0.0 for m in member_ids}
    for e in expenses:
        split = [m for m in (e.split_member_ids or []) if m in paid] or member_ids
        if e.paid_by in paid:
            paid[e.paid_by] += e.amount
        share = e.amount / len(split)
        for m in split:
            owed[m] += share
    bal = {m: round(paid[m] - owed[m]) for m in member_ids}
    debtors = sorted([[m, -b] for m, b in bal.items() if b < 0], key=lambda x: -x[1])
    creditors = sorted([[m, b] for m, b in bal.items() if b > 0], key=lambda x: -x[1])
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        amt = min(debtors[i][1], creditors[j][1])
        if amt >= 1:
            transfers.append({"from": debtors[i][0], "to": creditors[j][0], "amount": int(round(amt))})
        debtors[i][1] -= amt
        creditors[j][1] -= amt
        if debtors[i][1] < 1:
            i += 1
        if creditors[j][1] < 1:
            j += 1
    return {"paid": {m: round(v) for m, v in paid.items()}, "owed": {m: round(v) for m, v in owed.items()},
            "balance": bal, "transfers": transfers}


@router.get("/trips/{trip_id}/expenses")
def list_expenses(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    names = {m.id: m.nickname for m in trip.members}
    rows = db.scalars(select(Expense).where(Expense.trip_id == trip_id).order_by(Expense.created_at.desc())).all()
    # only members who appear in expenses (or me) take part in settlement
    involved = {member.id}
    for e in rows:
        involved |= set(e.split_member_ids or []) | ({e.paid_by} if e.paid_by else set())
    ids = [m.id for m in sorted(trip.members, key=lambda m: m.created_at) if m.id in involved]
    s = settle(list(rows), ids)
    by_cat: dict[str, int] = {}
    for e in rows:
        by_cat[e.category] = by_cat.get(e.category, 0) + e.amount
    total = sum(e.amount for e in rows)
    return {"expenses": [_expense_out(e, names) for e in rows], "total": total, "by_category": by_cat,
            "members": [{"id": m, "nickname": names.get(m), "paid": s["paid"][m], "owed": s["owed"][m],
                         "balance": s["balance"][m]} for m in ids],
            "transfers": [{**t, "from_name": names.get(t["from"]), "to_name": names.get(t["to"])} for t in s["transfers"]],
            "note": "지출마다 고른 사람끼리 똑같이 나눈 금액이에요."}


@router.post("/trips/{trip_id}/expenses", status_code=201)
def add_expense(trip_id: str, body: ExpenseIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    ids = {m.id for m in trip.members}
    if body.category not in EXPENSE_CATS:
        raise AppError(422, "INVALID_CATEGORY", "분류가 올바르지 않아요.")
    payer = body.paid_by or member.id
    split = body.split_member_ids or [payer]
    if payer not in ids or any(m not in ids for m in split):
        raise AppError(422, "INVALID_MEMBER", "참여자를 확인해 주세요.")
    _check_day(trip, body.day_number)
    e = Expense(trip_id=trip.id, title=body.title.strip(), amount=body.amount, category=body.category, paid_by=payer,
                split_member_ids=list(dict.fromkeys(split)), day_number=body.day_number, created_by=member.id)
    db.add(e)
    log_activity(db, member, "EXPENSE_ADDED", f"{member.nickname}님이 '{e.title}' {e.amount:,}원을 기록했어요")
    db.commit()
    return _expense_out(e, {m.id: m.nickname for m in trip.members})


def _check_day(trip, day_number: int | None) -> None:
    if day_number is not None and day_number not in {d.day_number for d in trip.days}:
        raise AppError(422, "INVALID_DAY", "여행 날짜를 확인해 주세요.")


@router.put("/expenses/{expense_id}")
def update_expense(expense_id: str, body: ExpenseIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    e = db.get(Expense, expense_id)
    if e is None or e.trip_id != member.trip_id:
        raise AppError(404, "EXPENSE_NOT_FOUND", "지출을 찾을 수 없어요.")
    trip = get_trip(db, member, e.trip_id)
    ids = {m.id for m in trip.members}
    if body.category not in EXPENSE_CATS:
        raise AppError(422, "INVALID_CATEGORY", "분류가 올바르지 않아요.")
    payer = body.paid_by or e.paid_by or member.id
    split = body.split_member_ids or [payer]
    if payer not in ids or any(m not in ids for m in split):
        raise AppError(422, "INVALID_MEMBER", "참여자를 확인해 주세요.")
    _check_day(trip, body.day_number)
    e.title, e.amount, e.category, e.paid_by = body.title.strip(), body.amount, body.category, payer
    e.split_member_ids, e.day_number = list(dict.fromkeys(split)), body.day_number
    log_activity(db, member, "EXPENSE_UPDATED", f"{member.nickname}님이 '{e.title}' 지출을 수정했어요")
    db.commit()
    return _expense_out(e, {m.id: m.nickname for m in trip.members})


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    e = db.get(Expense, expense_id)
    if e is None or e.trip_id != member.trip_id:
        raise AppError(404, "EXPENSE_NOT_FOUND", "지출을 찾을 수 없어요.")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ---------------- checklist ----------------

class ChecklistIn(BaseModel):
    text: str = Field(min_length=1, max_length=120)
    group: str = "PACK"


class ChecklistBulk(BaseModel):
    items: list[ChecklistIn] = Field(max_length=40)


class ChecklistPatch(BaseModel):
    done: bool | None = None
    text: str | None = Field(default=None, min_length=1, max_length=120)


def _item_out(i: ChecklistItem, names: dict[str, str]) -> dict:
    return {"id": i.id, "text": i.text, "group": i.group, "done": i.done, "done_by": names.get(i.done_by or ""),
            "created_by": names.get(i.created_by or ""), "created_at": i.created_at}


@router.get("/trips/{trip_id}/checklist")
def list_checklist(trip_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    names = {m.id: m.nickname for m in trip.members}
    rows = db.scalars(select(ChecklistItem).where(ChecklistItem.trip_id == trip_id).order_by(ChecklistItem.created_at)).all()
    return [_item_out(i, names) for i in rows]


@router.post("/trips/{trip_id}/checklist", status_code=201)
def add_checklist(trip_id: str, body: ChecklistBulk, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    trip = get_trip(db, member, trip_id)
    existing = {i.text for i in db.scalars(select(ChecklistItem).where(ChecklistItem.trip_id == trip_id)).all()}
    added = 0
    for it in body.items:
        t = it.text.strip()
        if t and t not in existing:
            db.add(ChecklistItem(trip_id=trip.id, text=t, group=it.group if it.group in ("PACK", "TODO") else "PACK",
                                 created_by=member.id))
            existing.add(t)
            added += 1
    if added:
        log_activity(db, member, "CHECKLIST_ADDED", f"{member.nickname}님이 체크리스트에 {added}개를 추가했어요")
    db.commit()
    return {"added": added}


@router.patch("/checklist/{item_id}")
def patch_checklist(item_id: str, body: ChecklistPatch, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    i = db.get(ChecklistItem, item_id)
    if i is None or i.trip_id != member.trip_id:
        raise AppError(404, "ITEM_NOT_FOUND", "항목을 찾을 수 없어요.")
    if body.done is not None:
        i.done = body.done
        i.done_by = member.id if body.done else None
    if body.text:
        i.text = body.text.strip()
    db.commit()
    return {"ok": True}


@router.delete("/checklist/{item_id}")
def delete_checklist(item_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    i = db.get(ChecklistItem, item_id)
    if i is None or i.trip_id != member.trip_id:
        raise AppError(404, "ITEM_NOT_FOUND", "항목을 찾을 수 없어요.")
    db.delete(i)
    db.commit()
    return {"ok": True}


# ---------------- place comments ----------------

class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@router.get("/places/{place_id}/comments")
def list_comments(place_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None or p.trip_id != member.trip_id:
        raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
    trip = db.get(Trip, p.trip_id)
    names = {m.id: m.nickname for m in trip.members}
    rows = db.scalars(select(PlaceComment).where(PlaceComment.place_id == place_id).order_by(PlaceComment.created_at)).all()
    return [{"id": c.id, "text": c.text, "member_id": c.member_id, "nickname": names.get(c.member_id or "", "?"),
             "is_me": c.member_id == member.id, "created_at": c.created_at} for c in rows]


@router.post("/places/{place_id}/comments", status_code=201)
def add_comment(place_id: str, body: CommentIn, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None or p.trip_id != member.trip_id:
        raise AppError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없어요.")
    c = PlaceComment(place_id=p.id, member_id=member.id, text=body.text.strip())
    db.add(c)
    log_activity(db, member, "COMMENTED", f"{member.nickname}님: '{p.name}'에 \"{c.text[:30]}\"")
    db.commit()
    return {"id": c.id}


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    c = db.get(PlaceComment, comment_id)
    if c is None or c.member_id != member.id:
        raise AppError(404, "COMMENT_NOT_FOUND", "내가 쓴 댓글만 지울 수 있어요.")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ---------------- day walking route (OSMnx) ----------------

@router.get("/trips/{trip_id}/days/{day_id}/walk-geometry")
async def day_walk_geometry(trip_id: str, day_id: str, member: TripMember = Depends(current_member), db: Session = Depends(get_db)):
    """Walking geometry between consecutive located places of a day. Non-walkable legs are listed, never drawn."""
    trip = get_trip(db, member, trip_id)
    day = db.get(TripDay, day_id)
    if day is None or day.trip_id != trip.id:
        raise AppError(404, "DAY_NOT_FOUND", "날짜를 찾을 수 없어요.")
    pts = [(i.place.name, i.place.latitude, i.place.longitude) for i in day.items
           if i.kind == "PLACE" and i.place and i.place.latitude is not None]

    def compute():
        feats, skipped, total = [], [], 0.0
        for (n1, la1, lo1), (n2, la2, lo2) in zip(pts[:-1], pts[1:]):
            r = eng.walk_route(la1, lo1, la2, lo2, trip.walking_speed_kmh)
            if r["status"] == "OK":
                total += r["distance_m"]
                feats.append({"type": "Feature", "geometry": r["geometry"],
                              "properties": {"mode": "WALK", "from": n1, "to": n2, "distance_m": r["distance_m"],
                                             "minutes": r["duration_minutes"], "source": "OSMNX"}})
            else:
                skipped.append({"from": n1, "to": n2, "reason": r["status"]})
        return {"type": "FeatureCollection", "features": feats, "skipped": skipped, "walk_distance_m": round(total),
                "note": "도보로 이어지는 구간만 그려요. 나머지는 대중교통 구간이에요."}
    return await run_in_threadpool(compute)


# ---------------- weather (Open-Meteo, CC BY 4.0, no key) ----------------

CITY_POINTS = {"busan": (35.1532, 129.1186), "gyeongju": (35.8347, 129.2190), "pohang": (36.0546, 129.3765)}
_weather_cache: dict[str, tuple[float, dict]] = {}


@router.get("/weather")
async def weather():  # public: no personal data; lets the deploy be checked with curl
    import asyncio

    now = time.time()

    async def one(c: httpx.AsyncClient, city: str, lat: float, lon: float) -> tuple[str, dict]:
        hit = _weather_cache.get(city)
        if hit and now - hit[0] < 3600:
            return city, hit[1]
        try:
            r = await c.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": lat, "longitude": lon, "timezone": "Asia/Seoul", "forecast_days": 16,
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
            d = r.json()["daily"]
            data = {"days": [{"date": d["time"][i], "code": d["weather_code"][i], "tmax": d["temperature_2m_max"][i],
                              "tmin": d["temperature_2m_min"][i], "rain": d["precipitation_probability_max"][i]}
                             for i in range(len(d["time"]))],
                    "fetched_at": datetime.now(timezone.utc).isoformat()}
            _weather_cache[city] = (now, data)
            return city, data
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            return city, {"days": [], "error": "UNAVAILABLE"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=4.0), headers={"User-Agent": "OurTrip/0.1"}) as c:
        out = dict(await asyncio.gather(*(one(c, k, la, lo) for k, (la, lo) in CITY_POINTS.items())))
    return {"cities": out, "source": "Open-Meteo", "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)",
            "note": "예보는 최대 16일까지만 제공돼요. 그 이후 날짜는 표시하지 않아요."}
