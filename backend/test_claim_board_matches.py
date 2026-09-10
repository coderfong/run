"""The board drawn under a claim IS the board the claim fights.

    .venv/Scripts/python.exe test_claim_board_matches.py

Two rules already existed and were true on their own: the map can be scoped to
one rank tier (`test_map_ranks.py`), and combat only ever meets holders in the
attacker's own tier (`test_claim_rank_scope.py`). Nothing pinned them TOGETHER,
and the result screen quietly fetched its map with no tier at all — so a claim
circle sat on six painted plots while the breakdown honestly reported one
rival, and the honest number read as the bug.

What this pins:

  * `/claim-options` states the tier the claim fights on (`rank_tier`), so the
    client scopes its map to the same board rather than re-deriving it;
  * the placement breakdown counts only in-tier holders;
  * `/map-polygons?rank=<that tier>` returns exactly those same holders, and
    the unscoped board returns more — which is precisely the mismatch a map
    fetched without a rank was showing the runner.

Runs against the local dev Postgres, like the other route tests here.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app import elo, models, schemas
from app.database import SessionLocal
from app.geospatial import circle_polygon_wgs
from app.main import app
from app.routes.runs import _placement_breakdown

c = TestClient(app)
db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Remote and unique per run, so no seeded or real player shares the viewport.
LAT = -55.3 + (int(tag, 16) % 300) * 0.01
LON = -73.2 + (int(tag[:4], 16) % 300) * 0.01
BBOX = (f"min_lon={LON - 0.02}&min_lat={LAT - 0.02}"
        f"&max_lon={LON + 0.02}&max_lat={LAT + 0.02}")

WOOD_PTS, GOLD_PTS = 1000, 1400


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def mkuser(name, rating):
    return db.execute(
        text(
            "INSERT INTO users (id, username, created_at, solo_elo, solo_elo_peak) "
            "VALUES (gen_random_uuid(), :n, now(), :p, :p) RETURNING id::text"
        ),
        {"n": name, "p": rating},
    ).scalar()


def plant(uid, lat, lon, radius=150.0, strength=0.05):
    """Weak land, so nothing here is decided by defence rather than by tier."""
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


check("1000 Elo is tier 0", elo.tier_for_rating(WOOD_PTS)["tier"] == 0)
check("1400 Elo is tier 3", elo.tier_for_rating(GOLD_PTS)["tier"] == 3)

# One Wood attacker, and FOUR holders stacked around the same spot: one in the
# attacker's tier, three a division away. This is the shape of the screenshot
# that started it — a neighbourhood thick with borders, one of them in play.
attacker_id = mkuser(f"bmAtk{tag}", WOOD_PTS)
in_tier = mkuser(f"bmIn{tag}", WOOD_PTS)
out_tier = [mkuser(f"bmOut{i}{tag}", GOLD_PTS) for i in range(3)]
db.commit()
all_ids = [attacker_id, in_tier] + out_tier

plant(in_tier, LAT, LON)
for i, uid in enumerate(out_tier):
    plant(uid, LAT + 0.0008 * (i + 1), LON + 0.0008 * (i + 1))

attacker = db.get(models.User, attacker_id)

print("\n== the breakdown counts one tier ==")
# A claim big enough to cover every plot around the spot.
poly = circle_polygon_wgs(LAT + 0.0012, LON + 0.0012, 260.0)
b = _placement_breakdown(db, attacker, [poly], strength=50.0)[0]
rival_ids = sorted(b["rivals"].keys())
check("exactly one rival is under a claim covering four borders",
      rival_ids == [in_tier], f"{len(rival_ids)} rivals: {rival_ids}")
check("and there is real ground to take off them", b["enemy_m2"] > 1000,
      f"{b['enemy_m2']:.0f} m2")

print("\n== the map, asked for that tier, shows exactly the same holders ==")
tier = elo.solo_status(db, attacker_id)["tier"]
check("the attacker's tier is Wood", tier == 0, str(tier))

scoped = c.get(f"/map-polygons?{BBOX}&rank={tier}&limit=500").json()["territories"]
scoped_owners = sorted({t["user_id"] for t in scoped})
check("the scoped board draws the one holder the claim fights",
      scoped_owners == rival_ids, f"drew {scoped_owners}, fights {rival_ids}")

unscoped = c.get(f"/map-polygons?{BBOX}&limit=500").json()["territories"]
unscoped_owners = sorted({t["user_id"] for t in unscoped})
# The regression itself, stated as a fact: this is what the result screen used
# to draw, and it is four plots for a fight with one.
check("an unscoped board draws holders the claim can never touch",
      len(unscoped_owners) == 4 and set(rival_ids) < set(unscoped_owners),
      f"{len(unscoped_owners)} owners: {unscoped_owners}")

print("\n== /claim-options states the tier, so the client need not derive it ==")
check("ClaimOptionsOut carries rank_tier",
      "rank_tier" in schemas.ClaimOptionsOut.model_fields)
# The unqualified early return states it too — that response still drives a map.
check("and it defaults to a real tier index",
      schemas.ClaimOptionsOut(run_id="x").rank_tier == 0)

# cleanup
db.rollback()
db.execute(text("DELETE FROM territories WHERE user_id::text = ANY(:i)"), {"i": all_ids})
db.execute(text("DELETE FROM rank_events WHERE user_id::text = ANY(:i)"), {"i": all_ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": all_ids})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
