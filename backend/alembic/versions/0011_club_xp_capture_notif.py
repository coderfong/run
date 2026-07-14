"""Club XP + capture (attacker-side) notification preference.

- clans.xp: a running total advanced whenever a member earns XP (distance,
  claims, steals), so a club has its own progression alongside the season.
- notif_prefs.captured: the attacker side of a territory take. The victim
  already gets `stolen`; this lets the runner who took the land be notified
  too (both sides), gated by their own preference.

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-14
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE clans ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS captured BOOLEAN NOT NULL DEFAULT true")


def downgrade() -> None:
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS captured")
    op.execute("ALTER TABLE clans DROP COLUMN IF EXISTS xp")
