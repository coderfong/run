"""PASER PRO becomes a subscription.

Until now PRO was one permanent thing: `users.premium_pass`, a boolean flipped
once by a one-time purchase, unlocking the gold reward track for the life of
the account. That shape fits a reward ladder — the ladder is career-long, so
paying for it once is honest. It does not fit what PRO is becoming: planning,
analytics, history and leaderboard depth, which cost something to run for as
long as somebody uses them.

So entitlement stops being a boolean and becomes a DATE, and this migration
adds the two pieces that takes.

- `pro_subscriptions` — one row per subscription, keyed by the store's
  ORIGINAL transaction id rather than the latest one. That is the only
  identifier that survives a renewal, an upgrade from monthly to annual, or a
  resubscribe after a lapse; keying on the latest transaction would write a new
  row every billing period and lose the thread. `user_id` is indexed but NOT
  unique: the same person can hold a lapsed subscription and a current one, and
  the entitlement is the furthest expiry among them.

- `users.pro_expires_at` — a denormalised copy of that furthest expiry.
  Entitlement is about to be read on a great many requests (every planner
  preview, every analytics panel, every gated overlay), and those requests
  already load the user row. A column on that row makes the check free, where
  a join per request would not be. `app/entitlements.py` owns keeping the two
  in step; nothing else should write this column.

`premium_pass` is deliberately LEFT ALONE and still honoured forever. Nobody
has actually bought it — IAP has never been enabled in a shipped build
(frontend/src/config/releaseFeatures.js) — but dev and TestFlight accounts
carry it, and an entitlement somebody was told was permanent is not one to
quietly take away. It is no longer sold; `/me/pass/purchase` stays reachable
only so a restore of an old receipt still lands.

Additive and idempotent. No existing row changes meaning, and a rollback
leaves lifetime holders exactly as they were.

THIS IS ALSO A MERGE POINT, which it has to be. The tree had forked: 0036
(bot accounts) took 0033 as its parent while 0034 (club photo) and 0035 (post
media urls) were already building on 0033 too, leaving two heads. Two heads
break the deploy outright rather than subtly — the container boots with
`alembic upgrade head && uvicorn ...` (backend/Dockerfile), and with an
ambiguous head that command exits non-zero, so the `&&` means the API never
starts at all. Taking both as parents collapses the fork; nothing about the
merge is specific to PRO, it just happened here because this is the next
migration anyone wrote.

Revision ID: 0037
Revises: 0035, 0036
Create Date: 2026-08-16
"""

from alembic import op

revision = "0037"
down_revision = ("0035", "0036")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- the subscriptions themselves ---------------------------------------
    # `environment` is recorded because a sandbox subscription renews every few
    # minutes and expires in hours; keeping it on the row is what lets a
    # support question ("why did my PRO vanish overnight?") be answered without
    # guessing, and lets a future sweep ignore sandbox rows.
    #
    # `auto_renew` is informational only. Entitlement is decided by
    # `expires_at` alone, because a cancelled subscription is still paid for
    # until the period it bought runs out.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS pro_subscriptions (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            store         TEXT NOT NULL,
            product_id    TEXT NOT NULL,
            original_txn  TEXT NOT NULL,
            latest_txn    TEXT,
            expires_at    TIMESTAMP NOT NULL,
            auto_renew    BOOLEAN NOT NULL DEFAULT true,
            environment   TEXT,
            revoked_at    TIMESTAMP,
            created_at    TIMESTAMP NOT NULL DEFAULT now(),
            updated_at    TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT pro_subscriptions_store CHECK (store IN ('apple', 'google'))
        )
        """
    )
    # The store's identity for a subscription is global, not per-account. This
    # unique index is what stops one paid subscription from entitling two
    # accounts: a second user POSTing the same receipt collides here instead of
    # quietly getting their own row. Renewals UPDATE this row rather than
    # inserting beside it.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_pro_subs_original "
        "ON pro_subscriptions (store, original_txn)"
    )
    # The entitlement read: this account's subscriptions, furthest expiry first.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_pro_subs_user "
        "ON pro_subscriptions (user_id, expires_at DESC)"
    )

    # --- the hot-path cache --------------------------------------------------
    # NULL means "no subscription ever", which is not the same as an expired
    # one and reads correctly either way: both are simply not entitled.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMP")
    # Not for the per-user lookup (that one is by primary key) but for the
    # sweeps that ask a population question — how many subscribers are live,
    # whose lapses this week — which would otherwise scan the whole table.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_pro_expires "
        "ON users (pro_expires_at) WHERE pro_expires_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_pro_expires")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS pro_expires_at")
    op.execute("DROP TABLE IF EXISTS pro_subscriptions")
