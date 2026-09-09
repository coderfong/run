"""Club runs: one log row per run a club actually ran together.

A run counts for a club only when at least one other member of that club ran
the same route at the same time — the rule and the matching live in
app/club_runs.py. This is the ledger that makes it idempotent: a run is logged
for a club exactly once, so the clubmate who finishes second can pay the club
credit the first finisher went without, and can only pay it once however many
of the group come in after them.

AND IT CLEARS THE CLUB OFF EVERY EXISTING TERRITORY. `territories.clan_id` was
denormalized from the runner at claim time, so every plot ever claimed by
anyone in a club is club land under the old rule and would stay drawn on the
club board under the new one. That land cannot be re-judged: nothing recorded
who anybody ran with, and a plot is not evidence of a route. So it is cleared,
and the club board rebuilds itself out of real group runs — which takes days,
not months, because territory expires anyway.

`clan_season_stats.area_current` is zeroed with it: the club leaderboard ranks
on that column and it is a snapshot of exactly the land being cleared.
`area_peak` is left alone. It is a record of what a club once held, it was
truly held at the time, and rewriting history is not what this migration is
for.

NOT REVERSIBLE in the part that matters. The downgrade drops the table; the
attribution it cleared is gone, because the fact it encoded was never stored
anywhere else.

Revision ID: 0043
Revises: 0042
Create Date: 2026-09-08
"""

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS club_run_logs (
            run_id    UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
            user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            clan_id   UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            partners  INTEGER NOT NULL DEFAULT 1,
            logged_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    # "What has this club been doing?" and "what has this member contributed?"
    # are the two questions asked of the log, and both are asked newest first.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_club_run_logs_clan "
        "ON club_run_logs (clan_id, logged_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_club_run_logs_user "
        "ON club_run_logs (user_id, logged_at DESC)"
    )

    # The cleanup. Every plot on the club board today was put there by the old
    # rule; none of it is evidence that anybody ran together.
    op.execute("UPDATE territories SET clan_id = NULL WHERE clan_id IS NOT NULL")
    op.execute("UPDATE clan_season_stats SET area_current = 0 WHERE area_current <> 0")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS club_run_logs")
