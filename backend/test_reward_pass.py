"""End-to-end exercise of the two-track reward pass (migration 0015).

Runs against the real app + the real dev DB via TestClient, then deletes the
throwaway user. Needs httpx.

    .venv/Scripts/python.exe test_reward_pass.py

Covers: ladder shape (free+premium per tier), level gating, tap-to-claim,
double-claim 409, premium gating + purchase, lootbox/energy grants landing,
and the 0015 backfill marking previously auto-granted levels claimed.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from sqlalchemy import text

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


r = c.post("/auth/signup", json={"username": f"passer{tag}", "password": "hunter2hunter2"})
assert r.status_code == 200, r.text
h = {"Authorization": f"Bearer {r.json()['access_token']}"}
uid = r.json()["user"]["id"]
db = SessionLocal()

print("\n== ladder shape ==")
p = c.get("/me/progression", headers=h).json()
check("premium_active false by default", p["premium_active"] is False, str(p.get("premium_active")))
check("claims empty for a new user", p["claims"] == [], str(p["claims"]))
check("50 tiers", len(p["ladder"]) == 50, str(len(p["ladder"])))
check("every tier has free + premium rewards",
      all(row["rewards"] and row["premium"] for row in p["ladder"]))
check("premium lootbox at 5 is rarity-bumped (rare > common)",
      p["ladder"][4]["premium"][0] == {"kind": "lootbox", "key": "rare", "label": "Rare lootbox"},
      str(p["ladder"][4]["premium"]))
check("premium level 2 is +25 energy", p["ladder"][1]["premium"][0]["key"] == "+25", str(p["ladder"][1]["premium"]))
check("premium level 10 is +50 energy... unless lootbox tier", p["ladder"][9]["premium"][0]["kind"] == "lootbox", str(p["ladder"][9]["premium"]))

print("\n== gating at level 0 ==")
r = c.post("/me/rewards/claim", json={"level": 1, "track": "free"}, headers=h)
check("claim above your level -> 403", r.status_code == 403, f"{r.status_code} {r.text[:80]}")
r = c.post("/me/rewards/claim", json={"level": 1, "track": "gold"}, headers=h)
check("bad track -> 400", r.status_code == 400, str(r.status_code))
r = c.post("/me/rewards/claim", json={"level": 99, "track": "free"}, headers=h)
check("level 99 -> 400", r.status_code == 400, str(r.status_code))

# Jump to level 5 (xp = 100 * 5^2 = 2500).
db.execute(text("UPDATE users SET xp = 2500 WHERE id = :u"), {"u": uid})
db.commit()

print("\n== free claims at level 5 ==")
r = c.post("/me/rewards/claim", json={"level": 5, "track": "free"}, headers=h)
check("claim free tier 5", r.status_code == 200, r.text[:120])
check("tier 5 free grants a common lootbox",
      any(rw["kind"] == "lootbox" and rw["key"] == "common" for rw in r.json()["rewards"]),
      str(r.json().get("rewards")))
p = c.get("/me/progression", headers=h).json()
check("lootbox is now pending", len(p["pending_lootboxes"]) == 1, str(p["pending_lootboxes"]))
check("claim recorded", {"level": 5, "track": "free"} in p["claims"], str(p["claims"]))
r = c.post("/me/rewards/claim", json={"level": 5, "track": "free"}, headers=h)
check("double-claim -> 409", r.status_code == 409, str(r.status_code))
r = c.post("/me/rewards/claim", json={"level": 6, "track": "free"}, headers=h)
check("tier 6 still locked at level 5 -> 403", r.status_code == 403, str(r.status_code))

print("\n== premium gate + purchase ==")
r = c.post("/me/rewards/claim", json={"level": 2, "track": "premium"}, headers=h)
check("premium claim without pass -> 402", r.status_code == 402, str(r.status_code))
r = c.post("/me/pass/purchase", json={"product_id": "premium_pass"}, headers=h)
check("purchase unlocks the pass", r.status_code == 200 and r.json()["premium_active"], r.text[:120])
r = c.post("/me/pass/purchase", json={"product_id": "nonsense"}, headers=h)
check("unknown product -> 400", r.status_code == 400, str(r.status_code))
r = c.post("/me/pass/purchase", json={"product_id": "premium_pass"}, headers=h)
check("re-purchase is a harmless no-op", r.status_code == 200, str(r.status_code))

print("\n== premium claims ==")
e0 = c.get("/me/energy", headers=h).json()["energy"]
r = c.post("/me/rewards/claim", json={"level": 2, "track": "premium"}, headers=h)
check("premium tier 2 claims", r.status_code == 200, r.text[:120])
e1 = r.json()["energy"]["energy"]
check("+25 energy actually landed (capped ok)", e1 == min(e0 + 25, r.json()["energy"]["energy_max"]), f"{e0} -> {e1}")
r = c.post("/me/rewards/claim", json={"level": 5, "track": "premium"}, headers=h)
check("premium tier 5 grants a RARE lootbox",
      r.status_code == 200 and any(rw["key"] == "rare" for rw in r.json()["rewards"]), r.text[:120])
p = c.get("/me/progression", headers=h).json()
check("two pending lootboxes now", len(p["pending_lootboxes"]) == 2, str(p["pending_lootboxes"]))
check("free tier 5 claim didn't collide with premium tier 5",
      {"level": 5, "track": "premium"} in p["claims"] and {"level": 5, "track": "free"} in p["claims"],
      str(p["claims"]))

print("\n== 0015 backfill semantics ==")
# Simulate a pre-0015 veteran: reward_level=3 with no claims, then run the
# migration's backfill SQL and confirm tiers 1-3 come out claimed.
db.execute(text("DELETE FROM reward_claims WHERE user_id = :u"), {"u": uid})
db.execute(text("UPDATE users SET reward_level = 3 WHERE id = :u"), {"u": uid})
db.commit()
db.execute(text(
    "INSERT INTO reward_claims (user_id, level, track) "
    "SELECT u.id, gs.level, 'free' FROM users u "
    "CROSS JOIN LATERAL generate_series(1, COALESCE(u.reward_level, 0)) AS gs(level) "
    "WHERE COALESCE(u.reward_level, 0) > 0 AND u.id = :u ON CONFLICT DO NOTHING"
), {"u": uid})
db.commit()
p = c.get("/me/progression", headers=h).json()
got = {(cl["level"], cl["track"]) for cl in p["claims"]}
check("backfill marked free 1-3 claimed", {(1, "free"), (2, "free"), (3, "free")} <= got, str(sorted(got)))
r = c.post("/me/rewards/claim", json={"level": 2, "track": "free"}, headers=h)
check("backfilled tier can't be re-claimed -> 409", r.status_code == 409, str(r.status_code))
r = c.post("/me/rewards/claim", json={"level": 4, "track": "free"}, headers=h)
check("un-backfilled tier 4 still claimable", r.status_code == 200, r.text[:120])

# cleanup
for t in ("reward_claims", "user_unlocks", "notif_prefs", "notifications"):
    db.execute(text(f"DELETE FROM {t} WHERE user_id = :u"), {"u": uid})
db.execute(text("DELETE FROM users WHERE id = :u"), {"u": uid})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
