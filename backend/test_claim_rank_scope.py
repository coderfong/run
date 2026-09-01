"""Combat happens on ONE rank board — the same board `/map-polygons` draws.

    .venv/Scripts/python.exe test_claim_rank_scope.py

The Map tab shows only the land of runners in the viewer's own rank tier
(`test_map_ranks.py` pins that). This pins the other half of the same rule:
a claim only ever fights the land it can see. A runner cannot steal from, be
defended by, or be blocked by a holder in another division — those polygons
coexist with the new claim the way a clubmate's does.

Why it matters: the runner who out-defends you is usually a tier away, so
without this a claim screen would price a fight the runner could never join,
and the Result screen would report a steal off someone the map never showed.

Driven through the real engine (`_claim_territory`), needs the database.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from app.database import SessionLocal
from app.geospatial import circle_polygon_wgs
from app import ranks
from app.routes.runs import _claim_territory

db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Somewhere empty, fresh every run (see the note in test_claim_ground.py).
LAT = -61.5 + (int(tag, 16) % 400) * 0.01
LON = -70.5 + (int(tag[:4], 16) % 400) * 0.01


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def mkuser(name, points, clan_id=None):
    """A user planted squarely in the tier `points` maps to, clock fresh so
    nothing decays out from under the test."""
    return db.execute(
        text(
            "INSERT INTO users (id, username, created_at, rank_points, rank_points_at, clan_id) "
            "VALUES (gen_random_uuid(), :n, now(), :p, timezone('utc', now()), :c) "
            "RETURNING id::text"
        ),
        {"n": name, "p": points, "c": clan_id},
    ).scalar()


def mkclan(name):
    return db.execute(
        text("INSERT INTO clans (id, name, tag, created_at) "
             "VALUES (gen_random_uuid(), :n, :t, now()) RETURNING id::text"),
        {"n": name, "t": tag[:5].upper()},
    ).scalar()


def plant(uid, lat, lon, radius, strength, clan_id=None):
    wkt = circle_polygon_wgs(lat, lon, radius).wkt
    db.execute(
        text(
            """
            INSERT INTO territories
                (id, user_id, run_id, polygon, area_m2, created_at, verified,
                 clan_id, strength, reinforcements, expires_at)
            VALUES
                (gen_random_uuid(), :u, NULL,
                 ST_Multi(ST_GeomFromText(:wkt, 4326)),
                 ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                 now(), true, :c, :s, 0, now() + interval '30 days')
            """
        ),
        {"u": uid, "wkt": wkt, "s": strength, "c": clan_id},
    )
    db.commit()


def claim(uid, lat, lon, radius, strength, clan_id=None):
    territory, stolen, _from, events, _ground = _claim_territory(
        db=db, user_id=uid, run_id=None,
        polygon_wgs=circle_polygon_wgs(lat, lon, radius),
        initial_area_m2=0.0, strength=strength, verified=True,
        clan_id=clan_id, lifetime_days=30.0,
    )
    db.commit()
    return territory, stolen, events


# Wood (0), Gold (tier 3), and a second Wood. Confirm the ladder agrees.
WOOD_PTS, GOLD_PTS = 0, 1600
check("0 points is tier 0", ranks.rank_for_points(WOOD_PTS)["tier"] == 0)
check("1600 points is tier 3", ranks.rank_for_points(GOLD_PTS)["tier"] == 3)

attacker = mkuser(f"rsAtk{tag}", WOOD_PTS)
same_tier = mkuser(f"rsSame{tag}", WOOD_PTS)
other_tier = mkuser(f"rsGold{tag}", GOLD_PTS)
db.commit()
all_ids = [attacker, same_tier, other_tier]

print("\n== a rival in another tier is not in the fight ==")
# Gold runner holds strong ground; a Wood runner storms the exact same spot.
G_LAT, G_LON = LAT, LON
plant(other_tier, G_LAT, G_LON, 150.0, strength=0.05)
terr, stolen, events = claim(attacker, G_LAT, G_LON + 0.0010, 150.0, strength=50.0)
check("nothing was stolen across the tier line", stolen < 1.0, f"{stolen:.0f} m2")
check("no rivalry event was written for the cross-tier holder",
      all(str(e["victim_id"]) != other_tier for e in events), str(events))
still_there = db.execute(
    text("SELECT ST_Area(polygon::geography) FROM territories WHERE user_id::text = :u"),
    {"u": other_tier},
).scalar()
check("the other tier's land is untouched", still_there and still_there > 60_000,
      f"{(still_there or 0):.0f} m2")

print("\n== a rival in the same tier still loses ground ==")
S_LAT, S_LON = LAT + 0.03, LON + 0.03
plant(same_tier, S_LAT, S_LON, 150.0, strength=0.05)
terr, stolen, events = claim(attacker, S_LAT, S_LON + 0.0010, 150.0, strength=50.0)
check("same-tier ground was taken", stolen > 1000, f"{stolen:.0f} m2")
check("and the rivalry event names the same-tier victim",
      any(str(e["victim_id"]) == same_tier and not e["defended"] for e in events),
      str(events))

print("\n== a clubmate a tier away cannot lend defence ==")
# Same-tier rival with weak land of their own (solo strength 1.0), but a
# strong clubmate sitting on the same spot. The attacker runs at strength 2.0:
# over the rival alone, well under the rival + a real clubmate stack. If the
# clubmate is a tier below, their strength must not enter the sum.
clan = mkclan(f"rsClan{tag}")
rival = mkuser(f"rsRival{tag}", GOLD_PTS, clan_id=clan)
helper_low = mkuser(f"rsHelp{tag}", WOOD_PTS, clan_id=clan)
db.commit()
all_ids += [rival, helper_low]
C_LAT, C_LON = LAT + 0.06, LON + 0.06
plant(rival, C_LAT, C_LON, 150.0, strength=1.0, clan_id=clan)
plant(helper_low, C_LAT, C_LON, 150.0, strength=40.0, clan_id=clan)
gold_attacker = mkuser(f"rsGAtk{tag}", GOLD_PTS)
db.commit()
all_ids.append(gold_attacker)
terr, stolen, events = claim(gold_attacker, C_LAT, C_LON + 0.0010, 150.0, strength=2.0)
check("the out-of-tier clubmate did not hold the line", stolen > 1000,
      f"{stolen:.0f} m2 taken")

print("\n== but a clubmate IN the tier still stacks defence ==")
# Same setup, helper promoted into the attacker's tier: now the stacked
# strength is real and the same strength-3 claim bounces.
I_LAT, I_LON = LAT + 0.09, LON + 0.09
rival2 = mkuser(f"rsRiv2{tag}", GOLD_PTS, clan_id=clan)
helper_in = mkuser(f"rsHelpIn{tag}", GOLD_PTS, clan_id=clan)
db.commit()
all_ids += [rival2, helper_in]
plant(rival2, I_LAT, I_LON, 150.0, strength=1.0, clan_id=clan)
plant(helper_in, I_LAT, I_LON, 150.0, strength=40.0, clan_id=clan)
terr, stolen, events = claim(gold_attacker, I_LAT, I_LON + 0.0010, 150.0, strength=2.0)
check("the in-tier clubmate held the line", stolen < 1.0, f"{stolen:.0f} m2 taken")
check("and the bounced attack is logged as a defence",
      any(str(e["victim_id"]) == rival2 and e["defended"] for e in events), str(events))

# cleanup
db.rollback()
db.execute(
    text("DELETE FROM territory_events WHERE actor_id::text = ANY(:i) OR victim_id::text = ANY(:i)"),
    {"i": all_ids},
)
db.execute(
    text("DELETE FROM territory_steals WHERE attacker_id::text = ANY(:i) OR victim_id::text = ANY(:i)"),
    {"i": all_ids},
)
db.execute(text("DELETE FROM territories WHERE user_id::text = ANY(:i)"), {"i": all_ids})
db.execute(text("DELETE FROM rank_events WHERE user_id::text = ANY(:i)"), {"i": all_ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": all_ids})
db.execute(text("DELETE FROM clans WHERE name = :n"), {"n": f"rsClan{tag}"})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
