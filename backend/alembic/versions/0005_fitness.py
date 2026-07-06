"""Fitness layer (Phase 6): splits, PRs, kudos, push tokens, notif prefs.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-06
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE run_splits (
            id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id   UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            km       INTEGER NOT NULL,
            seconds  DOUBLE PRECISION NOT NULL,
            UNIQUE (run_id, km)
        )
        """
    )
    # One row per (user, record kind); `value` semantics vary by kind
    # (seconds for pace records = lower is better; meters/m2 = higher).
    op.execute(
        """
        CREATE TABLE user_records (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind        TEXT NOT NULL,
            value       DOUBLE PRECISION NOT NULL,
            run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
            achieved_at TIMESTAMP NOT NULL DEFAULT now(),
            UNIQUE (user_id, kind)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE run_kudos (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            UNIQUE (run_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX run_kudos_run_idx ON run_kudos(run_id)")
    op.execute(
        """
        CREATE TABLE device_tokens (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT NOT NULL UNIQUE,
            platform   TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX device_tokens_user_idx ON device_tokens(user_id)")
    op.execute(
        """
        CREATE TABLE notif_prefs (
            user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            stolen     BOOLEAN NOT NULL DEFAULT true,
            clan_goal  BOOLEAN NOT NULL DEFAULT true,
            kudos      BOOLEAN NOT NULL DEFAULT true,
            season     BOOLEAN NOT NULL DEFAULT true,
            recap      BOOLEAN NOT NULL DEFAULT true
        )
        """
    )


def downgrade() -> None:
    for t in ("notif_prefs", "device_tokens", "run_kudos", "user_records", "run_splits"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
