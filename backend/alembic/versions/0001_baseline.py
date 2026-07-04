"""Baseline: users / runs / territories as of the anti-cheat release.

Matches schema.sql + migrations/001 + 002 (which remain as documentation
only). Fresh databases run this; existing databases should be stamped:

    alembic stamp 0001

Revision ID: 0001
Revises:
Create Date: 2026-07-05
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.execute(
        """
        CREATE TABLE users (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username        TEXT UNIQUE NOT NULL,
            password_hash   TEXT,
            created_at      TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE runs (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            started_at   TIMESTAMP NOT NULL DEFAULT now(),
            ended_at     TIMESTAMP,
            path         geometry(LineString, 4326),
            distance_m   DOUBLE PRECISION,
            duration_s   DOUBLE PRECISION,
            verified     BOOLEAN NOT NULL DEFAULT true,
            flag_reasons TEXT[]
        )
        """
    )
    op.execute("CREATE INDEX runs_user_idx ON runs(user_id)")
    op.execute("CREATE INDEX runs_path_gix ON runs USING GIST (path)")

    op.execute(
        """
        CREATE TABLE territories (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
            polygon     geometry(Polygon, 4326) NOT NULL,
            area_m2     DOUBLE PRECISION NOT NULL,
            created_at  TIMESTAMP NOT NULL DEFAULT now(),
            verified    BOOLEAN NOT NULL DEFAULT true
        )
        """
    )
    op.execute("CREATE INDEX territories_polygon_gix ON territories USING GIST (polygon)")
    op.execute("CREATE INDEX territories_user_idx ON territories(user_id)")
    op.execute("CREATE INDEX territories_verified_idx ON territories(verified)")
    op.execute(
        "ALTER TABLE territories ADD CONSTRAINT territories_polygon_valid CHECK (ST_IsValid(polygon))"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS territories CASCADE")
    op.execute("DROP TABLE IF EXISTS runs CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
