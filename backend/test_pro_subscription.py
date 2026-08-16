"""End-to-end exercise of the PASER PRO subscription (migration 0037).

Runs against the real app + the real dev DB via TestClient, then deletes the
throwaway users. Needs httpx.

    .venv/Scripts/python.exe test_pro_subscription.py

Covers: entitlement off by default, subscribe/sync via the dev grant path,
sync idempotency, the expiry-only-moves-forward rule, the grace window either
side of its edge, revocation, one subscription never entitling two accounts,
and the retired lifetime pass still counting as PRO.

Receipt verification is OFF in dev (`iap_verify_receipts`), so subscribe takes
the bounded `_DEV_GRANT` path rather than talking to a store. The rules being
checked here live in app/entitlements.py and are the same either way — what a
real receipt changes is only where `expires_at` comes from.
"""
import os, sys, uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app import entitlements
from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.routes.pro import _DEV_GRANT

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
PRODUCT = settings.pro_products[0]


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def set_expiry(db, uid, when):
    """Age a subscription by hand — the only way to reach an expiry boundary
    without waiting out a real billing period."""
    db.execute(text("UPDATE pro_subscriptions SET expires_at = :e WHERE user_id = :u"),
               {"e": when, "u": uid})
    db.execute(text("UPDATE users SET pro_expires_at = :e WHERE id = :u"),
               {"e": when, "u": uid})
    db.commit()


h, uid = signup(f"prosub{tag}")
h2, uid2 = signup(f"prosub{tag}b")
db = SessionLocal()

print("\n== default state ==")
p = c.get("/me/pro", headers=h).json()
check("a new account is not PRO", p["active"] is False, str(p))
check("and holds no lifetime pass", p["lifetime"] is False, str(p["lifetime"]))
check("no expiry recorded", p["expires_at"] is None, str(p["expires_at"]))
check("progression agrees PRO is off",
      c.get("/me/progression", headers=h).json()["premium_active"] is False)

print("\n== the gold track follows the one entitlement ==")
db.execute(text("UPDATE users SET xp = 2500 WHERE id = :u"), {"u": uid})
db.commit()
r = c.post("/me/rewards/claim", json={"level": 2, "track": "premium"}, headers=h)
check("premium claim without PRO -> 402", r.status_code == 402, str(r.status_code))

print("\n== subscribe ==")
r = c.post("/me/pro/subscribe", json={"product_id": "nonsense"}, headers=h)
check("unknown product -> 400", r.status_code == 400, str(r.status_code))
r = c.post("/me/pro/subscribe", json={"product_id": PRODUCT}, headers=h)
check("subscribing activates PRO", r.status_code == 200 and r.json()["active"], r.text[:140])
body = r.json()
check("the plan comes back", body["product_id"] == PRODUCT, str(body["product_id"]))
check("it is not reported as lifetime", body["lifetime"] is False, str(body["lifetime"]))
check("an expiry is set", bool(body["expires_at"]), str(body["expires_at"]))
check("dev grant is BOUNDED, not forever",
      datetime.fromisoformat(body["expires_at"].rstrip("Z")) < datetime.utcnow() + _DEV_GRANT + timedelta(minutes=1),
      str(body["expires_at"]))
check("premium track opens to a subscriber",
      c.post("/me/rewards/claim", json={"level": 2, "track": "premium"}, headers=h).status_code == 200)
check("progression reports PRO active",
      c.get("/me/progression", headers=h).json()["premium_active"] is True)

print("\n== sync is idempotent ==")
first = c.get("/me/pro", headers=h).json()["expires_at"]
rows_before = db.execute(text("SELECT count(*) FROM pro_subscriptions WHERE user_id = :u"),
                         {"u": uid}).scalar()
for _ in range(3):
    r = c.post("/me/pro/sync", json={"product_id": PRODUCT}, headers=h)
    check("sync keeps PRO active", r.status_code == 200 and r.json()["active"], r.text[:120])
rows_after = db.execute(text("SELECT count(*) FROM pro_subscriptions WHERE user_id = :u"),
                        {"u": uid}).scalar()
check("repeated sync does not add rows", rows_before == rows_after == 1, f"{rows_before} -> {rows_after}")

print("\n== expiry only ever moves forward ==")
far = datetime.utcnow() + timedelta(days=365)
set_expiry(db, uid, far)
c.post("/me/pro/sync", json={"product_id": PRODUCT}, headers=h)
after = db.execute(text("SELECT max(expires_at) FROM pro_subscriptions WHERE user_id = :u"),
                   {"u": uid}).scalar()
check("a stale receipt cannot retract a longer subscription",
      abs((after - far).total_seconds()) < 1, f"{far} -> {after}")

print("\n== the grace window ==")
set_expiry(db, uid, datetime.utcnow() - timedelta(days=1))
p = c.get("/me/pro", headers=h).json()
check("one day past expiry is still PRO (billing retry)", p["active"] is True, str(p))
check("and it is flagged as grace, not health", p["in_grace"] is True, str(p["in_grace"]))
set_expiry(db, uid, datetime.utcnow() - timedelta(days=settings.pro_grace_days + 1))
p = c.get("/me/pro", headers=h).json()
check("past the grace window PRO is gone", p["active"] is False, str(p))
check("expired is not reported as grace", p["in_grace"] is False, str(p["in_grace"]))
check("the gold track closes again",
      c.post("/me/rewards/claim", json={"level": 5, "track": "premium"}, headers=h).status_code == 402)

print("\n== one subscription, one account ==")
# Reach past the API for this: the dev grant keys on the user id, so two
# accounts can only collide on a store transaction a real store issued.
shared = f"apple-orig-{tag}"
ok = entitlements.refresh(
    db, uid, store="apple", product_id=PRODUCT, original_txn=shared,
    latest_txn=None, expires_at=datetime.utcnow() + timedelta(days=30),
)
db.commit()
check("the first account gets the subscription", ok is not None, str(ok))
stolen = entitlements.refresh(
    db, uid2, store="apple", product_id=PRODUCT, original_txn=shared,
    latest_txn=None, expires_at=datetime.utcnow() + timedelta(days=30),
)
db.commit()
check("a second account is refused the same receipt", stolen is None, str(stolen))
check("and gains nothing from trying",
      c.get("/me/pro", headers=h2).json()["active"] is False)

print("\n== revocation (refund) ==")
check("PRO is active before the refund", c.get("/me/pro", headers=h).json()["active"] is True)
entitlements.revoke(db, store="apple", original_txn=shared)
db.commit()
p = c.get("/me/pro", headers=h).json()
check("a refund takes PRO away immediately, with no grace", p["active"] is False, str(p))

print("\n== the retired lifetime pass ==")
db.execute(text("UPDATE users SET premium_pass = true WHERE id = :u"), {"u": uid2})
db.commit()
p = c.get("/me/pro", headers=h2).json()
check("a lifetime holder still has PRO", p["active"] is True, str(p))
check("and is told so, rather than sold to", p["lifetime"] is True, str(p["lifetime"]))
check("with no subscription attached", p["product_id"] is None, str(p["product_id"]))

# cleanup
for u in (uid, uid2):
    for t in ("pro_subscriptions", "reward_claims", "user_unlocks", "notif_prefs", "notifications"):
        db.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {"u": u})
    db.execute(text("DELETE FROM users WHERE id = :u"), {"u": u})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
