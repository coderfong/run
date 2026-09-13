"""Record land that runs out of time in the territory event log.

0038 left expiry out on purpose, and its reason does not hold. It said land
that decays is never deleted, so the end of a hold was already written on the
territory row. The row does not survive: the hourly sweep (`sweep.py`) and the
local sweep at claim time both DELETE expired territory, so an hour after a
plot faded there was no trace it had ever been held.

The runner's own land page (GET /me/territory) needs that trace. Fading is one
of the three ways ground ends, beside being taken and being held, and a list
that drops a plot without saying why reads as a bug.

So `expire` joins the kinds. The actor is the runner whose ground ran out, the
victim stays NULL because nobody took it (the victim constraint already allows
exactly that), and `created_at` is the moment the land expired rather than the
moment a sweep got round to it.

Nothing is backfilled because nothing can be: those rows were deleted.

Revision ID: 0045
Revises: 0044
"""
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE territory_events DROP CONSTRAINT IF EXISTS territory_events_kind")
    op.execute(
        "ALTER TABLE territory_events ADD CONSTRAINT territory_events_kind "
        "CHECK (kind IN ('claim', 'steal', 'defend', 'reinforce', 'expire'))"
    )


def downgrade():
    op.execute("DELETE FROM territory_events WHERE kind = 'expire'")
    op.execute("ALTER TABLE territory_events DROP CONSTRAINT IF EXISTS territory_events_kind")
    op.execute(
        "ALTER TABLE territory_events ADD CONSTRAINT territory_events_kind "
        "CHECK (kind IN ('claim', 'steal', 'defend', 'reinforce'))"
    )
