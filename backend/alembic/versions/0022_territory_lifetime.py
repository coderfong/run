"""Territory lifetime stops being a pace multiplier.

Lifetime used to be derived: `strength * 4 days`, where strength came straight
off pace (0.6-2.0). That gave pace a triple benefit — it decided how much land
you took, whether you could take defended ground, AND whether your land lived
2.4 days or 8. A slower runner's territory was worse in every dimension at
once, which is not something a fitness app should tell anyone.

Lifetime is now computed at claim time from effort and upkeep (base + distance
+ reinforcements, with pace worth at most half a day) and STORED, so it is no
longer a function of strength at all. Two columns:

  expires_at      when this territory decays. Every "is it still alive" query
                  reads this instead of recomputing from strength.
  reinforcements  how many times the owner has re-run over this ground, which
                  is what extends the life — and, from 0023 onward, what the
                  diminishing-returns strength curve will key off.

Existing rows are backfilled with the OLD rule so nothing expires early or
late on deploy: whatever lifetime they had before this migration, they keep.

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-05
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE territories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP")
    op.execute(
        "ALTER TABLE territories ADD COLUMN IF NOT EXISTS reinforcements "
        "INTEGER NOT NULL DEFAULT 0"
    )

    # Backfill on the old rule (strength x 4 days from creation), so live land
    # keeps exactly the expiry it already had. GREATEST(strength, 0.1) mirrors
    # the guard the old sweep used against a zero-strength row living forever.
    op.execute(
        """
        UPDATE territories
           SET expires_at = created_at
                          + make_interval(secs => GREATEST(strength, 0.1) * 4 * 86400)
         WHERE expires_at IS NULL
        """
    )

    # Every decay check is "expires_at > now()" now, and the map reads it for
    # the fade-as-it-ages effect, so it is worth an index.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_territories_expires_at "
        "ON territories (expires_at)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_territories_expires_at")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS reinforcements")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS expires_at")
