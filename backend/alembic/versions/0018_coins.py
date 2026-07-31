"""Coins — soft currency for buying cosmetics.

Adds `users.coins` plus a `coin_ledger` audit trail. The ledger is what makes
a balance dispute answerable: every grant and spend records its reason and the
thing it referred to (item id, IAP transaction id).

Balance is a plain integer column rather than a sum over the ledger because
it's read on every shop/profile load, and the spend guard needs to be a single
atomic UPDATE ... WHERE coins >= price (see app/coins.py).

Existing users start at 0. No backfill for past runs — coins begin
accumulating from this deploy.

Revision ID: 0018
Revises: 0017
Create Date: 2026-07-30
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coin_ledger (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            ref TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_coin_ledger_user "
        "ON coin_ledger (user_id, created_at DESC)"
    )
    # A cosmetic can only be owned once; the buy path relies on this for its
    # ON CONFLICT DO NOTHING.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_user_unlocks_item "
        "ON user_unlocks (user_id, item_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ux_user_unlocks_item")
    op.execute("DROP TABLE IF EXISTS coin_ledger")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS coins")
