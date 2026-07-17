"""Pasers — mutual friendship between runners.

- paser_links: one row per pair, holding the direction the request was sent in
  (requester_id -> addressee_id) plus its status ('pending' | 'accepted').
  Declines delete the row rather than parking it, so a decline can be retried
  later and never leaves a tombstone the addressee can't clear.

  The pair index is on LEAST/GREATEST of the two ids, so a pair can only ever
  have ONE row regardless of who asked first. That makes the "B asks while
  A->B is already pending" case an insert conflict instead of a duplicate
  friendship; the route turns it into an accept.

- notif_prefs.pasers: mutes the request/accept notifications.

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-17
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS paser_links (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status       TEXT NOT NULL DEFAULT 'pending',
            created_at   TIMESTAMP NOT NULL DEFAULT now(),
            responded_at TIMESTAMP,
            CONSTRAINT paser_links_not_self CHECK (requester_id <> addressee_id),
            CONSTRAINT paser_links_status CHECK (status IN ('pending', 'accepted'))
        )
        """
    )
    # One row per unordered pair, whichever way round the request went.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS paser_links_pair_idx ON paser_links "
        "(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))"
    )
    # "My pasers" and "my pending requests" both scan by one side of the pair.
    op.execute(
        "CREATE INDEX IF NOT EXISTS paser_links_requester_idx "
        "ON paser_links (requester_id, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS paser_links_addressee_idx "
        "ON paser_links (addressee_id, status)"
    )
    op.execute("ALTER TABLE notif_prefs ADD COLUMN IF NOT EXISTS pasers BOOLEAN NOT NULL DEFAULT true")

    # Username search hits ILIKE 'q%' — a text_pattern_ops index can't serve
    # ILIKE, so index lower(username) and have the route compare lowercase.
    op.execute(
        "CREATE INDEX IF NOT EXISTS users_username_lower_idx "
        "ON users (lower(username) text_pattern_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS users_username_lower_idx")
    op.execute("ALTER TABLE notif_prefs DROP COLUMN IF EXISTS pasers")
    op.execute("DROP TABLE IF EXISTS paser_links")
