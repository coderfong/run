"""Store the Apple refresh token needed for account-deletion revocation.

Revision ID: 0032
Revises: 0031
Create Date: 2026-08-12
"""

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS oauth_refresh_token")
