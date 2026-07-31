"""Ranks — territorial points that portrait borders now hang off.

Borders used to be derived from `level`, which comes from distance XP. That
meant the most visible badge in the game measured treadmill time rather than
competitive standing. Points here come only from taking, holding and
defending ground.

Three columns on users:
  rank_points       current balance (decays with inactivity)
  rank_points_at    when points were last EARNED — decay is measured from
                    this lazily on read, so there's no cron job
  rank_best         high-water tier index; a quiet month costs you the badge
                    you wear, never the one you reached

Existing accounts are seeded from level (12 * level^2, so level 50 lands
exactly on Mythic at 30000). Without that everyone would drop to Wood on
deploy, since territory_steals only started recording at 0016 and there's no
history to replay.

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-31
"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_points INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_points_at TIMESTAMP")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_best INTEGER NOT NULL DEFAULT 0")

    # Audit trail: answers "why did my rank move" and lets the points curve be
    # retuned later by replaying events rather than guessing.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rank_events (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rank_events_user "
        "ON rank_events (user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_rank_points "
        "ON users (rank_points DESC)"
    )

    # Seed from level. floor(sqrt(xp/100)) mirrors level_from_xp exactly.
    op.execute(
        """
        UPDATE users
           SET rank_points = (12 * FLOOR(SQRT(COALESCE(xp, 0) / 100.0)) ^ 2)::int,
               rank_points_at = now()
         WHERE COALESCE(rank_points, 0) = 0
           AND COALESCE(xp, 0) > 0
        """
    )
    # rank_best starts at whatever that seed earned.
    op.execute(
        """
        UPDATE users SET rank_best = (
            CASE
              WHEN rank_points >= 30000 THEN 9 WHEN rank_points >= 21000 THEN 8
              WHEN rank_points >= 14000 THEN 7 WHEN rank_points >= 9000  THEN 6
              WHEN rank_points >= 5500  THEN 5 WHEN rank_points >= 3000  THEN 4
              WHEN rank_points >= 1500  THEN 3 WHEN rank_points >= 700   THEN 2
              WHEN rank_points >= 250   THEN 1 ELSE 0
            END)
        """
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS rank_events")
    op.execute("DROP INDEX IF EXISTS ix_users_rank_points")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS rank_best")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS rank_points_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS rank_points")
