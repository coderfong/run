"""The "own it once" rule applies to cosmetics, not to lootboxes.

0018 added UNIQUE(user_id, item_id) on user_unlocks so the shop's buy path
could rely on ON CONFLICT DO NOTHING. The comment there says "a cosmetic can
only be owned once" — but the index covers every kind, and a lootbox row is
consumable inventory (it carries an `opened` flag), keyed by RARITY. So a
player could hold at most one 'rare' box, ever: the pass grants one at levels
10, 15 and 20, and claiming the second tier died on the constraint.

Made partial. Cosmetics keep the guarantee the shop depends on; boxes stack.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-05
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP INDEX IF EXISTS ux_user_unlocks_item")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_user_unlocks_item "
        "ON user_unlocks (user_id, item_id) WHERE kind = 'cosmetic'"
    )


def downgrade():
    # Going back can't recreate the total index while duplicate lootbox rows
    # exist, so drop the extras first — they were unreachable under the old
    # rule anyway.
    op.execute(
        """
        DELETE FROM user_unlocks u
         WHERE u.kind <> 'cosmetic'
           AND EXISTS (
                 SELECT 1 FROM user_unlocks o
                  WHERE o.user_id = u.user_id AND o.item_id = u.item_id
                    AND o.ctid < u.ctid)
        """
    )
    op.execute("DROP INDEX IF EXISTS ux_user_unlocks_item")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_user_unlocks_item "
        "ON user_unlocks (user_id, item_id)"
    )
