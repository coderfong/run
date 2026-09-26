"""Club battles: the facts the rest of the game needs to tell a club story.

0047 wrote down which runs were one club run. This adds what every surface
OUTSIDE the club page needs to say what those runs did to other clubs.

1. WHOSE CLUB THE GROUND BELONGED TO. `territory_events` names the victim but
   not their club, and a runner can change clubs, so "PASER Crew held" cannot
   be rebuilt from today's membership. `victim_clan_id` is the defender's club
   at the moment of the beat: MEMBERSHIP, not the club stamped on the plot,
   because membership is what combat reads (clubmates' land stacks its
   defence, and a club's rating moves on it: `elo.record_claim_matches`).

   Backfilled only where it is certain: `clan_members.user_id` is unique and
   carries `joined_at`, so a victim whose current membership began before the
   beat was in that club when it happened. Anyone else stays NULL, which every
   reader treats as a solo defender.

   The ATTACKER's club is deliberately not stored. It is the club the run
   counted for, which `club_run_logs` already answers, and for the first
   finisher of a club run that answer arrives after their claim. Reading it
   through the log means the history tells the truth once it is known.

2. ONE INBOX ROW PER GROUPED EVENT. `notifications.dedupe_key` lets the second
   clubmate's claim in the same club run update the row the first one wrote
   ("PASER Crew captured 18,420 m²" grows) instead of sending a second push.

3. `notif_prefs.club_battles`, the push switch for club battle alerts
   (attacked, captured, defended), defaulting on like every other category.
   Club run confirmations keep their own switch from 0047.

All additive; old code keeps working against it.

Revision ID: 0048
Revises: 0047
"""

from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE territory_events ADD COLUMN IF NOT EXISTS victim_clan_id UUID "
        "REFERENCES clans(id) ON DELETE SET NULL"
    )
    op.execute(
        """
        UPDATE territory_events te
        SET victim_clan_id = cm.clan_id
        FROM clan_members cm
        WHERE te.victim_id IS NOT NULL
          AND te.victim_clan_id IS NULL
          AND cm.user_id = te.victim_id
          AND cm.joined_at <= te.created_at
        """
    )
    # "Every beat against this club": club rivals and the club's own history.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_terr_events_victim_clan "
        "ON territory_events (victim_clan_id, created_at DESC) "
        "WHERE victim_clan_id IS NOT NULL"
    )
    # "Every beat this club run made": the attacker side is found through
    # `run_id`, which had no index of its own.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_terr_events_run "
        "ON territory_events (run_id) WHERE run_id IS NOT NULL"
    )

    op.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe "
        "ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL"
    )
    op.execute(
        "ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS club_battles BOOLEAN NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS club_battles")
    op.execute("DROP INDEX IF EXISTS ux_notifications_dedupe")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS dedupe_key")
    op.execute("DROP INDEX IF EXISTS ix_terr_events_run")
    op.execute("DROP INDEX IF EXISTS ix_terr_events_victim_clan")
    op.execute("ALTER TABLE territory_events DROP COLUMN IF EXISTS victim_clan_id")
