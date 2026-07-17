"""End-to-end exercise of the paser (mutual friends) flow.

Runs against the real app + the real dev DB via TestClient, then deletes the
three throwaway users it made. Needs httpx (TestClient's transport).

    .venv/Scripts/python.exe test_pasers.py

Covers: username search, request/accept/decline, the cross-request auto-accept,
symmetry of the pair, no decline tombstone, removal cutting only one pair, and
the request_id plumbing that lets a search hit or a profile answer a request.
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


def mk(name):
    r = c.post("/auth/signup", json={"username": f"{name}{tag}", "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


print("\n== setup ==")
alice_h, alice = mk("alice")
bob_h, bob = mk("bob")
cara_h, cara = mk("cara")
print(f"  alice={alice[:8]} bob={bob[:8]} cara={cara[:8]}")

print("\n== search ==")
r = c.get(f"/pasers/search?q=bob{tag[:3]}", headers=alice_h)
check("search finds bob", r.status_code == 200 and any(x["user_id"] == bob for x in r.json()), r.text[:120])
check("search state is 'none' pre-request", r.json()[0]["state"] == "none" if r.json() else False)
r = c.get(f"/pasers/search?q=alice{tag[:3]}", headers=alice_h)
check("search excludes self", all(x["user_id"] != alice for x in r.json()))

print("\n== request -> accept ==")
r = c.post("/pasers/requests", json={"user_id": bob}, headers=alice_h)
check("alice requests bob", r.status_code == 200, r.text[:160])
check("state now pending_out for alice", r.json().get("state") == "pending_out", str(r.json()))

r = c.post("/pasers/requests", json={"user_id": bob}, headers=alice_h)
check("duplicate request rejected (409)", r.status_code == 409, str(r.status_code))

r = c.post("/pasers/requests", json={"user_id": alice}, headers=alice_h)
check("self-request rejected (400)", r.status_code == 400, str(r.status_code))

r = c.get("/pasers", headers=bob_h)
inc = r.json()["incoming"]
check("bob sees 1 incoming", len(inc) == 1 and inc[0]["user_id"] == alice, str(r.json()))
check("incoming state is pending_in", inc[0]["state"] == "pending_in" if inc else False)
link_id = inc[0]["request_id"] if inc else None

r = c.get("/pasers", headers=alice_h)
check("alice sees 1 outgoing", len(r.json()["outgoing"]) == 1, str(r.json()))

# the requester must not be able to accept their own request
r = c.post(f"/pasers/requests/{link_id}/accept", headers=alice_h)
check("requester cannot self-accept (403)", r.status_code == 403, str(r.status_code))

r = c.post(f"/pasers/requests/{link_id}/accept", headers=bob_h)
check("bob accepts", r.status_code == 200 and r.json()["state"] == "paser", r.text[:160])

r = c.post(f"/pasers/requests/{link_id}/accept", headers=bob_h)
check("re-accept rejected (409)", r.status_code == 409, str(r.status_code))

for who, h, other in (("alice", alice_h, bob), ("bob", bob_h, alice)):
    r = c.get("/pasers", headers=h)
    ps = r.json()["pasers"]
    check(f"{who} has 1 paser (symmetric)", len(ps) == 1 and ps[0]["user_id"] == other, str(r.json()))

print("\n== search carries request_id so a pending_in hit can be accepted ==")
# cara asks bob; bob then SEARCHES cara and must be able to accept from the result
r = c.post("/pasers/requests", json={"user_id": bob}, headers=cara_h)
check("cara requests bob", r.status_code == 200, r.text[:120])
hit = [x for x in c.get(f"/pasers/search?q=cara{tag[:3]}", headers=bob_h).json() if x["user_id"] == cara]
check("bob's search finds cara", len(hit) == 1, str(hit))
check("search hit state = pending_in", hit[0]["state"] == "pending_in" if hit else False, str(hit))
check("search hit carries request_id", bool(hit and hit[0].get("request_id")), str(hit))
r = c.post(f"/pasers/requests/{hit[0]['request_id']}/accept", headers=bob_h)
check("bob accepts straight from the search row", r.status_code == 200 and r.json()["state"] == "paser", r.text[:160])
c.delete(f"/pasers/{cara}", headers=bob_h)  # reset for the decline block below

print("\n== profile carries request_id for pending_in ==")
r = c.post("/pasers/requests", json={"user_id": bob}, headers=cara_h)
prof = c.get(f"/users/{cara}/profile", headers=bob_h).json()
check("profile state = pending_in", prof.get("state") == "pending_in", str(prof.get("state")))
check("profile carries request_id", bool(prof.get("request_id")), str(prof.get("request_id")))
r = c.post(f"/pasers/requests/{prof['request_id']}/decline", headers=bob_h)
check("bob declines from the profile", r.status_code == 200, r.text[:120])

print("\n== mutual-cross auto-accept (cara asks alice while alice->cara pending) ==")
r = c.post("/pasers/requests", json={"user_id": cara}, headers=alice_h)
check("alice requests cara", r.status_code == 200, r.text[:120])
r = c.post("/pasers/requests", json={"user_id": alice}, headers=cara_h)
check("cara's reverse request auto-accepts", r.status_code == 200 and r.json()["state"] == "paser", str(r.json()))
db = SessionLocal()
n = db.execute(text(
    "SELECT COUNT(*) FROM paser_links WHERE (requester_id=:a AND addressee_id=:b) OR (requester_id=:b AND addressee_id=:a)"
), {"a": alice, "b": cara}).scalar()
check("still exactly ONE row for the pair", n == 1, f"rows={n}")

print("\n== profile tap-through ==")
r = c.get(f"/users/{bob}/profile", headers=alice_h)
p = r.json()
check("alice reads bob's profile", r.status_code == 200, r.text[:160])
check("profile state = paser", p.get("state") == "paser", str(p.get("state")))
check("profile paser_count = 1", p.get("paser_count") == 1, str(p.get("paser_count")))
check("profile has stats keys", all(k in p for k in ("level", "total_area_m2", "runs_count", "recent_runs")), str(list(p)[:6]))
r = c.get(f"/users/{alice}/profile", headers=alice_h)
check("own profile state = self", r.json().get("state") == "self", str(r.json().get("state")))
r = c.get(f"/users/{uuid.uuid4()}/profile", headers=alice_h)
check("unknown runner 404s", r.status_code == 404, str(r.status_code))

print("\n== decline ==")
r = c.post("/pasers/requests", json={"user_id": bob}, headers=cara_h)
lid = c.get("/pasers", headers=bob_h).json()["incoming"][0]["request_id"]
r = c.post(f"/pasers/requests/{lid}/decline", headers=bob_h)
check("bob declines cara", r.status_code == 200, r.text[:160])
check("declined -> state back to none", r.json()["state"] == "none", str(r.json()["state"]))
check("bob's incoming now empty", len(c.get("/pasers", headers=bob_h).json()["incoming"]) == 0)
r = c.post("/pasers/requests", json={"user_id": bob}, headers=cara_h)
check("cara can re-request after decline (no tombstone)", r.status_code == 200, r.text[:120])

print("\n== remove / cancel ==")
before = c.get("/pasers", headers=alice_h).json()["pasers"]
check("alice has bob AND cara before removal", {p["user_id"] for p in before} == {bob, cara}, str([p["username"] for p in before]))
r = c.delete(f"/pasers/{bob}", headers=alice_h)
check("alice removes bob", r.status_code == 200, r.text[:120])
after = c.get("/pasers", headers=alice_h).json()["pasers"]
check("bob is gone from alice's pasers", all(p["user_id"] != bob for p in after), str([p["username"] for p in after]))
check("cara survives the removal (only the pair is cut)", {p["user_id"] for p in after} == {cara}, str([p["username"] for p in after]))
check("removal is symmetric (bob's pasers 0)", len(c.get("/pasers", headers=bob_h).json()["pasers"]) == 0)
r = c.delete(f"/pasers/{bob}", headers=alice_h)
check("removing a non-link 404s", r.status_code == 404, str(r.status_code))

print("\n== notif pref column ==")
r = c.get("/me/notif-prefs", headers=alice_h)
check("notif-prefs exposes 'pasers'", "pasers" in r.json(), str(r.json()))
r = c.put("/me/notif-prefs", json={**r.json(), "pasers": False}, headers=alice_h)
check("pasers pref is settable", r.status_code == 200 and r.json()["pasers"] is False, r.text[:120])

# cleanup
for uid in (alice, bob, cara):
    db.execute(text("DELETE FROM paser_links WHERE requester_id=:u OR addressee_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM notifications WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM notif_prefs WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM users WHERE id=:u"), {"u": uid})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
