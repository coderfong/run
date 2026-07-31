"""Rivalries: a per-event ledger of land taken between two runners.

Until now a steal left no trace: `_claim_territory` reshaped the loser's
polygon, returned a total + the biggest victim's name for the result screen,
and that was it. Head-to-head history ("Kai has taken 0.6 km² from you across
4 attacks") was therefore unrecoverable — the map only ever shows the current
state.

`territory_steals` records one row per (claim, victim) pair, including the
attacks that FAILED (`defended = true`), which is what makes a defence stat
possible later. Rows are immutable; nothing reads them transactionally, so a
future retention sweep can trim old ones without breaking gameplay.

No backfill is possible — past steals were never recorded. Rivalries start
accumulating from this deploy.

Revision ID: 0016
Revises: 0015
Create Date: 2026-07-27
"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS territory_steals (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            attacker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            victim_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
            area_m2     DOUBLE PRECISION NOT NULL,
            -- true = the victim's land held (attack bounced off their strength)
            defended    BOOLEAN NOT NULL DEFAULT FALSE,
            -- where the claim was dropped, so the client can fly the map there
            lat         DOUBLE PRECISION,
            lon         DOUBLE PRECISION,
            created_at  TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT territory_steals_not_self CHECK (attacker_id <> victim_id)
        )
        """
    )
    # The rivals list reads "every event involving me, newest first", then
    # groups by the other runner — so both directions need their own index.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_steals_attacker ON territory_steals (attacker_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_steals_victim ON territory_steals (victim_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_steals_pair ON territory_steals (attacker_id, victim_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS territory_steals")
