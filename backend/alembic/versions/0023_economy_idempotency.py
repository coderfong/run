"""Economy stabilisation: idempotent rewards, per-run entitlement, claim replay.

Three problems, one migration.

1. REWARDS COULD BE GRANTED TWICE. /end-run paid coins and energy as a side
   effect of being called, and /claim-territory paid XP and rank the same way.
   A retry, a double-tap or two racing requests each paid again, and the only
   evidence afterwards was a balance that looked plausible. `reward_grants`
   makes every payout carry a key derived from the run it came from, so the
   second attempt inserts nothing and pays nothing. Balances are never
   consulted to decide whether a reward already happened.

2. SPLITTING A RUN MULTIPLIED TERRITORY. Area came from a per-run diminishing
   curve, so ten 1 km runs earned ten times the first kilometre's land while
   one 10 km run earned the tapered total. The curve is now a CUMULATIVE daily
   entitlement, which needs each run to remember what it consumed
   (`claim_distance_m`) and what that bought (`claim_area_m2`).

3. NEITHER ENDPOINT COULD BE REPLAYED. Both answered a repeat with 409, so a
   client that lost its response had no way to recover the result. Both now
   store their outcome — `reward_*`/`tier` for the run, `claim_result` for the
   claim — and hand the same answer back.

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    # --- what a finished run decided, kept so it can be replayed -----------
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS tier TEXT")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS gate_reason TEXT")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS reward_coins INTEGER")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS reward_energy INTEGER")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS reward_xp INTEGER")

    # The daily territorial entitlement this run consumed, and the land that
    # bought. Both are frozen at /end-run: a later run must never change what
    # an earlier one was worth, and the claim must land exactly the area its
    # preview promised.
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS claim_distance_m DOUBLE PRECISION")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS claim_area_m2 DOUBLE PRECISION")

    # What the claim turned out to be ("empty"/"reinforce"/"attack"/
    # "fortified"), which is what the neutral-expansion limit counts, and the
    # full response so a retry replays rather than 409s.
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS claim_action TEXT")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS claim_result JSONB")

    # Counting today's neutral claims and today's entitlement are both
    # per-user, per-day scans of this table.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_runs_user_ended "
        "ON runs (user_id, ended_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_runs_user_claimed "
        "ON runs (user_id, claimed_at DESC) WHERE claimed_at IS NOT NULL"
    )

    # --- the idempotency ledger -------------------------------------------
    # `key` is the whole mechanism: 'run:{id}:coins' and friends. An insert
    # that conflicts means the reward already happened, whatever the balance
    # currently says.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reward_grants (
            key TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            run_id UUID,
            kind TEXT NOT NULL,
            amount INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    # Daily caps are "how much of this kind did they already get today".
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reward_grants_user_kind "
        "ON reward_grants (user_id, kind, created_at DESC)"
    )

    # Belt and braces on the coin side: even a caller that bypasses
    # reward_grants cannot write the same run's coins twice.
    #
    # BUT NOT AT THE COST OF THE API. The container boots with
    # `alembic upgrade head && uvicorn ...`, so a migration that raises stops
    # the server from ever starting — a failure here is an outage, not a failed
    # deploy. And this index is exactly the one that can fail: it exists
    # because /end-run double-paid on retries, which means production is the
    # environment most likely to already hold the duplicate rows it forbids.
    #
    # So the duplicates are counted first. Clean data gets the guard; dirty
    # data gets a warning and keeps serving, because `reward_grants` above is
    # the actual mechanism and this was only ever the second lock on the door.
    # Nothing is deleted: the ledger is an audit trail, and quietly dropping
    # rows from it to win an index is not this migration's call to make. Clear
    # the duplicates deliberately, then re-run, to get the guard.
    dupes = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT COUNT(*) FROM ("
                "  SELECT 1 FROM coin_ledger WHERE ref IS NOT NULL"
                "  GROUP BY user_id, reason, ref HAVING COUNT(*) > 1"
                ") d"
            )
        )
        .scalar()
    )
    if dupes:
        print(
            f"[0023] SKIPPING ux_coin_ledger_run_reason: {dupes} duplicate "
            "(user_id, reason, ref) group(s) in coin_ledger. reward_grants "
            "still guards every payout. Dedupe and re-apply to add the index."
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_coin_ledger_run_reason "
            "ON coin_ledger (user_id, reason, ref) WHERE ref IS NOT NULL"
        )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ux_coin_ledger_run_reason")
    op.execute("DROP INDEX IF EXISTS ix_reward_grants_user_kind")
    op.execute("DROP TABLE IF EXISTS reward_grants")
    op.execute("DROP INDEX IF EXISTS ix_runs_user_claimed")
    op.execute("DROP INDEX IF EXISTS ix_runs_user_ended")
    for col in (
        "claim_result", "claim_action", "claim_area_m2", "claim_distance_m",
        "reward_xp", "reward_energy", "reward_coins", "gate_reason", "tier",
    ):
        op.execute(f"ALTER TABLE runs DROP COLUMN IF EXISTS {col}")
