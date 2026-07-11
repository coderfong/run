"""Run comments + club chat messages.

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-11
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS run_comments (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body       TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS run_comments_run_idx ON run_comments(run_id, created_at)")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS clan_messages (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
            body       TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS clan_messages_clan_idx ON clan_messages(clan_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS clan_messages")
    op.execute("DROP TABLE IF EXISTS run_comments")
