"""Post-run Territory Insights — GET /runs/{run_id}/insights.

    .venv/Scripts/python.exe test_run_insights.py

"Show the accomplishment, paywall the rabbit hole." The free half must carry
everything the runner just DID, including where they now stand; PRO adds the
analysis. The first block below is the one that matters — if a free runner ever
stops being told what happened in their own run, the split has gone wrong.

Also covers the two things that were wrong when this was first written: a
personal best measured against a maximum that already included the run being
judged (so every run tied its own record), and a 30 day rate that was declared
and never computed.
"""
import os, sys, uuid, json
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
LAT = -33.9 + (int(tag, 16) % 300) * 0.01
LON = -68.4


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def make_run(uid, *, distance_m, territory_m2, victims=(), stolen_m2=0.0, days_ago=0):
    """A finished, claimed run with a stored claim result — the shape the
    insights read. Built directly so the numbers under test are exact."""
    result = {
        "territory": {"area_m2": territory_m2},
        "stolen_m2": stolen_m2,
        "victims": list(victims),
    }
    return db.execute(
        text(
            """
            INSERT INTO runs (id, user_id, started_at, ended_at, distance_m, duration_s,
                              verified, claimed_at, claim_result)
            VALUES (gen_random_uuid(), CAST(:u AS uuid),
                    timezone('utc', now()) - make_interval(days => :ago),
                    timezone('utc', now()) - make_interval(days => :ago),
                    :d, 1800, true, now(), CAST(:res AS jsonb))
            RETURNING id::text
            """
        ),
        {"u": uid, "d": distance_m, "ago": days_ago, "res": json.dumps(result)},
    ).scalar()


def give_land(uid, area_m2, *, expires_days=30.0):
    db.execute(
        text(
            """
            INSERT INTO territories (id, user_id, polygon, area_m2, created_at, verified,
                                     strength, reinforcements, expires_at)
            VALUES (gen_random_uuid(), CAST(:u AS uuid),
                    ST_Multi(ST_Buffer(ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, 50)::geometry),
                    :a, now(), true, 1, 0, now() + make_interval(secs => :exp))
            """
        ),
        {"u": uid, "a": area_m2, "lat": LAT, "lon": LON, "exp": expires_days * 86400},
    )


db = SessionLocal()
h, me = signup(f"insA{tag}")
h_other, other = signup(f"insB{tag}")

VICTIMS = [
    {"user_id": other, "username": "rivalone", "area_m2": 4000.0, "defended": False},
    {"user_id": other, "username": "rivaltwo", "area_m2": 9000.0, "defended": False},
    {"user_id": other, "username": "wallguy", "area_m2": 500.0, "defended": True},
]
run_id = make_run(me, distance_m=5800, territory_m2=140_000, victims=VICTIMS, stolen_m2=13_000)
give_land(me, 140_000)
db.commit()

print("\n== the accomplishment is free ==")
r = c.get(f"/runs/{run_id}/insights", headers=h)
check("insights load without PRO", r.status_code == 200, r.text[:150])
d = r.json()
check("distance is there", abs(d["distance_m"] - 5800) < 1, str(d["distance_m"]))
check("the territory is there", abs(d["territory_m2"] - 140_000) < 1, str(d["territory_m2"]))
check("land taken off rivals", abs(d["stolen_m2"] - 13_000) < 1, str(d["stolen_m2"]))
check("rivals taken from", d["rivals_taken"] == 2, str(d["rivals_taken"]))
check("rivals who held", d["rivals_held"] == 1, str(d["rivals_held"]))
check("the biggest single capture", abs(d["biggest_capture_m2"] - 9000) < 1, str(d["biggest_capture_m2"]))
check("and where they stand, without paying", d["standing_rank"] is not None, str(d))
check("with a field to stand in", d["standing_field"] > 0, str(d["standing_field"]))
check("the analysis is withheld", d["pro"] is None, str(d["pro"]))

print("\n== land gained is honest about what it cannot know ==")
# No territory_events row: this run was built directly, exactly like every run
# claimed before migration 0038 existed.
check("null rather than a number meaning something else",
      d["land_gained_m2"] is None, str(d["land_gained_m2"]))
db.execute(
    text("INSERT INTO territory_events (actor_id, run_id, kind, area_m2) "
         "VALUES (CAST(:u AS uuid), CAST(:r AS uuid), 'claim', 55000)"),
    {"u": me, "r": run_id},
)
db.commit()
d2 = c.get(f"/runs/{run_id}/insights", headers=h).json()
check("and the real figure once the log has it",
      abs(d2["land_gained_m2"] - 55_000) < 1, str(d2["land_gained_m2"]))

print("\n== the rabbit hole needs PRO ==")
c.post("/me/pro/subscribe", json={"product_id": "paser_pro_monthly"}, headers=h)
p = c.get(f"/runs/{run_id}/insights", headers=h).json()["pro"]
check("analysis arrives", p is not None, "no pro block")
check("what the run was worth per km",
      p["m2_per_km"] and abs(p["m2_per_km"] - 140_000 / 5.8) < 1, str(p["m2_per_km"]))
check("recent claims are counted", p["claims_30d"] >= 1, str(p["claims_30d"]))
check("recent distance is counted", p["distance_m_30d"] >= 5800, str(p["distance_m_30d"]))
check("a 30 day rate is actually computed, not just declared",
      p["m2_per_km_30d"] is not None and p["m2_per_km_30d"] > 0, str(p["m2_per_km_30d"]))

print("\n== a personal best is measured against OTHER runs ==")
# The run being judged is already in the table. Comparing against a maximum
# that includes it makes every run tie its own record.
check("a first run has no record to beat", p["is_personal_best"] is False, str(p))
check("and no best is reported yet", p["best_territory_m2"] is None, str(p["best_territory_m2"]))

small = make_run(me, distance_m=3000, territory_m2=40_000, days_ago=2)
db.commit()
ps = c.get(f"/runs/{small}/insights", headers=h).json()["pro"]
check("a smaller later run is not a best", ps["is_personal_best"] is False, str(ps["is_personal_best"]))
check("and it knows what the record is",
      abs(ps["best_territory_m2"] - 140_000) < 1, str(ps["best_territory_m2"]))

big = make_run(me, distance_m=9000, territory_m2=300_000, days_ago=1)
db.commit()
pb = c.get(f"/runs/{big}/insights", headers=h).json()["pro"]
check("a bigger one IS a best", pb["is_personal_best"] is True, str(pb["is_personal_best"]))

tie = make_run(me, distance_m=9000, territory_m2=300_000, days_ago=0)
db.commit()
pt = c.get(f"/runs/{tie}/insights", headers=h).json()["pro"]
check("a tie is not a new record", pt["is_personal_best"] is False, str(pt["is_personal_best"]))

print("\n== land about to decay ==")
check("nothing at risk yet", pb["at_risk_count"] == 0, str(pb["at_risk_count"]))
give_land(me, 22_000, expires_days=1)
db.commit()
pr = c.get(f"/runs/{big}/insights", headers=h).json()["pro"]
check("land expiring inside the window is flagged", pr["at_risk_count"] == 1, str(pr["at_risk_count"]))
check("with how much of it there is", abs(pr["at_risk_m2"] - 22_000) < 1, str(pr["at_risk_m2"]))
check("and when the first of it goes", pr["soonest_expiry_at"] is not None, str(pr))

print("\n== somebody else's run ==")
r = c.get(f"/runs/{run_id}/insights", headers=h_other)
check("is a 404, not a 403 that confirms it exists", r.status_code == 404, str(r.status_code))

# cleanup
ids = [me, other]
db.execute(text("DELETE FROM territory_events WHERE actor_id::text = ANY(:i)"), {"i": ids})
for t in ("territories", "pro_subscriptions", "runs", "notif_prefs", "notifications"):
    db.execute(text(f"DELETE FROM {t} WHERE user_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": ids})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
