"""Full clan system (Phase 5): roles, invites, seasons, leagues, weekly goals.

Extends the v1 groundwork (0003): clans gains color_key/badge_icon/privacy/
description/member_cap; membership moves to clan_members (role); adds
clan_invites, seasons, clan_season_stats, clan_week_goals + contributions.
Existing users.clan_id memberships are backfilled into clan_members.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-06
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- clans: new cosmetic + policy columns --------------------------------
    op.execute(
        """
        ALTER TABLE clans
            ADD COLUMN IF NOT EXISTS color_key   TEXT,
            ADD COLUMN IF NOT EXISTS badge_icon  TEXT NOT NULL DEFAULT 'shield',
            ADD COLUMN IF NOT EXISTS privacy     TEXT NOT NULL DEFAULT 'open',
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS member_cap  INTEGER NOT NULL DEFAULT 50
        """
    )
    # The old color_fill/stroke/glow triple becomes optional (color_key wins).
    op.execute("ALTER TABLE clans ALTER COLUMN color_fill DROP NOT NULL")
    op.execute("ALTER TABLE clans ALTER COLUMN color_stroke DROP NOT NULL")
    op.execute("ALTER TABLE clans ALTER COLUMN color_glow DROP NOT NULL")
    op.execute("UPDATE clans SET color_key = 'azure' WHERE color_key IS NULL")

    # --- membership + roles --------------------------------------------------
    op.execute(
        """
        CREATE TABLE clan_members (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            role       TEXT NOT NULL DEFAULT 'member',
            joined_at  TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX clan_members_clan_idx ON clan_members(clan_id)")
    # Backfill from users.clan_id: creators become leaders, others members.
    op.execute(
        """
        INSERT INTO clan_members (clan_id, user_id, role)
        SELECT u.clan_id, u.id,
               CASE WHEN c.created_by = u.id THEN 'leader' ELSE 'member' END
        FROM users u JOIN clans c ON c.id = u.clan_id
        WHERE u.clan_id IS NOT NULL
        ON CONFLICT (user_id) DO NOTHING
        """
    )

    # --- invites -------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE clan_invites (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            code       TEXT NOT NULL UNIQUE,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMP,
            max_uses   INTEGER NOT NULL DEFAULT 25,
            uses       INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )

    # --- seasons + per-clan season stats + league tier -----------------------
    op.execute(
        """
        CREATE TABLE seasons (
            id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name      TEXT NOT NULL,
            starts_at TIMESTAMP NOT NULL,
            ends_at   TIMESTAMP NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE clan_season_stats (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            clan_id      UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            area_current DOUBLE PRECISION NOT NULL DEFAULT 0,
            area_peak    DOUBLE PRECISION NOT NULL DEFAULT 0,
            steals       INTEGER NOT NULL DEFAULT 0,
            distance_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
            league       TEXT,
            UNIQUE (season_id, clan_id)
        )
        """
    )

    # --- weekly clan goal (the "chest") + per-member contributions -----------
    op.execute(
        """
        CREATE TABLE clan_week_goals (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            clan_id           UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
            week_start        DATE NOT NULL,
            target_distance_m DOUBLE PRECISION NOT NULL,
            target_claims     INTEGER NOT NULL,
            progress_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
            progress_claims   INTEGER NOT NULL DEFAULT 0,
            reached           BOOLEAN NOT NULL DEFAULT false,
            UNIQUE (clan_id, week_start)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE clan_week_contrib (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            goal_id     UUID NOT NULL REFERENCES clan_week_goals(id) ON DELETE CASCADE,
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            distance_m  DOUBLE PRECISION NOT NULL DEFAULT 0,
            claims      INTEGER NOT NULL DEFAULT 0,
            UNIQUE (goal_id, user_id)
        )
        """
    )

    # Seed Season 1 so the app has a live season out of the box.
    op.execute(
        """
        INSERT INTO seasons (name, starts_at, ends_at)
        SELECT 'Season 1 — Monsoon', now(), now() + interval '90 days'
        WHERE NOT EXISTS (SELECT 1 FROM seasons)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS clan_week_contrib")
    op.execute("DROP TABLE IF EXISTS clan_week_goals")
    op.execute("DROP TABLE IF EXISTS clan_season_stats")
    op.execute("DROP TABLE IF EXISTS seasons")
    op.execute("DROP TABLE IF EXISTS clan_invites")
    op.execute("DROP TABLE IF EXISTS clan_members")
    op.execute(
        """
        ALTER TABLE clans
            DROP COLUMN IF EXISTS color_key,
            DROP COLUMN IF EXISTS badge_icon,
            DROP COLUMN IF EXISTS privacy,
            DROP COLUMN IF EXISTS description,
            DROP COLUMN IF EXISTS member_cap
        """
    )
