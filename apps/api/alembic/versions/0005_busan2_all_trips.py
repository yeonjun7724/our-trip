"""부산 2일 · 경주 1일 · 포항 1일 for every trip (0004 only touched the default trip)

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

OLD = "busan,gyeongju,pohang,pohang"
NEW = "busan,busan,gyeongju,pohang"


def _relabel(cases: str, pattern: str) -> str:
    # one UPDATE so the CASE sees the original rows, not ones already relabeled
    return (
        f"UPDATE trip_days d SET primary_city = CASE d.day_number {cases} ELSE d.primary_city END "
        "WHERE d.trip_id IN (SELECT t.id FROM trips t WHERE "
        "(SELECT string_agg(primary_city, ',' ORDER BY day_number) FROM trip_days x WHERE x.trip_id=t.id)"
        f"='{pattern}')"
    )


def upgrade() -> None:
    op.execute(_relabel("WHEN 2 THEN 'busan' WHEN 3 THEN 'gyeongju' WHEN 4 THEN 'pohang'", OLD))


def downgrade() -> None:
    pass  # 0004's downgrade restores the default trip; other trips keep the corrected layout
