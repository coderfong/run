"""The territory event log (migration 0038), driven through the real claim
engine rather than by inserting rows by hand.

    .venv/Scripts/python.exe test_territory_history.py

This log ships dark — nothing reads it yet — which is exactly why it needs a
test now. A history that is silently wrong is discovered months later, when
the timeline feature is built on top of it and the past cannot be recollected.

Covers: a neutral claim, a reinforce measuring its OWN ground rather than the
merged territory it joined, a steal attributing only the contested overlap,
a bounced attack, slivers staying out, the point lookup the timeline will use,
and the savepoint that keeps a bad history write from taking a claim with it.
"""
import os, sys, uuid
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from app import territory_history
from app.database import SessionLocal
from app.geospatial import circle_polygon_wgs
from app.routes.runs import _claim_territory

db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Somewhere empty, and somewhere DIFFERENT each run. A fixed spot inherits the
# land left behind by any previous run that failed before its cleanup, and the
# symptom is a 409 on the very first claim — the ghost of the last attempt
# defending its ground.
LAT = -54.5 + (int(tag, 16) % 400) * 0.01
LON = -71.5 + (int(tag[:4], 16) % 400) * 0.01


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def mkuser(name):
    return db.execute(
        text("INSERT INTO users (id, username, created_at) "
             "VALUES (gen_random_uuid(), :n, now()) RETURNING id::text"),
        {"n": name},
    ).scalar()


def claim(uid, lat, lon, radius, strength=1.0):
    out = _claim_territory(
        db=db, user_id=uid, run_id=None,
        polygon_wgs=circle_polygon_wgs(lat, lon, radius),
        initial_area_m2=0.0, strength=strength, verified=True,
        clan_id=None, lifetime_days=30.0,
    )
    db.commit()
    return out


def events(actor=None, kind=None):
    sql = ("SELECT kind, actor_id::text, victim_id::text, area_m2 FROM territory_events "
           "WHERE actor_id::text = ANY(:ids)")
    args = {"ids": [a, b]}
    if actor:
        sql += " AND actor_id::text = :actor"
        args["actor"] = actor
    if kind:
        sql += " AND kind = :kind"
        args["kind"] = kind
    return db.execute(text(sql + " ORDER BY created_at"), args).fetchall()


a = mkuser(f"histA{tag}")
b = mkuser(f"histB{tag}")
db.commit()

print("\n== a claim on empty ground ==")
occupied = db.execute(
    text("SELECT count(*) FROM territories "
         "WHERE ST_DWithin(polygon::geography, "
         "ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, 2000)"),
    {"lat": LAT, "lon": LON},
).scalar()
check("the test ground really is empty", occupied == 0, f"{occupied} territories within 2km")
claim(a, LAT, LON, 120.0)
rows = events(actor=a)
check("one event, and it is a claim", len(rows) == 1 and rows[0][0] == "claim", str(rows))
check("no victim on neutral ground", rows[0][2] is None, str(rows[0][2]))
first_area = float(rows[0][3])
check("its area is the ground claimed", 30_000 < first_area < 60_000, f"{first_area:.0f} m2")

print("\n== the point lookup the timeline will use ==")
hit = db.execute(
    text("SELECT count(*) FROM territory_events "
         "WHERE ST_Contains(ground, ST_SetSRID(ST_Point(:lon, :lat), 4326))"),
    {"lat": LAT, "lon": LON},
).scalar()
check("the claim is findable by a point inside it", hit == 1, str(hit))
miss = db.execute(
    text("SELECT count(*) FROM territory_events "
         "WHERE ST_Contains(ground, ST_SetSRID(ST_Point(:lon, :lat), 4326))"),
    {"lat": LAT + 0.5, "lon": LON + 0.5},
).scalar()
check("and not by a point outside it", miss == 0, str(miss))

print("\n== reinforcing measures its own ground, not the merged total ==")
claim(a, LAT, LON, 120.0)  # same spot again
rows = events(actor=a, kind="reinforce")
check("a repeat claim on your own land is a reinforce", len(rows) == 1, str(rows))
# The merged territory is now ~the same 45k m2, but a naive implementation
# credits the event with the merged row's area_m2, which for a second identical
# claim happens to look right. Claiming a SMALLER circle inside it is what
# separates the two: its own ground is small, the merged total is not.
claim(a, LAT, LON, 40.0)
small = events(actor=a, kind="reinforce")[-1]
small_area = float(small[3])
check("a small reinforce inside big land measures the SMALL ground",
      small_area < first_area / 2, f"{small_area:.0f} m2 vs merged ~{first_area:.0f}")

print("\n== a claim that lands half on your own ground is BOTH beats ==")
# The case the log used to get wrong: any touch of the actor's own land typed
# the whole footprint `reinforce`, so a claim that took a field and clipped its
# own border read back as having won nothing at all. Somewhere clear of every
# other shape in this file.
MLAT, MLON = LAT + 0.02, LON + 0.02
claim(a, MLAT, MLON, 120.0)
n_claim = len(events(actor=a, kind="claim"))
n_reinf = len(events(actor=a, kind="reinforce"))
# ~135 m east — over half a diameter, so the new stamp keeps a good half of
# itself on ground `a` already holds and puts the other half on open field.
claim(a, MLAT, MLON + 0.0021, 120.0)
won = events(actor=a, kind="claim")[n_claim:]
held = events(actor=a, kind="reinforce")[n_reinf:]
check("the new half is recorded as a claim", len(won) == 1, str(won))
check("the overlapping half as a reinforce", len(held) == 1, str(held))
if len(won) == 1 and len(held) == 1:
    won_area, held_area = float(won[0][3]), float(held[0][3])
    total = won_area + held_area
    check("neither half is the whole move",
          won_area < total * 0.95 and held_area < total * 0.95,
          f"claim {won_area:.0f} / reinforce {held_area:.0f}")
    check("and together they are the claim's own footprint, not the merged land",
          abs(total - first_area) < first_area * 0.05,
          f"{total:.0f} vs footprint ~{first_area:.0f}")

print("\n== a steal attributes only the contested overlap ==")
# Offset so the circles overlap partially. Strength beats a defence of 3 claims.
claim(b, LAT, LON + 0.0015, 120.0, strength=50.0)
steals = events(actor=b, kind="steal")
check("one steal recorded", len(steals) == 1, str(steals))
check("the victim is the runner who lost the ground", steals[0][2] == a, str(steals[0][2]))
steal_area = float(steals[0][3])
b_claim = events(actor=b, kind="claim")
check("the attacker also gets their own claim event", len(b_claim) == 1, str(b_claim))
check("the steal is SMALLER than the attacker's whole claim",
      steal_area < float(b_claim[0][3]),
      f"steal {steal_area:.0f} vs claim {float(b_claim[0][3]):.0f}")
check("and it is real ground, not a rounding sliver", steal_area > 1000, f"{steal_area:.0f} m2")

print("\n== a bounced attack is a beat too ==")
# The attack has to PARTIALLY overlap the wall. A claim that lands entirely on
# ground it cannot take is refused outright (409) and rolls back — no energy
# spent, no run consumed, nothing happened — so it is not history, in the same
# way the rivalry ledger has never recorded one. A partial bounce is different:
# the claim really landed, and the ground this rival held really was held.
before = len(events(actor=b, kind="defend"))
claim(a, LAT + 0.004, LON, 120.0, strength=80.0)          # strong wall
claim(b, LAT + 0.004, LON + 0.0025, 120.0, strength=0.2)  # clips its edge
after = events(actor=b, kind="defend")
check("the bounce is recorded against the defender", len(after) == before + 1, str(after))
check("with the defender as the victim", after[-1][2] == a, str(after[-1][2]))

print("\n== a refused move is not history ==")
n = len(events())
try:
    claim(b, LAT + 0.004, LON, 120.0, strength=0.2)  # entirely inside the wall
    check("a hopeless claim is refused", False, "no 409 raised")
except Exception as e:
    check("a hopeless claim is refused", "too strong" in str(e), str(e)[:60])
db.rollback()
check("and leaves nothing behind in the log", len(events()) == n, f"{n} -> {len(events())}")

print("\n== slivers stay out ==")
n_before = len(events())
territory_history.record(
    db, kind="claim", actor_id=a, area_m2=territory_history.MIN_AREA_M2 - 1,
    ground_wkt=circle_polygon_wgs(LAT, LON, 2.0).wkt,
)
db.commit()
check("an area under the floor is not recorded", len(events()) == n_before, str(len(events())))

print("\n== a bad history write must not cost the claim ==")
territory_history.record(db, kind="claim", actor_id=a, area_m2=5000.0,
                         ground_wkt="POLYGON((this is not geometry))")
# The savepoint is the whole point: if it were missing, the session would be
# poisoned and this next statement would raise instead of answering.
alive = db.execute(text("SELECT 1")).scalar()
check("the session survives a failed write", alive == 1, str(alive))
check("and nothing was recorded for it",
      len(events()) == n_before, str(len(events())))
db.commit()

print("\n== nothing here counts as PRO gating ==")
# The log is instrumentation. If it ever starts deciding what a runner is
# allowed to DO, rather than what they can read about, that is the line.
check("no event kind implies an entitlement",
      set(r[0] for r in events()) <= {"claim", "steal", "defend", "reinforce"},
      str(set(r[0] for r in events())))

# cleanup
db.execute(text("DELETE FROM territory_events WHERE actor_id::text = ANY(:ids) OR victim_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM territory_steals WHERE attacker_id::text = ANY(:ids) OR victim_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM territories WHERE user_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:ids)"), {"ids": [a, b]})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
