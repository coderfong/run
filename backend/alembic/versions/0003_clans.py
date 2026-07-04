"""Clans groundwork for v1.1: clans table, users.clan_id, territories.clan_id.

No gameplay change in v1 — territories.clan_id is denormalized at claim
time from the runner so clan leaderboards are a single aggregate.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-05
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE clans (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name         TEXT UNIQUE NOT NULL
                         CHECK (char_length(name) BETWEEN 3 AND 32),
            tag          TEXT UNIQUE NOT NULL
                         CHECK (char_length(tag) BETWEEN 2 AND 5),
            color_fill   TEXT NOT NULL,
            color_stroke TEXT NOT NULL,
            color_glow   TEXT NOT NULL,
            created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at   TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN clan_id UUID REFERENCES clans(id) ON DELETE SET NULL
        """
    )
    op.execute("CREATE INDEX users_clan_idx ON users(clan_id)")
    op.execute(
        """
        ALTER TABLE territories
        ADD COLUMN clan_id UUID REFERENCES clans(id) ON DELETE SET NULL
        """
    )
    op.execute("CREATE INDEX territories_clan_idx ON territories(clan_id)")


def downgrade() -> None:
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS clan_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS clan_id")
    op.execute("DROP TABLE IF EXISTS clans")
