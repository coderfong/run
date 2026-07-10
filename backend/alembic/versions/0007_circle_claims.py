"""Circle claims: a run converts to a circle (circumference = distance) the
runner places along their trail after the run. runs.claimed_at marks that the
run's claim has been placed — sticky even after territory rows merge.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-10
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS claimed_at")
