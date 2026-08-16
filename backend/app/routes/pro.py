"""PASER PRO subscription API.

- GET  /me/pro            current entitlement (what the paywall reads)
- POST /me/pro/subscribe  a fresh purchase from the store sheet
- POST /me/pro/sync       re-post whatever the store says this device owns

WHY SYNC EXISTS. A subscription renews without the app being involved, so the
expiry recorded at purchase goes stale on its own. There are two ways to learn
about a renewal: the store tells the server (App Store Server Notifications /
Play RTDN, a webhook that needs configuration outside this repo), or the client
asks the store and re-posts what it hears. This implements the second, called
once on launch, and it is sufficient on its own for a very simple reason: PRO
is only ever spent inside the app, so the only moment the expiry has to be
right is a moment the app is open. A webhook would additionally catch refunds
the instant they happen — `entitlements.revoke()` is already there for it —
but nothing here waits on that to be correct.

Subscribe and sync are the SAME operation with different names. Both verify a
receipt and upsert the resulting expiry; neither trusts a date from the client.
They are separate endpoints only because the client's intent differs, and
because subscribe is the one that should be rate limited like a purchase.

Note there is no `iap_transactions` dedupe here, unlike the energy packs. A
consumable must never be redeemed twice, so a replayed receipt is an error
there. A subscription receipt is replayed BY DESIGN, on every sync — its
idempotency comes from the upsert in `entitlements.refresh`, which moves an
expiry forward and never grants anything twice.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .. import entitlements, iap, models
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter()

# What an unverified (dev/local) subscription is worth. `iap.verify_subscription`
# returns None when receipt checking is switched off, and the alternative to a
# bounded window here is granting PRO with no expiry at all to anyone who can
# POST — which is exactly the hole receipt verification exists to close. Short
# enough that a misconfigured production deploy leaks days rather than years.
_DEV_GRANT = timedelta(days=7)


def _apply(db: Session, user: models.User, body: dict) -> dict:
    """Verify a subscription receipt and record what it entitles."""
    product_id = (body.get("product_id") or "").strip()
    if product_id not in settings.pro_products:
        raise HTTPException(400, "unknown product")

    state = iap.verify_subscription(
        platform=body.get("platform"), receipt=body.get("receipt"),
        product_id=product_id,
    )

    if state is None:
        # Verification disabled. Grant a bounded window rather than forever,
        # and record it as its own row per account so a dev grant can never
        # collide with a real store subscription.
        expires = entitlements.refresh(
            db, user.id,
            store="apple",
            product_id=product_id,
            original_txn=f"dev:{user.id}",
            latest_txn=None,
            expires_at=datetime.utcnow() + _DEV_GRANT,
            auto_renew=False,
            environment="DEV",
        )
    else:
        expires = entitlements.refresh(
            db, user.id,
            store=state.store,
            product_id=state.product_id,
            original_txn=state.original_txn,
            latest_txn=state.latest_txn,
            expires_at=state.expires_at,
            auto_renew=state.auto_renew,
            environment=state.environment,
        )

    if expires is None:
        # The subscription is attached to another account. Apple and Google
        # both key a subscription to a STORE account, which is not the same
        # thing as a PASER account — one person signing into two PASER
        # accounts on one device lands here, and so does a shared device.
        raise HTTPException(409, "that subscription is already active on another account")

    db.commit()
    db.refresh(user)
    return entitlements.status(db, user)


@router.get("/me/pro")
def pro_status(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Entitlement for the signed-in account. Cheap: reads the user row."""
    return entitlements.status(db, user)


@router.post("/me/pro/subscribe")
@limiter.limit(settings.rate_limit_default)
def subscribe(request: Request, response: Response, body: dict,
              user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Activate PRO from a completed store purchase."""
    return _apply(db, user, body)


@router.post("/me/pro/sync")
@limiter.limit(settings.rate_limit_default)
def sync(request: Request, response: Response, body: dict,
         user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Refresh entitlement from the store's own record of what is owned.

    Takes the same body as subscribe, plus a `purchases` list for the restore
    case where the store hands back several. An entry that fails verification
    is skipped rather than failing the whole sync: one dead receipt in the list
    must not cost somebody the subscription they actually hold.
    """
    entries = body.get("purchases")
    if not isinstance(entries, list):
        entries = [body]

    last_error: HTTPException | None = None
    applied = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            _apply(db, user, entry)
            applied += 1
        except HTTPException as e:
            db.rollback()
            last_error = e

    if not applied and last_error is not None and len(entries) == 1:
        # Nothing to fall back on and only one thing was tried — the caller
        # asked about one specific purchase, so tell them what was wrong with
        # it instead of silently reporting "not subscribed".
        raise last_error

    db.refresh(user)
    return entitlements.status(db, user)
