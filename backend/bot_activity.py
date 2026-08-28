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
from types import SimpleNamespace

from fastapi import HTTPException
from shapely.geometry import MultiPolygon, Polygon
from sqlalchemy import text

import bot_world
from app import economy, ranks
from app.config import settings
from app.database import SessionLocal
from app.geospatial import claim_area_m2
from app.notifications import notify
from app.routes.clans import record_clan_activity
from app.routes.runs import STEAL_LEDGER_MIN_M2, _claim_territory, claim_lifetime_days, claim_strength

TARGET_USERNAME = "jonfong78"

# How many due bots to process in one cron tick. Runs are not spread evenly
# around the clock any more (see bot_world's run windows), so a tick landing
# in the evening peak has many more due bots than the daily average — this
# has to absorb that burst plus a missed tick or two, not just the mean.
BATCH_SIZE = 60

# Of every DUE RUN from an attacker-eligible bot (~22% of the roster, set at
# seed time), this fraction targets TARGET_USERNAME's own territory instead
# of the bot's home turf. With ~85 eligible bots each running ~once every 2
# days, the pool produces roughly 42 runs/day ≈ 300/week; 0.013 * 300 ≈ 4
# raids/week — "a few times a week". Tune this one constant to change it.
ATTACK_CHANCE = 0.013

# Chance any bot's run goes after a NEIGHBOURING BOT's land instead of its
# own. This is what makes the world's territory move on its own: without it,
# bots only ever fought the one real player, every other border on the map
# was frozen, and the map looked like a photograph rather than a game in
# progress. One run in nine is a local derby.
RIVAL_CHANCE = 0.11

# How far a bot will travel to raid a neighbour. Far enough to reach the next
# estate, near enough that it is still a local rivalry.
RIVAL_RADIUS_M = 2500

# A bot's home-turf run starts within this radius of its home point, so its
# territory drifts and occasionally bumps a neighbour rather than teleporting.
HOME_JITTER_M = 350.0

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


def _target_territory(db):
    """A random one of TARGET_USERNAME's currently-live territories, or None."""
    rows = db.execute(
        text(
            """
            SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
            FROM territories t JOIN users u ON u.id = t.user_id
            WHERE u.username = :n AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
            """
        ),
        {"n": TARGET_USERNAME},
    ).fetchall()
    if not rows:
        return None
    return random.choice(rows)


def _rival_territory(db, home_lat: float, home_lon: float, clan_id, user_id):
    """A nearby bot's land, owned by somebody in another club.

    Excludes club-mates deliberately: club-mates stack defence on each other's
    territory, so a bot attacking its own club is both thematically wrong and
    mechanically futile. Real accounts are excluded here too — raiding the
    player is a separate, rationed decision, not something that should also
    happen by accident through this path.
    """
    row = db.execute(
        text(
            """
            SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
            FROM territories t
            JOIN users u ON u.id = t.user_id
            WHERE u.is_bot
              AND t.verified
              AND (t.expires_at IS NULL OR t.expires_at > now())
              AND u.id <> :me
              AND (u.clan_id IS DISTINCT FROM :clan)
              AND ST_DWithin(
                    t.polygon::geography,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                    :radius)
            ORDER BY random()
            LIMIT 1
            """
        ),
        {"me": user_id, "clan": clan_id, "lat": home_lat, "lon": home_lon,
         "radius": RIVAL_RADIUS_M},
    ).fetchone()
    return row


def _jitter(lat: float, lon: float, metres: float, rng: random.Random) -> tuple[float, float]:
    import math
    dy = rng.uniform(-metres, metres)
    dx = rng.uniform(-metres, metres)
    return (
        lat + dy / 111_320.0,
        lon + dx / (111_320.0 * max(0.1, math.cos(math.radians(lat)))),
    )


def _run_one(db, bot_row, background_notifies: list) -> None:
    user_id, username, clan_id, avatar, home_lat, home_lon, attacker, region_key = bot_row
    rng = random.Random()

    distance_m, pace_s_per_km = bot_world.plan_run(rng, user_id=user_id)

    # Where does this run start?
    start_lat, start_lon = home_lat, home_lon
    roll = rng.random()
    if attacker and roll < ATTACK_CHANCE:
        target = _target_territory(db)
        if target is not None:
            start_lat, start_lon = _jitter(target[0], target[1], 150, rng)
    elif roll < ATTACK_CHANCE + RIVAL_CHANCE:
        rival = _rival_territory(db, home_lat, home_lon, clan_id, user_id)
        if rival is not None:
            start_lat, start_lon = _jitter(rival[0], rival[1], 200, rng)
    else:
        start_lat, start_lon = _jitter(home_lat, home_lon, HOME_JITTER_M, rng)

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
            clan_id=clan_id,
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

    # Club season stats and the weekly goal, which /end-run advances and this
    # never did. The club leaderboard ranks on `clan_season_stats.area_current`,
    # and nothing was writing it for simulated play — 24 clubs held 700
    # territories between them and the board was empty. Seeding can backfill
    # it once, but only this keeps it true as bots take and lose ground.
    #
    # Takes a stub rather than a User row because it only reads `.id`, and
    # loading the ORM object per bot per tick is a query for nothing.
    if not bounced and clan_id:
        try:
            record_clan_activity(
                db, SimpleNamespace(id=user_id),
                distance_m=distance_m, closed_loop=True, stolen=_stolen_m2 or 0.0,
            )
        except Exception as exc:  # noqa: BLE001 — club bookkeeping must not sink a run
            print(f"clan activity FAILED for {username}: {exc}", file=sys.stderr)

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
            ranks.award(db, ev["victim_id"], ranks.POINTS_DEFEND, "defend")
            continue
        ranks.award(db, user_id, ranks.POINTS_STEAL, "steal")
        ranks.award(db, ev["victim_id"], ranks.POINTS_LOST, "lost_ground")

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

    db.execute(
        text("UPDATE bot_accounts SET next_run_at = :n WHERE user_id = :u"),
        {"n": bot_world.next_run_at(rng), "u": user_id},
    )


def main() -> int:
    db = SessionLocal()
    processed = 0
    failed = 0
    notifies: list = []
    try:
        due = _due_bots(db, BATCH_SIZE)
        for row in due:
            try:
                _run_one(db, row, notifies)
                db.commit()
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
