"""In-app purchase receipt verification (Apple StoreKit / Google Play).

Why this exists: without it, `/me/pass/purchase` and `/me/energy/purchase`
grant their goods to anyone who can call the endpoint. A single authenticated
request would hand over the whole PASER PRO track. Every paid grant must go
through `verify()` first.

Design notes:
  * FAILS CLOSED. If verification is enabled but unconfigured or the store is
    unreachable, we raise rather than granting. A purchase that errors can be
    retried by the client; a purchase granted in error cannot be taken back.
  * Returns a stable transaction id so callers can dedupe replays. The same
    receipt POSTed twice must not grant twice.

Apple: the client (expo-iap, StoreKit 2) hands us a signed JWS transaction —
NOT the old base64 whole-app receipt, which StoreKit 2 purchases don't
produce. That JWS is verified LOCALLY against Apple's own root certificate
(app/certs/AppleRootCA-G3.cer, a public file downloaded from
apple.com/certificateauthority — not a secret) using Apple's official
app-store-server-library, rather than posting to the deprecated verifyReceipt
endpoint. Sandbox testers — App Review included — always transact in sandbox,
so a production check is tried first and a sandbox one second, mirroring the
old endpoint's "status 21007 means sandbox" retry.
"""

from __future__ import annotations

import datetime as _dt
import functools
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from appstoreserverlibrary.models.Environment import Environment
from appstoreserverlibrary.signed_data_verifier import (
    SignedDataVerifier,
    VerificationException,
    VerificationStatus,
)
from fastapi import HTTPException

from .config import settings

GOOGLE_URL = ("https://androidpublisher.googleapis.com/androidpublisher/v3/"
              "applications/{pkg}/purchases/products/{sku}/tokens/{token}")

# Subscriptions are a DIFFERENT Play endpoint to one-time products, and the v2
# one at that: v1 (`purchases/subscriptions/...`) is deprecated and cannot
# describe a subscription with more than one line item.
GOOGLE_SUB_URL = ("https://androidpublisher.googleapis.com/androidpublisher/v3/"
                  "applications/{pkg}/purchases/subscriptionsv2/tokens/{token}")

_TIMEOUT = 8

_APPLE_ROOT_CERT_PATH = os.path.join(os.path.dirname(__file__), "certs", "AppleRootCA-G3.cer")


def _get_json(url: str, bearer: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read())


@functools.lru_cache(maxsize=1)
def _apple_root_certs() -> list[bytes]:
    with open(_APPLE_ROOT_CERT_PATH, "rb") as f:
        return [f.read()]


def _apple_verifier(environment: Environment, bundle_id: str) -> SignedDataVerifier:
    app_apple_id = None
    if environment == Environment.PRODUCTION:
        raw = (settings.apple_app_apple_id or "").strip()
        if not raw:
            # A production transaction cannot be checked without the app's
            # App Store Connect id — fail closed rather than skip the check.
            raise HTTPException(503, "iap not configured")
        app_apple_id = int(raw)
    return SignedDataVerifier(
        root_certificates=_apple_root_certs(),
        enable_online_checks=True,
        environment=environment,
        bundle_id=bundle_id,
        app_apple_id=app_apple_id,
    )


def _verify_apple(signed_transaction: str, product_id: str) -> str:
    bundle_id = (settings.apple_bundle_id or "").strip()
    if not bundle_id:
        raise HTTPException(503, "iap not configured")
    try:
        payload = _apple_verifier(Environment.PRODUCTION, bundle_id) \
            .verify_and_decode_signed_transaction(signed_transaction)
    except VerificationException as e:
        if e.status != VerificationStatus.INVALID_ENVIRONMENT:
            raise HTTPException(402, f"invalid receipt ({e.status.name})") from e
        try:
            payload = _apple_verifier(Environment.SANDBOX, bundle_id) \
                .verify_and_decode_signed_transaction(signed_transaction)
        except VerificationException as e2:
            raise HTTPException(402, f"invalid receipt ({e2.status.name})") from e2

    if payload.productId != product_id:
        raise HTTPException(402, "receipt does not contain that product")
    if payload.revocationDate:
        raise HTTPException(402, "purchase was refunded")
    txn = payload.originalTransactionId or payload.transactionId
    if not txn:
        raise HTTPException(402, "receipt missing transaction id")
    return f"apple:{txn}"


def _verify_google(token: str, product_id: str) -> str:
    access = (settings.google_play_access_token or "").strip()
    pkg = (settings.android_package or "").strip()
    if not access or not pkg:
        raise HTTPException(503, "iap not configured")
    url = GOOGLE_URL.format(pkg=pkg, sku=product_id, token=token)
    try:
        res = _get_json(url, bearer=access)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise HTTPException(503, "could not reach Google Play") from e
    # purchaseState: 0 = purchased, 1 = cancelled, 2 = pending
    if res.get("purchaseState") != 0:
        raise HTTPException(402, "purchase not in a completed state")
    txn = res.get("orderId") or token
    return f"google:{txn}"


# ---------------------------------------------------------------------------
# Subscriptions (PASER PRO)
#
# A subscription is not a purchase that happened, it is a purchase that KEEPS
# happening, so verifying one has to answer a different question: not "was this
# paid for" but "what is it paid up until". Everything below exists to produce
# that date from a receipt, and `app/entitlements.py` is what stores it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SubscriptionState:
    """What a store says about a subscription right now.

    `original_txn` is the identity that survives renewals and plan changes —
    the one to key storage on. `latest_txn` is only for dedupe and support.
    """
    store: str            # 'apple' | 'google'
    product_id: str
    original_txn: str
    latest_txn: str | None
    expires_at: _dt.datetime  # UTC, naive (matches every other timestamp here)
    auto_renew: bool
    environment: str | None


def _epoch_ms_to_dt(ms) -> _dt.datetime | None:
    try:
        return _dt.datetime.utcfromtimestamp(int(ms) / 1000.0)
    except (TypeError, ValueError):
        return None


def _verify_apple_subscription(signed_transaction: str, product_id: str) -> SubscriptionState:
    bundle_id = (settings.apple_bundle_id or "").strip()
    if not bundle_id:
        raise HTTPException(503, "iap not configured")
    environment = Environment.PRODUCTION
    try:
        payload = _apple_verifier(environment, bundle_id) \
            .verify_and_decode_signed_transaction(signed_transaction)
    except VerificationException as e:
        if e.status != VerificationStatus.INVALID_ENVIRONMENT:
            raise HTTPException(402, f"invalid receipt ({e.status.name})") from e
        environment = Environment.SANDBOX
        try:
            payload = _apple_verifier(environment, bundle_id) \
                .verify_and_decode_signed_transaction(signed_transaction)
        except VerificationException as e2:
            raise HTTPException(402, f"invalid receipt ({e2.status.name})") from e2

    if payload.productId != product_id:
        raise HTTPException(402, "receipt does not contain that product")
    if payload.revocationDate:
        # Refunded or revoked by Apple. Not an expiry — the money went back.
        raise HTTPException(402, "purchase was refunded")

    expires = _epoch_ms_to_dt(payload.expiresDate)
    if expires is None:
        # No expiry means this is not an auto-renewable subscription at all —
        # a consumable or non-consumable receipt posted to the wrong endpoint.
        # Granting PRO on it would grant it forever.
        raise HTTPException(402, "receipt is not a subscription")

    original = payload.originalTransactionId or payload.transactionId
    if not original:
        raise HTTPException(402, "receipt missing transaction id")

    # NOTE: the signed transaction says nothing about whether renewal is still
    # switched on — that lives in the separate renewal info, which needs the
    # App Store Server API. Assuming True here is safe because entitlement is
    # decided by `expires_at` alone; auto_renew is only ever displayed. A
    # cancelled subscription simply stops being extended at the next sync.
    return SubscriptionState(
        store="apple",
        product_id=product_id,
        original_txn=str(original),
        latest_txn=str(payload.transactionId) if payload.transactionId else None,
        expires_at=expires,
        auto_renew=True,
        environment=getattr(environment, "name", str(environment)),
    )


def _verify_google_subscription(token: str, product_id: str) -> SubscriptionState:
    access = (settings.google_play_access_token or "").strip()
    pkg = (settings.android_package or "").strip()
    if not access or not pkg:
        raise HTTPException(503, "iap not configured")
    url = GOOGLE_SUB_URL.format(pkg=pkg, token=token)
    try:
        res = _get_json(url, bearer=access)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise HTTPException(503, "could not reach Google Play") from e

    state = res.get("subscriptionState")
    if state in ("SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_UNSPECIFIED"):
        raise HTTPException(402, "purchase not in a completed state")
    if state == "SUBSCRIPTION_STATE_EXPIRED":
        raise HTTPException(402, "subscription has expired")

    # A subscription can carry several line items; the one that matters is the
    # one for the product actually being claimed.
    items = res.get("lineItems") or []
    item = next((i for i in items if i.get("productId") == product_id), None)
    if item is None:
        raise HTTPException(402, "receipt does not contain that product")

    raw_expiry = item.get("expiryTime")
    try:
        # RFC 3339 with a Z and often nanosecond precision, which
        # fromisoformat won't take before 3.11 — trim to microseconds.
        cleaned = (raw_expiry or "").replace("Z", "+00:00")
        if "." in cleaned:
            head, _, tail = cleaned.partition(".")
            frac, sign, offset = tail.partition("+")
            cleaned = f"{head}.{frac[:6]}{sign}{offset}"
        expires = _dt.datetime.fromisoformat(cleaned).astimezone(
            _dt.timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError) as e:
        raise HTTPException(402, "receipt missing an expiry") from e

    return SubscriptionState(
        store="google",
        product_id=product_id,
        original_txn=str(res.get("latestOrderId") or token).split("..")[0],
        latest_txn=str(res.get("latestOrderId")) if res.get("latestOrderId") else None,
        expires_at=expires,
        auto_renew=bool((item.get("autoRenewingPlan") or {}).get("autoRenewEnabled")),
        environment="SANDBOX" if res.get("testPurchase") else "PRODUCTION",
    )


def verify_subscription(*, platform: str, receipt: str | None,
                        product_id: str) -> SubscriptionState | None:
    """Verify an auto-renewable subscription and return its current state.

    Same contract as `verify()`: returns None when verification is DISABLED
    (dev/local) so the caller can keep a testable path, and raises rather than
    returning anything falsy on failure. A caller that treats None as "valid
    forever" has misread this — see how `routes/pro.py` bounds it.
    """
    if not settings.iap_verify_receipts:
        return None
    if not receipt:
        raise HTTPException(402, "missing receipt")
    plat = (platform or "ios").lower()
    if plat in ("ios", "apple"):
        return _verify_apple_subscription(receipt, product_id)
    if plat in ("android", "google"):
        return _verify_google_subscription(receipt, product_id)
    raise HTTPException(400, "unknown platform")


def verify(*, platform: str, receipt: str | None, product_id: str) -> str | None:
    """Verify a store purchase and return a stable transaction id.

    Returns None when verification is DISABLED (dev/local), so callers keep
    their existing unverified path for testing. Raises HTTPException on any
    failure — never returns a falsy 'ok' by accident.
    """
    if not settings.iap_verify_receipts:
        return None
    if not receipt:
        raise HTTPException(402, "missing receipt")
    plat = (platform or "ios").lower()
    if plat in ("ios", "apple"):
        return _verify_apple(receipt, product_id)
    if plat in ("android", "google"):
        return _verify_google(receipt, product_id)
    raise HTTPException(400, "unknown platform")
