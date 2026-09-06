"""The map board, scoped to a rank tier.

    .venv/Scripts/python.exe test_map_ranks.py

Chunk 4b of the NB sweep: the global map shows only the land of runners in ONE
rank, so a runner sees the rivals they are actually racing and not the whole
planet. This pins the contract that makes that possible:

  * every territory now carries its owner's rank (key / tier index / label),
    decay already applied — a client that never asks for a tier still learns
    each holder's rank;
  * `?rank=N` filters the board to exactly tier N, and the LIMIT is respected
    (the filter is in SQL, so a sparse tier still fills its page rather than
    returning whatever survived a post-fetch trim);
  * omitting `rank` returns every tier, because the claim-placement callers
    (result / running screens) need all nearby land regardless of who holds it.

Runs against the local dev Postgres, like the other route tests here.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app
from app import elo

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
# Remote, so no seeded or real players share the viewport and muddy membership.
LAT, LON = -48.7 + (int(tag, 16) % 200) * 0.01, -71.4
BBOX = f"min_lon={LON - 0.02}&min_lat={LAT - 0.02}&max_lon={LON + 0.02}&max_lat={LAT + 0.02}"


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def set_points(uid, pts):
    """Put a runner squarely in an Elo tier."""
    db.execute(
        text("UPDATE users SET solo_elo = :p, solo_elo_peak = GREATEST(solo_elo_peak,:p) "
             "WHERE id = CAST(:u AS uuid)"),
        {"p": pts, "u": uid},
    )


def give_land(uid, lat=LAT, lon=LON):
    """A verified, unexpired ~60m plot at the remote point."""
    db.execute(
        text(
            """
            INSERT INTO territories (id, user_id, polygon, area_m2, created_at, verified,
                                     strength, reinforcements, expires_at)
            VALUES (gen_random_uuid(), CAST(:u AS uuid),
                    ST_Multi(ST_Buffer(ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, 60)::geometry),
                    11000, now(), true, 1, 0, now() + interval '30 days')
            """
        ),
        {"u": uid, "lat": lat, "lon": lon},
    )


def board(**params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    return c.get(f"/map-polygons?{BBOX}&{q}" if q else f"/map-polygons?{BBOX}")


db = SessionLocal()
# Three runners, one per tier: Wood (0), Gold (3), Mythic (9). Slightly offset
# so their plots don't perfectly overlap, all inside the bbox.
h_wood, wood = signup(f"mrWood{tag}")
h_gold, gold = signup(f"mrGold{tag}")
h_myth, myth = signup(f"mrMyth{tag}")
set_points(wood, 1000)       # Wood
set_points(gold, 1400)       # inside Gold [1350, 1500)
set_points(myth, 2450)       # Mythic (top, no ceiling)
give_land(wood, LAT, LON)
give_land(gold, LAT + 0.001, LON)
give_land(myth, LAT, LON + 0.001)
db.commit()

# Sanity: the tiers we seeded are the tiers the ladder assigns.
check("Wood is tier 0", elo.tier_for_rating(1000)["tier"] == 0)
check("Gold is tier 3", elo.tier_for_rating(1400)["tier"] == 3, str(elo.tier_for_rating(1400)))
check("Mythic is tier 9", elo.tier_for_rating(2450)["tier"] == 9)

print("\n== every territory carries its owner's rank ==")
r = board()
check("the board loads", r.status_code == 200, r.text[:160])
terrs = {t["user_id"]: t for t in r.json()["territories"]}
check("all three holders are on the unfiltered board",
      {wood, gold, myth} <= set(terrs), str(list(terrs)))
if wood in terrs:
    check("wood holder tagged Wood/tier 0",
          terrs[wood]["rank_key"] == "wood" and terrs[wood]["rank_tier"] == 0,
          str(terrs[wood].get("rank_key")))
if gold in terrs:
    check("gold holder tagged Gold/tier 3",
          terrs[gold]["rank_key"] == "gold" and terrs[gold]["rank_tier"] == 3
          and terrs[gold]["rank_label"] == "Gold",
          str(terrs[gold].get("rank_key")))
if myth in terrs:
    check("mythic holder tagged Mythic/tier 9",
          terrs[myth]["rank_key"] == "mythic" and terrs[myth]["rank_tier"] == 9,
          str(terrs[myth].get("rank_key")))

print("\n== ?rank=N shows only that tier ==")
ids0 = {t["user_id"] for t in board(rank=0).json()["territories"]}
check("rank=0 includes the Wood runner", wood in ids0, str(ids0))
check("rank=0 excludes the Gold runner", gold not in ids0, str(ids0))
check("rank=0 excludes the Mythic runner", myth not in ids0, str(ids0))

ids3 = {t["user_id"] for t in board(rank=3).json()["territories"]}
check("rank=3 includes the Gold runner", gold in ids3, str(ids3))
check("rank=3 excludes the Wood runner", wood not in ids3, str(ids3))
check("rank=3 excludes the Mythic runner", myth not in ids3, str(ids3))

ids9 = {t["user_id"] for t in board(rank=9).json()["territories"]}
check("rank=9 includes the Mythic runner", myth in ids9, str(ids9))
check("rank=9 excludes the lower tiers", wood not in ids9 and gold not in ids9, str(ids9))

print("\n== an empty tier is empty, not everyone ==")
# Tier 6 (Onyx) has no seeded holder near here — the band must not leak lower
# tiers in. This is the case a Python post-filter after a LIMIT would get wrong.
ids6 = {t["user_id"] for t in board(rank=6).json()["territories"]}
check("a tier with no local holders returns none of ours",
      not ({wood, gold, myth} & ids6), str(ids6))

print("\n== the top tier's open ceiling ==")
# Mythic has no next tier, so its band is [30000, ∞). A runner far past the
# floor must still count as Mythic, not fall off the top.
set_points(myth, 9999)
db.commit()
ids9b = {t["user_id"] for t in board(rank=9).json()["territories"]}
check("a runner well past the Mythic floor is still Mythic", myth in ids9b, str(ids9b))

# cleanup
ids = [wood, gold, myth]
for t in ("territories", "rank_events", "runs", "notif_prefs", "notifications"):
    db.execute(text(f"DELETE FROM {t} WHERE user_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": ids})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
