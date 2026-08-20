"""End-to-end check of the pasers-scoped activity feed.

The Home feed is a Strava-style social timeline: you see your own runs plus
those of your accepted pasers and your clanmates, and nothing else. A
stranger's run never streams past, and a private run is hidden even from
pasers. This exercises all of that against the real app + real dev DB via
TestClient, then deletes the throwaway users and clan it made. Needs httpx.

    .venv/Scripts/python.exe test_feed.py

Covers: own runs shown, paser runs shown, clanmate runs shown, stranger runs
hidden, a paser's private run hidden while the owner still sees it, and the
per-viewer scoping (a clanmate of mine is not automatically in my paser's feed).
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from sqlalchemy import text

c = TestClient(app)
db = SessionLocal()
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


def add_run(uid, visibility="public", verified=True):
    """Insert a completed run directly — the feed only needs ended_at + verified,
    and a synthesised GPS path is beside the point for a scoping test."""
    rid = db.execute(
        text(
            "INSERT INTO runs (user_id, started_at, ended_at, distance_m, duration_s, verified, visibility) "
            "VALUES (:u, now() - interval '30 minutes', now(), 3000, 1800, :v, :vis) "
            "RETURNING id::text"
        ),
        {"u": uid, "v": verified, "vis": visibility},
    ).scalar()
    db.commit()
    return rid


def feed_ids(headers):
    r = c.get("/feed", headers=headers)
    assert r.status_code == 200, r.text
    return {it["id"] for it in r.json()["items"]}, r


print("\n== setup ==")
me_h, me = mk("me")
pal_h, pal = mk("pal")       # will become my paser
mate_h, mate = mk("mate")    # will share my clan
rando_h, rando = mk("rando") # a stranger: neither paser nor clanmate
print(f"  me={me[:8]} pal={pal[:8]} mate={mate[:8]} rando={rando[:8]}")

# me <-> pal become pasers via the real request/accept flow.
c.post("/pasers/requests", json={"user_id": pal}, headers=me_h)
lid = c.get("/pasers", headers=pal_h).json()["incoming"][0]["request_id"]
r = c.post(f"/pasers/requests/{lid}/accept", headers=pal_h)
check("me and pal are pasers", r.status_code == 200 and r.json()["state"] == "paser", r.text[:120])

# me + mate share a clan (inserted directly to skip clan-creation policy).
clan_id = db.execute(
    text("INSERT INTO clans (name, tag) VALUES (:n, :t) RETURNING id::text"),
    {"n": f"clan{tag}", "t": tag[:4]},
).scalar()
for uid in (me, mate):
    db.execute(
        text("INSERT INTO clan_members (clan_id, user_id, role) VALUES (:c, :u, 'member')"),
        {"c": clan_id, "u": uid},
    )
db.commit()
check("clan created with me + mate", clan_id is not None)

print("\n== runs ==")
my_run = add_run(me)
pal_run = add_run(pal)
mate_run = add_run(mate)
rando_run = add_run(rando)
pal_private = add_run(pal, visibility="private")
my_private = add_run(me, visibility="private")

print("\n== my feed: pasers + clanmates + self ==")
mine, _ = feed_ids(me_h)
check("my own run is in my feed", my_run in mine)
check("my paser's run is in my feed", pal_run in mine)
check("my clanmate's run is in my feed", mate_run in mine)
check("a stranger's run is NOT in my feed", rando_run not in mine)
check("my paser's PRIVATE run is hidden from me", pal_private not in mine)
check("my OWN private run is still visible to me", my_private in mine)

print("\n== a stranger's feed cannot see my circle ==")
theirs, _ = feed_ids(rando_h)
check("stranger sees their own run", rando_run in theirs)
check("stranger does NOT see my run", my_run not in theirs)
check("stranger does NOT see my paser's run", pal_run not in theirs)
check("stranger does NOT see my clanmate's run", mate_run not in theirs)

print("\n== scoping is per-viewer, not transitive ==")
pals, _ = feed_ids(pal_h)
check("pal sees their own run", pal_run in pals)
check("pal sees my run (we are pasers)", my_run in pals)
check("pal sees their own private run", pal_private in pals)
check("pal does NOT see my clanmate (mate is not pal's clanmate)", mate_run not in pals)
check("pal does NOT see the stranger's run", rando_run not in pals)

# cleanup
for uid in (me, pal, mate, rando):
    db.execute(text("DELETE FROM runs WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM clan_members WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM paser_links WHERE requester_id=:u OR addressee_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM notifications WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM notif_prefs WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM users WHERE id=:u"), {"u": uid})
db.execute(text("DELETE FROM clans WHERE id=:c"), {"c": clan_id})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
