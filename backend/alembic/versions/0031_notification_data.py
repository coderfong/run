"""Attach structured event context to notifications.

Capture alerts need more than copy: the client needs the exact area, map
position and a stable event id to animate the attack once and take the owner
back to the affected land. A JSON object keeps that context useful for future
notification categories without adding one nullable column per event type.

Revision ID: 0031
Revises: 0030
Create Date: 2026-08-11
"""

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB "
        "NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS data")
