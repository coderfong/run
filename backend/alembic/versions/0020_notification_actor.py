"""Notifications remember WHO did the thing.

Every row in the inbox was a category icon and two lines of text, so a kudos
from a rival and a kudos from a clubmate looked identical. The inbox is a
social surface in a game about people taking your land — it should show their
face. `actor_id` is the user who caused the notification (the runner who took
your ground, gave you kudos, commented, sent a paser request); it is NULL for
the system ones (season, weekly recap, your own capture confirmation).

ON DELETE SET NULL, not CASCADE: a deleted account must not silently erase the
history of what it did to you.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-05
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id UUID "
        "REFERENCES users(id) ON DELETE SET NULL"
    )


def downgrade():
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS actor_id")
