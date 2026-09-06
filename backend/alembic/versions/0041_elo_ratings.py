"""Add zero-sum solo and club Elo ratings.

Revision ID: 0041
Revises: 0040
Create Date: 2026-09-06
"""

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in (
        "solo_elo INTEGER NOT NULL DEFAULT 1000",
        "solo_elo_peak INTEGER NOT NULL DEFAULT 1000",
        "solo_elo_matches INTEGER NOT NULL DEFAULT 0",
        "solo_elo_wins INTEGER NOT NULL DEFAULT 0",
        "solo_elo_losses INTEGER NOT NULL DEFAULT 0",
        "solo_elo_draws INTEGER NOT NULL DEFAULT 0",
    ):
        op.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {column}")
    for column in (
        "elo_rating INTEGER NOT NULL DEFAULT 1000",
        "elo_peak INTEGER NOT NULL DEFAULT 1000",
        "elo_matches INTEGER NOT NULL DEFAULT 0",
        "elo_wins INTEGER NOT NULL DEFAULT 0",
        "elo_losses INTEGER NOT NULL DEFAULT 0",
        "elo_draws INTEGER NOT NULL DEFAULT 0",
    ):
        op.execute(f"ALTER TABLE clans ADD COLUMN IF NOT EXISTS {column}")

    # Preserve established players' relative standing instead of resetting the
    # whole live ladder to a 1000 tie. Future movement is pure Elo; this is a
    # one-time launch seed from the old territorial-points high water.
    op.execute(
        """
        UPDATE users SET solo_elo = CASE
            WHEN rank_points >= 30000 THEN 2450
            WHEN rank_points >= 21000 THEN 2200
            WHEN rank_points >= 14000 THEN 2000
            WHEN rank_points >=  9000 THEN 1850
            WHEN rank_points >=  5500 THEN 1700
            WHEN rank_points >=  3000 THEN 1550
            WHEN rank_points >=  1500 THEN 1400
            WHEN rank_points >=   700 THEN 1250
            WHEN rank_points >=   250 THEN 1100
            ELSE 1000 END
        """
    )
    op.execute("UPDATE users SET solo_elo_peak = solo_elo")
    # Existing rivalry rows give honest W/L totals even though the old point
    # exchanges cannot be replayed chronologically into a new Elo ladder.
    op.execute(
        """
        UPDATE users u SET
          solo_elo_matches = x.matches,
          solo_elo_wins = x.wins,
          solo_elo_losses = x.losses
        FROM (
          SELECT u2.id,
            COUNT(s.id)::int AS matches,
            COUNT(s.id) FILTER (WHERE (s.attacker_id=u2.id AND NOT s.defended)
                                     OR (s.victim_id=u2.id AND s.defended))::int AS wins,
            COUNT(s.id) FILTER (WHERE (s.attacker_id=u2.id AND s.defended)
                                     OR (s.victim_id=u2.id AND NOT s.defended))::int AS losses
          FROM users u2
          JOIN territory_steals s ON s.attacker_id=u2.id OR s.victim_id=u2.id
          GROUP BY u2.id
        ) x WHERE x.id=u.id
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS elo_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
          scope TEXT NOT NULL CHECK (scope IN ('solo','club')),
          user_a_id UUID REFERENCES users(id) ON DELETE CASCADE,
          user_b_id UUID REFERENCES users(id) ON DELETE CASCADE,
          clan_a_id UUID REFERENCES clans(id) ON DELETE CASCADE,
          clan_b_id UUID REFERENCES clans(id) ON DELETE CASCADE,
          score_a DOUBLE PRECISION NOT NULL CHECK (score_a BETWEEN 0 AND 1),
          delta_a INTEGER NOT NULL,
          rating_a_before INTEGER NOT NULL,
          rating_b_before INTEGER NOT NULL,
          rating_a_after INTEGER NOT NULL,
          rating_b_after INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT timezone('utc', now()),
          CONSTRAINT elo_events_scope_ids CHECK (
            (scope='solo' AND user_a_id IS NOT NULL AND user_b_id IS NOT NULL
                          AND clan_a_id IS NULL AND clan_b_id IS NULL)
            OR
            (scope='club' AND clan_a_id IS NOT NULL AND clan_b_id IS NOT NULL
                          AND user_a_id IS NULL AND user_b_id IS NULL)
          )
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_solo_elo ON users (solo_elo DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_clans_elo ON clans (elo_rating DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_elo_events_run ON elo_events (run_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_elo_events_users ON elo_events (user_a_id, user_b_id, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_elo_events_clans ON elo_events (clan_a_id, clan_b_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS elo_events")
    op.execute("DROP INDEX IF EXISTS ix_clans_elo")
    op.execute("DROP INDEX IF EXISTS ix_users_solo_elo")
    for column in ("elo_draws", "elo_losses", "elo_wins", "elo_matches", "elo_peak", "elo_rating"):
        op.execute(f"ALTER TABLE clans DROP COLUMN IF EXISTS {column}")
    for column in ("solo_elo_draws", "solo_elo_losses", "solo_elo_wins", "solo_elo_matches", "solo_elo_peak", "solo_elo"):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {column}")
