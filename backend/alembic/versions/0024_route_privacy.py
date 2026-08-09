"""Route privacy: private zones, endpoint trimming, per-run visibility.

The map is the product, but a GPS trace is a home address. Two endpoints were
handing the raw path of any run to any authenticated caller — `GET /runs/{id}`
returned the full unsimplified LineString, and `/feed` a lightly simplified one
— so reading where someone lives took one request and no privileges at all.

Three controls, smallest first:

  * `route_trim_m`   — metres cut off BOTH ends of a route before anyone else
                       sees it. On by default, because the first and last
                       hundred metres are the whole problem and a default that
                       protects nobody is not a default.
  * `privacy_zones`  — circles the runner draws around home, school or work.
                       Any part of a route inside one is never published.
  * `runs.visibility` — 'public' | 'private'. A private run still records, still
                       claims territory, still counts for every total; its route
                       is simply never shown to anyone else.

The territory polygon is deliberately untouched: it is the game, and it is
already a coarse shape. What it must not do is start where the runner sleeps.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-06
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    # Metres trimmed from each end of a published route. NULL means "never
    # set", which `privacy.effective_trim_m` reads as the default rather than
    # as zero — an existing account must not be published in full because it
    # predates the column.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS route_trim_m INTEGER")
    # [{"lat": .., "lon": .., "radius_m": .., "label": ".."}]
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_zones JSONB")
    # Withhold a route from others for this many hours after the run ends, so
    # "who is out right now, and where" is not a query anyone can run.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS route_publish_delay_h INTEGER")

    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_runs_visibility ON runs (visibility) "
        "WHERE visibility <> 'public'"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_runs_visibility")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS visibility")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS route_publish_delay_h")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS privacy_zones")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS route_trim_m")
