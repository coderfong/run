"""In-app purchase receipt verification (Apple StoreKit / Google Play).

Why this exists: without it, `/me/pass/purchase` and `/me/energy/purchase`
grant their goods to anyone who can call the endpoint. A single authenticated
request would hand over the whole PASER PRO track. Every paid grant must go
through `verify()` first.

Design notes:
  * stdlib `urllib` only — matches routes/auth.py, no new dependency.
  * FAILS CLOSED. If verification is enabled but unconfigured or the store is
    unreachable, we raise rather than granting. A purchase that errors can be
    retried by the client; a purchase granted in error cannot be taken back.
  * Returns a stable transaction id so callers can dedupe replays. The same
    receipt POSTed twice must not grant twice.

Apple: verifyReceipt takes the base64 app receipt. Status 21007 means a
sandbox receipt hit production, which is exactly what App Review's sandbox
testers send — retry against sandbox, per Apple's own guidance. Getting this
wrong is a classic review rejection.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from fastapi import HTTPException

from .config import settings

APPLE_PROD_URL = "https://buy.itunes.apple.com/verifyReceipt"
APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt"
GOOGLE_URL = ("https://androidpublisher.googleapis.com/androidpublisher/v3/"
              "applications/{pkg}/purchases/products/{sku}/tokens/{token}")

_TIMEOUT = 8


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read())


def _get_json(url: str, bearer: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read())


def _verify_apple(receipt: str, product_id: str) -> str:
    secret = (settings.apple_shared_secret or "").strip()
    if not secret:
        # Fail closed: an unconfigured server must never grant a paid item.
        raise HTTPException(503, "iap not configured")
    body = {"receipt-data": receipt, "password": secret,
            "exclude-old-transactions": True}
    try:
        res = _post_json(APPLE_PROD_URL, body)
        # 21007 = sandbox receipt sent to production. App Review's testers use
        # sandbox, so this path MUST work or every review purchase fails.
        if res.get("status") == 21007:
            res = _post_json(APPLE_SANDBOX_URL, body)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise HTTPException(503, "could not reach the App Store") from e

    if res.get("status") != 0:
        raise HTTPException(402, f"invalid receipt (apple status {res.get('status')})")

    receipts = (res.get("receipt", {}).get("in_app", [])
                or res.get("latest_receipt_info", []))
    for item in receipts:
        if item.get("product_id") != product_id:
            continue
        if item.get("cancellation_date") or item.get("cancellation_date_ms"):
            continue                                   # refunded / revoked
        txn = (item.get("original_transaction_id")
               or item.get("transaction_id"))
        if txn:
            return f"apple:{txn}"
    raise HTTPException(402, "receipt does not contain that product")


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
