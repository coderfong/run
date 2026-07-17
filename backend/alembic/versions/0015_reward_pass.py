"""Two-track reward pass: tap-to-claim rewards + the premium track.

- reward_claims: one row per (user, level, track) claim. Rewards used to be
  auto-granted on level-up; now the player taps each tier to collect it, so
  claims need persisting. UNIQUE makes a double-tap (or a replayed request)
  a conflict instead of a double grant.

- users.premium_pass: whether the premium track is unlocked (one-time IAP —
  the ladder is career-permanent, so the pass is too, not seasonal).

- Backfill: lootboxes for levels <= reward_level were already auto-granted by
  the old sync_level_rewards, so mark every free tier up to reward_level as
  claimed. Without this, existing players could re-claim (and re-receive)
  every lootbox they were already given.

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-17
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reward_claims (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            level      INT  NOT NULL,
            track      TEXT NOT NULL,
            claimed_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT reward_claims_track CHECK (track IN ('free', 'premium')),
            UNIQUE (user_id, level, track)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS reward_claims_user_idx ON reward_claims(user_id)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_pass BOOLEAN NOT NULL DEFAULT false")
    op.execute(
        """
        INSERT INTO reward_claims (user_id, level, track)
        SELECT u.id, gs.level, 'free'
        FROM users u
        CROSS JOIN LATERAL generate_series(1, COALESCE(u.reward_level, 0)) AS gs(level)
        WHERE COALESCE(u.reward_level, 0) > 0
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS premium_pass")
    op.execute("DROP TABLE IF EXISTS reward_claims")
