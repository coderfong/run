"""Daily mission claims.

ONE TABLE, AND ONLY CLAIMS. Mission progress is derived from `runs`,
`territory_steals`, `rank_events` and `coin_ledger` on every read (see
app/missions.py for why), so there is nothing here recording what a player did
today. The only fact that cannot be re-derived from play is which rewards were
already handed over, and that is exactly what this stores.

The all-four day bonus shares the table under the reserved mission id
`day_bonus`, so a day needs no second row shape and the unique index covers
both against double claims.

`day` is the LOCAL date on the economy's day boundary, not a UTC date. The
route computes it; storing a plain DATE keeps the unique index doing the work.

Revision ID: 0042
Revises: 0041
Create Date: 2026-09-07
"""

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mission_claims (
            id         BIGSERIAL PRIMARY KEY,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day        DATE NOT NULL,
            mission_id TEXT NOT NULL,
            reward     INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    # The double claim guard. Checking before inserting would let two taps
    # race through; this is what actually decides which one pays.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_mission_claims_one "
        "ON mission_claims (user_id, day, mission_id)"
    )
    # The week strip asks for seven days of one player at a time.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_mission_claims_user_day "
        "ON mission_claims (user_id, day)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mission_claims")
