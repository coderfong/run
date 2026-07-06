"""PACER feature layer: XP, notifications inbox, clan join requests.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-07
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # XP: awarded on verified end-run (distance + claims + steals).
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0")

    # In-app notifications inbox (the bell). Rows are written whenever a push
    # is sent, so the inbox and push stay consistent.
    op.execute(
        """
        CREATE TABLE notifications (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category   TEXT NOT NULL,
            title      TEXT NOT NULL,
            body       TEXT NOT NULL,
            read       BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC)")

    # Join requests for invite-only clans (officer+ approves/denies).
    op.execute(
        """
        CREATE TABLE clan_join_requests (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status     TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            UNIQUE (clan_id, user_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS clan_join_requests")
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS xp")
