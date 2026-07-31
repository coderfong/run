"""IAP transaction ledger — makes paid grants replay-safe.

Before this, /me/pass/purchase and /me/energy/purchase granted their goods to
any authenticated caller (receipt verification was a TODO that raised 501 when
enabled, so it shipped disabled). app/iap.py now verifies against Apple /
Google, and this table is the second half: a store transaction id may be
redeemed exactly ONCE.

The UNIQUE constraint is the enforcement, not an application-level check —
two concurrent requests carrying the same receipt both reach the insert, and
the database picks a winner. `ON CONFLICT DO NOTHING` turns the loser into a
rowcount of 0, which the route reads as "already redeemed".

Energy packs are consumable, so a duplicate is rejected outright. The pass is
permanent, so a duplicate reports success (restore-purchases must not error).

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-30
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS iap_transactions (
            transaction_id TEXT PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_iap_transactions_user "
        "ON iap_transactions (user_id, created_at DESC)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS iap_transactions")
