"""default trip: 부산 2일 · 경주 1일 · 포항 1일

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # single statement per day would see already-updated rows; do it in one UPDATE
    op.execute(
        "UPDATE trip_days d SET primary_city = CASE d.day_number WHEN 2 THEN 'busan' WHEN 3 THEN 'gyeongju' "
        "WHEN 4 THEN 'pohang' ELSE d.primary_city END "
        "WHERE d.trip_id IN (SELECT t.id FROM trips t WHERE t.is_default AND "
        "(SELECT string_agg(primary_city, ',' ORDER BY day_number) FROM trip_days x WHERE x.trip_id=t.id)"
        "='busan,gyeongju,pohang,pohang')"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE trip_days d SET primary_city = CASE d.day_number WHEN 2 THEN 'gyeongju' WHEN 3 THEN 'pohang' "
        "WHEN 4 THEN 'pohang' ELSE d.primary_city END "
        "WHERE d.trip_id IN (SELECT t.id FROM trips t WHERE t.is_default AND "
        "(SELECT string_agg(primary_city, ',' ORDER BY day_number) FROM trip_days x WHERE x.trip_id=t.id)"
        "='busan,busan,gyeongju,pohang')"
    )
