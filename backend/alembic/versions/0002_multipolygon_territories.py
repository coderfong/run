"""territories.polygon: Polygon -> MultiPolygon.

Stealing land can shatter a territory; storing MultiPolygon keeps every
surviving fragment instead of discarding all but the largest. Existing
rows are wrapped with ST_Multi.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-05
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE territories DROP CONSTRAINT IF EXISTS territories_polygon_valid")
    op.execute(
        """
        ALTER TABLE territories
        ALTER COLUMN polygon TYPE geometry(MultiPolygon, 4326)
        USING ST_Multi(polygon)
        """
    )
    op.execute(
        "ALTER TABLE territories ADD CONSTRAINT territories_polygon_valid CHECK (ST_IsValid(polygon))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE territories DROP CONSTRAINT IF EXISTS territories_polygon_valid")
    # Collapse to the largest piece — lossy, but that's what downgrading means here.
    op.execute(
        """
        ALTER TABLE territories
        ALTER COLUMN polygon TYPE geometry(Polygon, 4326)
        USING (
            SELECT g FROM (
                SELECT (ST_Dump(polygon)).geom AS g
            ) parts
            ORDER BY ST_Area(g::geography) DESC
            LIMIT 1
        )
        """
    )
    op.execute(
        "ALTER TABLE territories ADD CONSTRAINT territories_polygon_valid CHECK (ST_IsValid(polygon))"
    )
