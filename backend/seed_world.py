"""One-time: populate the map with seeded clubs, bot players, run history and
territory, so a fresh account opens onto a world that already looks lived-in
instead of an empty map.

Talks to the database directly (see sweep.py for the same pattern), scattered
across Singapore using the same 5-region breakdown the map's own region
colouring uses (sg_regions.json). Never touches an existing real account or
its territory — bot claims are placed avoiding whatever the target player
(TARGET_USERNAME) already holds, and skip any account that isn't a bot.

Idempotent: running it again with everything already seeded is a no-op unless
--reset is passed, which deletes only rows where users.is_bot is true (and
everything that cascades from them — bot_accounts, clan_members, runs,
territories, territory_steals) before reseeding. It never deletes a real
account.

    cd backend
    $env:DATABASE_URL = "postgres://...oregon-postgres.render.com/dbname"
    .venv\\Scripts\\python.exe seed_world.py --yes
    .venv\\Scripts\\python.exe seed_world.py --yes --reset   # wipe bots and redo

Ongoing bot activity (bots going on runs, reinforcing, raiding each other and
TARGET_USERNAME) is a separate script: bot_activity.py, meant to run on a
schedule via the `territory-run-bots` cron in render.yaml. This script only
lays down the starting state.

Route synthesis, name generation, the rank pyramid and the run-record writer
all live in bot_world.py, shared with the cron so the two cannot drift apart
on what a simulated player looks like.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import uuid
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import HTTPException  # noqa: E402
from shapely.geometry import Polygon, MultiPolygon, Point  # noqa: E402
from sqlalchemy import text  # noqa: E402

import bot_world  # noqa: E402
from app import ranks  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.clans_meta import CLAN_COLORS, CLAN_BADGES  # noqa: E402
from app.geospatial import claim_area_m2  # noqa: E402
from app.routes.clans import rebuild_clan_season_stats  # noqa: E402
from app.routes.runs import _claim_territory, claim_strength, claim_lifetime_days  # noqa: E402

# The real player bots should never steal from during the initial seed —
# ongoing raids on this account are bot_activity.py's job, not this script's.
TARGET_USERNAME = "jonfong78"

N_CLANS = 24
BOTS_PER_CLAN = 16
# Roughly a quarter of the roster is allowed to raid TARGET_USERNAME once
# bot_activity.py starts running — see that script for the attack-frequency
# math. Marked here so seed and cron agree on who is eligible.
ATTACKER_FRACTION = 0.22

# How many past runs each bot is seeded with. A bot with exactly one run has
# an empty profile and a single claim; a handful gives it a history, a route
# thumbnail per run, a believable total distance, and territory of several
# different ages rather than a world minted in one instant.
MIN_HISTORY_RUNS = 4
MAX_HISTORY_RUNS = 7

# Bots cluster around a few estate centres per region instead of scattering
# uniformly across its land area. Uniform scatter is the other half of why the
# seeded world read as generated: real runners live where the flats are, so a
# real map has dense contested neighbourhoods and genuinely empty stretches,
# not an even wash of territory over every square kilometre of the island.
# Clustering also creates the overlaps that make bots steal from EACH OTHER
# without anyone scripting a fight.
HUBS_PER_REGION = (3, 6)
HOME_SPREAD_M = 700.0

REGION_FILE = os.path.join(os.path.dirname(__file__), "sg_regions.json")

# CLUB NAMES.
#
# These used to be alliterative mascot names — Marina Milers, Bishan Blazers,
# Tampines Thunder. That is what a game studio invents and not at all what a
# running group calls itself. Real ones are named after the thing that
# actually distinguishes them: when they meet, where they meet, how far they
# go, or a flat joke about how slow they are. "7PM Club" and "Nothing
# Serious" are believable in a way "Jurong Jaguars" never was.
#
# Split by whether the name commits to a place. A name that says Bedok has to
# be seeded in the east or it contradicts itself, exactly like the club
# descriptions did before. Everything else travels: "Slow Group" belongs
# anywhere, so those fill out whichever region runs short.
CLUB_NAMES_BY_REGION = {
    "north": [
        "Punggol Run Club", "Northside", "Hougang Runners", "Serangoon",
        "North East", "Punggol Sundays", "North East 10",
    ],
    "south": [
        "Southside", "Harbourfront Run", "Telok Blangah Hill", "West Coast Park",
    ],
    "east": [
        "East Side", "Bedok Boys", "Tampines Track", "East Coast",
        "Bedok Reservoir", "ECP Sundays", "East Coast Crew", "Tampines 5K",
        "East Side 5",
    ],
    "west": [
        "Westies", "Jurong Lake", "Clementi Run", "West Side Run",
    ],
    "central": [
        "AMK Track", "Kallang Crew", "Bishan Run", "Central Run",
        "Bishan Tuesdays", "Marina Run", "CBD Run Club", "Stadium Crew",
    ],
}

CLUB_NAMES_ANY = [
    "7PM Club", "After Work", "8:30", "Run First", "Tuesday Club", "5K Only",
    "Just Running", "6AM", "Sunday People", "The Usual", "Slow Group",
    "Fast Group", "Thursday Night", "10K Gang", "Run Lah", "downstairs",
    "630pm", "Last Minute", "Meet @ 7", "Macs After", "5:45 Club",
    "Weekend Run", "After Office", "Track Tuesdays", "Run Then Eat",
    "Saturday 7AM", "The Running Group", "Casual 5K", "Pace 6", "6:30 Crew",
    "MRT Exit A", "Wednesday Run", "Loop Club", "10 Klicks", "Running Dept",
    "5K Dept", "Run Unit", "Pace Dept", "Morning Shift", "Night Shift",
    "0600", "1930", "RC01", "Run Group 03", "Group B", "The 7PM",
    "Lunch Run", "After Hours", "Weeknight", "Saturday Club", "Easy Pace",
    "Tempo Boys", "The Joggers", "Jog Club", "Nothing Serious", "Not Fast",
    "Probably 5K", "Maybe 10K", "Again Tomorrow", "Same Route", "Normal Pace",
    "Start Here", "Just 5", "One Round", "Another Round", "Run Group",
    "Running People", "People Who Run", "Out Running", "Outside Club",
    "Meet Outside", "Downstairs Club", "Void Deck Run Club", "Kopi After",
    "Milo After", "Run First Eat Later", "5K Then Kopi", "Block Runners",
    "Neighbourhood Run", "Sunday Jog", "Tuesday Jog",
]


def _derive_tag(name: str, taken: set) -> str:
    """A 2 to 5 character tag for a club, from its name.

    Derived rather than hand written because the names are now ordinary
    phrases and there are a hundred of them. The column is UNIQUE and
    CHECK (char_length BETWEEN 2 AND 5), so both bounds have to hold and
    collisions have to be resolved: "Bishan Run" and "Block Runners" both
    reduce to BR on initials alone.
    """
    words = [w for w in "".join(c if c.isalnum() else " " for c in name).split() if w]
    candidates = []
    if len(words) > 1:
        candidates.append("".join(w[0] for w in words).upper())
        candidates.append((words[0][:3] + words[1][0]).upper())
    if words:
        candidates.append(words[0][:4].upper())
        candidates.append("".join(words)[:5].upper())

    for c in candidates:
        c = "".join(ch for ch in c if ch.isalnum())[:5]
        if 2 <= len(c) <= 5 and c not in taken:
            taken.add(c)
            return c
    # Everything collided: number the best candidate until it does not.
    base = ("".join(ch for ch in (candidates[0] if candidates else "RC") if ch.isalnum()))[:4] or "RC"
    for n in range(2, 100):
        c = f"{base[:5 - len(str(n))]}{n}"
        if c not in taken:
            taken.add(c)
            return c
    raise RuntimeError(f"could not derive a unique tag for {name!r}")


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


def _region_hubs(region: dict, rng: random.Random) -> list[tuple[float, float]]:
    """A few estate centres to hang this region's residents off."""
    n = rng.randint(*HUBS_PER_REGION)
    return [_sample_point_in_region(region, rng) for _ in range(n)]


def _home_near(hub: tuple[float, float], region: dict, rng: random.Random) -> tuple[float, float]:
    """A home point scattered around one hub, kept on land."""
    hub_lat, hub_lon = hub
    for _ in range(40):
        dlat = rng.gauss(0, HOME_SPREAD_M) / 111_320.0
        dlon = rng.gauss(0, HOME_SPREAD_M) / (111_320.0 * 0.99977)
        lat, lon = hub_lat + dlat, hub_lon + dlon
        if region["geom"].contains(Point(lon, lat)):
            return lat, lon
    return hub


def _existing_usernames(db) -> set[str]:
    return {r[0] for r in db.execute(text("SELECT username FROM users")).fetchall()}


def _wipe_bots(db) -> None:
    n = db.execute(text("SELECT count(*) FROM users WHERE is_bot")).scalar()
    print(f"--reset: deleting {n} bot accounts (cascades to their runs, territory, clan membership)")
    # territory_events (migration 0038) carries
    #     CHECK ((kind IN ('steal','defend')) = (victim_id IS NOT NULL))
    # while its FK is ON DELETE SET NULL. So deleting a bot that was ever the
    # VICTIM of a steal or a defend nulls that column and violates the check,
    # and the whole wipe fails. The event log postdates these scripts, which
    # is why --reset worked right up until the first reseed of bots that had
    # actually fought each other.
    #
    # Only victim-side rows have to go: actor_id has no such check, so an
    # event where a bot raided a REAL player keeps its place in that player's
    # history with a null attacker, which is exactly what SET NULL is for.
    # Rows where the bot was the victim cannot be kept under the constraint
    # and are lost — that is the schema's call, not a choice made here.
    db.execute(
        text(
            "DELETE FROM territory_events "
            "WHERE victim_id IN (SELECT id FROM users WHERE is_bot)"
        )
    )
    # runs.user_id carries no ON DELETE CASCADE, so bot runs have to go before
    # the users themselves or the delete trips the foreign key.
    db.execute(text("DELETE FROM runs WHERE user_id IN (SELECT id FROM users WHERE is_bot)"))
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


def _seed_one_run(db, *, user_id, clan_id, home_lat, home_lon, land, started_at,
                  avoid_geom, rank_tier, rng) -> float:
    """One historical run for a bot: route, run row, and the claim it earned.

    Returns the distance run, so the caller can total it into XP. Returns 0.0
    if the claim had to be abandoned because every attempt landed on the real
    player's territory.
    """
    distance_m, pace_s_per_km = bot_world.plan_run(rng, user_id=user_id)

    # Up to a few attempts to find a route whose claim misses the real
    # player's land. Re-rolling the ROUTE rather than nudging the circle is
    # what the old version could not do, and it is why a bot can now live
    # next door to the player without ever having stolen from them.
    path = poly = None
    for attempt in range(5):
        candidate_path = bot_world.synth_route(home_lat, home_lon, distance_m, rng, land=land)
        actual_m = bot_world.route_length_m(candidate_path)
        candidate_poly = bot_world.claim_polygon(candidate_path, actual_m, home_lat, home_lon)
        if avoid_geom is None or not candidate_poly.intersects(avoid_geom):
            path, poly, distance_m = candidate_path, candidate_poly, actual_m
            break
    if poly is None:
        return 0.0

    duration_s = distance_m / 1000.0 * pace_s_per_km
    run_id = bot_world.record_run(db, user_id, path, distance_m, duration_s, started_at)

    # A claim that lands entirely on ground too strongly defended to take
    # raises 409 — the message a human sees when their claim bounces. For a
    # simulated run that is an ordinary outcome, not an error, and it gets
    # commoner as the world fills up: the denser the map, the likelier a bot
    # picks a route over a neighbour's fortified block. Uncaught, it killed
    # the whole seed at club six.
    #
    # The run stays on the books. Somebody who went running and failed to
    # take any ground still went running, and the 409 is raised before any
    # mutation, so there is nothing half-written to undo.
    try:
        territory_out, *_rest = _claim_territory(
            db=db,
            user_id=user_id,
            run_id=run_id,
            polygon_wgs=poly,
            initial_area_m2=claim_area_m2(distance_m),
            strength=claim_strength(distance_m, duration_s),
            verified=True,
            clan_id=clan_id,
            rank_tier=rank_tier,
            lifetime_for=lambda r, d=distance_m, du=duration_s: claim_lifetime_days(d, du, r),
        )
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        return distance_m

    # Age the territory to match the run that earned it, so a bot's oldest
    # claim is genuinely its oldest and the decay clock is already ticking.
    if territory_out is not None:
        age_h = max(0.0, (datetime.utcnow() - started_at).total_seconds() / 3600.0)
        db.execute(
            text(
                """
                UPDATE territories
                SET created_at = created_at - (:h || ' hours')::interval,
                    expires_at = expires_at - (:h || ' hours')::interval
                WHERE id = :id AND expires_at > now() + (:h || ' hours')::interval
                """
            ),
            {"h": age_h, "id": territory_out.id},
        )
    return distance_m


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="required to actually write")
    ap.add_argument("--reset", action="store_true", help="wipe existing bot accounts first")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed, for a reproducible run")
    # Size overrides exist so the whole thing can be exercised against a local
    # database in seconds. A full seed is ~2100 claims, each doing real PostGIS
    # overlap resolution, which is several minutes — too slow to iterate on.
    ap.add_argument("--clans", type=int, default=N_CLANS, help=f"number of clubs (default {N_CLANS})")
    ap.add_argument("--per-clan", type=int, default=BOTS_PER_CLAN,
                    help=f"players per club (default {BOTS_PER_CLAN})")
    ap.add_argument("--resume", action="store_true",
                    help="add clubs to an existing seeded world instead of refusing")
    ap.add_argument("--check", action="store_true",
                    help="connect, report what is there, change nothing")
    ap.add_argument("--rerank", action="store_true",
                    help="redeal rank points across existing bots, nothing else")
    ap.add_argument("--redress", action="store_true",
                    help="redeal cosmetics across existing bots, nothing else")
    ap.add_argument("--clubstats", action="store_true",
                    help="rebuild clan_season_stats from live territory, nothing else")
    ap.add_argument("--unclub", type=float, default=None, metavar="FRAC",
                    help="move this fraction of bots out of their clubs (e.g. 0.22)")
    args = ap.parse_args()

    n_clans = max(1, args.clans)
    per_clan = max(1, args.per_clan)

    db_url = os.environ.get("DATABASE_URL", "")
    host = db_url.split("@")[-1].split("/")[0] if "@" in db_url else "(default local)"

    if args.clubstats:
        db = SessionLocal()
        try:
            n = rebuild_clan_season_stats(db)
            db.commit()
            print(f"rebuilt club season stats for {n} clubs in: {host}")
            for name, area, steals in db.execute(text(
                """SELECT c.name, s.area_current, s.steals
                   FROM clan_season_stats s JOIN clans c ON c.id = s.clan_id
                   WHERE s.area_current > 0
                   ORDER BY s.area_current DESC LIMIT 10""")).fetchall():
                print(f"   {name:<24} {area/1e6:>6.2f} km2   {steals} steals")
            return 0
        finally:
            db.close()

    if args.unclub is not None:
        # Leave some runners clubless.
        #
        # The solo board is defined as players with no club membership, so a
        # world where every seeded runner joined one leaves it holding nobody
        # but the real accounts — the same empty-surface problem the rank
        # filter had. Plenty of real runners are in no club, so this is what
        # the world should have looked like anyway.
        frac = max(0.0, min(1.0, args.unclub))
        rng = random.Random(args.seed)
        db = SessionLocal()
        try:
            ids = [r[0] for r in db.execute(
                text("SELECT id::text FROM users WHERE is_bot AND clan_id IS NOT NULL")
            ).fetchall()]
            n = int(len(ids) * frac)
            picked = rng.sample(ids, n) if n else []
            if picked:
                # Territory carries the club id for defence stacking, so it
                # has to let go too or a clubless runner keeps club-stacked
                # land they are no longer part of.
                db.execute(text("UPDATE territories SET clan_id = NULL "
                                "WHERE user_id = ANY(CAST(:ids AS uuid[]))"), {"ids": picked})
                db.execute(text("DELETE FROM clan_members "
                                "WHERE user_id = ANY(CAST(:ids AS uuid[]))"), {"ids": picked})
                db.execute(text("UPDATE users SET clan_id = NULL "
                                "WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": picked})
                rebuild_clan_season_stats(db)
                db.commit()
            print(f"moved {len(picked)} of {len(ids)} bots out of their clubs in: {host}")
            return 0
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    if args.redress:
        # Dress the bots already in the world. Same reasoning as --rerank:
        # a wardrobe change should not cost an hour and a half of re-seeding
        # when it only rewrites one column.
        rng = random.Random(args.seed)
        db = SessionLocal()
        try:
            ids = [r[0] for r in db.execute(
                text("SELECT id::text FROM users WHERE is_bot")).fetchall()]
            if not ids:
                print("no bot accounts to dress.")
                return 0
            looks = [json.dumps(bot_world.make_avatar(rng)) for _ in ids]
            db.execute(
                text(
                    """
                    UPDATE users u
                    SET avatar = d.look::jsonb
                    FROM (
                        SELECT unnest(CAST(:ids AS uuid[]))  AS id,
                               unnest(CAST(:looks AS text[])) AS look
                    ) d
                    WHERE u.id = d.id
                    """
                ),
                {"ids": ids, "looks": looks},
            )
            db.commit()
            import collections
            worn = collections.Counter()
            for raw in looks:
                a = json.loads(raw)
                for slot in ("headwear", "glasses", "accessory", "footwear"):
                    if a.get(slot, "none") != "none":
                        worn[slot] += 1
            print(f"dressed {len(ids)} bots in: {host}")
            print("  distinct loadouts:", len(set(looks)))
            for slot in ("headwear", "glasses", "accessory", "footwear"):
                print(f"  wearing {slot:<10} {worn[slot]} ({worn[slot]/len(ids):.0%})")
            return 0
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    if args.rerank:
        # Redeal standing over the bots already in the world.
        #
        # Retuning _TIER_WEIGHTS otherwise means re-seeding, and a full seed
        # is an hour and a half against the real database — far too much to
        # pay for a number that lives in one column. Nothing else is touched:
        # same accounts, same clubs, same runs, same territory.
        #
        # One statement rather than 384. Per-row updates at ~190ms each is
        # over a minute of pure latency for work the database can do in a
        # single pass.
        rng = random.Random(args.seed)
        db = SessionLocal()
        try:
            ids = [r[0] for r in db.execute(
                text("SELECT id::text FROM users WHERE is_bot")).fetchall()]
            if not ids:
                print("no bot accounts to rerank.")
                return 0
            pts = bot_world.rank_points_pyramid(rng, len(ids))
            from app.ranks import rank_for_points
            tiers = [rank_for_points(p)["tier"] for p in pts]
            from app.elo import rating_for_tier
            elo_ratings = [rating_for_tier(t, 0.3) for t in tiers]
            ages = [rng.uniform(0, 200) for _ in ids]
            db.execute(
                text(
                    """
                    UPDATE users u
                    SET rank_points = d.pts,
                        rank_points_at = timezone('utc', now())
                                         - make_interval(secs => d.age * 3600),
                        rank_best = GREATEST(COALESCE(u.rank_best, 0), d.tier),
                        solo_elo = d.elo,
                        solo_elo_peak = GREATEST(COALESCE(u.solo_elo_peak,1000), d.elo)
                    FROM (
                        SELECT unnest(CAST(:ids AS uuid[]))  AS id,
                               unnest(CAST(:pts AS int[]))   AS pts,
                               unnest(CAST(:tiers AS int[])) AS tier,
                               unnest(CAST(:elo AS int[]))   AS elo,
                               unnest(CAST(:ages AS float[])) AS age
                    ) d
                    WHERE u.id = d.id
                    """
                ),
                {"ids": ids, "pts": pts, "tiers": tiers, "elo": elo_ratings, "ages": ages},
            )
            db.commit()
            import collections
            spread = collections.Counter(rank_for_points(p)["label"] for p in pts)
            print(f"reranked {len(ids)} bots into: {host}\n")
            for _need, _key, label in __import__("app.ranks", fromlist=["x"]).RANK_TIERS:
                print(f"   {label:<10} {spread.get(label, 0)}")
            return 0
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    if args.check:
        # Read-only preflight. `--reset` against the wrong DATABASE_URL is the
        # one mistake here that cannot be undone, and the shape of the two
        # databases is nearly identical from the command line, so the only
        # honest way to tell them apart is to look at what is inside.
        db = SessionLocal()
        try:
            one = lambda q: db.execute(text(q)).scalar()
            print(f"host              {host}")
            print(f"alembic head      {one('SELECT version_num FROM alembic_version')}")
            print(f"real accounts     {one('SELECT count(*) FROM users WHERE NOT is_bot')}")
            print(f"bot accounts      {one('SELECT count(*) FROM users WHERE is_bot')}"
                  "   <- --reset deletes exactly these")
            print(f"clubs             {one('SELECT count(*) FROM clans')}")
            print(f"live territory    {one('SELECT count(*) FROM territories WHERE expires_at IS NULL OR expires_at > now()')}"
                  f"  ({one('SELECT count(*) FROM territories t JOIN users u ON u.id=t.user_id WHERE u.is_bot')} of it bot owned)")
            mine = one(
                "SELECT count(*) FROM territories t JOIN users u ON u.id=t.user_id "
                f"WHERE u.username = '{TARGET_USERNAME}'"
            )
            print(f"{TARGET_USERNAME + ' territory':<17} {mine}   <- never touched, and seeded claims avoid it")
            print(f"\nwould seed        {n_clans} clubs / {n_clans * per_clan} players")
        finally:
            db.close()
        return 0

    if not args.yes:
        print(f"This will seed {n_clans} clubs / {n_clans * per_clan} bot players into: {host}")
        print("Run --check first to see what is already there, then re-run with --yes.")
        return 1

    rng = random.Random(args.seed)
    regions = _load_regions()
    db = SessionLocal()
    try:
        if args.reset:
            _wipe_bots(db)

        # Clear seeded clubs that ended up with nobody in them.
        #
        # The club rows are all INSERTed up front and the first per-club
        # commit commits every one of them, so a run that dies partway leaves
        # clubs that exist and have no members. They are invisible to the
        # "which clubs are seeded" query below, which counts membership — so
        # a resume hands their names out a second time and dies on
        # clans_name_key instead. Deleting them frees the name and loses
        # nothing, since an empty club is not a club.
        #
        # Scoped to created_by IS NULL, which is what marks a seeded club. A
        # club a real person made is never touched, even if it is empty.
        orphans = db.execute(
            text(
                """
                DELETE FROM clans
                WHERE created_by IS NULL
                  AND id NOT IN (
                        SELECT clan_id FROM users WHERE clan_id IS NOT NULL
                  )
                RETURNING name
                """
            )
        ).fetchall()
        if orphans:
            db.commit()
            print(f"cleared {len(orphans)} empty club(s) left by an interrupted run")

        # Clubs that already have seeded members, so --resume knows where it
        # got to and which names are spoken for.
        seeded_names = {
            r[0] for r in db.execute(
                text(
                    "SELECT c.name FROM clans c JOIN users u ON u.clan_id = c.id "
                    "WHERE u.is_bot GROUP BY c.name"
                )
            ).fetchall()
        }
        done_clubs = len(seeded_names)

        already = db.execute(text("SELECT count(*) FROM users WHERE is_bot")).scalar()
        if already and not args.resume:
            print(f"{already} bot accounts already exist — nothing to do "
                  "(--reset to redo, --resume to carry on adding clubs).")
            return 0
        if args.resume and done_clubs >= n_clans:
            print(f"{done_clubs} clubs already seeded, target is {n_clans} — nothing left to do.")
            return 0

        # RESUME EXISTS BECAUSE THE SEED IS SLOW WHERE IT MATTERS. Against a
        # local database the whole thing is a couple of minutes; against the
        # real one it is an hour, because every claim is a dozen round trips
        # and the database is a continent away from whoever is running this.
        # An hour is long enough that "it died at club 19" has to cost the
        # club, not the hour. Combined with the per club commit, --resume
        # picks up at the next unseeded club.
        to_create = n_clans - done_clubs if args.resume else n_clans
        if args.resume:
            print(f"resuming: {done_clubs} clubs already seeded, adding {to_create} more")

        avoid_geom = _target_avoid_geom(db)
        taken_usernames = _existing_usernames(db)
        # Every club name in the table, not just the seeded ones. clans.name
        # is UNIQUE across the whole table, so a club a real player happened
        # to call "Slow Group" would collide just as hard as a leftover.
        existing_club_names = {
            r[0] for r in db.execute(text("SELECT name FROM clans")).fetchall() if r[0]
        }
        total_bots = to_create * per_clan
        usernames = bot_world.allocate_usernames(rng, total_bots, taken_usernames)
        rank_points = bot_world.rank_points_pyramid(rng, total_bots)

        # Round-robin clubs across the 5 regions so no single neighbourhood
        # gets every club's home turf, and pre-pick each region's estate hubs.
        # Offset by what is already there so a resumed run keeps the rotation
        # going rather than starting over at north every time.
        region_cycle = [regions[(done_clubs + i) % len(regions)] for i in range(to_create)]
        hubs = {r["key"]: _region_hubs(r, rng) for r in regions}
        color_keys = list(CLAN_COLORS.keys())
        rng.shuffle(color_keys)
        badge_keys = list(CLAN_BADGES)
        rng.shuffle(badge_keys)
        # One shuffled queue of place-committed names PER REGION, plus one
        # shared queue of names that could belong anywhere. A club named after
        # an estate has to be seeded in that estate; everything else travels,
        # which is what lets a region with few named landmarks still fill up.
        name_queues = {}
        for key, names in CLUB_NAMES_BY_REGION.items():
            pool = [n for n in names if n not in existing_club_names]
            rng.shuffle(pool)
            name_queues[key] = pool
        any_queue = [n for n in CLUB_NAMES_ANY if n not in existing_club_names]
        rng.shuffle(any_queue)

        taken_tags = {
            r[0] for r in db.execute(text("SELECT tag FROM clans")).fetchall() if r[0]
        }

        clan_ids: list[tuple[str, dict, str]] = []  # (clan_id, region, name)
        for i in range(to_create):
            region_key = region_cycle[i]["key"]
            queue = name_queues.get(region_key) or []
            # Lean toward a local name where one is left, but not always —
            # a map where every single club is named after its own estate is
            # its own kind of too tidy.
            if queue and (rng.random() < 0.55 or not any_queue):
                name = queue.pop()
            elif any_queue:
                name = any_queue.pop()
            elif queue:
                name = queue.pop()
            else:
                name = f"Run Group {i + 1:02d}"
            tag = _derive_tag(name, taken_tags)
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
                    # No dash: club descriptions are user visible copy.
                    "desc": f"Running out of {region_cycle[i]['name']} Singapore.",
                    "ck": color_keys[i % len(color_keys)], "b": badge_keys[i % len(badge_keys)],
                },
            )
            clan_ids.append((clan_id, region_cycle[i], name))
        db.flush()
        print(f"created {len(clan_ids)} clubs")

        cursor = 0
        total_attackers = 0
        total_runs = 0
        for clan_id, region, name_of_clan in clan_ids:
            leader_set = False
            clan_hubs = hubs[region["key"]]
            for _ in range(per_clan):
                username = usernames[cursor]
                points = rank_points[cursor]
                rank_tier = ranks.rank_for_points(points)["tier"]
                cursor += 1
                user_id = str(uuid.uuid4())
                is_attacker = rng.random() < ATTACKER_FRACTION

                db.execute(
                    text(
                        """
                        INSERT INTO users (id, username, password_hash, created_at, clan_id, avatar, is_bot)
                        VALUES (:id, :u, NULL, now() - (:age_days || ' days')::interval, :cid, CAST(:avatar AS jsonb), true)
                        """
                    ),
                    {"id": user_id, "u": username, "cid": clan_id, "age_days": rng.uniform(3, 200),
                     "avatar": json.dumps(bot_world.make_avatar(rng))},
                )

                # The rank must exist BEFORE historical territory is resolved.
                # Combat is rank-scoped; assigning it afterwards made every
                # initial claim fight as Wood, carving unrelated rank layers out
                # of each other and leaving every map board needlessly sparse.
                bot_world.apply_rank_points(db, user_id, points, rng)
                db.execute(
                    text(
                        "INSERT INTO clan_members (clan_id, user_id, role) VALUES (:cid, :uid, :role)"
                    ),
                    {"cid": clan_id, "uid": user_id, "role": "leader" if not leader_set else "member"},
                )
                leader_set = True

                home_lat, home_lon = _home_near(rng.choice(clan_hubs), region, rng)
                db.execute(
                    text(
                        """
                        INSERT INTO bot_accounts (user_id, home_lat, home_lon, region_key, attacker, next_run_at)
                        VALUES (:uid, :lat, :lon, :rk, :atk, :nra)
                        """
                    ),
                    {
                        "uid": user_id, "lat": home_lat, "lon": home_lon,
                        "rk": region["key"], "atk": is_attacker,
                        "nra": bot_world.next_run_at(rng),
                    },
                )

                # Run history, oldest first so each claim lands on top of the
                # one before it exactly as it would have in real time.
                when = sorted(bot_world.recent_run_times(
                    rng, rng.randint(MIN_HISTORY_RUNS, MAX_HISTORY_RUNS)))
                distance_total = 0.0
                for started_at in when:
                    distance_total += _seed_one_run(
                        db, user_id=user_id, clan_id=clan_id,
                        home_lat=home_lat, home_lon=home_lon, land=region["geom"],
                        started_at=started_at, avoid_geom=avoid_geom,
                        rank_tier=rank_tier, rng=rng,
                    )
                    total_runs += 1

                # XP from distance, the same rule /end-run applies, so the
                # level on a bot's portrait matches the runs on its profile.
                db.execute(
                    text("UPDATE users SET xp = :xp WHERE id = :u"),
                    {"xp": round(distance_total / 1000.0 * settings.xp_per_km), "u": user_id},
                )
                total_attackers += 1 if is_attacker else 0
            # Commit per club, not once at the end. A full seed is ~2100
            # claims, and against a remote database that is the better part of
            # an hour inside a single transaction — long enough for a dropped
            # connection or an idle timeout to throw the whole thing away, and
            # long enough to be holding locks nobody wants held that long. Per
            # club, a failure costs the club in flight instead of the night.
            db.commit()
            print(f"  {region['name']:<10} {name_of_clan:<24} seeded "
                  f"({cursor}/{total_bots} players)", flush=True)

        # The club board ranks on clan_season_stats and _claim_territory does
        # not write it, so a seed that skipped this leaves 24 clubs holding
        # territory and an empty leaderboard.
        rebuild_clan_season_stats(db)
        db.commit()
        print(f"created {cursor} bot players, {total_runs} runs "
              f"({total_attackers} eligible to raid {TARGET_USERNAME})")
        print("done. Ongoing activity needs bot_activity.py running on a schedule.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
