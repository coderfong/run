"""Bring the existing seeded world onto the denser activity cadence.

The scheduling policy lives in bot_world.py, but rows already scheduled under
the old 1-4 day policy would otherwise take up to four days to encounter it.
Pull only later runs into the next 18 hours; a bot already due sooner is never
postponed. Once each bot runs, bot_activity.py owns its schedule again.

Revision ID: 0040
Revises: 0039
Create Date: 2026-09-03
"""

from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE bot_accounts
        SET next_run_at = LEAST(
            next_run_at,
            timezone('utc', now()) + random() * interval '18 hours'
        )
        """
    )


def downgrade() -> None:
    # Scheduling timestamps are ephemeral state. Restoring stale pre-upgrade
    # times would be less correct than leaving the current schedule intact.
    pass
