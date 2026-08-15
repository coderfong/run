"""Seeded/bot players: a populated world without waiting for real users.

`users.is_bot` marks an account as non-human so the rest of the app can tell
it apart where that matters (bot victims don't get push notifications nobody
will read; bots never show up as a real person to add as a paser). `bot_accounts`
holds the small amount of state a bot needs between cron ticks: where it
"lives" (so its claims stay near a home patch instead of teleporting around
Singapore), when it is next due to go on a run, and whether it is one of the
bots allowed to raid a real player's territory rather than only its own
neighbourhood.

Revision ID: 0036
Revises: 0033
Create Date: 2026-08-15
"""

from alembic import op

revision = "0036"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS bot_accounts (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            home_lat DOUBLE PRECISION NOT NULL,
            home_lon DOUBLE PRECISION NOT NULL,
            region_key TEXT,
            attacker BOOLEAN NOT NULL DEFAULT false,
            next_run_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bot_accounts_next_run_at ON bot_accounts (next_run_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bot_accounts")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_bot")
