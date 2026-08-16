"""Who has PASER PRO, and what that is allowed to mean.

ONE definition, in one place. Every gated surface — planner previews, the
analytics dashboards, intelligence overlays, leaderboard filters — asks this
module and nothing else, because an entitlement check that gets reimplemented
per route is an entitlement check that eventually disagrees with itself.

PRO is:

    a live subscription  OR  the retired lifetime pass

`pro_expires_at` on the user row is the subscription's furthest expiry; it is
a cache of `pro_subscriptions`, refreshed by `refresh(...)` below whenever a
receipt is verified. Reading it costs nothing on a request that already loaded
the user, which is the point — gating is about to be checked constantly.

WHAT PRO MUST NEVER GATE. The rule the whole monetisation rests on is that
paying buys knowledge, expression and depth, never power. Nothing in this
module may be used to gate claiming, defending, energy, territory strength,
decay, leaderboard POSITION, clans, rivals existing, or any other input to the
competitive outcome. If a check would change who wins, it does not belong
behind `require_pro`. See app/coins.py, which makes the same promise about
coins.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import get_db
from .security import current_user


def _grace() -> timedelta:
    """How long a lapsed subscription keeps working.

    A renewal that fails on the store's side is retried for days before it is
    given up on, and the person being retried has not cancelled anything —
    their card expired. Cutting the features off the instant `expires_at`
    passes punishes them for a billing hiccup, so entitlement outlives the
    expiry by this much. It is deliberately short: it is cover for a retry,
    not a free extra period.
    """
    return timedelta(days=max(0, settings.pro_grace_days))


def is_pro(user: models.User | None, *, now: datetime | None = None) -> bool:
    """The whole entitlement, from a user row already in hand. No queries."""
    if user is None:
        return False
    if getattr(user, "premium_pass", False):
        return True  # retired lifetime unlock, honoured forever
    expires = getattr(user, "pro_expires_at", None)
    if expires is None:
        return False
    return expires + _grace() > (now or datetime.utcnow())


def status(db: Session, user: models.User) -> dict:
    """The shape `/me/pro` returns and the client's paywall reads.

    `active` is the only field anything should branch on. The rest is there so
    the app can say something true about WHY — "renews on the 4th", "expired,
    resubscribe" — instead of just showing or hiding a button.
    """
    now = datetime.utcnow()
    lifetime = bool(getattr(user, "premium_pass", False))
    expires = getattr(user, "pro_expires_at", None)
    row = None
    if not lifetime:
        row = db.execute(
            text(
                "SELECT product_id, store, auto_renew, expires_at "
                "FROM pro_subscriptions "
                "WHERE user_id = :u AND revoked_at IS NULL "
                "ORDER BY expires_at DESC LIMIT 1"
            ),
            {"u": user.id},
        ).fetchone()
    return {
        "active": is_pro(user, now=now),
        # Distinguishes "bought PRO before it was a subscription" from a live
        # subscriber, so the paywall can thank the former rather than sell to
        # them.
        "lifetime": lifetime,
        "expires_at": expires.isoformat() + "Z" if expires else None,
        "product_id": row[0] if row else None,
        "store": row[1] if row else None,
        "auto_renew": bool(row[2]) if row else None,
        # True only in the window where the subscription has technically
        # lapsed but the grace period is still carrying it. The app uses this
        # to ask someone to check their payment method BEFORE anything is
        # taken away.
        "in_grace": bool(
            not lifetime and expires and expires <= now and is_pro(user, now=now)
        ),
    }


def refresh(
    db: Session,
    user_id: str,
    *,
    store: str,
    product_id: str,
    original_txn: str,
    latest_txn: str | None,
    expires_at: datetime,
    auto_renew: bool = True,
    environment: str | None = None,
) -> datetime | None:
    """Record a verified subscription state and re-cache the user's expiry.

    Upserts on (store, original_txn) — the identity that survives renewals and
    plan changes — so a renewal moves the existing row's expiry forward rather
    than accumulating a row per billing period.

    The expiry only ever moves FORWARD (`GREATEST`). A store can hand back an
    older transaction than one already recorded: an unfinished transaction
    replayed from a previous session, or a restore listing history. Taking
    whatever arrived last would let one of those retract a renewal that is
    already paid for.

    Returns the user's resulting entitlement expiry, or None if the receipt
    belongs to a different account (see below).
    """
    res = db.execute(
        text(
            """
            INSERT INTO pro_subscriptions
                (user_id, store, product_id, original_txn, latest_txn,
                 expires_at, auto_renew, environment)
            VALUES (:u, :s, :p, :o, :l, :e, :ar, :env)
            ON CONFLICT (store, original_txn) DO UPDATE SET
                product_id = EXCLUDED.product_id,
                latest_txn = EXCLUDED.latest_txn,
                expires_at = GREATEST(pro_subscriptions.expires_at, EXCLUDED.expires_at),
                auto_renew = EXCLUDED.auto_renew,
                environment = EXCLUDED.environment,
                revoked_at = NULL,
                updated_at = now()
            WHERE pro_subscriptions.user_id = :u
            RETURNING expires_at
            """
        ),
        {
            "u": user_id, "s": store, "p": product_id, "o": original_txn,
            "l": latest_txn, "e": expires_at, "ar": auto_renew, "env": environment,
        },
    ).fetchone()

    if res is None:
        # The WHERE on the DO UPDATE didn't match: this subscription is already
        # attached to a DIFFERENT account. One paid subscription entitles one
        # account, so this is refused rather than silently moved — otherwise a
        # single purchase could be passed between accounts indefinitely.
        return None

    return _recache(db, user_id)


def revoke(db: Session, *, store: str, original_txn: str) -> None:
    """Kill a subscription outright — a refund or a store revocation.

    Unlike a lapse, this takes the entitlement away immediately and with no
    grace: the money has gone back to the buyer.
    """
    row = db.execute(
        text(
            "UPDATE pro_subscriptions SET revoked_at = now(), updated_at = now() "
            "WHERE store = :s AND original_txn = :o RETURNING user_id::text"
        ),
        {"s": store, "o": original_txn},
    ).fetchone()
    if row:
        _recache(db, row[0])


def _recache(db: Session, user_id: str) -> datetime | None:
    """Recompute users.pro_expires_at from the subscription rows.

    Always derived from the table, never incremented in place, so the cache
    cannot drift away from what was actually paid for. Revoked rows are
    excluded here rather than deleted, which keeps the purchase history
    intact for support questions.
    """
    row = db.execute(
        text(
            "SELECT MAX(expires_at) FROM pro_subscriptions "
            "WHERE user_id = :u AND revoked_at IS NULL"
        ),
        {"u": user_id},
    ).fetchone()
    expires = row[0] if row else None
    db.execute(
        text("UPDATE users SET pro_expires_at = :e WHERE id = :u"),
        {"e": expires, "u": user_id},
    )
    return expires


def require_pro(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """Dependency for a PRO-only endpoint.

    402 rather than 403: the client turns this into the paywall, and "payment
    required" is what actually happened. A 403 would be indistinguishable from
    a permissions bug.

    Read the module docstring before putting this on a route. It is for depth,
    never for power.
    """
    if not is_pro(user):
        raise HTTPException(402, "PASER PRO required")
    return user
