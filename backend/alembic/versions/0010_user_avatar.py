"""Store each user's equipped avatar server-side so their character portrait
can render on other people's feeds / cards.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-12
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS avatar")
