"""Successful-defense and reminder notification preferences.

The inbox is now the complete in-app event history while these columns control
only whether the matching event also interrupts the user outside the app.

Revision ID: 0039
Revises: 0038
Create Date: 2026-09-01
"""

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS defended "
        "BOOLEAN NOT NULL DEFAULT true"
    )
    op.execute(
        "ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS reminder "
        "BOOLEAN NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS reminder")
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS defended")
