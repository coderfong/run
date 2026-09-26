"""Club runs become a group: sessions, shared metres, live presence.

WHY A TABLE. `club_run_logs` (0043) records that a run counted for a club, one
row per run, and nothing about WHO it was run with. Its `partners` column is
the size of whichever group happened to log the row, not a list, and a third
finisher's row carries no link to the first two at all. The group cannot be
recomputed later either: the matching probe reads CURRENT club membership, so
a partner who has since left the club silently drops out of a run they really
did, and the probe is far too expensive to run for every feed card. So the
group gets written down at the moment it is known.

`club_run_sessions` is the group. `club_run_logs` stays the participant table
(it already is one: run, user, club), and gains the session it belongs to.
There is no second participant ledger to drift from the first.

`club_run_logs.shared_m` is the metres this run spent within tolerance of a
partner, as PostGIS measured it during matching (the larger figure if several
partners were measured). It is the only "km together" the app shows, and it is
NULL for rows logged before this migration because nobody kept the number.

`runs.live_lat/live_lon/live_at` hold the latest fix of a run IN PROGRESS, so a
clubmate's running screen can say "running with Ryan" and a finished runner can
be told a clubmate is still out. They are written by /submit-path, never
returned by any endpoint, and cleared by /end-run: a finished run keeps no live
position at all.

`clan_week_goals.reached_at` dates the moment a weekly goal was hit, so the
club feed can show it as an event. Goals reached before today have no date and
are simply not in the feed.

`notif_prefs.club_run` is the push switch for "your club run is confirmed".

THE BACKFILL groups the club runs already logged, and it is careful about what
it claims. Two logged runs join one session when EITHER
  * they were logged in the same transaction (identical `logged_at`: one
    matching call writes the whole group it found, so this is exact), or
  * they are in the same club, their windows overlap with the matching grace,
    and their paths come within the matching tolerance of each other
    (a third finisher's row is written alone, so this is how it rejoins).
Components of that graph become sessions. A lone row becomes a session of one.
Nothing is paid, attributed or re-judged here: which runs are club runs is
already settled, this only decides which of them go on the same feed card.

Additive and idempotent. The downgrade drops only what this adds.

Revision ID: 0047
Revises: 0046
"""

import uuid

from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None

# Mirrors settings.club_run_time_grace_s / club_run_path_tolerance_m at the
# time of writing. Frozen here on purpose: a migration must mean the same
# thing whenever it runs, whatever the settings say later.
_GRACE_S = 600
_TOL_M = 35.0


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS club_run_sessions (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            started_at TIMESTAMP NOT NULL,
            ended_at   TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    # The feed: "this club's group runs, newest first".
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_club_run_sessions_clan "
        "ON club_run_sessions (clan_id, ended_at DESC)"
    )
    op.execute(
        "ALTER TABLE club_run_logs ADD COLUMN IF NOT EXISTS session_id UUID "
        "REFERENCES club_run_sessions(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE club_run_logs ADD COLUMN IF NOT EXISTS shared_m DOUBLE PRECISION")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_club_run_logs_session ON club_run_logs (session_id)"
    )

    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS live_lat DOUBLE PRECISION")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS live_lon DOUBLE PRECISION")
    op.execute("ALTER TABLE runs ADD COLUMN IF NOT EXISTS live_at TIMESTAMP")
    # Only runs still in progress are ever asked about, and those are few.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_runs_live_open ON runs (live_at) "
        "WHERE ended_at IS NULL AND live_at IS NOT NULL"
    )

    op.execute("ALTER TABLE clan_week_goals ADD COLUMN IF NOT EXISTS reached_at TIMESTAMP")
    op.execute(
        "ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS club_run BOOLEAN NOT NULL DEFAULT true"
    )

    _backfill_sessions(op.get_bind())


def _backfill_sessions(bind):
    rows = bind.execute(
        sa.text(
            """
            SELECT cr.run_id::text, cr.clan_id::text, r.started_at,
                   COALESCE(r.ended_at, r.started_at) AS ended_at, cr.logged_at
            FROM club_run_logs cr
            JOIN runs r ON r.id = cr.run_id
            WHERE cr.session_id IS NULL
            """
        )
    ).fetchall()
    if not rows:
        return

    parent = {r[0]: r[0] for r in rows}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Exact: written by the same matching call.
    by_txn = {}
    for run_id, clan_id, _s, _e, logged_at in rows:
        by_txn.setdefault((clan_id, logged_at), []).append(run_id)
    for group in by_txn.values():
        for other in group[1:]:
            union(group[0], other)

    # A later finisher, written alone: rejoin it on the same evidence the
    # probe used (same club, same time, same streets).
    pairs = bind.execute(
        sa.text(
            """
            SELECT a.run_id::text, b.run_id::text
            FROM club_run_logs a
            JOIN club_run_logs b ON b.clan_id = a.clan_id AND b.run_id > a.run_id
            JOIN runs ra ON ra.id = a.run_id
            JOIN runs rb ON rb.id = b.run_id
            WHERE a.session_id IS NULL AND b.session_id IS NULL
              AND ra.started_at <= COALESCE(rb.ended_at, rb.started_at) + make_interval(secs => :grace)
              AND rb.started_at <= COALESCE(ra.ended_at, ra.started_at) + make_interval(secs => :grace)
              AND ra.path IS NOT NULL AND rb.path IS NOT NULL
              AND ST_DWithin(ra.path::geography, rb.path::geography, :tol)
            """
        ),
        {"grace": _GRACE_S, "tol": _TOL_M},
    ).fetchall()
    for a, b in pairs:
        union(a, b)

    components = {}
    meta = {r[0]: r for r in rows}
    for run_id in parent:
        components.setdefault(find(run_id), []).append(run_id)

    for members in components.values():
        clan_id = meta[members[0]][1]
        started = min(meta[m][2] for m in members)
        ended = max(meta[m][3] for m in members)
        created = min(meta[m][4] for m in members)
        session_id = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO club_run_sessions (id, clan_id, started_at, ended_at, created_at, updated_at) "
                "VALUES (CAST(:id AS uuid), CAST(:c AS uuid), :s, :e, :cr, :cr)"
            ),
            {"id": session_id, "c": clan_id, "s": started, "e": ended, "cr": created},
        )
        bind.execute(
            sa.text(
                "UPDATE club_run_logs SET session_id = CAST(:sid AS uuid) "
                "WHERE run_id = ANY(CAST(:ids AS uuid[]))"
            ),
            {"sid": session_id, "ids": members},
        )


def downgrade():
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS club_run")
    op.execute("ALTER TABLE clan_week_goals DROP COLUMN IF EXISTS reached_at")
    op.execute("DROP INDEX IF EXISTS ix_runs_live_open")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS live_at")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS live_lon")
    op.execute("ALTER TABLE runs DROP COLUMN IF EXISTS live_lat")
    op.execute("DROP INDEX IF EXISTS ix_club_run_logs_session")
    op.execute("ALTER TABLE club_run_logs DROP COLUMN IF EXISTS shared_m")
    op.execute("ALTER TABLE club_run_logs DROP COLUMN IF EXISTS session_id")
    op.execute("DROP TABLE IF EXISTS club_run_sessions")
