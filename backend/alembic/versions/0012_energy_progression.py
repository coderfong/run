"""Energy + progression: per-user energy meter, level-reward bookkeeping, and
a persistence table for random (lootbox-granted) unlocks.

- users.energy / energy_updated_at: the claim-gating energy meter (lazy regen).
- users.reward_level: highest level whose rewards were already granted, so
  level-up lootboxes are handed out exactly once.
- user_unlocks: persists things that are NOT derivable from level — lootbox
  tokens and the random cosmetics rolled out of them. (Borders/shapes/FX are
  deterministic from level and don't need a row.)

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-14
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS energy INTEGER NOT NULL DEFAULT 100")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMP NOT NULL DEFAULT now()")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS reward_level INTEGER NOT NULL DEFAULT 0")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_unlocks (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind       TEXT NOT NULL,               -- 'lootbox' | 'cosmetic'
            item_id    TEXT NOT NULL,               -- rarity for lootbox, cosmetic id otherwise
            opened     BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS user_unlocks_user_idx ON user_unlocks(user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_unlocks")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS reward_level")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS energy_updated_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS energy")
