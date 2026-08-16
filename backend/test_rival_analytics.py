"""Rival Analytics — the PRO read of a rivalry (routes/rivals.py `_analytics`).

    .venv/Scripts/python.exe test_rival_analytics.py

The rivalry ledger is seeded directly here rather than by running the claim
engine: these are assertions about how beats are COUNTED, and driving real
claims to produce an exact streak would test the geometry instead.

The load-bearing case is the last one. PRO is allowed to deepen a rivalry and
never to gate it, so a free runner must still receive the card, the totals and
the full blow-by-blow — everything that says who is winning — with only the
analysis withheld. If that ever inverts, the monetisation has started selling
advantage and this is where it should fail.
"""
import os, sys, uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
LAT, LON = 1.3521, 103.8198  # Singapore, where the copy examples live


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def beat(attacker, victim, *, area, defended, days_ago, lat=LAT, lon=LON):
    """One row in the rivalry ledger, placed in the past."""
    db.execute(
        text(
            "INSERT INTO territory_steals (attacker_id, victim_id, area_m2, defended, lat, lon, created_at) "
            "VALUES (CAST(:a AS uuid), CAST(:v AS uuid), :area, :d, :lat, :lon, now() - make_interval(days => :ago))"
        ),
        {"a": attacker, "v": victim, "area": area, "d": defended,
         "lat": lat, "lon": lon, "ago": days_ago},
    )


def run_for(uid, *, metres, days_ago):
    db.execute(
        text(
            "INSERT INTO runs (id, user_id, started_at, ended_at, distance_m, duration_s, verified) "
            "VALUES (gen_random_uuid(), CAST(:u AS uuid), now() - make_interval(days => :ago), "
            "        now() - make_interval(days => :ago), :m, 1800, true)"
        ),
        {"u": uid, "m": metres, "ago": days_ago},
    )


def detail(headers, other):
    r = c.get(f"/me/rivals/{other}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


h, me = signup(f"rivA{tag}")
h2, them = signup(f"rivB{tag}")
db = SessionLocal()

# A rivalry with a shape worth reading: they opened it 40 days ago, took ground
# twice, I bounced one of their attacks, then I took ground three times running.
beat(them, me, area=4000, defended=False, days_ago=40)
beat(them, me, area=3000, defended=False, days_ago=30)
beat(them, me, area=2000, defended=True, days_ago=20)   # their attack bounced
beat(me, them, area=5000, defended=False, days_ago=9)
beat(me, them, area=6000, defended=False, days_ago=5)
beat(me, them, area=7000, defended=False, days_ago=1)
# One skirmish a long way from the rest, so the battleground count has
# something to exclude.
beat(me, them, area=100, defended=True, days_ago=3, lat=LAT + 0.4, lon=LON + 0.4)
run_for(me, metres=42000, days_ago=10)
run_for(me, metres=8000, days_ago=200)                  # outside the window
run_for(them, metres=38000, days_ago=12)
db.commit()

print("\n== a free runner keeps the whole rivalry ==")
free = detail(h, them)
check("the card is there", free["rival"]["user_id"] == them, str(free["rival"].get("user_id")))
check("the totals are there", free["rival"]["you_took_m2"] > 0, str(free["rival"]["you_took_m2"]))
check("who is ahead is visible", free["rival"]["net_m2"] != 0, str(free["rival"]["net_m2"]))
check("the blow-by-blow is complete", len(free["events"]) == 7, str(len(free["events"])))
check("only the ANALYSIS is withheld", free["analytics"] is None, str(free["analytics"]))

print("\n== with PRO ==")
c.post("/me/pro/subscribe", json={"product_id": "paser_pro_monthly"}, headers=h)
pro = detail(h, them)
a = pro["analytics"]
check("analytics arrive", a is not None, str(a))
check("the events did not change", len(pro["events"]) == len(free["events"]))
check("every beat is counted", a["total_beats"] == 7, str(a["total_beats"]))
check("first met is the oldest beat",
      a["first_met"] and (datetime.utcnow() - datetime.fromisoformat(a["first_met"])).days >= 39,
      str(a["first_met"]))

print("\n== defence rate reads the right way round ==")
# They attacked 3 times and bounced once → MY defence rate is 1/3.
check("your defence rate is the share of THEIR attacks that failed",
      abs(a["your_defence_rate"] - 1 / 3) < 0.01, str(a["your_defence_rate"]))
# I attacked 4 times and bounced once → THEIR defence rate is 1/4.
check("their defence rate is the share of YOUR attacks that failed",
      abs(a["their_defence_rate"] - 1 / 4) < 0.01, str(a["their_defence_rate"]))

print("\n== streak ==")
check("three takes in a row, my way", a["streak"] == 3, str(a["streak"]))
beat(them, me, area=900, defended=False, days_ago=0)
db.commit()
a2 = detail(h, them)["analytics"]
check("a take the other way flips it", a2["streak"] == -1, str(a2["streak"]))
check("a bounced attack does not break a run of takes",
      detail(h, them)["analytics"]["streak"] == -1, "the defence at day 20 sits inside their old run")

print("\n== current form, not career ==")
check("your 30 day distance excludes the old run",
      abs(a["your_distance_m_30d"] - 42000) < 1, str(a["your_distance_m_30d"]))
check("theirs is counted too", abs(a["their_distance_m_30d"] - 38000) < 1, str(a["their_distance_m_30d"]))
check("your recent takes", a["your_beats_30d"] == 3, str(a["your_beats_30d"]))
# Both of their takes are 30 and 40 days old, so the window excludes them —
# which is the point of having a window. Career totals live on the card.
check("their recent takes exclude what fell out of the window",
      a["their_beats_30d"] == 0, str(a["their_beats_30d"]))

print("\n== the battleground ==")
check("it lands near where the fighting is",
      abs(a["battleground_lat"] - LAT) < 0.1 and abs(a["battleground_lon"] - LON) < 0.1,
      f"{a['battleground_lat']}, {a['battleground_lon']}")
check("the distant skirmish is not counted as part of it",
      a["battleground_beats"] == 6, str(a["battleground_beats"]))

print("\n== symmetry: PRO is not surveillance ==")
# Everything above is derived from beats BOTH runners took part in. The rival
# subscribing sees the mirror image, never more.
c.post("/me/pro/subscribe", json={"product_id": "paser_pro_monthly"}, headers=h2)
theirs = detail(h2, me)["analytics"]
mine = detail(h, them)["analytics"]
check("both sides see the same number of beats",
      theirs["total_beats"] == mine["total_beats"], f"{theirs['total_beats']} vs {mine['total_beats']}")
check("the streak is exactly inverted", theirs["streak"] == -mine["streak"],
      f"{theirs['streak']} vs {mine['streak']}")
check("defence rates swap places",
      theirs["your_defence_rate"] == mine["their_defence_rate"],
      f"{theirs['your_defence_rate']} vs {mine['their_defence_rate']}")

print("\n== a rivalry that does not exist ==")
r = c.get(f"/me/rivals/{me}", headers=h)
check("you cannot be your own rival", r.status_code == 400, str(r.status_code))

# cleanup
for u in (me, them):
    for t, col in (("territory_steals", "attacker_id"), ("territory_steals", "victim_id"),
                   ("pro_subscriptions", "user_id"), ("runs", "user_id"),
                   ("notif_prefs", "user_id"), ("notifications", "user_id")):
        db.execute(text(f"DELETE FROM {t} WHERE {col}::text = :u"), {"u": u})
    db.execute(text("DELETE FROM users WHERE id::text = :u"), {"u": u})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
