"""PASERBY — crossed paths between two runners who were in the same place at
the same time, discovered after both runs have ended.

Five tables, one column, and a rule about what may never be stored.

- `run_traces` is the only new location data, and it is INTERNAL. A finished,
  verified, qualifying run is sampled down to a point every ~25 seconds and the
  samples are kept for a couple of days so a later run can be matched against
  them. Nothing reads this table except the matcher; no endpoint returns a row
  from it. It is derived entirely from `runs.path`, which the app already
  stores, so it adds no new class of data — only a shorter-lived, indexable
  copy of it. `ST_DWithin` on the geography column with a GIST index is what
  makes matching a bounded index probe rather than a nested scan of every GPS
  point against every other.

- `paserby_encounters` deliberately has NO coordinate and NO crossing time.
  The date is stored as a DATE (which is as precise as the API is allowed to
  be: "earlier today" / "yesterday" / "this week"), and `created_at` exists for
  ordering and sweeps but is never serialised. Ordered pair (`user_a_id` <
  `user_b_id`) plus the unique index on the run pair is what makes one crossing
  produce exactly one row whichever run is processed first.

- `paserby_pairs` is the familiar-faces counter and the 24h cooldown, keyed on
  the ordered pair so a duplicate summary cannot exist.

- `paserby_settings` is the "Allow Crossed Paths" switch. Absent row = the
  configured default (settings.paserby_default_enabled).

- `user_blocks` / `user_reports` are general-purpose, not PASERBY-specific:
  blocking is a property of two accounts, and the matcher, the encounter list
  and any future social surface all read the same table.

Chained AFTER the route-privacy pass rather than beside it, because the matcher
honours both of its controls: a run marked `private` is never matched, and
samples inside a runner's privacy zones are never written at all. It therefore
sits at the head of that chain (0024 → 0025 → 0026 → here) instead of forking
beside it.

Revision ID: 0027
Revises: 0026
Create Date: 2026-08-06
"""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- internal, short-lived trace samples --------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS run_traces (
            id      BIGSERIAL PRIMARY KEY,
            run_id  UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            at      TIMESTAMP NOT NULL,
            geog    geography(POINT, 4326) NOT NULL
        )
        """
    )
    # The matcher narrows by TIME first (a couple of hundred rows), then probes
    # the spatial index. Both halves need their own index or the join degrades
    # into the full-table comparison this feature must never do.
    op.execute("CREATE INDEX IF NOT EXISTS ix_run_traces_at ON run_traces (at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_run_traces_geog ON run_traces USING GIST (geog)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_run_traces_run ON run_traces (run_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_run_traces_user ON run_traces (user_id)")

    # --- the switch ---------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS paserby_settings (
            user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            enabled    BOOLEAN NOT NULL DEFAULT true,
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )

    # --- encounters ---------------------------------------------------------
    # user_a_id < user_b_id ALWAYS, so "have these two already met from these
    # two runs" is one index lookup and cannot be defeated by argument order.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS paserby_encounters (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_a_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            run_a_id           UUID REFERENCES runs(id) ON DELETE SET NULL,
            run_b_id           UUID REFERENCES runs(id) ON DELETE SET NULL,
            -- The BROAD date, which is the most precise thing the API may say.
            -- No coordinate and no crossing time are stored, here or anywhere.
            encounter_date     DATE NOT NULL,
            created_at         TIMESTAMP NOT NULL DEFAULT now(),
            user_a_seen_at     TIMESTAMP,
            user_b_seen_at     TIMESTAMP,
            user_a_hidden_at   TIMESTAMP,
            user_b_hidden_at   TIMESTAMP,
            user_a_high_five_at TIMESTAMP,
            user_b_high_five_at TIMESTAMP,
            status             TEXT NOT NULL DEFAULT 'active',
            CONSTRAINT paserby_encounters_ordered CHECK (user_a_id < user_b_id),
            CONSTRAINT paserby_encounters_status
                CHECK (status IN ('active', 'removed'))
        )
        """
    )
    # One row per pair of runs — the same crossing processed from either side
    # collides here instead of creating a second encounter.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS paserby_encounters_runs_idx "
        "ON paserby_encounters (run_a_id, run_b_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS paserby_encounters_a_idx "
        "ON paserby_encounters (user_a_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS paserby_encounters_b_idx "
        "ON paserby_encounters (user_b_id, created_at DESC)"
    )

    # --- pair summary (familiar faces + the cooldown) -----------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS paserby_pairs (
            lower_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            higher_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            encounter_count   INTEGER NOT NULL DEFAULT 0,
            last_encounter_at TIMESTAMP,
            PRIMARY KEY (lower_user_id, higher_user_id),
            CONSTRAINT paserby_pairs_ordered CHECK (lower_user_id < higher_user_id)
        )
        """
    )

    # --- blocking + reporting (general, not PASERBY-specific) ---------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_blocks (
            blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            PRIMARY KEY (blocker_id, blocked_id),
            CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
        )
        """
    )
    # The matcher asks "is either direction blocked", so the reverse side needs
    # its own index as well as the primary key.
    op.execute(
        "CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_reports (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reported_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            surface      TEXT NOT NULL DEFAULT 'paserby',
            reason       TEXT NOT NULL,
            detail       TEXT,
            encounter_id UUID REFERENCES paserby_encounters(id) ON DELETE SET NULL,
            created_at   TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT user_reports_not_self CHECK (reporter_id <> reported_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS user_reports_reported_idx "
        "ON user_reports (reported_id, created_at DESC)"
    )

    # --- has this run been matched yet? -------------------------------------
    # The matching runs off the request path, but the reveal endpoint has to be
    # able to force it (a background task that never ran must not cost a runner
    # their encounters). This stamp is what makes that safe to ask for twice.
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS paserby_at TIMESTAMP")

    # High fives are muted like every other push category.
    op.execute(
        "ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS paserby BOOLEAN NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS paserby")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS paserby_at")
    op.execute("DROP TABLE IF EXISTS user_reports")
    op.execute("DROP TABLE IF EXISTS user_blocks")
    op.execute("DROP TABLE IF EXISTS paserby_pairs")
    op.execute("DROP TABLE IF EXISTS paserby_encounters")
    op.execute("DROP TABLE IF EXISTS paserby_settings")
    op.execute("DROP TABLE IF EXISTS run_traces")
