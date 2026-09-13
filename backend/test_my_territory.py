"""Your land — GET /me/territory (routes/my_territory.py) and the expiry log.

    .venv/Scripts/python.exe test_my_territory.py

Needs the local database, no server. Plots and beats are planted directly:
these are assertions about how the page READS the board, and producing an
exact set of clocks and fights through the claim engine would test the claim
engine instead.

The load-bearing checks:
  * the page and the stat wall agree to the square metre (one predicate),
  * a defence is counted on the plot it happened on, not the plot next door,
  * land a sweep collects leaves a `faded` beat behind: once, only for
    verified ground, dated when it expired rather than when it was swept,
  * and a sweep whose log write fails still sweeps.
"""
import math, os, random, sys, uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app import territory_history
from app.database import SessionLocal
from app.main import app
from app.routes import runs as runs_route

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
# Somewhere in Singapore, different every run. Nothing here is spatial across
# runners, but a fixed spot would still collect every failed run's leftovers.
LAT = 1.33 + random.random() * 0.05
LON = 103.75 + random.random() * 0.1
H = 3600.0


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def square(lat, lon, metres):
    """A WKT square `metres` on a side with its south west corner at lat, lon."""
    dlat = metres / 111320.0
    dlon = metres / (111320.0 * math.cos(math.radians(lat)))
    return (
        f"POLYGON(({lon} {lat}, {lon + dlon} {lat}, {lon + dlon} {lat + dlat}, "
        f"{lon} {lat + dlat}, {lon} {lat}))"
    )


def east(lon, lat, metres):
    return lon + metres / (111320.0 * math.cos(math.radians(lat)))


def north(lat, metres):
    return lat + metres / 111320.0


def plant(uid, wkt, *, left_h, age_h=72.0, verified=True, reinforcements=0):
    """A territory row whose clock has `left_h` hours to run (negative = dead)."""
    return db.execute(
        text(
            """
            INSERT INTO territories
                (id, user_id, run_id, polygon, area_m2, created_at, verified,
                 clan_id, strength, reinforcements, expires_at)
            VALUES
                (gen_random_uuid(), CAST(:u AS uuid), NULL,
                 ST_Multi(ST_GeomFromText(:wkt, 4326)),
                 ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                 now() - make_interval(secs => :age), :v, NULL, 1.0, :rf,
                 now() + make_interval(secs => :left))
            RETURNING id::text, area_m2
            """
        ),
        {"u": uid, "wkt": wkt, "age": age_h * H, "v": verified, "rf": reinforcements,
         "left": left_h * H},
    ).fetchone()


def beat(kind, actor, victim, wkt, *, ago_h):
    db.execute(
        text(
            """
            INSERT INTO territory_events
                (actor_id, victim_id, run_id, kind, area_m2, ground, lat, lon, created_at)
            SELECT CAST(:a AS uuid), CAST(:v AS uuid), NULL, :k,
                   ST_Area(s.g::geography), s.g, ST_Y(ST_Centroid(s.g)), ST_X(ST_Centroid(s.g)),
                   now() - make_interval(secs => :ago)
            FROM (SELECT ST_Multi(ST_GeomFromText(:wkt, 4326)) AS g) s
            """
        ),
        {"a": actor, "v": victim, "k": kind, "wkt": wkt, "ago": ago_h * H},
    )


def land(headers):
    r = c.get("/me/territory", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def parse(iso):
    return datetime.fromisoformat(iso.replace("Z", ""))


h, me = signup(f"landA{tag}")
_, rival = signup(f"landB{tag}")
_, other = signup(f"landC{tag}")
db = SessionLocal()

# Two plots side by side, sharing an edge: the west one fades tonight, the east
# one was re-run twice and has days left. A third, shadow-flagged plot the
# owner can still see. And one that died two hours ago and has not been swept.
p1 = plant(me, square(LAT, LON, 100), left_h=10, age_h=72)
p2 = plant(me, square(LAT, east(LON, LAT, 100), 100), left_h=120, age_h=24, reinforcements=2)
p3 = plant(me, square(north(LAT, 400), LON, 60), left_h=72, verified=False)
dead = plant(me, square(north(LAT, 800), LON, 50), left_h=-2)

# A defence on the EAST plot, right up against the shared edge, five hours ago.
beat("defend", rival, me, square(north(LAT, 40), east(LON, LAT, 100), 20), ago_h=5)
# An older defence on the same ground, outside the week, inside the fortnight.
beat("defend", rival, me, square(north(LAT, 40), east(LON, LAT, 100), 20), ago_h=240)
# Ground taken off me two days ago, just north of the west plot.
beat("steal", rival, me, square(north(LAT, 100), LON, 30), ago_h=48)
# My own ground running out, a day ago.
beat("expire", me, None, square(north(LAT, 1200), LON, 40), ago_h=24)
# Too old for the page at all.
beat("steal", rival, me, square(north(LAT, 1600), LON, 30), ago_h=20 * 24)
# Somebody else's fight, which is none of my business.
beat("steal", rival, other, square(north(LAT, 2000), LON, 30), ago_h=3)
db.commit()

print("\n== the page agrees with the stat wall ==")
out = land(h)
stats = c.get("/me/stats", headers=h).json()
s = out["summary"]
check("the same number of plots as Zones", s["plots"] == stats["territory_count"] == 3,
      f"{s['plots']} vs {stats['territory_count']}")
check("the same area as Area held", abs(s["area_m2"] - stats["total_area_m2"]) < 0.01,
      f"{s['area_m2']} vs {stats['total_area_m2']}")
check("dead ground is not held", all(p["id"] != dead[0] for p in out["plots"]))

print("\n== plots, soonest to fade first ==")
ids = [p["id"] for p in out["plots"]]
check("ordered by what expires first", ids == [p1[0], p3[0], p2[0]], str(ids))
by_id = {p["id"]: p for p in out["plots"]}
west, east_plot, flagged = by_id.get(p1[0], {}), by_id.get(p2[0], {}), by_id.get(p3[0], {})
check("ten hours left is fading", west.get("fading") is True)
check("five days left is not", east_plot.get("fading") is False)
check("one plot fading in the summary", s["fading_plots"] == 1, str(s["fading_plots"]))
left = (parse(west["expires_at"]) - datetime.utcnow()).total_seconds() / H
check("the clock is right, whatever zone the database keeps", abs(left - 10) < 0.05, f"{left:.3f}h")
age = (datetime.utcnow() - parse(west["claimed_at"])).total_seconds() / H
check("claimed three days ago", abs(age - 72) < 0.05, f"{age:.3f}h")
check("life left is the share of its life still to run",
      abs(west["life_left"] - 10 / 82) < 0.01, str(west["life_left"]))
check("reinforcements come through", east_plot.get("reinforcements") == 2)
check("shadow-flagged ground is listed for its owner", bool(flagged))
check("without saying it was flagged", bool(flagged) and "verified" not in flagged)
check("every plot has an outline to draw",
      all(p["rings"] and len(p["rings"][0]) >= 4 for p in out["plots"]))
check("and bounds that contain its point",
      all(p["bbox"][0] <= p["lon"] <= p["bbox"][2] and p["bbox"][1] <= p["lat"] <= p["bbox"][3]
          for p in out["plots"]))

print("\n== a defence belongs to the plot it happened on ==")
check("the east plot held one attack this week", east_plot.get("held") == 1, str(east_plot.get("held")))
check("the plot next door, touching that ground, held none", west.get("held") == 0,
      str(west.get("held")))
check("and when", east_plot.get("last_held_at") is not None)

print("\n== history ==")
kinds = [b["kind"] for b in out["history"]]
check("newest first, fortnight only, mine only", kinds == ["held", "faded", "lost", "held"], str(kinds))
lost = next(b for b in out["history"] if b["kind"] == "lost")
# Signup stores usernames lowercased.
check("the loss names who took it", lost["rival_username"] == f"landB{tag}".lower(),
      str(lost["rival_username"]))
check("and wears their rank", bool(lost["rival_rank_key"]))
faded = next(b for b in out["history"] if b["kind"] == "faded")
check("fading has no rival", faded["rival_id"] is None and faded["rival_username"] is None)
check("the week's losses", s["lost_times"] == 1 and abs(s["lost_m2"] - 900) < 30,
      f"{s['lost_times']} / {s['lost_m2']}")
check("the week's defences", s["held_times"] == 1, str(s["held_times"]))
check("the week's fades", s["faded_times"] == 1, str(s["faded_times"]))

print("\n== a sweep leaves a faded beat behind ==")
x1 = plant(me, square(north(LAT, 2400), LON, 40), left_h=-3)
x2 = plant(me, square(north(LAT, 2800), LON, 40), left_h=-3, verified=False)
x3 = plant(me, square(north(LAT, 3200), LON, 4), left_h=-3)  # 16 m², a sliver
db.commit()
scope = "AND t.user_id = CAST(:scope_u AS uuid)"
swept = runs_route._collect_expired(db, scope, {"scope_u": me})
db.commit()
check("every dead row of mine is collected", len(swept) == 4, str(len(swept)))
gone = db.execute(
    text("SELECT COUNT(*) FROM territories WHERE id::text = ANY(:i)"),
    {"i": [x1[0], x2[0], x3[0], dead[0]]},
).scalar()
check("and gone from the board", gone == 0, str(gone))
logged = db.execute(
    text(
        "SELECT area_m2, EXTRACT(EPOCH FROM (now() - created_at)) FROM territory_events "
        "WHERE actor_id = CAST(:u AS uuid) AND kind = 'expire' "
        "AND created_at > now() - interval '6 hours' ORDER BY created_at"
    ),
    {"u": me},
).fetchall()
check("verified ground above the sliver floor is logged, once each", len(logged) == 2, str(logged))
check("dated when it expired, not when it was swept",
      logged and abs(float(logged[0][1]) - 3 * H) < 120, str(logged[:1]))
check("the live plots were not touched",
      db.execute(text("SELECT COUNT(*) FROM territories WHERE id::text = ANY(:i)"),
                 {"i": [p1[0], p2[0], p3[0]]}).scalar() == 3)
after = land(h)
check("the page shows them faded", after["summary"]["faded_times"] == 3,
      str(after["summary"]["faded_times"]))

print("\n== a log write that fails still sweeps ==")
y1 = plant(me, square(north(LAT, 3600), LON, 40), left_h=-1)
db.commit()
real = territory_history.EXPIRE
territory_history.EXPIRE = "not_a_kind"   # the CHECK constraint refuses it
try:
    swept = runs_route._collect_expired(db, scope, {"scope_u": me})
    db.commit()
finally:
    territory_history.EXPIRE = real
check("the dead row is still collected", len(swept) == 1, str(len(swept)))
check("and the session is still usable afterwards",
      db.execute(text("SELECT COUNT(*) FROM territories WHERE id::text = :i"),
                 {"i": y1[0]}).scalar() == 0)

# cleanup
ids = [me, rival, other]
db.execute(text("DELETE FROM territory_events WHERE actor_id::text = ANY(:i) OR victim_id::text = ANY(:i)"),
           {"i": ids})
db.execute(text("DELETE FROM territories WHERE user_id::text = ANY(:i)"), {"i": ids})
for t in ("notif_prefs", "notifications"):
    db.execute(text(f"DELETE FROM {t} WHERE user_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": ids})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
