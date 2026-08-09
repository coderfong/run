"""Account recovery — a way back in when the password is gone.

Until now an account was a username, a bcrypt hash and nothing else. There was
no second factor of identity anywhere in the schema, which meant a forgotten
password was a deleted account: no support path, no reset, no recovery. The
only runners who could get back in were the ones who had signed in with Google
or Apple, because for them the provider holds the identity.

Three additions, and each is doing one job.

- `users.email` / `users.email_verified_at` — the address a reset code is sent
  to. NULLABLE on purpose: this ships to an existing user base that has never
  been asked for an email, and an account without one still works exactly as
  before (it just cannot be recovered, which the app says out loud). Only a
  VERIFIED address is ever mailed a reset code, because an unverified one is a
  typo at best and somebody else's inbox at worst. The unique index is on
  `lower(email)` and partial, so two accounts cannot share an address but any
  number can share NULL.

- `auth_codes` — the short-lived numeric codes, stored as bcrypt hashes rather
  than plaintext, with the attempt counter ON THE ROW. A six digit code is only
  safe if guessing is bounded, and the bound has to live in the database or a
  restart resets it. `used_at` makes a code single use; `expires_at` makes an
  unread mail harmless after fifteen minutes.

- `users.token_version` — the reason a reset actually helps somebody whose
  account was taken. Sessions are 30 day JWTs with no server side record, so
  before this column a thief's token kept working right through a password
  change. The claim is now minted into each token and checked on every
  authenticated request; bumping this column invalidates every session ever
  issued for that account. Old tokens carry no `tv` claim and are read as 0, so
  this deploy does not sign the entire user base out.

Additive and idempotent throughout. `email` starts uniformly NULL, so the
unique index cannot collide with existing data, and the NOT NULL DEFAULT on
`token_version` is a catalogue-only change on PostgreSQL 11+ rather than a
table rewrite.

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-09
"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- the recovery address -----------------------------------------------
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP")
    # Case insensitive and partial: addresses are compared lowercased, and the
    # overwhelming majority of rows are NULL, which a plain UNIQUE would treat
    # as distinct anyway but which this keeps out of the index entirely.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower "
        "ON users (lower(email)) WHERE email IS NOT NULL"
    )

    # --- session invalidation ------------------------------------------------
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "token_version INTEGER NOT NULL DEFAULT 0"
    )

    # --- the codes -----------------------------------------------------------
    # `purpose` separates the two flows that share this table: proving you own
    # an address before it becomes a recovery route ('verify_email'), and
    # proving you own the address in order to get back in ('password_reset').
    # A code issued for one is useless for the other.
    #
    # `dest` records where the code was actually sent, so a reset stays bound
    # to the address that was on the account when it was requested. Changing
    # the address later cannot redirect a code already in flight.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_codes (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            purpose    TEXT NOT NULL,
            dest       TEXT NOT NULL,
            code_hash  TEXT NOT NULL,
            attempts   INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            expires_at TIMESTAMP NOT NULL,
            used_at    TIMESTAMP,
            CONSTRAINT auth_codes_purpose
                CHECK (purpose IN ('password_reset', 'verify_email'))
        )
        """
    )
    # Every read is "the live code for this account and this purpose", newest
    # first — issuing a new code retires the old ones rather than deleting
    # them, so the lookup has to be able to skip the retired rows cheaply.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_auth_codes_live "
        "ON auth_codes (user_id, purpose, created_at DESC)"
    )
    # The sweep that deletes expired rows scans by time alone.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_auth_codes_expires ON auth_codes (expires_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS auth_codes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS token_version")
    op.execute("DROP INDEX IF EXISTS ux_users_email_lower")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email")
