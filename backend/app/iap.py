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

import functools
import json
import os
import urllib.error
import urllib.request

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
