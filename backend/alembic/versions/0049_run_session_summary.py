"""Store the client run session's summary on each run.

The client now decides, from evidence, what each stretch of a run was —
running, stopped, a drive, a bike ride, paused — and sends only the accepted
running segments as the route (frontend/src/run/session). It also sends a
summary of that decision: seconds spent in each kind of stretch and the
distance it left out. That summary is evidence for anti-cheat review and for
calibrating the classifier against tester runs. It is never paid on and
never trusted as a metric: distance and duration are recomputed from the
submitted points.

Server-side only, like flag_reasons. Nullable: older clients send none.

Revision ID: 0049
Revises: 0048
"""
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS session_summary JSONB")


def downgrade():
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS session_summary")
