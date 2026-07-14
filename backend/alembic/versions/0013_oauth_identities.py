"""OAuth sign-in (Google / Apple): link a user to an external identity.

- users.oauth_provider / oauth_sub: the provider ('google'|'apple') and the
  provider's stable subject id. Unique together so one external identity maps
  to exactly one user. password_hash is already nullable, so OAuth-only users
  simply have no password.

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-14
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_sub TEXT")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_idx "
        "ON users (oauth_provider, oauth_sub) "
        "WHERE oauth_provider IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS users_oauth_idx")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS oauth_sub")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS oauth_provider")
