"""Hold credit: rank points for ground you keep, not just ground you take.

`POINTS_HOLD` existed in the rank table from the start and was never awarded by
anything — there was no job to award it from and nowhere to record that it had
been. So rank measured taking and losing, but not the third thing a territory
game is actually about: keeping.

`hold_credited_at` is the high-water mark. The scheduled sweep credits any
verified, unexpired territory whose last credit (or creation) is older than
`hold_credit_hours`, then stamps it — so a restarted or double-fired job cannot
pay the same 48 hours twice.

Revision ID: 0025
Revises: 0024
Create Date: 2026-08-06
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE territories ADD COLUMN IF NOT EXISTS hold_credited_at TIMESTAMP")
    # The sweep's own lookup: "what is due a hold credit".
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_territories_hold_credited "
        "ON territories (hold_credited_at NULLS FIRST) WHERE verified"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_territories_hold_credited")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS hold_credited_at")
