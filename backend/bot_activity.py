"""Scheduled: let seeded bot players go on runs.

Run by the `territory-run-bots` cron in render.yaml, on the same "talk to the
database directly" pattern as sweep.py — no HTTP hop, no shared secret, and it
does not care whether the web service is up.

Each tick, every bot whose `bot_accounts.next_run_at` has passed (capped at
BATCH_SIZE per tick so one slow tick can't starve the rest of the schedule)
goes on a run: a synthesised route near its home (bot_world.synth_route), a
real `runs` row, and a claim grown around that route through the exact same
overlap-resolution helper (`_claim_territory`) a human /claim uses. Strength,
decay, club defence-stacking, the rivalry ledger and the rank ladder all
behave identically to a human claim, because they are the same code.

Three things a bot's run can be, in rising order of aggression:

  * REINFORCE its own neighbourhood (the common case)
  * RAID A NEIGHBOUR — another bot, in another club, near enough to be a
    plausible local rival
  * RAID THE PLAYER — only attacker-eligible bots, only at ATTACK_CHANCE

A real victim (never a bot one) gets the same "stolen" notification a human
attacker would have triggered.

    python bot_activity.py

Idempotent per tick in the sense that matters: a bot only becomes due again
after this tick pushes its next_run_at forward, so a cron firing every 30
minutes cannot double-run the same bot in one pass.
"""

from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta

from fastapi import HTTPException
from shapely.geometry import MultiPolygon, Polygon
from sqlalchemy import text

import bot_world
from app import club_runs, economy, elo, ranks
from app.config import settings
from app.database import SessionLocal
from app.geospatial import claim_area_m2
from app.notifications import notify
from app.routes.runs import (
    STEAL_LEDGER_MIN_M2,
    _claim_territory,
    _rank_scope_sql,
    claim_lifetime_days,
    claim_strength,
)

TARGET_USERNAME = "jonfong78"

# How many due bots to process in one cron tick. Runs are not spread evenly
# around the clock any more (see bot_world's run windows), so a tick landing
# in the evening peak has many more due bots than the daily average — this
# has to absorb that burst plus a missed tick or two, not just the mean.
BATCH_SIZE = 60

# Of every due run from an attacker-eligible bot in the TARGET's current rank,
# this fraction targets the player's land. Rank scoping matters: choosing from
# all ~85 eligible bots made nine out of ten apparent raids unable to fight the
# selected land. At the denser cadence this yields roughly 2-5 real attempts a
# week depending on the population of the player's tier.
ATTACK_CHANCE = 0.06

# Chance any bot's run goes after a NEIGHBOURING BOT's land instead of its
# own. This is what makes the world's territory move on its own: without it,
# bots only ever fought the one real player, every other border on the map
# was frozen, and the map looked like a photograph rather than a game in
# progress. Nearly one run in three is now an intentional local derby; ordinary
# home routes still produce incidental border contact on top of this.
RIVAL_CHANCE = 0.32

# Prefer someone this bot has fought before on most intentional raids. This is
# the difference between many unrelated steals and a border that visibly moves
# back and forth between recognisable rivals.
REMATCH_CHANCE = 0.70

# How far a bot will travel to raid a neighbour. Far enough to reach the next
# estate, near enough that it is still a local rivalry.
RIVAL_RADIUS_M = 5000

# A bot's home-turf run starts within this radius of its home point, so its
# territory drifts and occasionally bumps a neighbour rather than teleporting.
HOME_JITTER_M = 900.0

# Chance a due bot with a club offers its route to the club, for the next due
# clubmate in the same tick to run with it. Club land only exists where a club
# ran TOGETHER now (app/club_runs.py), so without this the seeded world would
# hold no club territory at all and the club board would be permanently empty
# — not because the rule is wrong, but because nothing in the simulation was
# ever written to satisfy it.
CLUB_RUN_CHANCE = 0.45

# How far apart the two starts are. Comfortably inside the tolerance the
# matcher allows, because this is meant to be a group run, not a test of where
# the threshold sits.
CLUB_RUN_START_SKEW_S = 90

_REGION_FILE = os.path.join(os.path.dirname(__file__), "sg_regions.json")
_regions_cache: dict | None = None


def _land_for(region_key: str | None):
    """The land polygon for a region, so synthesised routes stay ashore.

    Loaded once per process and cached: the cron is a short-lived process, and
    27 KB of GeoJSON parsed once is cheaper than every bot in the batch
    running into the sea.
    """
    global _regions_cache
    if _regions_cache is None:
        _regions_cache = {}
        try:
            with open(_REGION_FILE, encoding="utf-8") as f:
                data = json.load(f)
            for r in data["regions"]:
                polys = [Polygon(ring) for ring in r["polygons"] if len(ring) >= 4]
                polys = [p.buffer(0) for p in polys if p.is_valid or p.buffer(0).area > 0]
                _regions_cache[r["key"]] = MultiPolygon(
                    [p for p in polys if p.geom_type == "Polygon"]
                )
        except Exception as exc:  # noqa: BLE001 — routes without land beat no runs
            print(f"could not load regions, routes will be unconstrained: {exc}", file=sys.stderr)
    return _regions_cache.get(region_key or "")


def _due_bots(db, limit: int):
    return db.execute(
        text(
            """
            SELECT b.user_id, u.username, u.clan_id, u.avatar, b.home_lat, b.home_lon,
                   b.attacker, b.region_key
            FROM bot_accounts b
            JOIN users u ON u.id = b.user_id
            WHERE b.next_run_at <= now()
            ORDER BY b.next_run_at
            LIMIT :n
            """
        ),
        {"n": limit},
    ).fetchall()


def _target_territory(db, rank_tier: int):
    """A random live TARGET territory on the bot's combat board, or None."""
    rank_clause, rank_params = _rank_scope_sql(rank_tier, "u", "target_rank")
    rows = db.execute(
        text(
            f"""
            SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
            FROM territories t JOIN users u ON u.id = t.user_id
            WHERE u.username = :n AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
              AND {rank_clause}
            """
        ),
        {"n": TARGET_USERNAME, **rank_params},
    ).fetchall()
    if not rows:
        return None
    return random.choice(rows)


def _rival_territory(
    db,
    home_lat: float,
    home_lon: float,
    clan_id,
    user_id,
    rank_tier: int,
    prefer_rematch: bool,
):
    """A nearby bot's land, owned by somebody in another club.

    Excludes club-mates deliberately: club-mates stack defence on each other's
    territory, so a bot attacking its own club is both thematically wrong and
    mechanically futile. Real accounts are excluded here too — raiding the
    player is a separate, rationed decision, not something that should also
    happen by accident through this path.
    """
    rank_clause, rank_params = _rank_scope_sql(rank_tier, "u", "rival_rank")
    params = {
        "me": user_id,
        "clan": clan_id,
        "lat": home_lat,
        "lon": home_lon,
        "radius": RIVAL_RADIUS_M,
        **rank_params,
    }

    def find(extra: str = ""):
        return db.execute(
            text(
                f"""
            SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
            FROM territories t
            JOIN users u ON u.id = t.user_id
            WHERE u.is_bot
              AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
              AND u.id <> :me
              AND (
                CAST(:clan AS uuid) IS NULL
                OR u.clan_id IS NULL
                OR u.clan_id <> :clan
              )
              AND {rank_clause}
              AND ST_DWithin(
                    t.polygon::geography,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                    :radius)
              {extra}
            ORDER BY random()
            LIMIT 1
            """
            ),
            params,
        ).fetchone()

    if prefer_rematch:
        row = find(
            """
              AND u.id IN (
                SELECT victim_id FROM territory_steals WHERE attacker_id = :me
                UNION
                SELECT attacker_id FROM territory_steals WHERE victim_id = :me
              )
            """
        )
        if row is not None:
            return row
    return find()


def _jitter(lat: float, lon: float, metres: float, rng: random.Random) -> tuple[float, float]:
    import math
    dy = rng.uniform(-metres, metres)
    dx = rng.uniform(-metres, metres)
    return (
        lat + dy / 111_320.0,
        lon + dx / (111_320.0 * max(0.1, math.cos(math.radians(lat)))),
    )


def _run_one(db, bot_row, background_notifies: list, shared=None):
    """One bot's run. Returns the route it ran, so main() can offer it to a
    clubmate; `shared` is that offer coming back the other way."""
    user_id, username, clan_id, avatar, home_lat, home_lon, attacker, region_key = bot_row
    rng = random.Random()

    distance_m, pace_s_per_km = bot_world.plan_run(rng, user_id=user_id)
    # Read the live tier before choosing a destination. A cross-tier target is
    # scenery to the claim engine, so selecting one cannot create a rivalry.
    bot_rank_tier = elo.solo_status(db, user_id)["tier"]

    if shared is not None:
        # Running with the club: the route and the hour are the clubmate's,
        # only the pace is this bot's. Nothing is chosen here — a group run
        # that quietly picked its own rival to raid would not be the same run.
        path = shared["path"]
        start_lat, start_lon = path[0][1], path[0][0]
        distance_m = bot_world.route_length_m(path)
        duration_s = distance_m / 1000.0 * pace_s_per_km
        started_at = shared["started_at"] + timedelta(
            seconds=rng.uniform(-CLUB_RUN_START_SKEW_S, CLUB_RUN_START_SKEW_S)
        )
    else:
        # Where does this run start?
        start_lat, start_lon = _jitter(home_lat, home_lon, HOME_JITTER_M, rng)
        target = (
            _target_territory(db, bot_rank_tier)
            if attacker and rng.random() < ATTACK_CHANCE
            else None
        )
        if target is not None:
            start_lat, start_lon = _jitter(target[0], target[1], 150, rng)
        elif rng.random() < RIVAL_CHANCE:
            rival = _rival_territory(
                db, home_lat, home_lon, clan_id, user_id, bot_rank_tier,
                prefer_rematch=rng.random() < REMATCH_CHANCE,
            )
            if rival is not None:
                start_lat, start_lon = _jitter(rival[0], rival[1], 200, rng)

        path = bot_world.synth_route(
            start_lat, start_lon, distance_m, rng, land=_land_for(region_key)
        )
        distance_m = bot_world.route_length_m(path)
        duration_s = distance_m / 1000.0 * pace_s_per_km
        started_at = datetime.utcnow() - timedelta(seconds=duration_s)

    run_id = bot_world.record_run(db, user_id, path, distance_m, duration_s, started_at)
    poly = bot_world.claim_polygon(path, distance_m, start_lat, start_lon)

    # A raid that lands entirely on ground too strongly defended to take
    # raises 409 — what a human sees when their claim bounces off a fortified
    # block. For a bot it is an ordinary outcome and a likely one, since
    # RIVAL_CHANCE deliberately sends it at a neighbour's territory.
    #
    # It has to be caught HERE rather than left to the per-bot handler in
    # main(). That handler rolls back, which also discards the `next_run_at`
    # update at the end of this function — so a bot boxed in by a strong
    # neighbour would come up due on every tick forever, fail every time, and
    # eat a slot in the batch while never running again.
    # Read once and passed through explicitly, mirroring routes/runs.py: it
    # both scopes the fight (rivals are only ever in this bracket — see
    # `_claim_territory`'s docstring) and is what the tier-scaled steal/lost/
    # defend rewards below key off. Left implicit, `_claim_territory` would
    # compute the identical number itself, but this way there is one query
    # and one value in use for the whole call.
    # Same rule a human claim runs under: this land is the CLUB's only if the
    # club ran the route together. For a bot that means the clubmate this tick
    # handed it the route, or the one it is about to hand it to — whoever
    # claims second is what makes it a club run for both (app/club_runs.py).
    club_id, club_partners, _newly = club_runs.log_run(db, run_id, user_id, clan_id)
    if club_id:
        club_runs.attribute_territories(
            db, [p["run_id"] for p in club_partners], club_id
        )

    bounced = False
    try:
        territory_out, _stolen_m2, _stolen_from, steal_events, ground = _claim_territory(
            db=db,
            user_id=user_id,
            run_id=run_id,
            polygon_wgs=poly,
            initial_area_m2=claim_area_m2(distance_m),
            strength=claim_strength(distance_m, duration_s),
            verified=True,
            clan_id=club_id,
            member_clan_id=clan_id,
            rank_tier=bot_rank_tier,
            lifetime_for=lambda r: claim_lifetime_days(distance_m, duration_s, r),
        )
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        bounced = True
        territory_out, steal_events, ground = None, [], {}

    # XP, the same rule /end-run applies to a human run.
    db.execute(
        text("UPDATE users SET xp = COALESCE(xp, 0) + :g WHERE id = :u"),
        {"g": round(distance_m / 1000.0 * settings.xp_per_km), "u": user_id},
    )

    db.execute(text("UPDATE runs SET reward_xp = :xp WHERE id = :rid"),
               {"xp": round(distance_m / 1000.0 * settings.xp_per_km), "rid": run_id})
    club_runs.sync_credit(db, [run_id] + [p["run_id"] for p in club_partners], club_id)

    # Rank points, mirroring the block in routes/runs.py. This was missing
    # entirely, and its absence was not just a gap in the bots' own standing:
    # when a bot took the PLAYER's land, the player lost the territory but
    # none of the rank points a human attacker would have cost them, and
    # successfully defending against a bot earned them nothing. Being raided
    # has to mean the same thing whoever did it.
    # The daily ration on the flat per-claim award is NOT a brake on bots. It
    # is the rule a human claim already runs under: only ACTION_EMPTY, quiet
    # expansion onto nobody's ground, is capped, because it is the one thing
    # a player can repeat at will. Taking ground and defending it are
    # contested outcomes and stay uncapped for everyone.
    #
    # The action is computed the same way /claim computes it rather than
    # guessed from whether anything was stolen. Those are not the same test:
    # REINFORCE — running over your own turf, which is what most bot runs are
    # — steals nothing but is not empty ground either, and it pays the full
    # award for a human. Approximating it as "uncontested" rationed the bots
    # for the commonest thing they do and left them earning less than a person
    # doing the identical run.
    #
    # A bounced claim earns nothing. Without this guard it would earn the
    # FULL award: with no steal events and no ground, `claim_action` sees
    # zero contested and zero area, reads `mine >= area * 0.5` as 0 >= 0, and
    # returns REINFORCE — the uncapped case. An attack that failed would pay
    # better than the quiet expansion that worked.
    enemy_m2 = sum(ev["area_m2"] for ev in steal_events if not ev["defended"])
    defended_m2 = sum(ev["area_m2"] for ev in steal_events if ev["defended"])
    action = economy.claim_action(
        (ground or {}).get("claimed_m2", 0.0),
        enemy_m2,
        defended_m2,
        (ground or {}).get("reinforced_m2", 0.0),
    )
    claim_points = 0 if bounced else ranks.POINTS_CLAIM
    if not bounced and action == economy.ACTION_EMPTY:
        claim_points = min(claim_points, economy.neutral_rank_allowance(db, user_id))
        if claim_points > 0:
            economy.claim_grant(db, user_id, run_id, economy.KIND_NEUTRAL_RANK, claim_points)
    if claim_points > 0:
        ranks.award(db, user_id, claim_points, "claim")

    centre = poly.centroid
    for ev in steal_events:
        if ev["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        db.execute(
            text(
                """
                INSERT INTO territory_steals (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, :r, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": user_id, "v": ev["victim_id"], "r": run_id, "area": ev["area_m2"],
                "defended": ev["defended"], "lat": centre.y, "lon": centre.x,
            },
        )
        if ev["defended"]:
            ranks.award(db, ev["victim_id"], ranks.defend_reward(bot_rank_tier), "defend")
            continue
        ranks.award(db, user_id, ranks.steal_reward(bot_rank_tier), "steal")
        ranks.award(db, ev["victim_id"], ranks.loss_penalty(bot_rank_tier), "lost_ground")

        # Only a REAL victim gets a push — a bot losing land to another bot is
        # invisible noise nobody needs woken up for.
        victim_is_real = db.execute(
            text("SELECT NOT is_bot FROM users WHERE id = :v"), {"v": ev["victim_id"]}
        ).scalar()
        if victim_is_real:
            background_notifies.append(
                (
                    [str(ev["victim_id"])],
                    "stolen",
                    "Your land was captured",
                    f"{username} took {ev['area_m2'] / 1_000_000:.3f} km² of your territory.",
                    {
                        "capture_id": f"bot:{user_id}:{ev['victim_id']}:{centre.x:.5f},{centre.y:.5f}",
                        "taken_m2": ev["area_m2"],
                        "lat": centre.y,
                        "lon": centre.x,
                        "attacker_id": str(user_id),
                        "attacker_username": username,
                        "attacker_avatar": avatar or {},
                        "territory_id": str(territory_out.id) if territory_out else None,
                    },
                    str(user_id),
                )
            )

    # Bots play on the same zero-sum ladder as people. Keep this in the same
    # transaction as the territory and steal ledger so a rolled-back claim can
    # never leave either solo or club Elo behind.
    elo.record_claim_matches(
        db, user_id, run_id, steal_events, attacker_clan_id=club_id,
        club_match=bool(club_id),
    )

    db.execute(
        text("UPDATE bot_accounts SET next_run_at = :n WHERE user_id = :u"),
        {"n": bot_world.next_run_at(rng), "u": user_id},
    )

    # The route, for a clubmate later in this tick to run with. Offered only
    # by a bot that ran its own route: passing a shared one along again would
    # build a chain rather than a group.
    if clan_id and shared is None:
        return {"path": path, "started_at": started_at, "clan_id": str(clan_id)}
    return None


def main() -> int:
    db = SessionLocal()
    processed = 0
    failed = 0
    notifies: list = []
    try:
        due = _due_bots(db, BATCH_SIZE)
        # One open offer per club at a time: the first due member offers its
        # route, the next due member of that club runs it, and the pair is a
        # club run. Due order is by `next_run_at`, so clubmates are rarely
        # adjacent in the batch — the offer waits, which is the point.
        rng = random.Random()
        offers: dict = {}
        for row in due:
            clan_id = row[2]
            shared = offers.pop(str(clan_id), None) if clan_id else None
            try:
                route = _run_one(db, row, notifies, shared=shared)
                db.commit()
                if route is not None and rng.random() < CLUB_RUN_CHANCE:
                    offers[route["clan_id"]] = route
                processed += 1
            except Exception as exc:  # noqa: BLE001 — one bad bot must not sink the tick
                db.rollback()
                failed += 1
                print(f"bot run FAILED for {row[1]}: {exc}", file=sys.stderr)
    finally:
        db.close()

    # Notifications are best-effort and fire after every claim is committed,
    # same ordering the real /claim endpoint uses.
    for args in notifies:
        try:
            notify(*args)
        except Exception as exc:  # noqa: BLE001
            print(f"notify FAILED: {exc}", file=sys.stderr)

    print(f"bot_activity ok — {processed} bots ran, {failed} failed, {len(notifies)} raid notifications sent")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
