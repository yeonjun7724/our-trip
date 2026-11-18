"""Day timelines, rail connection checks, walking-order optimisation, day suggestions.

Times are minutes since local (Asia/Seoul) midnight of the day. A value of None means the
time cannot be determined from verified data — it is shown as "미확인", never guessed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from ..config import KST
from ..models import ItineraryItem, Place, PlaceVote, TransportLeg, Trip, TripDay
from ..routing import osmnx_engine as eng

PREF_POINTS = {"MUST": 3, "GOOD": 2, "MAYBE": 1, "SKIP": -2}
LONG_WALK_MIN = 30
TRANSIT_STALE = timedelta(days=3)

CONNECTION_LABELS = {
    "LIKELY_OK": "연결 가능성이 높은 계획",
    "BUFFER_SHORT": "여유시간 부족",
    "MISSED": "열차 출발 이후 도착 예상",
    "UNVERIFIED": "연결 조건 미확인",
    "TIMETABLE_UNVERIFIED": "시간표 미확인",
    "INSUFFICIENT_DATA": "데이터 부족",
}


def priority(votes: list[PlaceVote], member_ids: list[str]) -> dict:
    by = {v.member_id: v.preference for v in votes}
    pts = sum(PREF_POINTS.get(p, 0) for p in by.values())
    # "둘 다" = at least two people want it (robust if a third device/name ever joins the shared trip)
    both_high = sum(1 for p in by.values() if p in ("MUST", "GOOD")) >= 2
    both_must = sum(1 for p in by.values() if p == "MUST") >= 2
    all_skip = bool(by) and all(p == "SKIP" for p in by.values())
    return {"score": pts + (2 if both_high else 0) + (1 if both_must else 0), "both_want": both_high,
            "excluded": all_skip, "votes": by}


def fmt(m: float | None) -> str | None:
    if m is None:
        return None
    m = int(round(m))
    d, r = divmod(m, 1440)
    s = f"{r // 60:02d}:{r % 60:02d}"
    return s if d == 0 else f"{s} (+{d}일)"


def _mins(t: time | None) -> float | None:
    return None if t is None else t.hour * 60 + t.minute


def _kst_mins(dt: datetime | None, day_date) -> float | None:
    if dt is None:
        return None
    local = dt.astimezone(KST)
    base = (local.date() - day_date).days * 1440 if day_date else 0
    return base + local.hour * 60 + local.minute


@dataclass
class Loc:
    lat: float | None
    lon: float | None
    label: str

    @property
    def known(self) -> bool:
        return self.lat is not None and self.lon is not None


def _loc_of_place(p: Place | None) -> Loc:
    return Loc(p.latitude, p.longitude, p.name) if p else Loc(None, None, "?")


def _stay(item: ItineraryItem) -> int:
    if item.stay_minutes is not None:
        return item.stay_minutes
    return item.place.stay_minutes if item.place else 0


def build_timeline(trip: Trip, day: TripDay, legs: dict[tuple[str | None, str], TransportLeg],
                   lodging: Place | None = None, compute_walks: bool = True) -> dict:
    buffer = trip.station_buffer_minutes
    speed = trip.walking_speed_kmh
    cursor: float | None = _mins(day.start_time) or 540
    loc = _loc_of_place(lodging) if lodging else None
    prev_id: str | None = None
    entries = []
    warnings: list[str] = []
    walk_total = 0.0
    now = datetime.now(timezone.utc)

    for item in day.items:
        if item.kind == "PLACE" and item.place is None:
            continue
        here = _loc_of_place(item.place) if item.kind == "PLACE" else Loc(
            item.rail.origin_lat, item.rail.origin_lon, item.rail.origin_station_name) if item.rail else Loc(None, None, "?")
        leg_out = None
        travel: float | None = 0.0
        if loc is not None:
            stored = legs.get((prev_id, item.id))
            if stored:
                travel = stored.duration_minutes
                st = stored.verification_status
                if stored.mode != "WALK" and stored.checked_at and now - (stored.checked_at if stored.checked_at.tzinfo else stored.checked_at.replace(tzinfo=timezone.utc)) > TRANSIT_STALE:
                    st = "STALE"
                leg_out = {"leg_id": stored.id, "mode": stored.mode, "duration_minutes": travel, "status": st,
                           "source": stored.schedule_source, "summary": stored.summary,
                           "transfer_count": stored.transfer_count, "checked_at": stored.checked_at}
            elif loc.known and here.known:
                r = eng.walk_route(loc.lat, loc.lon, here.lat, here.lon, speed) if compute_walks else {"status": "NOT_COMPUTED"}
                if r["status"] == "OK":
                    travel = r["duration_minutes"]
                    walk_total += r["distance_m"]
                    leg_out = {"mode": "WALK", "duration_minutes": travel, "distance_m": r["distance_m"],
                               "status": "ESTIMATED", "source": "OSMNX", "warnings": r["warnings"]}
                    if travel > LONG_WALK_MIN:
                        leg_out["suggest_transit"] = True
                else:
                    travel = None
                    leg_out = {"mode": "UNKNOWN", "duration_minutes": None, "status": "UNAVAILABLE",
                               "source": "OSMNX", "reason": r["status"], "warnings": r.get("warnings", [])}
            else:
                travel = None
                leg_out = {"mode": "UNKNOWN", "duration_minutes": None, "status": "UNAVAILABLE",
                           "reason": "LOCATION_MISSING", "warnings": ["위치가 확정되지 않은 장소가 있어 이동시간을 계산할 수 없어요."]}
        arrival = cursor + travel if (cursor is not None and travel is not None) else None

        if item.kind == "PLACE":
            start = arrival
            conflict = None
            if item.is_fixed and item.planned_start:
                fixed = _mins(item.planned_start)
                if arrival is not None and arrival > fixed + 1:
                    conflict = f"고정 시각 {fmt(fixed)}보다 약 {int(arrival - fixed)}분 늦게 도착해요."
                    warnings.append(f"{item.place.name}: {conflict}")
                start = fixed if arrival is None or arrival <= fixed else arrival
            stay = _stay(item)
            end = start + stay if start is not None else None
            entries.append({"item_id": item.id, "kind": "PLACE", "place_id": item.place_id, "name": item.place.name,
                            "category": item.place.category, "has_location": here.known, "leg_in": leg_out,
                            "arrival": fmt(arrival), "start": fmt(start), "end": fmt(end), "stay_minutes": stay,
                            "is_fixed": item.is_fixed, "visit_status": item.visit_status, "version": item.version,
                            "conflict": conflict, "time_status": "ESTIMATED" if start is not None else "UNAVAILABLE"})
            cursor, loc = end, here
        else:
            r = item.rail
            dep = _kst_mins(r.scheduled_departure, day.travel_date) if r else None
            arr = _kst_mins(r.scheduled_arrival, day.travel_date) if r else None
            status, note = check_connection(arrival, dep, buffer, r.schedule_source if r else None,
                                            leg_out["mode"] if leg_out else None,
                                            leg_out["status"] if leg_out else None, first=loc is None)
            if status in ("BUFFER_SHORT", "MISSED"):
                warnings.append(f"{r.origin_station_name} 열차: {CONNECTION_LABELS[status]}")
            if r and day.travel_date and r.travel_date and r.travel_date != day.travel_date:
                warnings.append(f"{r.train_number or ''} 열차 날짜가 이 날짜와 달라요.")
            entries.append({"item_id": item.id, "kind": "RAIL", "rail_reservation_id": r.id if r else None,
                            "name": f"{r.train_type or '열차'} {r.train_number or ''}".strip() if r else "열차",
                            "origin": r.origin_station_name if r else None,
                            "destination": r.destination_station_name if r else None,
                            "leg_in": leg_out, "arrival_at_station": fmt(arrival), "departure": fmt(dep),
                            "arrival": fmt(arr), "buffer_minutes": buffer,
                            "slack_minutes": int(dep - arrival) if dep is not None and arrival is not None else None,
                            "connection": status, "connection_label": CONNECTION_LABELS[status], "connection_note": note,
                            "schedule_source": r.schedule_source if r else None,
                            "reservation_status": r.reservation_status if r else None,
                            "visit_status": item.visit_status, "version": item.version, "is_fixed": True,
                            "time_status": "SCHEDULED" if r and r.schedule_source == "TAGO_TIMETABLE" else "USER_ENTERED"})
            cursor = arr
            loc = Loc(r.destination_lat, r.destination_lon, r.destination_station_name) if r else Loc(None, None, "?")
        prev_id = item.id

    first = _mins(day.start_time) or 540
    if cursor is not None and cursor - first > 14 * 60:
        warnings.append(f"하루 활동시간이 약 {int((cursor - first) / 60)}시간이에요. 일정을 줄이는 걸 고려해 보세요.")
    return {"entries": entries, "end": fmt(cursor), "walk_distance_m": round(walk_total), "warnings": warnings,
            "unknown_legs": sum(1 for e in entries if e["leg_in"] and e["leg_in"]["duration_minutes"] is None)}


def check_connection(arrival: float | None, dep: float | None, buffer: int, schedule_source: str | None,
                     leg_mode: str | None, leg_status: str | None, first: bool = False) -> tuple[str, str]:
    """Rule: station arrival + user buffer ≤ train departure. Buffer is a planning margin, not a rule."""
    if dep is None:
        return "INSUFFICIENT_DATA", "열차 출발 시각이 없어요."
    if first:
        tt = schedule_source == "TAGO_TIMETABLE"
        return ("LIKELY_OK" if tt else "TIMETABLE_UNVERIFIED",
                "하루의 첫 일정이라 역까지 이동은 따로 계산하지 않았어요." + ("" if tt else " 공식 시간표로 확인되지 않은 시각이에요."))
    if arrival is None:
        return "UNVERIFIED", "역 도착 예상 시각을 계산할 수 없어요(위치 또는 이동시간 미확정)."
    slack = dep - arrival
    if slack < 0:
        return "MISSED", f"역 도착 예상이 출발보다 {int(-slack)}분 늦어요."
    if slack < buffer:
        return "BUFFER_SHORT", f"여유 {int(slack)}분 — 설정한 여유시간 {buffer}분보다 짧아요."
    if schedule_source != "TAGO_TIMETABLE":
        return "TIMETABLE_UNVERIFIED", f"여유 {int(slack)}분. 단, 열차 시각을 공식 시간표로 확인하지 않았어요."
    if leg_status == "STALE":
        return "UNVERIFIED", "역까지 대중교통 소요시간 조회가 오래되었어요. 다시 조회해 주세요."
    if leg_mode not in ("WALK",):
        return "LIKELY_OK", (f"여유 {int(slack)}분. 역까지 소요시간은 조회 시점 기준이라 당일 혼잡·지연·운행은 "
                             "반영되지 않았어요.")
    return "LIKELY_OK", f"여유 {int(slack)}분 (도보 OSMnx 추정)."


# ---------- optimisation ----------

def _cost(a: Loc, b: Loc, cache: dict) -> tuple[float, bool]:
    """(cost metres, walkable). Cross-zone legs get a penalty: they need transit."""
    key = (a.lat, a.lon, b.lat, b.lon)
    if key in cache:
        return cache[key]
    r = eng.walk_route(a.lat, a.lon, b.lat, b.lon)
    if r["status"] == "OK":
        out = (r["distance_m"], True)
    else:
        out = (float(eng.haversine(a.lat, a.lon, b.lat, b.lon)) * 1.3 + 3000, False)
    cache[key] = out
    return out


def _tour_cost(start: Loc | None, seq: list[Loc], cache) -> float:
    total = 0.0
    prev = start
    for s in seq:
        if prev is not None:
            total += _cost(prev, s, cache)[0]
        prev = s
    return total


def order_segment(start: Loc | None, locs: list[Loc], cache: dict) -> list[int]:
    n = len(locs)
    if n <= 1:
        return list(range(n))
    # nearest neighbour from start (or from the first item when no start)
    remaining = list(range(n))
    order: list[int] = []
    cur = start
    if cur is None:
        order.append(remaining.pop(0))
        cur = locs[order[0]]
    while remaining:
        nxt = min(remaining, key=lambda j: _cost(cur, locs[j], cache)[0])
        remaining.remove(nxt)
        order.append(nxt)
        cur = locs[nxt]
    # 2-opt (open path, fixed start)
    improved = True
    while improved:
        improved = False
        best = _tour_cost(start, [locs[i] for i in order], cache)
        for i in range(0 if start is not None else 1, n - 1):
            for k in range(i + 1, n):
                cand = order[:i] + order[i:k + 1][::-1] + order[k + 1:]
                c = _tour_cost(start, [locs[j] for j in cand], cache)
                if c + 1e-6 < best:
                    order, best, improved = cand, c, True
    return order


def optimise_day(trip: Trip, day: TripDay, lodging: Place | None) -> dict:
    """Propose an order. Anchors (RAIL items, fixed places) keep their positions."""
    cache: dict = {}
    items = list(day.items)
    result: list[ItineraryItem] = []
    warnings: list[str] = []
    seg: list[ItineraryItem] = []
    start = _loc_of_place(lodging) if lodging and lodging.latitude is not None else None

    def flush(seg_start):
        located = [i for i in seg if i.place and i.place.latitude is not None]
        unlocated = [i for i in seg if not (i.place and i.place.latitude is not None)]
        if unlocated:
            warnings.append(f"위치 미확정 {len(unlocated)}곳은 순서 최적화에서 제외하고 구간 끝에 두었어요.")
        locs = [_loc_of_place(i.place) for i in located]
        result.extend(located[j] for j in order_segment(seg_start, locs, cache))
        result.extend(unlocated)

    for it in items:
        anchor = it.kind == "RAIL" or it.is_fixed
        if anchor:
            flush(start)
            seg = []
            result.append(it)
            if it.kind == "RAIL" and it.rail:
                start = Loc(it.rail.destination_lat, it.rail.destination_lon, it.rail.destination_station_name) \
                    if it.rail.destination_lat is not None else None
            elif it.place and it.place.latitude is not None:
                start = _loc_of_place(it.place)
        else:
            seg.append(it)
    flush(start)

    def metrics(seq: list[ItineraryItem]):
        walk = 0.0
        transit_legs = 0
        prev = _loc_of_place(lodging) if lodging and lodging.latitude is not None else None
        for it in seq:
            here = _loc_of_place(it.place) if it.kind == "PLACE" and it.place else (
                Loc(it.rail.origin_lat, it.rail.origin_lon, "") if it.rail else Loc(None, None, ""))
            if prev and prev.known and here.known:
                c, walkable = _cost(prev, here, cache)
                if walkable:
                    walk += c
                else:
                    transit_legs += 1
            prev = here if it.kind == "PLACE" else (Loc(it.rail.destination_lat, it.rail.destination_lon, "") if it.rail else None)
        return {"walk_distance_m": round(walk), "legs_needing_transit": transit_legs}

    before, after = metrics(items), metrics(result)
    if after["legs_needing_transit"]:
        warnings.append("도보 권역을 벗어나는 구간은 직선거리 기반으로만 순서를 정했어요. 대중교통 경로를 조회해 확인해 주세요.")
    return {"day_id": day.id, "base_version": day.version, "proposed_order": [i.id for i in result],
            "changed": [i.id for i in result] != [i.id for i in items], "before": before, "after": after,
            "warnings": warnings,
            "method": "OSMnx 보행거리 행렬 + nearest-neighbor + 2-opt (고정 일정·열차는 위치 유지)"}


def suggest_days(trip: Trip, places: list[Place], assigned_ids: set[str], member_ids: list[str]) -> list[dict]:
    """Suggest a day for unassigned places in the same city. Never applied automatically."""
    out = []
    load = {d.id: len(d.items) for d in trip.days}
    for p in sorted(places, key=lambda p: -priority(p.votes, member_ids)["score"]):
        if p.id in assigned_ids or p.category == "LODGING":
            continue
        pr = priority(p.votes, member_ids)
        if pr["excluded"]:
            continue
        days = [d for d in trip.days if d.primary_city == p.city]
        if not days:
            out.append({"place_id": p.id, "name": p.name, "day_id": None,
                        "reason": "이 도시를 방문하는 날이 없어요."})
            continue
        best = min(days, key=lambda d: (load[d.id], d.day_number))
        load[best.id] += 1
        out.append({"place_id": p.id, "name": p.name, "day_id": best.id, "day_number": best.day_number,
                    "score": pr["score"], "reason": f"DAY {best.day_number} 방문 도시와 같고 일정이 가장 여유로워요."})
    return out
