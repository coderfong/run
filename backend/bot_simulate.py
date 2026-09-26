"""Simulate hours of the seeded world in minutes, then throw it all away.

    python bot_activity.py --simulate-hours 24 [--sim-humans 3]
        [--sim-human-claims-per-hour 0] [--sim-start-sgt 5] [--seed 7]

Everything happens inside ONE transaction that is rolled back at the end, and
the command refuses to run against anything but a local database unless
`--allow-remote` is given — it rewrites timestamps across the whole schema
while it runs, which on a live database would hold locks the app needs.
Point it at a copy:

    createdb -T territory_run territory_run_botsim
    DATABASE_URL=postgresql://run:run@localhost:5432/territory_run_botsim ...

HOW TIME MOVES. Postgres' `now()` is frozen for the life of a transaction, and
every query in the game compares against it. So instead of moving the clock
forward, each simulated tick moves the WORLD back: every timestamp in the
public schema within the last fortnight (or in the future) is shifted fifteen
minutes earlier. Everything the game measures relative to now — expiry,
cooldowns, rolling counts, schedules — then behaves exactly as if fifteen
minutes had passed. The one thing that would not move is the time of day, so
`bot_world.SIM_CLOCK_SHIFT` carries the elapsed simulated time into every
Singapore-hour decision.

SIMULATED PLAYERS. `--sim-humans N` creates N real (is_bot = false) accounts
for the run, each living beside a seeded hub, in a tier the bots there occupy,
and running once a day at their own hour through the same executor. They are
what the engagement director reacts to. `--sim-human-claims-per-hour X` adds a
crowd of real runners on top, to show bot activity backing off as real play
grows.
"""

from __future__ import annotations

import math
import os
import random
import time
import uuid
from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy import text

import bot_activity
import bot_director
import bot_observe
import bot_world
from app import elo
from app.database import SessionLocal


def _host() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if "@" in url:
        return url.split("@")[-1].split("/")[0].split(":")[0]
    from app.config import settings
    return settings.database_url.split("@")[-1].split("/")[0].split(":")[0]


def _timestamp_columns(db) -> dict:
    rows = db.execute(text(
        """
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone')
          AND c.table_name NOT LIKE 'alembic%'
        """
    )).fetchall()
    out = defaultdict(list)
    for table, col in rows:
        out[table].append(col)
    return out


def age_world(db, cols: dict, minutes: float) -> None:
    """Shift every recent or future timestamp `minutes` into the past. One
    statement per table so a CHECK across two of its columns never sees one
    moved and the other not."""
    for table, columns in cols.items():
        sets = ", ".join(
            f'"{c}" = CASE WHEN "{c}" > now() - interval \'15 days\' '
            f'THEN "{c}" - make_interval(secs => :s) ELSE "{c}" END'
            for c in columns
        )
        where = " OR ".join(f'"{c}" > now() - interval \'15 days\'' for c in columns)
        db.execute(text(f'UPDATE "{table}" SET {sets} WHERE {where}'), {"s": minutes * 60.0})


class SimPlayer:
    def __init__(self, user_id, username, home_lat, home_lon, region, run_hour):
        self.user_id = user_id
        self.username = username
        self.home_lat = home_lat
        self.home_lon = home_lon
        self.region = region
        self.run_hour = run_hour
        self.ran_on: set = set()

    def as_runner(self, db, now):
        rating = db.execute(text(f"SELECT {elo.rating_sql('u')} FROM users u WHERE id = CAST(:u AS uuid)"),
                            {"u": self.user_id}).scalar()
        last = db.execute(text("SELECT MAX(ended_at) FROM runs WHERE user_id = CAST(:u AS uuid)"),
                          {"u": self.user_id}).scalar()
        n24 = db.execute(text(
            "SELECT count(*) FROM runs WHERE user_id = CAST(:u AS uuid) AND started_at > :d"
        ), {"u": self.user_id, "d": now - timedelta(hours=24)}).scalar()
        return bot_observe.Bot(
            user_id=self.user_id, username=self.username, clan_id=None, avatar={},
            home_lat=self.home_lat, home_lon=self.home_lon, region_key=self.region,
            next_run_at=None, tier=elo.tier_for_rating(int(rating))["tier"], attacker=False,
            last_run_end=last, runs_7d=0, runs_24h=int(n24 or 0), live_territories=0,
        )


def _stage_players(db, n: int, rng: random.Random, prefix: str, now) -> list:
    """Real accounts beside real bot neighbourhoods, in a populated tier."""
    rows = db.execute(text(
        f"""
        SELECT b.home_lat, b.home_lon, b.region_key, {elo.rating_sql('u')}
        FROM bot_accounts b JOIN users u ON u.id = b.user_id
        ORDER BY random() LIMIT :n
        """
    ), {"n": max(n, 1) * 3}).fetchall()
    players = []
    for i in range(n):
        lat, lon, region, rating = rows[i % len(rows)]
        tier = elo.tier_for_rating(int(rating))["tier"]
        uid = str(uuid.uuid4())
        name = f"{prefix}{i + 1}"
        db.execute(text(
            """
            INSERT INTO users (id, username, password_hash, created_at, is_bot, solo_elo, solo_elo_peak)
            VALUES (CAST(:id AS uuid), :u, NULL, now() - interval '30 days', false, :r, :r)
            """
        ), {"id": uid, "u": name, "r": elo.rating_for_tier(tier, 0.4)})
        hl, ho = bot_director._offset(lat, lon, rng.uniform(200, 900), rng.uniform(0, 6.28))
        hour = rng.choice([rng.uniform(6.0, 7.8), rng.uniform(18.0, 21.0)])
        players.append(SimPlayer(uid, name, hl, ho, region, hour))
    return players


def _player_run(db, p: SimPlayer, now, cfg, rng, ctx, index_terr, hotspots, attack: bool):
    runner = p.as_runner(db, now)
    index = bot_director.TerritoryIndex(index_terr)
    run = None
    if attack:
        terr, intent = bot_director.combat_target(runner, index, {}, now, cfg, rng, False)
        if terr is not None:
            run = bot_director.PlannedRun(bot=runner, intent="HUMAN_RUN_ATTACK", region=p.region,
                                          target_territory_id=terr.id, target_owner_id=terr.owner_id,
                                          mode="nibble")
    if run is None:
        anchor, _ = bot_director.frontier_point(runner, index, [], hotspots, cfg, rng, local=True)
        run = bot_director.PlannedRun(bot=runner, intent="HUMAN_RUN", region=p.region,
                                      anchor=anchor, mode="frontier")
    with bot_activity.unit(db, ctx):
        route = bot_activity.plan_route(db, run, rng, now, cfg)
        out = bot_activity.execute_run(db, run, route, now, cfg, rng, ctx, is_bot=False)
    out["human_run"] = True
    out["actor"] = p.user_id
    return out


def run(cfg, args) -> int:
    host = _host()
    if host not in ("localhost", "127.0.0.1", "::1") and not args.allow_remote:
        print(f"refusing to simulate against {host}: this rewrites timestamps across the schema "
              "inside one long transaction. Use a local copy, or pass --allow-remote.")
        return 2

    rng = random.Random(args.seed)
    ticks = int(math.ceil(args.simulate_hours * 60.0 / cfg.tick_minutes))
    db = SessionLocal()
    t0 = time.time()
    try:
        bot_observe.utc_session(db)
        now = bot_observe.db_now(db)
        if args.sim_start_sgt is not None:
            cur = bot_director.local_hour(now)
            bot_world.SIM_CLOCK_SHIFT = timedelta(hours=(args.sim_start_sgt - cur) % 24)
        cols = _timestamp_columns(db)

        before = _world_counts(db)
        players = _stage_players(db, args.sim_humans, rng, "sim_player_", now)
        crowd = _stage_players(db, max(0, int(math.ceil(args.sim_human_claims_per_hour))) * 4,
                               rng, "sim_crowd_", now) if args.sim_human_claims_per_hour > 0 else []
        # Every simulated player starts with a little land and a recent run,
        # so they are "active real players with territory" from tick one.
        ctx0 = bot_activity.Ctx(mode="sim")
        terr = bot_observe.read_territories(db)
        for p in players:
            _player_run(db, p, now, cfg, rng, ctx0, terr, [], attack=False)

        all_runs = []
        timeline = []
        human_runs_out = []
        for i in range(ticks):
            ctx = bot_activity.Ctx(mode="sim")
            snap, plan = bot_activity.tick(db, cfg, rng, ctx)
            wall = bot_director.local_hour(now)
            day = (now + bot_world.local_offset()).date()

            # Simulated real players: each runs once a day at their own hour,
            # and a third of the time goes for a neighbour's border.
            terr = snap.territories
            for p in players:
                if day not in p.ran_on and abs(wall - p.run_hour) < cfg.tick_minutes / 60.0:
                    p.ran_on.add(day)
                    human_runs_out.append(_player_run(db, p, now, cfg, rng, ctx, terr,
                                                      snap.hotspots, attack=rng.random() < 0.33))
            if crowd:
                lam = args.sim_human_claims_per_hour * cfg.tick_hours * bot_director.diurnal(now, cfg)
                for _ in range(_poisson(lam, rng)):
                    p = rng.choice(crowd)
                    try:
                        human_runs_out.append(_player_run(db, p, now, cfg, rng, ctx, terr,
                                                          snap.hotspots, attack=rng.random() < 0.3))
                    except Exception:  # noqa: BLE001 - a crowd member too soon after their last run
                        pass

            summ = bot_activity.summary(snap, plan, ctx, cfg)
            timeline.append({
                "sgt": wall, "runs": ctx.stats.get("runs", 0),
                "claims": ctx.stats.get("claims", 0), "steals": ctx.stats.get("steals", 0),
                "defences": ctx.stats.get("defences", 0),
                "target": summ["targets_per_hour"]["claims"],
                "human_claims_1h": summ["activity_last_hour"]["human_claims"],
                "bot_claims_1h": summ["activity_last_hour"]["bot_claims"],
                "pressure": ctx.stats.get("human_interactions_created", 0),
                "groups": ctx.stats.get("club_groups_attempted", 0),
                "club_ok": ctx.stats.get("club_validations_passed", 0),
                "club_try": ctx.stats.get("club_validations_attempted", 0),
                "skips": plan.report.get("skips", {}),
                "hp_skips": plan.report.get("human_pressure", {}).get("skipped", {}),
            })
            all_runs.extend(ctx.runs)
            if (i + 1) % 8 == 0:
                print(f"  sim {((i + 1) * cfg.tick_minutes) / 60:.0f}h  SGT {wall:05.2f}  "
                      f"bot runs so far {sum(1 for r in all_runs if r.get('run_id'))}  "
                      f"({time.time() - t0:.0f}s)", flush=True)
            age_world(db, cols, cfg.tick_minutes)
            bot_world.SIM_CLOCK_SHIFT += timedelta(minutes=cfg.tick_minutes)

        after = _world_counts(db)
        _report(args, cfg, all_runs, human_runs_out, timeline, players, crowd, before, after, db)
        print(f"\n(simulated {args.simulate_hours}h in {time.time() - t0:.0f}s; rolled back, nothing kept)")
        return 0
    finally:
        db.rollback()
        db.close()
        bot_world.SIM_CLOCK_SHIFT = timedelta(0)


def _poisson(lam: float, rng: random.Random) -> int:
    n, p, limit = 0, 1.0, math.exp(-lam)
    while True:
        p *= rng.random()
        if p <= limit:
            return n
        n += 1


def _world_counts(db) -> dict:
    one = lambda q: db.execute(text(q)).scalar()
    clubs = db.execute(text(
        """
        SELECT t.clan_id::text, SUM(t.area_m2) FROM territories t
        WHERE t.clan_id IS NOT NULL AND t.verified AND t.expires_at > now()
        GROUP BY 1 ORDER BY 2 DESC
        """
    )).fetchall()
    return {
        "club_territories": one("SELECT count(*) FROM territories WHERE clan_id IS NOT NULL "
                                "AND expires_at > now()"),
        "club_order": [c[0] for c in clubs],
        "club_area": {c[0]: float(c[1]) for c in clubs},
        "live_territories": one("SELECT count(*) FROM territories WHERE expires_at > now()"),
    }


def _report(args, cfg, runs, human_runs, timeline, players, crowd, before, after, db):
    bot_runs = [r for r in runs if r.get("run_id")]
    by_intent = Counter(r["intent"] for r in bot_runs)
    print("\n" + "=" * 72)
    print(f"SIMULATION  {args.simulate_hours}h  ({len(timeline)} ticks)   "
          f"real players {len(players)}  crowd {len(crowd)} @ {args.sim_human_claims_per_hour}/h")
    print("=" * 72)
    claims = sum(1 for r in bot_runs if not r.get("bounced"))
    steals = sum(r.get("steals", 0) for r in bot_runs)
    defences = sum(r.get("defended", 0) + (1 if r.get("bounced") else 0) for r in bot_runs)
    battles = sum(1 for r in bot_runs if r.get("steals") or r.get("defended") or r.get("bounced"))
    neutral = sum(1 for r in bot_runs if not (r.get("steals") or r.get("defended") or r.get("bounced")))
    club_runs = sum(1 for r in bot_runs if r.get("club_run"))
    print(f"Bot runs:              {len(bot_runs)}")
    print(f"Bot claims:            {claims}   (bounced {len(bot_runs) - claims})")
    print(f"Uncontested claims:    {neutral}")
    print(f"Battles (runs):        {battles}   steals {steals}   defences {defences}")
    print(f"Club runs (validated): {club_runs}")
    print(f"Real-player runs:      {len(human_runs)}")
    print(f"By intent:             {dict(by_intent)}")
    skipped = Counter(r["status"] for r in runs if not r.get("run_id"))
    if skipped:
        print(f"Runs not executed:     {dict(skipped)}")

    print("\nClub state:")
    print(f"  club-attributed live territories  {before['club_territories']} -> {after['club_territories']}")
    common = [c for c in after["club_order"] if c in before["club_order"]]
    moved = sum(1 for c in common if before["club_order"].index(c) != after["club_order"].index(c))
    print(f"  clubs holding club land           {len(before['club_order'])} -> {len(after['club_order'])}"
          f"   ({moved} changed place on the club land ranking)")
    lost = sum(1 for c, a in before["club_area"].items() if after["club_area"].get(c, 0) < a)
    print(f"  clubs that lost club land         {lost}")
    tries = sum(t["club_try"] for t in timeline)
    ok = sum(t["club_ok"] for t in timeline)
    print(f"  group-member validations          {ok}/{tries} passed club_runs.nearby_in_time + route match")

    print("\nReal players:")
    for p in players:
        mine = [r for r in bot_runs if r.get("target_human") and _targets(r, p, db)]
        touched = [r for r in bot_runs if p.user_id in (r.get("victims") or [])]
        own = [r for r in human_runs if r.get("actor") == p.user_id]
        own_fights = [r for r in own if r.get("steals") or r.get("defended")]
        rivals = {r["bot"] for r in touched} | {r["bot"] for r in mine}
        interactions = len({r["run_id"] for r in touched} | {r["run_id"] for r in mine}) + len(own_fights)
        stolen = sum(1 for r in touched if r.get("steals"))
        held = sum(1 for r in touched if r.get("defended") or r.get("bounced"))
        print(f"  {p.username:<14} territory interactions {interactions:>2}   unique rivals {len(rivals):>2}"
              f"   (attacked&lost {stolen}, held {held}, neighbours/near-misses "
              f"{len(mine) - len([r for r in mine if r['run_id'] in {t['run_id'] for t in touched}])},"
              f" own fights {len(own_fights)}, own runs {len(own)})")
        stages = Counter(r.get("stage") for r in mine)
        if stages:
            print(f"  {'':<14} pressure by stage {dict(stages)}   rivals: {', '.join(sorted(rivals))[:90]}")

    print("\nBy Singapore hour (sum over the run):")
    buckets = defaultdict(lambda: Counter())
    for t in timeline:
        h = int(t["sgt"]) % 24
        buckets[h].update({"runs": t["runs"], "claims": t["claims"], "steals": t["steals"],
                           "defences": t["defences"], "pressure": t["pressure"], "groups": t["groups"]})
        buckets[h]["target"] += t["target"] * cfg.tick_hours
        buckets[h]["human1h"] += t["human_claims_1h"] * cfg.tick_hours
    print("  SGT  target  human  runs claims steals def  pressure groups")
    for h in sorted(buckets):
        b = buckets[h]
        print(f"  {h:02d}   {b['target']:>6.1f} {b['human1h']:>6.1f} {b['runs']:>5} {b['claims']:>6} "
              f"{b['steals']:>6} {b['defences']:>4} {b['pressure']:>8} {b['groups']:>6}")
    sk = Counter()
    hs = Counter()
    for t in timeline:
        sk.update(t["skips"])
        hs.update(t["hp_skips"])
    print(f"\nPlanner skips (summed): {dict(sk.most_common(12))}")
    print(f"Pressure skips (summed): {dict(hs)}")


def _targets(run_out: dict, player: SimPlayer, db) -> bool:
    return run_out.get("target_owner") == player.user_id
