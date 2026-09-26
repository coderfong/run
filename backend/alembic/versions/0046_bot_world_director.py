"""State for the seeded-world activity director (bot_director.py).

Additive only: two new tables and two indexes. Nothing existing is altered,
backfilled or deleted, so this is safe on a live database with any amount of
bot or human data in it.

`bot_world_intents` is the director's memory between cron ticks. A human claim
schedules possible reactions hours or days ahead ("a rival may probe this edge
in 2-8 h"), and a reaction has to survive the process that scheduled it. Each
row is one thing the world MIGHT do, and it resolves to exactly one of:

    done     a bot ran it — `run_id` points at the real run it produced
    skipped  a rule stopped it (cooldown, saturation, no eligible bot), with
             the reason, so an empty world can be explained from the table
    expired  its window closed before it could run

The resolved rows double as the per-pair and per-human cooldown ledger: a bot
that ran at a human and missed every border still "interacted" for cooldown
purposes, and territory_steals only records the overlaps.

(source, stage) is unique so a tick that dies and reruns cannot schedule the
same reaction to the same claim twice.

`bot_hotspots` holds the few areas that are running hot right now. Stored
rather than derived so that a hotspot keeps its place and its end time across
ticks, and so the dry run and the logs can say where they are.

The two indexes serve the director's rolling one-hour counts, which read the
whole world's recent claims and steals rather than one runner's.

Revision ID: 0046
Revises: 0045
"""
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS bot_world_intents (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind           TEXT NOT NULL,
            stage          TEXT NOT NULL DEFAULT '',
            source         TEXT NOT NULL,
            target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            bot_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
            lat            DOUBLE PRECISION,
            lon            DOUBLE PRECISION,
            region_key     TEXT,
            due_at         TIMESTAMP NOT NULL,
            expires_at     TIMESTAMP NOT NULL,
            status         TEXT NOT NULL DEFAULT 'pending',
            reason         TEXT,
            run_id         UUID REFERENCES runs(id) ON DELETE SET NULL,
            outcome        JSONB,
            created_at     TIMESTAMP NOT NULL DEFAULT timezone('utc', now()),
            resolved_at    TIMESTAMP,
            CONSTRAINT bot_world_intents_status
                CHECK (status IN ('pending', 'done', 'skipped', 'expired')),
            CONSTRAINT bot_world_intents_once UNIQUE (source, stage)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bot_intents_due "
        "ON bot_world_intents (due_at) WHERE status = 'pending'"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bot_intents_target "
        "ON bot_world_intents (target_user_id, resolved_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bot_intents_pair "
        "ON bot_world_intents (bot_user_id, target_user_id, resolved_at DESC)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS bot_hotspots (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            region_key  TEXT,
            lat         DOUBLE PRECISION NOT NULL,
            lon         DOUBLE PRECISION NOT NULL,
            radius_m    DOUBLE PRECISION NOT NULL,
            multiplier  DOUBLE PRECISION NOT NULL,
            label       TEXT,
            starts_at   TIMESTAMP NOT NULL,
            ends_at     TIMESTAMP NOT NULL,
            created_at  TIMESTAMP NOT NULL DEFAULT timezone('utc', now())
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_bot_hotspots_ends ON bot_hotspots (ends_at)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_runs_claimed_at ON runs (claimed_at) "
        "WHERE claimed_at IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_steals_created ON territory_steals (created_at)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_steals_created")
    op.execute("DROP INDEX IF EXISTS ix_runs_claimed_at")
    op.execute("DROP TABLE IF EXISTS bot_hotspots")
    op.execute("DROP TABLE IF EXISTS bot_world_intents")
