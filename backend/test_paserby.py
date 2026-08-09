"""End-to-end exercise of PASERBY (crossed paths).

Runs against the real app + the real dev DB via TestClient, then deletes the
throwaway users it made. Needs httpx (TestClient's transport).

    .venv/Scripts/python.exe test_paserby.py

Covers the acceptance list:

  1  two eligible runs that pass close enough, closely enough in time, make ONE
     encounter — and both runners get it
  2  a run that never qualified makes none
  3  a runner with Crossed Paths off makes none
  4  a blocked pair can never match, and blocking removes the shared history
  5  no response anywhere carries a coordinate, a route or a time
  6  the post-run reveal returns what that run turned up, and marking it seen
     clears the badge
  7  the Crossroads list shows recent encounters
  8  a high five works exactly once, and the daily social-XP ceiling is
     enforced server-side
  9  a repeat crossing bumps the familiar-faces counter and its label...
  10 ...but only after the pair cooldown, so short repeated runs are worthless
  11 hiding is one-sided

The runs are deliberately REWARDS-ONLY (600-900 m): PASERBY's bar is "this was
a real run", not "this run could claim", and staying under the claim bar keeps
the suite off the claim-geometry path it is not testing.
"""

import os
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The suite ends a dozen runs in a few seconds; the production limit is exactly
# what stops that pace for real, so it is relaxed for the harness only. Must be
# set BEFORE app.config is imported.
os.environ.setdefault("RATE_LIMIT_END_RUN", "1000/minute")

import math  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app import paserby  # noqa: E402

c = TestClient(app)
db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Somewhere nobody in the dev database has ever run, so the suite can only ever
# match its own users.
LAT, LON = 12.3456, 45.6789


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def mk(name):
    r = c.post("/auth/signup", json={"username": f"{name}{tag}", "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def loop_points(t0, radius=140.0, n=12, duration=460.0):
    """A regular n-gon traced as GPS points, closing back to the start.

    `t0` is a datetime; two runners handed the same `t0` are literally running
    the same circle at the same moment, which is the crossing this feature
    exists to find.
    """
    pts = []
    for i in range(n + 1):
        ang = 2 * math.pi * (i % n) / n
        dy = radius * math.sin(ang)
        dx = radius * math.cos(ang)
        pts.append(
            {
                "lat": LAT + dy / 111320.0,
                "lon": LON + dx / (111320.0 * math.cos(math.radians(LAT))),
                "t": (t0 + timedelta(seconds=duration * i / n)).isoformat(),
            }
        )
    return pts


def do_run(headers, t0=None, radius=140.0, duration=460.0, n=12):
    """One complete run: start (backdated), end. Returns the run id."""
    t0 = t0 or (datetime.utcnow() - timedelta(seconds=duration + 5))
    r = c.post("/start-run", json={"started_at": t0.isoformat()}, headers=headers)
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    r = c.post(
        "/end-run",
        json={"run_id": run_id, "points": loop_points(t0, radius, n, duration)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return run_id, r.json()


def encounters(headers):
    r = c.get("/me/paserby/encounters", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def traces_for(run_id):
    return db.execute(
        text("SELECT COUNT(*) FROM run_traces WHERE run_id = CAST(:r AS uuid)"), {"r": run_id}
    ).scalar()


# A crossing shared by two runs needs one shared moment. Everything below hangs
# off this: same circle, same clock.
SHARED_T0 = datetime.utcnow() - timedelta(seconds=600)


print("\n== setup ==")
alice_h, alice = mk("pbalice")
bob_h, bob = mk("pbbob")
cara_h, cara = mk("pbcara")
print(f"  alice={alice[:8]} bob={bob[:8]} cara={cara[:8]}")

r = c.get("/me/paserby", headers=alice_h)
check("summary is reachable and reports the switch", r.status_code == 200 and "enabled" in r.json(), r.text[:160])
check("no encounters to start with", r.json().get("total") == 0, str(r.json()))

print("\n== a run that never qualified produces nothing ==")
tiny_id, tiny = do_run(alice_h, radius=8.0, duration=60.0)
check("the 50 m activity is unqualified", tiny["tier"] == "unqualified_for_rewards", tiny["tier"])
check("...so it writes no trace at all", traces_for(tiny_id) == 0, f"traces={traces_for(tiny_id)}")

print("\n== two runs, same place, same minute ==")
a_run, a_res = do_run(alice_h, t0=SHARED_T0)
check("alice's run cleared the reward bar", a_res["tier"] == "qualified_for_rewards_only", a_res["tier"])
check("...and was sampled into traces", traces_for(a_run) > 0, f"traces={traces_for(a_run)}")
b_run, _ = do_run(bob_h, t0=SHARED_T0)

a_list = encounters(alice_h)
b_list = encounters(bob_h)
check("alice has exactly one encounter", a_list["total"] == 1, str(a_list))
check("...and it is bob", a_list["encounters"] and a_list["encounters"][0]["user_id"] == bob, str(a_list))
check("bob has the same encounter, from his side", b_list["total"] == 1
      and b_list["encounters"][0]["user_id"] == alice, str(b_list))
check("the pair produced ONE row, not two",
      db.execute(text(
          "SELECT COUNT(*) FROM paserby_encounters WHERE user_a_id IN (CAST(:a AS uuid), CAST(:b AS uuid)) "
          "AND user_b_id IN (CAST(:a AS uuid), CAST(:b AS uuid))"
      ), {"a": alice, "b": bob}).scalar() == 1)

card = a_list["encounters"][0]
print("\n== what an encounter is allowed to say ==")
LEAKY = ("lat", "lon", "latitude", "longitude", "coord", "coordinates", "path", "route",
         "created_at", "at", "crossed_at", "time", "timestamp", "distance_m", "run_id")
check("no location or time field on the card",
      not [k for k in card if k.lower() in LEAKY], str([k for k in card if k.lower() in LEAKY]))
check("the only temporal answer is a broad phrase",
      card["when"] in ("Earlier today", "Yesterday", "This week", "A while back"), card["when"])
check("it carries the public identity the card needs",
      all(k in card for k in ("username", "avatar", "level", "rank_key", "times_crossed")), str(list(card)))
check("first encounter reads as Crossed Paths",
      card["familiarity"] == "crossed_paths" and card["times_crossed"] == 1, str(card["familiarity"]))
check("it starts unseen", card["seen"] is False and a_list["unseen"] == 1, str(a_list["unseen"]))

print("\n== the post-run reveal ==")
r = c.get(f"/me/paserby/reveal/{a_run}", headers=alice_h)
check("reveal returns this run's new encounters", r.status_code == 200 and r.json()["new_count"] == 1, r.text[:200])
check("...capped at the cast size, with the rest counted",
      r.json()["more_at_crossroads"] == 0 and len(r.json()["encounters"]) == 1, str(r.json()))
r2 = c.get(f"/me/paserby/reveal/{b_run}", headers=alice_h)
check("a run that isn't yours 404s", r2.status_code == 404, str(r2.status_code))

r = c.post("/me/paserby/seen", json={}, headers=alice_h)
check("marking seen clears the badge", r.status_code == 200 and encounters(alice_h)["unseen"] == 0, r.text[:160])
check("...and the reveal for that run is now empty",
      c.get(f"/me/paserby/reveal/{a_run}", headers=alice_h).json()["new_count"] == 0)

print("\n== high five ==")
enc_id = card["id"]
r = c.post(f"/me/paserby/encounters/{enc_id}/high-five", headers=alice_h)
check("alice high-fives bob", r.status_code == 200 and r.json()["high_fived"], r.text[:160])
check("...for a small amount of social XP",
      r.json()["xp_gained"] == settings.paserby_high_five_xp, str(r.json()))
r = c.post(f"/me/paserby/encounters/{enc_id}/high-five", headers=alice_h)
check("a second press pays nothing", r.status_code == 200 and r.json()["already"] and r.json()["xp_gained"] == 0,
      str(r.json()))
check("bob can see he received one", encounters(bob_h)["encounters"][0]["high_five_received"] is True,
      str(encounters(bob_h)["encounters"][0]))
check("...and alice's own card says she sent it", encounters(alice_h)["encounters"][0]["high_fived"] is True)
r = c.post(f"/me/paserby/encounters/{uuid.uuid4()}/high-five", headers=cara_h)
check("high-fiving an encounter you're not in 404s", r.status_code == 404, str(r.status_code))

print("\n== the daily social-XP ceiling ==")
# Spend bob's whole day up front, then let him answer the high five.
db.execute(
    text("INSERT INTO reward_grants (key, user_id, kind, amount) "
         "VALUES (:k, CAST(:u AS uuid), 'social_xp', :a)"),
    {"k": f"test:{tag}:cap", "u": bob, "a": settings.paserby_daily_social_xp_cap},
)
db.commit()
r = c.post(f"/me/paserby/encounters/{enc_id}/high-five", headers=bob_h)
check("bob's high five still lands", r.status_code == 200 and r.json()["high_fived"], r.text[:160])
check("...but pays nothing once the day's cap is spent",
      r.json()["xp_gained"] == 0 and r.json()["capped"] is True, str(r.json()))

print("\n== the pair cooldown ==")
a2, _ = do_run(alice_h, t0=datetime.utcnow() - timedelta(seconds=520))
do_run(bob_h, t0=datetime.utcnow() - timedelta(seconds=520))
check("a second crossing inside the cooldown makes no new encounter",
      encounters(alice_h)["total"] == 1, str(encounters(alice_h)["total"]))

print("\n== familiar faces ==")
# Age the pair past the cooldown, then cross again.
db.execute(
    text("UPDATE paserby_pairs SET last_encounter_at = now() - interval '2 days' "
         "WHERE lower_user_id = LEAST(CAST(:a AS uuid), CAST(:b AS uuid)) "
         "AND higher_user_id = GREATEST(CAST(:a AS uuid), CAST(:b AS uuid))"),
    {"a": alice, "b": bob},
)
db.commit()
t_third = datetime.utcnow() - timedelta(seconds=480)
do_run(alice_h, t0=t_third)
do_run(bob_h, t0=t_third)
after = encounters(alice_h)
check("crossing again after the cooldown adds an encounter", after["total"] == 2, str(after["total"]))
check("...and the counter says two", after["encounters"][0]["times_crossed"] == 2,
      str(after["encounters"][0]["times_crossed"]))
check("...which reads as Familiar Face",
      after["encounters"][0]["familiarity_label"] == "Familiar Face",
      after["encounters"][0]["familiarity_label"])
check("the label ladder is the MVP's four rungs",
      [paserby.familiarity_for(n)[1] for n in (1, 2, 5, 10)]
      == ["Crossed Paths", "Familiar Face", "Running Regular", "Local Legend"])

print("\n== hiding is one-sided ==")
hide_id = after["encounters"][0]["id"]
r = c.post(f"/me/paserby/encounters/{hide_id}/hide", headers=alice_h)
check("alice hides one encounter", r.status_code == 200, r.text[:160])
check("...it leaves her list", encounters(alice_h)["total"] == 1, str(encounters(alice_h)["total"]))
check("...and stays on bob's", encounters(bob_h)["total"] == 2, str(encounters(bob_h)["total"]))

print("\n== Crossed Paths off ==")
r = c.put("/me/paserby", json={"enabled": False}, headers=cara_h)
check("cara turns it off", r.status_code == 200 and r.json()["enabled"] is False, r.text[:160])
t_off = datetime.utcnow() - timedelta(seconds=470)
cara_run, _ = do_run(cara_h, t0=t_off)
do_run(alice_h, t0=t_off)
check("a disabled runner writes no traces", traces_for(cara_run) == 0, f"traces={traces_for(cara_run)}")
check("...and makes no encounters",
      all(e["user_id"] != cara for e in encounters(alice_h)["encounters"]), str(encounters(alice_h)))
r = c.put("/me/paserby", json={"enabled": True}, headers=cara_h)
check("and back on again", r.status_code == 200 and r.json()["enabled"] is True, r.text[:160])

print("\n== blocking ==")
before_block = encounters(bob_h)["total"]
r = c.post("/me/blocks", json={"user_id": bob}, headers=alice_h)
check("alice blocks bob", r.status_code == 200, r.text[:160])
check("the pair's history goes with it", encounters(alice_h)["total"] == 0, str(encounters(alice_h)))
check("...from both sides", encounters(bob_h)["total"] == 0, f"was {before_block}")
t_blocked = datetime.utcnow() - timedelta(seconds=465)
do_run(alice_h, t0=t_blocked)
do_run(bob_h, t0=t_blocked)
check("and a blocked pair can never match again", encounters(alice_h)["total"] == 0, str(encounters(alice_h)))
r = c.post("/me/blocks", json={"user_id": alice}, headers=alice_h)
check("blocking yourself is refused", r.status_code == 400, str(r.status_code))

print("\n== reporting ==")
r = c.post("/me/reports", json={"user_id": cara, "reason": "inappropriate_name"}, headers=alice_h)
check("a report is filed", r.status_code == 200 and r.json().get("report_id"), r.text[:160])
r = c.post("/me/reports", json={"user_id": alice, "reason": "spam"}, headers=alice_h)
check("reporting yourself is refused", r.status_code == 400, str(r.status_code))

print("\n== notification pref ==")
prefs = c.get("/me/notif-prefs", headers=alice_h).json()
check("notif-prefs exposes 'paserby'", "paserby" in prefs, str(prefs))
r = c.put("/me/notif-prefs", json={**prefs, "paserby": False}, headers=alice_h)
check("...and it is settable", r.status_code == 200 and r.json()["paserby"] is False, r.text[:160])
check("...and it PERSISTS", c.get("/me/notif-prefs", headers=alice_h).json()["paserby"] is False,
      str(c.get("/me/notif-prefs", headers=alice_h).json()))

# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------
for uid in (alice, bob, cara):
    for stmt in (
        "DELETE FROM paserby_encounters WHERE user_a_id = CAST(:u AS uuid) OR user_b_id = CAST(:u AS uuid)",
        "DELETE FROM paserby_pairs WHERE lower_user_id = CAST(:u AS uuid) OR higher_user_id = CAST(:u AS uuid)",
        "DELETE FROM paserby_settings WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM user_blocks WHERE blocker_id = CAST(:u AS uuid) OR blocked_id = CAST(:u AS uuid)",
        "DELETE FROM user_reports WHERE reporter_id = CAST(:u AS uuid) OR reported_id = CAST(:u AS uuid)",
        "DELETE FROM run_traces WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM reward_grants WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM run_splits WHERE run_id IN (SELECT id FROM runs WHERE user_id = CAST(:u AS uuid))",
        "DELETE FROM territories WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM runs WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM notifications WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM notif_prefs WHERE user_id = CAST(:u AS uuid)",
        "DELETE FROM users WHERE id = CAST(:u AS uuid)",
    ):
        db.execute(text(stmt), {"u": uid})
db.commit()
db.close()

print("\n" + "=" * 46)
print("ALL PASSED" if not fails else f"{len(fails)} FAILED: " + ", ".join(fails))
sys.exit(1 if fails else 0)
