"""Add TourAPI (한국관광공사) recommended places to every existing trip

New trips get them from data/seed/candidates.json; this backfills trips created
before the seed grew. Skips any trip that already has a place with the same name.

Revision ID: 0006
Revises: 0005
"""
import json
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

from app.config import get_settings

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def _candidates() -> list[dict]:
    path = get_settings().seed_dir / "candidates.json"
    if not path.exists():
        return []
    return [c for c in json.loads(path.read_text("utf-8")) if c.get("coordinate_source") == "TOURAPI"]


def upgrade() -> None:
    cands = _candidates()
    if not cands:
        return
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    places = sa.table(
        "places", *(sa.column(c) for c in (
            "id", "trip_id", "name", "city", "category", "latitude", "longitude", "coordinate_source", "osm_ref",
            "provider", "provider_place_id", "memo", "stay_minutes", "version", "created_at", "updated_at")))
    for (trip_id,) in conn.execute(sa.text("SELECT id FROM trips")).all():
        have = {n.replace(" ", "") for (n,) in conn.execute(sa.text("SELECT name FROM places WHERE trip_id=:t"), {"t": trip_id}).all()}
        rows = [{
            "id": uuid.uuid4().hex, "trip_id": trip_id, "name": c["name"], "city": c["city"], "category": c.get("category", "ATTRACTION"),
            "latitude": c["latitude"], "longitude": c["longitude"], "coordinate_source": "TOURAPI", "osm_ref": None,
            "provider": "SEED", "provider_place_id": c.get("tourapi_content_id"), "memo": c.get("memo"),
            "stay_minutes": 60, "version": 1, "created_at": now, "updated_at": now,
        } for c in cands if c["name"].replace(" ", "") not in have]
        if rows:
            op.bulk_insert(places, rows)


def downgrade() -> None:
    op.execute("DELETE FROM places WHERE coordinate_source = 'TOURAPI' AND created_by IS NULL")
