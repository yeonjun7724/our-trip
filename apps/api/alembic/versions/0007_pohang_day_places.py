"""Put 구룡포 일본인 가옥거리 and 카페 슈슈모아 on the 포항 day

Uses the places people already registered in the trip (with their own location, votes and memo).
A place that isn't registered under a recognisable name is created: 구룡포 from OpenStreetMap,
슈슈모아 without coordinates (it isn't in OSM) so it shows up as "위치 미정".
Places already on any day are left where they are.

Revision ID: 0007
Revises: 0006
"""
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _is_guryongpo(name: str) -> bool:
    return "일본인" in name and ("가옥" in name or "구룡포" in name)


def _is_chouchoumoa(name: str) -> bool:
    return "슈슈모아" in name


WANTED = [
    (_is_guryongpo, {
        "name": "구룡포 일본인 가옥거리", "category": "ATTRACTION", "latitude": 35.990211, "longitude": 129.5613471,
        "coordinate_source": "OSM_NOMINATIM", "osm_ref": "node/12098825360", "memo": None}),
    (_is_chouchoumoa, {
        "name": "슈슈모아", "category": "CAFE", "latitude": None, "longitude": None,
        "coordinate_source": "NONE", "osm_ref": None, "memo": "경북 포항시 북구 우창로 81"}),
]

_PLACE_COLS = ("id", "trip_id", "name", "city", "category", "latitude", "longitude", "coordinate_source", "osm_ref",
               "provider", "memo", "stay_minutes", "version", "created_at", "updated_at")
_ITEM_COLS = ("id", "trip_day_id", "kind", "place_id", "sort_order", "is_fixed", "visit_status", "version", "updated_at")


def _find(rows, matches):
    """The registered place, preferring one a person added over a seeded one."""
    hits = [r for r in rows if matches(r.name.replace(" ", ""))]
    return min(hits, key=lambda r: r.created_by is None, default=None)


def _insert_at(conn, day_id: str) -> int:
    """Position right before the train that leaves 포항 (if any), otherwise the end of the day."""
    items = conn.execute(sa.text(
        "SELECT i.id, r.origin_station_name AS origin FROM itinerary_items i "
        "LEFT JOIN rail_reservations r ON r.id = i.rail_reservation_id "
        "WHERE i.trip_day_id = :d ORDER BY i.sort_order"), {"d": day_id}).all()
    return next((n for n, i in enumerate(items) if (i.origin or "").startswith("포항")), len(items))


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    places = sa.table("places", *(sa.column(c) for c in _PLACE_COLS))
    items = sa.table("itinerary_items", *(sa.column(c) for c in _ITEM_COLS))

    by_trip: dict[str, list] = {}
    for r in conn.execute(sa.text("SELECT id, trip_id, name, created_by FROM places ORDER BY created_at")).all():
        by_trip.setdefault(r.trip_id, []).append(r)
    trips = [t for t, rows in by_trip.items() if any(_find(rows, m) for m, _ in WANTED)]
    if not trips:
        trips = list(conn.scalars(sa.text("SELECT id FROM trips WHERE is_default ORDER BY created_at LIMIT 1")))

    for trip_id in trips:
        day_id = conn.scalar(sa.text("SELECT id FROM trip_days WHERE trip_id = :t AND primary_city = 'pohang' "
                                     "ORDER BY day_number LIMIT 1"), {"t": trip_id})
        if day_id is None:
            continue
        scheduled = set(conn.scalars(sa.text(
            "SELECT i.place_id FROM itinerary_items i JOIN trip_days d ON d.id = i.trip_day_id "
            "WHERE d.trip_id = :t AND i.place_id IS NOT NULL"), {"t": trip_id}))
        add: list[str] = []
        for matches, fallback in WANTED:
            found = _find(by_trip.get(trip_id, []), matches)
            place_id = found.id if found else uuid.uuid4().hex
            if found is None:
                op.bulk_insert(places, [{
                    **fallback, "id": place_id, "trip_id": trip_id, "city": "pohang", "provider": "SEED",
                    "stay_minutes": 60, "version": 1, "created_at": now, "updated_at": now}])
            if place_id not in scheduled:
                add.append(place_id)
        if not add:
            continue
        pos = _insert_at(conn, day_id)
        order = list(conn.scalars(sa.text("SELECT id FROM itinerary_items WHERE trip_day_id = :d ORDER BY sort_order"),
                                  {"d": day_id}))
        new = [{"id": uuid.uuid4().hex, "trip_day_id": day_id, "kind": "PLACE", "place_id": p, "sort_order": 0,
                "is_fixed": False, "visit_status": "PLANNED", "version": 1, "updated_at": now} for p in add]
        op.bulk_insert(items, new)
        order[pos:pos] = [n["id"] for n in new]
        for idx, item_id in enumerate(order):
            conn.execute(sa.text("UPDATE itinerary_items SET sort_order = :s WHERE id = :i"), {"s": idx, "i": item_id})
        conn.execute(sa.text("UPDATE trip_days SET version = version + 1 WHERE id = :d"), {"d": day_id})


def downgrade() -> None:
    pass  # the schedule belongs to the users once added; they can take the places off the day in the app
