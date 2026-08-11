"""Curate the free and PASER Pro cosmetic tracks.

The pass catalogue was rebalanced after the bottom and footwear catalogues
were restored. Existing claimed tiers need the new item grants because a
reward_claim row prevents the tier being claimed again.

Punk crown and knight armour also moved from automatic level unlocks to the
Pro track. Players who had already reached their old unlock levels keep them.

Revision ID: 0030
Revises: 0029
Create Date: 2026-08-11
"""

from alembic import op


revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO user_unlocks (user_id, kind, item_id)
        SELECT rc.user_id, 'cosmetic', reward.item_id
          FROM reward_claims rc
          JOIN (VALUES
            (1,  'face:grump'),
            (2,  'headwear:catears'),
            (3,  'hair:messy'),
            (4,  'top:sportpolo'),
            (6,  'face:determined'),
            (7,  'headwear:sweatband'),
            (8,  'top:greyhoodie'),
            (9,  'hair:flow'),
            (11, 'headwear:bandana'),
            (12, 'glasses:rects'),
            (13, 'hair:roundfro'),
            (14, 'bottom:wb025'),
            (16, 'top:labcoat'),
            (17, 'footwear:wf005'),
            (18, 'face:whoa'),
            (19, 'accessory:goldmedal'),
            (21, 'headwear:pombeanie'),
            (22, 'bottom:wb050'),
            (23, 'glasses:cleargoggles'),
            (24, 'headwear:tiara'),
            (26, 'top:puffer'),
            (27, 'face:gasp'),
            (28, 'footwear:wf010'),
            (29, 'accessory:hydrovest'),
            (31, 'hair:topknot'),
            (32, 'glasses:sportshield'),
            (33, 'top:o4t'),
            (34, 'bottom:wb110'),
            (36, 'footwear:wf011'),
            (37, 'headwear:bikehelmet'),
            (38, 'face:rage'),
            (39, 'accessory:katanas'),
            (41, 'hair:surfer'),
            (42, 'glasses:steampunk'),
            (43, 'top:o49t'),
            (44, 'footwear:wf044'),
            (46, 'headwear:spacehelmet'),
            (47, 'headwear:royalcrown'),
            (48, 'accessory:neonwings'),
            (49, 'glasses:onimask')
          ) AS reward(level, item_id)
            ON reward.level = rc.level
         WHERE rc.track = 'free'
        ON CONFLICT DO NOTHING
        """
    )

    # Preserve the two automatic level unlocks that became Pro exclusives.
    op.execute(
        """
        INSERT INTO user_unlocks (user_id, kind, item_id)
        SELECT id, 'cosmetic', 'headwear:punkcrown'
          FROM users
         WHERE COALESCE(xp, 0) >= 32400
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO user_unlocks (user_id, kind, item_id)
        SELECT id, 'cosmetic', 'top:knightarmor'
          FROM users
         WHERE COALESCE(xp, 0) >= 211600
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    # Grants are intentionally retained. They are indistinguishable from an
    # item earned through a lootbox/shop and deleting wardrobe items is unsafe.
    pass
