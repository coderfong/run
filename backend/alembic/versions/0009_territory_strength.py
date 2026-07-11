"""Territory strength: pace-based claim strength that stacks when the same
user re-claims over their land (union sums strength) and when clubmates'
territories overlap (combined defense). Steals now require attacker
strength > defender strength in the contested overlap.

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-11
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE territories ADD COLUMN IF NOT EXISTS strength DOUBLE PRECISION NOT NULL DEFAULT 1"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS strength")
