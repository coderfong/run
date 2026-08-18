"""What a claim REPORTS it did, as against what the runner ends up holding.

    .venv/Scripts/python.exe test_claim_ground.py

The bug this pins: a claim placed on ground the runner already owns is merged
into it, and `territory.area_m2` is then the whole merged holding — every block
they have taken around there, going back weeks. The result screen led with that
number, so a lap around your own street reported an estate as this morning's
take. `gained_m2` is the part of the claim that was NOT already theirs, and it
is measured inside the claim engine because a moment later the two polygons are
one row and the question has no answer.

Driven through the real engine (`_claim_territory`), not by inserting rows: the
split is a PostGIS difference over the same geometry the claim actually used,
and a hand-built fixture would be testing the fixture.

No server needed, but it does need the database — it is all PostGIS.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from app.database import SessionLocal
from app.geospatial import circle_polygon_wgs
from app.routes.runs import _claim_territory, _rings_of

db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Somewhere empty, and somewhere different every run — a fixed spot inherits
# the land left behind by any earlier run that died before its cleanup, and the
# symptom is a first claim that mysteriously starts out overlapping something.
LAT = -56.5 + (int(tag, 16) % 400) * 0.01
LON = -73.5 + (int(tag[:4], 16) % 400) * 0.01


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def close(a, b, tol=0.02):
    """Within `tol` of each other, relative to the larger."""
    scale = max(abs(a), abs(b), 1.0)
    return abs(a - b) <= scale * tol


def mkuser(name):
    return db.execute(
        text("INSERT INTO users (id, username, created_at) "
             "VALUES (gen_random_uuid(), :n, now()) RETURNING id::text"),
        {"n": name},
    ).scalar()


def plant(uid, lat, lon, radius, strength=0.05):
    """Drop a territory straight into the table, overlapping whatever is
    already there.

    Not a shortcut around the engine: this is a board the engine cannot build
    for itself but the live game reaches constantly. Two runners hold the same
    square whenever a clubmate’s coexisting land outlives the club, and the
    seeded world plants bots on top of ground that is already claimed.
    """
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
                 now(), true, NULL, :s, 0, now() + interval '30 days')
            """
        ),
        {"u": uid, "wkt": wkt, "s": strength},
    )
    db.commit()


def claim(uid, lat, lon, radius, strength=1.0):
    """Place a claim and hand back (territory, ground) — held, then won."""
    territory, _stolen, _from, _events, ground = _claim_territory(
        db=db, user_id=uid, run_id=None,
        polygon_wgs=circle_polygon_wgs(lat, lon, radius),
        initial_area_m2=0.0, strength=strength, verified=True,
        clan_id=None, lifetime_days=30.0,
    )
    db.commit()
    return territory, ground


a = mkuser(f"groundA{tag}")
b = mkuser(f"groundB{tag}")
db.commit()

print("\n== open ground: all of it is gained ==")
occupied = db.execute(
    text("SELECT count(*) FROM territories "
         "WHERE ST_DWithin(polygon::geography, "
         "ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, 3000)"),
    {"lat": LAT, "lon": LON},
).scalar()
check("the test ground really is empty", occupied == 0, f"{occupied} territories within 3km")

terr, g = claim(a, LAT, LON, 150.0)
footprint = g["claimed_m2"]
check("the claim covers real ground", 50_000 < footprint < 90_000, f"{footprint:.0f} m2")
check("all of it is gained", close(g["gained_m2"], footprint), f"{g['gained_m2']:.0f}")
check("none of it is reinforcement", g["reinforced_m2"] == 0, f"{g['reinforced_m2']:.0f}")
check("and it has a shape to reveal", len(_rings_of(g["gained_wkt"])) == 1,
      str(len(_rings_of(g["gained_wkt"]))))

print("\n== the same ground again: nothing is gained ==")
terr, g = claim(a, LAT, LON, 150.0)
check("the footprint is unchanged", close(g["claimed_m2"], footprint), f"{g['claimed_m2']:.0f}")
check("nothing was won", g["gained_m2"] < 1.0, f"{g['gained_m2']:.0f} m2")
check("all of it reinforced land they already held",
      close(g["reinforced_m2"], footprint), f"{g['reinforced_m2']:.0f}")
check("there is no new ground to reveal", _rings_of(g["gained_wkt"]) == [],
      str(_rings_of(g["gained_wkt"])))
check("but the claim itself still has one", len(_rings_of(g["claim_wkt"])) == 1)
# THE REGRESSION. The merged row is what the screen used to lead with.
check("and the merged holding is NOT what this run won",
      terr.area_m2 > g["gained_m2"] * 100,
      f"held {terr.area_m2:.0f} vs won {g['gained_m2']:.0f}")

print("\n== half on their own land: the halves add up to the claim ==")
# ~170 m east of the first circle's centre, so a good half of the new stamp
# lands on ground `a` already holds and the rest on open field.
terr, g = claim(a, LAT, LON + 0.0028, 150.0)
check("the footprint is still one run's worth of land",
      close(g["claimed_m2"], footprint, 0.05), f"{g['claimed_m2']:.0f}")
check("some was won", g["gained_m2"] > 1000, f"{g['gained_m2']:.0f} m2")
check("some was reinforcement", g["reinforced_m2"] > 1000, f"{g['reinforced_m2']:.0f} m2")
check("and the two are exactly the claim, with nothing invented or lost",
      close(g["gained_m2"] + g["reinforced_m2"], g["claimed_m2"]),
      f"{g['gained_m2']:.0f} + {g['reinforced_m2']:.0f} vs {g['claimed_m2']:.0f}")
check("the reveal gets only the new part",
      len(_rings_of(g["gained_wkt"])) >= 1
      and len(_rings_of(g["gained_wkt"])[0]) >= 3)

print("\n== a rival's ground counts as gained, because it was not yours ==")
# Far enough from `a` to be a fresh neighbourhood, taken off `b` by force.
RLAT, RLON = LAT + 0.03, LON + 0.03
claim(b, RLAT, RLON, 150.0)
terr, g = claim(a, RLAT, RLON + 0.0014, 150.0, strength=50.0)
check("taking someone else's land is a gain, not a reinforcement",
      g["reinforced_m2"] == 0 and close(g["gained_m2"], g["claimed_m2"]),
      f"won {g['gained_m2']:.0f} of {g['claimed_m2']:.0f}, reinforced {g['reinforced_m2']:.0f}")

print("\n== a takeback on ground you also hold: won, not reinforced ==")
# THE REGRESSION. Ground that is BOTH yours and a rival’s, taken off them.
# It used to land entirely in `reinforced_m2` — the result screen said
# "+0.000 km² · 0.63 km² of your own land reinforced" under the headline
# YOU TOOK IT BACK, next to a steal banner for the same 0.63.
TLAT, TLON = LAT + 0.06, LON + 0.06
claim(a, TLAT, TLON, 150.0)
plant(b, TLAT, TLON, 150.0)
terr, g = claim(a, TLAT, TLON, 150.0, strength=50.0)
check("what changed hands is what was won",
      close(g["gained_m2"], g["claimed_m2"]),
      f"won {g['gained_m2']:.0f} of {g['claimed_m2']:.0f}")
check("and none of it is filed as reinforcement", g["reinforced_m2"] < 1.0,
      f"{g['reinforced_m2']:.0f} m2")
check("the reveal has the takeback to show", len(_rings_of(g["gained_wkt"])) >= 1,
      str(len(_rings_of(g["gained_wkt"]))))

print("\n== half of your own land contested: the halves still add up ==")
# The rival sits over the eastern half of ground `a` already holds, so this
# claim wins that half back and merely reinforces the rest.
HLAT, HLON = LAT + 0.09, LON + 0.09
claim(a, HLAT, HLON, 150.0)
plant(b, HLAT, HLON + 0.0028, 150.0)
terr, g = claim(a, HLAT, HLON, 150.0, strength=50.0)
check("the contested half was won", g["gained_m2"] > 1000, f"{g['gained_m2']:.0f} m2")
check("the quiet half was reinforced", g["reinforced_m2"] > 1000, f"{g['reinforced_m2']:.0f} m2")
check("and the two are exactly the claim, with nothing invented or lost",
      close(g["gained_m2"] + g["reinforced_m2"], g["claimed_m2"]),
      f"{g['gained_m2']:.0f} + {g['reinforced_m2']:.0f} vs {g['claimed_m2']:.0f}")

# cleanup
db.rollback()
db.execute(text("DELETE FROM territory_events WHERE actor_id::text = ANY(:ids) OR victim_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM territory_steals WHERE attacker_id::text = ANY(:ids) OR victim_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM territories WHERE user_id::text = ANY(:ids)"), {"ids": [a, b]})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:ids)"), {"ids": [a, b]})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
