"""End-to-end exercise of emote reactions and text comments on runs.

Runs against the real app + the real dev DB via TestClient, then deletes the
two throwaway users and the run it made. Needs httpx (TestClient's transport).

    .venv/Scripts/python.exe test_reactions.py

Covers: leaving a reaction, swapping it (one per person, not a pile), the tap
to take it back off, the allowlist, the summary shape on /feed and on the run
detail, `mine` pointing at the viewer's own choice and not somebody else's, and
comments staying text-only while emoji remain reactions.
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


print("\n== setup ==")
alice_h, alice = mk("ralice")
bob_h, bob = mk("rbob")

# A run to react to. Inserted directly: this test is about reactions, and
# driving the whole start/submit/end flow would make it a run test that also
# happens to touch emotes.
run_id = db.execute(
    text(
        """
        INSERT INTO runs (user_id, distance_m, duration_s, started_at, ended_at, verified)
        VALUES (:u, 5000, 1800, now() - interval '30 minutes', now(), TRUE)
        RETURNING id::text
        """
    ),
    {"u": alice},
).scalar()
db.commit()
print(f"  alice={alice[:8]} bob={bob[:8]} run={run_id[:8]}")


def reactions_of(headers):
    r = c.get(f"/runs/{run_id}/reactions", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


print("\n== leaving one ==")
check("a fresh run has no reactions", reactions_of(bob_h)["reactions"] == [])
r = c.post(f"/runs/{run_id}/reactions", json={"emote": "love"}, headers=bob_h)
check("bob leaves 'love'", r.status_code == 200 and r.json()["my_reaction"] == "love", r.text[:160])
check("count is 1", [x["count"] for x in r.json()["reactions"]] == [1], str(r.json()))
check("it is marked as bob's own", r.json()["reactions"][0]["mine"] is True, str(r.json()))

print("\n== one per person ==")
r = c.post(f"/runs/{run_id}/reactions", json={"emote": "brutal"}, headers=bob_h)
check("a second emote SWAPS rather than adds", len(r.json()["reactions"]) == 1, str(r.json()))
check("the swap is the new emote", r.json()["my_reaction"] == "brutal", str(r.json()))

print("\n== two people ==")
r = c.post(f"/runs/{run_id}/reactions", json={"emote": "love"}, headers=alice_h)
by_emote = {x["emote"]: x for x in r.json()["reactions"]}
check("both emotes are now on the run", set(by_emote) == {"love", "brutal"}, str(r.json()))
check("alice's own is 'love'", r.json()["my_reaction"] == "love")
check("'mine' is per viewer, not global", by_emote["love"]["mine"] is True and by_emote["brutal"]["mine"] is False, str(r.json()))
bobs = {x["emote"]: x for x in reactions_of(bob_h)["reactions"]}
check("and it flips for bob", bobs["brutal"]["mine"] is True and bobs["love"]["mine"] is False, str(bobs))

print("\n== taking it back off ==")
r = c.post(f"/runs/{run_id}/reactions", json={"emote": "brutal"}, headers=bob_h)
check("tapping your own emote clears it", r.json()["my_reaction"] is None, str(r.json()))
check("the other person's survives", [x["emote"] for x in r.json()["reactions"]] == ["love"], str(r.json()))
r = c.post(f"/runs/{run_id}/reactions", json={"emote": None}, headers=alice_h)
check("null clears too", r.json()["my_reaction"] is None and r.json()["reactions"] == [], str(r.json()))

print("\n== the allowlist ==")
r = c.post(f"/runs/{run_id}/reactions", json={"emote": "definitely_not_an_emote"}, headers=bob_h)
check("an unknown emote is refused", r.status_code == 422, str(r.status_code))
check("and nothing was stored", reactions_of(bob_h)["reactions"] == [])

print("\n== on the feed ==")
c.post(f"/runs/{run_id}/reactions", json={"emote": "respect"}, headers=bob_h)
feed = c.get("/feed", headers=bob_h).json()["items"]
row = next((x for x in feed if x["id"] == run_id), None)
check("the run is on bob's feed", row is not None)
if row:
    check("the feed row carries the summary", [x["emote"] for x in row["reactions"]] == ["respect"], str(row["reactions"]))
    check("and bob's own choice", row["my_reaction"] == "respect", str(row["my_reaction"]))
detail = c.get(f"/runs/{run_id}", headers=bob_h).json()
check("the run detail carries it as well", detail["my_reaction"] == "respect", str(detail.get("my_reaction")))

print("\n== text-only comments ==")
r = c.post(f"/runs/{run_id}/comments", json={"emote": "wow"}, headers=bob_h)
check("a sticker cannot become a comment", r.status_code == 422, r.text[:160])
r = c.post(f"/runs/{run_id}/comments", json={"body": "strong pace", "emote": "love"}, headers=bob_h)
check("an extra emote is ignored and text is stored", r.status_code == 200 and r.json()["body"] == "strong pace" and "emote" not in r.json(), r.text[:160])
r = c.post(f"/runs/{run_id}/comments", json={"body": "just words"}, headers=bob_h)
check("text alone works", r.status_code == 200 and r.json()["body"] == "just words", r.text[:160])
r = c.post(f"/runs/{run_id}/comments", json={}, headers=bob_h)
check("an empty comment is refused", r.status_code == 422, str(r.status_code))
r = c.post(f"/runs/{run_id}/comments", json={"body": "   "}, headers=bob_h)
check("whitespace is not a comment", r.status_code == 422, str(r.status_code))
r = c.post(f"/runs/{run_id}/comments", json={"body": "hi", "emote": "not_real"}, headers=bob_h)
check("comment emoji never enter the response", r.status_code == 200 and "emote" not in r.json(), r.text[:160])
listed = c.get(f"/runs/{run_id}/comments", headers=bob_h).json()
check("comments read back as text only", [x["body"] for x in listed] == ["strong pace", "just words", "hi"], str(listed))
check("comment responses contain no emote field", all("emote" not in x for x in listed), str(listed))

# cleanup
db.execute(text("DELETE FROM run_reactions WHERE run_id = :r"), {"r": run_id})
db.execute(text("DELETE FROM run_comments WHERE run_id = :r"), {"r": run_id})
db.execute(text("DELETE FROM runs WHERE id = :r"), {"r": run_id})
for uid in (alice, bob):
    db.execute(text("DELETE FROM notifications WHERE user_id=:u OR actor_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM notif_prefs WHERE user_id=:u"), {"u": uid})
    db.execute(text("DELETE FROM users WHERE id=:u"), {"u": uid})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
