"""One-time: populate the map with seeded clubs, bot players, and starting
territory, so a fresh account opens onto a world that already looks lived-in
instead of an empty map.

Talks to the database directly (see sweep.py for the same pattern), scattered
across Singapore using the same 5-region breakdown the map's own region
colouring uses (sg_regions.json). Never touches an existing real account or
its territory — bot claims are placed avoiding whatever the target player
(TARGET_USERNAME) already holds, and skip any account that isn't a bot.

Idempotent: running it again with everything already seeded is a no-op unless
--reset is passed, which deletes only rows where users.is_bot is true (and
everything that cascades from them — bot_accounts, clan_members, territories,
territory_steals) before reseeding. It never deletes a real account.

    cd backend
    $env:DATABASE_URL = "postgres://...oregon-postgres.render.com/dbname"
    .venv\\Scripts\\python.exe seed_world.py --yes
    .venv\\Scripts\\python.exe seed_world.py --yes --reset   # wipe bots and redo

Ongoing bot activity (bots going on runs, reinforcing, occasionally raiding
TARGET_USERNAME's territory) is a separate script: bot_activity.py, meant to
run on a schedule via the `territory-run-bots` cron in render.yaml. This
script only lays down the starting state.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))

from shapely.geometry import Polygon, MultiPolygon, Point  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app import models  # noqa: E402
from app.clans_meta import CLAN_COLORS, CLAN_BADGES  # noqa: E402
from app.geospatial import circle_polygon_wgs, claim_area_m2, claim_radius_m  # noqa: E402
from app.routes.runs import _claim_territory, claim_strength, claim_lifetime_days  # noqa: E402

# The real player bots should never steal from during the initial seed —
# ongoing raids on this account are bot_activity.py's job, not this script's.
TARGET_USERNAME = "jonfong78"

N_CLANS = 12
BOTS_PER_CLAN = 10
# Roughly a quarter of the roster is allowed to raid TARGET_USERNAME once
# bot_activity.py starts running — see that script for the attack-frequency
# math. Marked here so seed and cron agree on who is eligible.
ATTACKER_FRACTION = 0.22

REGION_FILE = os.path.join(os.path.dirname(__file__), "sg_regions.json")

CLAN_NAME_POOL = [
    ("Marina Milers", "MRNA"), ("Bishan Blazers", "BISH"), ("Tampines Thunder", "TMPN"),
    ("Jurong Jaguars", "JRNG"), ("Yishun Yetis", "YSHN"), ("Punggol Pacers", "PNGL"),
    ("Clementi Comets", "CLMT"), ("Toa Payoh Titans", "TPYH"), ("Bedok Blitz", "BDOK"),
    ("Woodlands Wolves", "WDLD"), ("Sengkang Sprinters", "SNKG"), ("Pasir Panthers", "PSRP"),
    ("Kallang Kites", "KLNG"), ("Hougang Hawks", "HGNG"), ("Novena Nomads", "NOVA"),
]

FIRST_NAMES = [
    "kai", "mei", "arif", "wei", "siti", "farah", "jun", "hui", "daniel", "aisha",
    "ryan", "nadia", "zheng", "priya", "haziq", "clara", "ethan", "yasmin", "benjamin",
    "nurul", "gabriel", "michelle", "faris", "shu", "amirah", "joel", "sarah", "hafiz",
    "xin", "dev", "iris", "zul", "valerie", "aaron", "farhan", "cheryl", "irfan", "jia",
]
NAME_SUFFIXES = ["", "run", "runs", "sg", "trail", "pace"]


def _load_regions() -> list[dict]:
    with open(REGION_FILE, encoding="utf-8") as f:
        data = json.load(f)
    regions = []
    for r in data["regions"]:
        polys = [Polygon(ring) for ring in r["polygons"] if len(ring) >= 4]
        polys = [p.buffer(0) for p in polys if p.is_valid or p.buffer(0).area > 0]
        geom = MultiPolygon([p for p in polys if p.geom_type == "Polygon"])
        regions.append({"key": r["key"], "name": r["name"], "geom": geom, "bounds": geom.bounds})
    return regions


def _sample_point_in_region(region: dict, rng: random.Random) -> tuple[float, float]:
    """Rejection-sample a (lat, lon) inside the region's land polygons."""
    min_lon, min_lat, max_lon, max_lat = region["bounds"]
    for _ in range(200):
        lon = rng.uniform(min_lon, max_lon)
        lat = rng.uniform(min_lat, max_lat)
        if region["geom"].contains(Point(lon, lat)):
            return lat, lon
    # Land sampling failed (sliver region) — fall back to its published centre.
    return region["geom"].centroid.y, region["geom"].centroid.x


def _make_username(rng: random.Random, taken: set[str]) -> str:
    for _ in range(200):
        first = rng.choice(FIRST_NAMES)
        suffix = rng.choice(NAME_SUFFIXES)
        num = rng.randint(2, 999)
        parts = [first] + ([suffix] if suffix else []) + [str(num)]
        name = "_".join(parts)
        if name not in taken and len(name) <= 32:
            taken.add(name)
            return name
    raise RuntimeError("could not generate a unique username")


def _existing_usernames(db) -> set[str]:
    return {r[0] for r in db.execute(text("SELECT username FROM users")).fetchall()}


def _wipe_bots(db) -> None:
    n = db.execute(text("SELECT count(*) FROM users WHERE is_bot")).scalar()
    print(f"--reset: deleting {n} existing bot accounts (cascades to their territory, clan membership, etc.)")
    db.execute(text("DELETE FROM users WHERE is_bot"))
    # Clubs a bot founded are orphaned by the FK's SET NULL, not deleted — but
    # a seeded club with zero seeded members is pointless, so clear those too.
    db.execute(
        text(
            "DELETE FROM clans WHERE id NOT IN (SELECT DISTINCT clan_id FROM users WHERE clan_id IS NOT NULL)"
        )
    )
    db.commit()


def _target_avoid_geom(db):
    """The real player's current live territory, if any — bots must not land
    a starting claim on top of it. Returns a shapely geometry or None."""
    row = db.execute(
        text(
            """
            SELECT ST_AsText(ST_Union(polygon))
            FROM territories t JOIN users u ON u.id = t.user_id
            WHERE u.username = :n AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
            """
        ),
        {"n": TARGET_USERNAME},
    ).fetchone()
    if not row or not row[0]:
        return None
    from shapely import wkt as shapely_wkt

    return shapely_wkt.loads(row[0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="required to actually write")
    ap.add_argument("--reset", action="store_true", help="wipe existing bot accounts first")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed, for a reproducible dry run")
    args = ap.parse_args()

    db_url = os.environ.get("DATABASE_URL", "")
    host = db_url.split("@")[-1].split("/")[0] if "@" in db_url else "(default local)"
    if not args.yes:
        print(f"This will seed {N_CLANS} clubs / {N_CLANS * BOTS_PER_CLAN} bot players into: {host}")
        print("Re-run with --yes to proceed.")
        return 1

    rng = random.Random(args.seed)
    regions = _load_regions()
    db = SessionLocal()
    try:
        if args.reset:
            _wipe_bots(db)

        already = db.execute(text("SELECT count(*) FROM users WHERE is_bot")).scalar()
        if already:
            print(f"{already} bot accounts already exist — nothing to do (use --reset to redo).")
            return 0

        avoid_geom = _target_avoid_geom(db)
        taken_usernames = _existing_usernames(db)

        # Round-robin clubs across the 5 regions so no single neighbourhood
        # gets every club's home turf.
        region_cycle = [regions[i % len(regions)] for i in range(N_CLANS)]
        color_keys = list(CLAN_COLORS.keys())
        rng.shuffle(color_keys)
        badge_keys = list(CLAN_BADGES)
        rng.shuffle(badge_keys)
        name_pool = list(CLAN_NAME_POOL)
        rng.shuffle(name_pool)

        clan_ids: list[tuple[str, dict]] = []  # (clan_id, region)
        for i in range(N_CLANS):
            name, tag = name_pool[i % len(name_pool)]
            if i >= len(name_pool):
                tag = f"{tag[:3]}{i}"
            clan_id = str(uuid.uuid4())
            db.execute(
                text(
                    """
                    INSERT INTO clans (id, name, tag, description, color_key, badge_icon,
                                        privacy, created_by, created_at)
                    VALUES (:id, :name, :tag, :desc, :ck, :b, 'open', NULL, now())
                    """
                ),
                {
                    "id": clan_id, "name": name, "tag": tag,
                    "desc": f"Seeded club — {region_cycle[i]['name']} Singapore.",
                    "ck": color_keys[i % len(color_keys)], "b": badge_keys[i % len(badge_keys)],
                },
            )
            clan_ids.append((clan_id, region_cycle[i]))
        db.flush()
        print(f"created {len(clan_ids)} clubs")

        total_attackers = 0
        total_users = 0
        for clan_id, region in clan_ids:
            leader_set = False
            for _ in range(BOTS_PER_CLAN):
                username = _make_username(rng, taken_usernames)
                user_id = str(uuid.uuid4())
                is_attacker = rng.random() < ATTACKER_FRACTION

                db.execute(
                    text(
                        """
                        INSERT INTO users (id, username, password_hash, created_at, clan_id, avatar, is_bot)
                        VALUES (:id, :u, NULL, now() - (:age_days || ' days')::interval, :cid, '{}'::jsonb, true)
                        """
                    ),
                    {"id": user_id, "u": username, "cid": clan_id, "age_days": rng.uniform(3, 120)},
                )
                db.execute(
                    text(
                        "INSERT INTO clan_members (clan_id, user_id, role) VALUES (:cid, :uid, :role)"
                    ),
                    {"cid": clan_id, "uid": user_id, "role": "leader" if not leader_set else "member"},
                )
                leader_set = True

                home_lat, home_lon = _sample_point_in_region(region, rng)
                next_run_at = datetime.utcnow() + timedelta(hours=rng.uniform(1, 48))
                db.execute(
                    text(
                        """
                        INSERT INTO bot_accounts (user_id, home_lat, home_lon, region_key, attacker, next_run_at)
                        VALUES (:uid, :lat, :lon, :rk, :atk, :nra)
                        """
                    ),
                    {
                        "uid": user_id, "lat": home_lat, "lon": home_lon,
                        "rk": region["key"], "atk": is_attacker, "nra": next_run_at,
                    },
                )

                # Starting territory: one plausible recreational run near home,
                # nudged (a few retries) off the real player's current land.
                distance_m = rng.triangular(1800, 8000, 3500)
                pace_s_per_km = rng.triangular(300, 480, 380)
                duration_s = distance_m / 1000.0 * pace_s_per_km
                lat, lon = home_lat, home_lon
                for _try in range(6):
                    poly = circle_polygon_wgs(lat, lon, claim_radius_m(distance_m))
                    if avoid_geom is None or not poly.intersects(avoid_geom):
                        break
                    lat, lon = _sample_point_in_region(region, rng)
                else:
                    poly = None

                if poly is not None:
                    territory_out, *_rest = _claim_territory(
                        db=db,
                        user_id=user_id,
                        run_id=None,
                        polygon_wgs=poly,
                        initial_area_m2=claim_area_m2(distance_m),
                        strength=claim_strength(distance_m, duration_s),
                        verified=True,
                        clan_id=clan_id,
                        lifetime_for=lambda r, d=distance_m, du=duration_s: claim_lifetime_days(d, du, r),
                    )
                    # Stagger ages so not every claim looks minted this second.
                    if territory_out is not None:
                        age_h = rng.uniform(0, 30)
                        db.execute(
                            text(
                                """
                                UPDATE territories
                                SET created_at = created_at - (:h || ' hours')::interval,
                                    expires_at = expires_at - (:h || ' hours')::interval
                                WHERE id = :id AND expires_at > now() + interval '6 hours'
                                """
                            ),
                            {"h": age_h, "id": territory_out.id},
                        )

                total_users += 1
                total_attackers += 1 if is_attacker else 0
            db.flush()

        db.commit()
        print(f"created {total_users} bot players ({total_attackers} eligible to raid {TARGET_USERNAME})")
        print("done. Ongoing activity needs bot_activity.py running on a schedule.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
