"""Add editable captions and photos to run posts.

Revision ID: 0033
Revises: 0032
Create Date: 2026-08-13
"""

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS caption TEXT")
    op.execute(
        "ALTER TABLE runs ADD COLUMN IF NOT EXISTS post_media JSONB NOT NULL DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS post_media")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS caption")
