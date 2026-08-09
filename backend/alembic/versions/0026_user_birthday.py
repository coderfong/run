"""Birthday on the server, so young accounts can be protected by default.

Onboarding has always asked for a birthday, but it was written to AsyncStorage
and never left the phone. That made age-aware privacy impossible to enforce:
the one place that decides what a route publishes — the server — did not know
whether it was publishing a child's route.

Stored as a DATE and used for exactly one thing (see `privacy.load`): raising
the FLOOR on route trimming and the publish delay for under-18 accounts. Not a
default they can lower — a floor.

Revision ID: 0026
Revises: 0025
Create Date: 2026-08-06
"""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE")


def downgrade():
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS birthday")
