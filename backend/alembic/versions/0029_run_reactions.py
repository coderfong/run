"""Emote reactions on runs, and emotes attached to comments.

Kudos is a heart and nothing else: it can say "I saw this" and it cannot say
anything more. A feed of other people's runs wants range — a 12 km hill lap and
a shuffle round the block both get the same single heart today, which is why
the heart stops meaning much once you follow more than a handful of people.

Two additions.

- `run_reactions` — ONE reaction per person per run, like kudos but with a
  choice of emote. The UNIQUE (run_id, user_id) is what makes it a choice
  rather than a pile: tapping a second emote SWAPS yours, tapping your own
  clears it. That keeps the summary on a feed card small and stable (a handful
  of distinct emotes with counts) instead of unbounded, and it means a run can
  never be brigaded into a wall of the same face by one account.

  Kudos is left exactly as it was. It is a different gesture and a lot of
  history is stored against it; reactions sit alongside rather than replacing.

- `run_comments.emote` — NULLABLE. A comment may now carry an emote sticker
  next to its text, or be a sticker with no text at all. Existing rows keep
  NULL and render exactly as before.

The emote key is stored as TEXT rather than an enum on purpose: the vocabulary
lives in the client registry and the API allowlist, and widening it must not
need a migration and a coordinated deploy. Validation happens at the edge.

Revision ID: 0029
Revises: 0028
Create Date: 2026-08-11
"""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS run_reactions (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emote      TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            UNIQUE (run_id, user_id)
        )
        """
    )
    # The feed asks "what is on this run" for every row on the page, so the
    # index is on run_id. `emote` rides along so the per-run tally is an
    # index-only scan rather than a heap lookup per reaction.
    op.execute(
        "CREATE INDEX IF NOT EXISTS run_reactions_run_idx ON run_reactions(run_id, emote)"
    )
    op.execute("ALTER TABLE run_comments ADD COLUMN IF NOT EXISTS emote TEXT")
    # A comment used to be text and only text. Now that a sticker with no words
    # is a valid comment, the column has to allow it — but a row with NEITHER
    # is a bug, so the constraint says so rather than letting empties collect.
    op.execute("ALTER TABLE run_comments ALTER COLUMN body DROP NOT NULL")
    # Postgres has no ADD CONSTRAINT IF NOT EXISTS, and the rest of this
    # migration is re-runnable, so the guard is written out longhand.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'run_comments_body_or_emote'
            ) THEN
                ALTER TABLE run_comments
                ADD CONSTRAINT run_comments_body_or_emote
                CHECK (COALESCE(NULLIF(btrim(body), ''), emote) IS NOT NULL);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE run_comments DROP CONSTRAINT IF EXISTS run_comments_body_or_emote")
    op.execute("UPDATE run_comments SET body = '' WHERE body IS NULL")
    op.execute("ALTER TABLE run_comments ALTER COLUMN body SET NOT NULL")
    op.execute("ALTER TABLE run_comments DROP COLUMN IF EXISTS emote")
    op.execute("DROP TABLE IF EXISTS run_reactions")
