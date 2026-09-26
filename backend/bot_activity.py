"""Scheduled: the seeded world's activity tick.

Run by the `run-bots` cron (see render.yaml's `territory-run-bots`) every 15
minutes, talking to the database directly like sweep.py.

Each tick has two halves:

  1. PLAN (bot_director.py over bot_observe.py's snapshot). How much should
     happen given what real players already did in the last hour, where, and
     what for — including reactions owed to real players' own claims and a
     soft daily floor of interactions for every active player.
  2. EXECUTE (here). Every planned run becomes a REAL run: a synthesised
     route (bot_world.synth_route), a `runs` row, and a claim through the same
     `_claim_territory` a human claim uses, settled through the same
     app/claim_consequences.py as a human claim — steal ledger, rank points
     both ways, Elo, the territory event log, and the "captured" / "defended"
     alert to a real victim. Whether a fight takes ground or bounces is the
     combat rules' decision, never this file's.

    python bot_activity.py                       # one live tick
    python bot_activity.py --dry-run             # plan only, read-only transaction
    python bot_activity.py --simulate-hours 24   # rolled-back simulation (bot_simulate.py)

Idempotent in the ways that matter: an advisory lock stops two ticks
overlapping, every bot row is locked while it runs, and a reaction intent is
unique per (source, stage).
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from fastapi import HTTPException
from shapely import wkt as shapely_wkt
from sqlalchemy import text

import bot_director
import bot_observe
import bot_sim_config
import bot_world
from app import claim_consequences, club_runs, economy, elo
from app.config import settings
from app.database import SessionLocal
from app.geospatial import claim_area_m2
from app.notifications import notify
from app.routes.runs import (
    _claim_territory,
    _decimate_ring,
    _rings_of,
    claim_lifetime_days,
    claim_strength,
)

# Kept for anything that imported it: raids on this account are no longer a
# special case, every active real player gets the same engagement director.
TARGET_USERNAME = "jonfong78"

_TICK_LOCK_KEY = 8150046


# ---------------------------------------------------------------------------
# Execution context
# ---------------------------------------------------------------------------

@dataclass
class Ctx:
    """How a tick's writes land. `live` commits each run on its own; `sim`
    wraps each in a savepoint inside one transaction the simulator rolls
    back; notifications only ever leave the process in `live`."""
    mode: str = "live"
    notifies: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    runs: list = field(default_factory=list)   # per-run outcome dicts

    def bump(self, key: str, n: int = 1):
        self.stats[key] = self.stats.get(key, 0) + n


@contextmanager
def unit(db, ctx: Ctx):
    """One indivisible piece of work: a run and everything it caused."""
    if ctx.mode == "sim":
        sp = db.begin_nested()
        try:
            yield
            sp.commit()
        except Exception:
            sp.rollback()
            raise
    else:
        try:
            yield
            db.commit()
        except Exception:
            db.rollback()
            raise


# ---------------------------------------------------------------------------
# Route planning for one run
# ---------------------------------------------------------------------------

def _move(lat: float, lon: float, toward: tuple, metres_: float) -> tuple:
    """Step from (lat, lon) `metres_` along the bearing to `toward`; negative
    steps away from it."""
    dy = (toward[0] - lat) * 111_320.0
    dx = (toward[1] - lon) * 111_320.0 * math.cos(math.radians(lat))
    d = math.hypot(dx, dy) or 1.0
    return (lat + (dy / d) * metres_ / 111_320.0,
            lon + (dx / d) * metres_ / (111_320.0 * math.cos(math.radians(lat))))


def _overlap_score(mode: str, poly, target) -> float:
    """How well a candidate claim fits the kind of run it is meant to be."""
    if target is None:
        return 0.0
    inter = poly.intersection(target).area
    frac = inter / max(poly.area, 1e-12)
    if mode == "edge":
        # A new neighbour: against their border, barely inside it.
        gap = poly.distance(target) * 111_320.0
        return -abs(frac - 0.02) * 10 - gap / 200.0
    if mode == "nibble":
        return -abs(frac - 0.15) * 5 if inter > 0 else -5.0
    if mode == "push":
        return -abs(frac - 0.45) * 3 if inter > 0 else -5.0
    return frac  # takeover: as much as it can reach


def plan_route(db, run, rng: random.Random, now: datetime, cfg, dry: bool = False) -> dict:
    """Distance, pace, route, claim polygon and predicted overlap for one run."""
    bot = run.bot
    max_d = 10_000.0 if bot.runs_24h >= 1 else None
    distance_m, pace = bot_world.plan_run(rng, user_id=bot.user_id, max_distance_m=max_d)
    if run.mode == "takeover":
        distance_m = max(distance_m, rng.uniform(8000, 13000))

    target_poly = None
    start = None
    if run.target_territory_id:
        geo = bot_observe.target_geometry(db, run.target_territory_id, bot.home_lat, bot.home_lon)
        if geo is not None:
            target_poly = shapely_wkt.loads(geo["wkt"])
            edge, inside = geo["edge"], geo["inside"]
            if run.mode == "edge":
                start = _move(edge[0], edge[1], inside, -rng.uniform(250, 400))
            elif run.mode == "nibble":
                start = _move(edge[0], edge[1], inside, -120)
            elif run.mode == "push":
                start = _move(edge[0], edge[1], inside, 120)
            else:
                start = inside
    if start is None and run.anchor:
        start = run.anchor
    if start is None:
        ang = rng.uniform(0, 2 * math.pi)
        start = bot_director._offset(bot.home_lat, bot.home_lon, rng.uniform(0, 900), ang)

    land = bot_observe.land_for(bot_observe.region_of(start[0], start[1]))
    tries = 4 if target_poly is not None else 1
    best = None
    for _ in range(tries):
        path = bot_world.synth_route(start[0], start[1], distance_m, rng, land=land)
        actual = bot_world.route_length_m(path)
        poly = bot_world.claim_polygon(path, actual, start[0], start[1])
        score = _overlap_score(run.mode, poly, target_poly)
        if best is None or score > best["score"]:
            best = {"path": path, "distance_m": actual, "poly": poly, "score": score}
    best["pace"] = pace
    best["start"] = start
    best["target_poly"] = target_poly
    best["predicted_overlap_m2"] = (
        best["poly"].intersection(target_poly).area * 111_320.0 ** 2
        * math.cos(math.radians(start[0]))
        if target_poly is not None else 0.0
    )
    best["target_gone"] = bool(run.target_territory_id) and target_poly is None
    return best


# ---------------------------------------------------------------------------
# Executing one run
# ---------------------------------------------------------------------------

def execute_run(db, run, route: dict, now: datetime, cfg, rng: random.Random, ctx: Ctx,
                started_at: datetime | None = None, duration_s: float | None = None,
                trace: list | None = None, path_override=None, is_bot: bool = True) -> dict:
    """One run through the real pipeline. Returns an outcome dict (never raises
    for an ordinary game outcome like a bounced claim)."""
    bot = run.bot
    path = path_override or route["path"]
    distance_m = bot_world.route_length_m(path) if path_override else route["distance_m"]
    duration_s = duration_s or distance_m / 1000.0 * route["pace"]
    if started_at is None:
        # Finished some time during the last tick window — never in the
        # future, never all on the cron boundary.
        ended = now - timedelta(minutes=rng.uniform(0.5, cfg.tick_minutes))
        started_at = ended - timedelta(seconds=duration_s)
    ended_at = started_at + timedelta(seconds=duration_s)
    out = {"bot": bot.username, "intent": run.intent, "mode": run.mode, "region": run.region,
           "target_human": run.target_is_human, "target_owner": run.target_owner_id,
           "stage": run.stage, "group": run.group_id,
           "distance_km": round(distance_m / 1000, 2), "status": "ran"}

    if is_bot:
        # The row lock is what makes an overlapping tick harmless: it cannot
        # run the same bot twice.
        locked = db.execute(text(
            "SELECT 1 FROM bot_accounts WHERE user_id = CAST(:u AS uuid) FOR UPDATE SKIP LOCKED"
        ), {"u": bot.user_id}).fetchone()
        if locked is None:
            out["status"] = "skipped_locked"
            return out
    last_end = db.execute(text(
        "SELECT MAX(ended_at) FROM runs WHERE user_id = CAST(:u AS uuid)"
    ), {"u": bot.user_id}).scalar()
    if last_end and started_at < last_end + timedelta(hours=min(cfg.min_run_gap_h, 3.0)):
        # Two runs cannot overlap, and nobody runs again straight after.
        out["status"] = "skipped_overlap"
        return out

    run_id = bot_world.record_run(db, bot.user_id, path, distance_m, duration_s, started_at,
                                  together_trace=trace, claimed_at=now)
    out["run_id"] = run_id

    # Club land only where the club ran together — the same probe a human
    # claim runs, which is why group members need honest traces.
    club_id, partners, _newly = club_runs.log_run(db, run_id, bot.user_id, bot.clan_id)
    if run.group_id and run.group_index > 0:
        ctx.bump("club_validations_attempted")
        if club_id:
            ctx.bump("club_validations_passed")
    if club_id:
        club_runs.attribute_territories(db, [p["run_id"] for p in partners], club_id)
    out["club_run"] = bool(club_id)

    # The LIVE tier, read the way /claim-territory reads it: an earlier fight
    # in this same tick may already have moved this bot across a boundary.
    tier = elo.solo_status(db, bot.user_id)["tier"]
    poly = route["poly"] if not path_override else bot_world.claim_polygon(
        path, distance_m, path[0][1], path[0][0])
    territory_out, stolen_m2, steal_events, ground = None, 0.0, [], {}
    bounced = False
    sp = db.begin_nested()
    try:
        territory_out, stolen_m2, _from, steal_events, ground = _claim_territory(
            db=db, user_id=bot.user_id, run_id=run_id, polygon_wgs=poly,
            initial_area_m2=claim_area_m2(distance_m),
            strength=claim_strength(distance_m, duration_s), verified=True,
            clan_id=club_id, member_clan_id=bot.clan_id, rank_tier=tier,
            lifetime_for=lambda r: claim_lifetime_days(distance_m, duration_s, r),
        )
        sp.commit()
    except HTTPException as exc:
        # Fully defended: exactly what a human sees when a claim bounces, and
        # rolled back exactly as the human request is — the run stands, the
        # claim leaves nothing behind.
        sp.rollback()
        if exc.status_code != 409:
            raise
        bounced = True

    xp = round(distance_m / 1000.0 * settings.xp_per_km)
    db.execute(text("UPDATE users SET xp = COALESCE(xp, 0) + :g WHERE id = CAST(:u AS uuid)"),
               {"g": xp, "u": bot.user_id})

    action = None
    if not bounced:
        enemy_m2 = sum(ev["area_m2"] for ev in steal_events if not ev["defended"])
        defended_m2 = sum(ev["area_m2"] for ev in steal_events if ev["defended"])
        action = economy.claim_action(ground.get("claimed_m2", 0.0), enemy_m2, defended_m2,
                                      ground.get("reinforced_m2", 0.0))
        centre = poly.centroid
        claim_consequences.settle(
            db, user_id=bot.user_id, run_id=run_id, action=action,
            steal_events=steal_events, ground=ground, stolen_m2=stolen_m2,
            rank_tier=tier, club_id=club_id, centre=centre,
        )
        real = {r[0] for r in db.execute(text(
            "SELECT id::text FROM users WHERE id = ANY(CAST(:ids AS uuid[])) AND NOT is_bot"
        ), {"ids": list({str(e["victim_id"]) for e in steal_events}) or [None]}).fetchall()}
        ring = (_decimate_ring(territory_out.rings[0])
                if territory_out and territory_out.rings else None)
        for args in claim_consequences.victim_notifications(
            [e for e in steal_events if str(e["victim_id"]) in real],
            run_id=run_id, attacker_id=bot.user_id, attacker_username=bot.username,
            attacker_avatar=bot.avatar, territory_id=territory_out.id if territory_out else None,
            territory_ring=ring, centre=centre,
        ):
            ctx.notifies.append(args)
        # The feed and the club board read the claim's own ground off the run.
        claim_result = {
            "claimed_m2": ground.get("claimed_m2", 0.0), "gained_m2": ground.get("gained_m2", 0.0),
            "reinforced_m2": ground.get("reinforced_m2", 0.0), "stolen_m2": stolen_m2,
            "claim_rings": _rings_of(ground.get("claim_wkt")),
            "gained_rings": _rings_of(ground.get("gained_wkt")), "xp_gained": 0, "action": action,
        }
        db.execute(text(
            "UPDATE runs SET reward_xp = :xp, claim_action = :a, "
            "claim_result = CAST(:cr AS jsonb) WHERE id = CAST(:r AS uuid)"
        ), {"xp": xp, "a": action, "cr": json.dumps(claim_result), "r": run_id})
    else:
        db.execute(text("UPDATE runs SET reward_xp = :xp WHERE id = CAST(:r AS uuid)"),
                   {"xp": xp, "r": run_id})
    club_runs.sync_credit(db, [run_id] + [p["run_id"] for p in partners], club_id)

    if is_bot:
        db.execute(text("UPDATE bot_accounts SET next_run_at = :n WHERE user_id = CAST(:u AS uuid)"), {
            "n": bot_world.next_run_for(rng, max(ended_at, now), bot.user_id, bot.clan_id,
                                        cfg.min_run_gap_h),
            "u": bot.user_id,
        })

    counted = claim_consequences.counted(steal_events)
    stolen = [e for e in counted if not e["defended"]]
    held = [e for e in counted if e["defended"]]
    out.update({
        "bounced": bounced, "action": action,
        "gained_m2": round(ground.get("gained_m2", 0.0)) if ground else 0,
        "stolen_m2": round(stolen_m2), "steals": len(stolen), "defended": len(held),
        "victims": sorted({str(e["victim_id"]) for e in counted}),
        "predicted_overlap_m2": round(route.get("predicted_overlap_m2", 0.0)),
        "target_gone": route.get("target_gone", False),
    })
    ctx.bump("runs")
    ctx.bump("bounced" if bounced else "claims")
    if counted or bounced:
        ctx.bump("battles_attempted")
    ctx.bump("steals", len(stolen))
    ctx.bump("defences", len(held) + (1 if bounced else 0))
    if club_id:
        ctx.bump("club_runs_logged")
    return out


def _resolve_intent(db, intent_id, status: str, reason: str | None, now: datetime,
                    run_id=None, bot_id=None, outcome=None, due=None):
    db.execute(text(
        """
        UPDATE bot_world_intents
        SET status = :s, reason = :r,
            resolved_at = CASE WHEN :s = 'pending' THEN NULL ELSE :now END,
            run_id = COALESCE(CAST(:run AS uuid), run_id),
            bot_user_id = COALESCE(CAST(:bot AS uuid), bot_user_id),
            outcome = COALESCE(CAST(:o AS jsonb), outcome),
            due_at = COALESCE(:due, due_at)
        WHERE id = CAST(:id AS uuid)
        """
    ), {"s": status, "r": reason, "now": now, "run": run_id, "bot": bot_id,
        "o": json.dumps(outcome) if outcome is not None else None, "due": due, "id": intent_id})


# ---------------------------------------------------------------------------
# Applying a plan
# ---------------------------------------------------------------------------

def apply_state(db, plan, ctx: Ctx):
    """Hotspots, newly scheduled reactions, deferrals and expiries."""
    now = plan.now
    with unit(db, ctx):
        for h in plan.new_hotspots:
            db.execute(text(
                """
                INSERT INTO bot_hotspots (region_key, lat, lon, radius_m, multiplier, label,
                                          starts_at, ends_at)
                VALUES (:rk, :lat, :lon, :r, :m, :label, :s, :e)
                """
            ), {"rk": h.region_key, "lat": h.lat, "lon": h.lon, "r": h.radius_m,
                "m": h.multiplier, "label": h.label, "s": h.starts_at, "e": h.ends_at})
        for row in plan.new_intents:
            db.execute(text(
                """
                INSERT INTO bot_world_intents (kind, stage, source, target_user_id, bot_user_id,
                    lat, lon, region_key, due_at, expires_at, status, reason, resolved_at)
                VALUES (:kind, :stage, :source, CAST(:target_user_id AS uuid),
                        CAST(:bot_user_id AS uuid), :lat, :lon, :region_key, :due_at,
                        :expires_at, :status, :reason,
                        CASE WHEN :status = 'pending' THEN NULL ELSE CAST(:now AS timestamp) END)
                ON CONFLICT (source, stage) DO NOTHING
                """
            ), {**row, "now": now})
        expired = db.execute(text(
            "UPDATE bot_world_intents SET status = 'expired', resolved_at = :now "
            "WHERE status = 'pending' AND expires_at <= :now"
        ), {"now": now}).rowcount
        ctx.bump("intents_expired", expired or 0)
        for intent_id, status, reason, due in plan.intent_updates:
            _resolve_intent(db, intent_id, status, reason, now, due=due)
        for b in plan.rests:
            # A rest day: the bot's own schedule came due while the world was
            # already busy enough. It is simply scheduled again.
            db.execute(text(
                "UPDATE bot_accounts SET next_run_at = :n WHERE user_id = CAST(:u AS uuid)"
            ), {"n": bot_world.next_run_for(random.Random(), now, b.user_id, b.clan_id),
                "u": b.user_id})


def execute_plan(db, plan, cfg, rng: random.Random, ctx: Ctx):
    now = plan.now
    apply_state(db, plan, ctx)

    groups: dict = {}
    solos = []
    for r in plan.runs:
        (groups.setdefault(r.group_id, []) if r.group_id else solos).append(r)

    for run in solos:
        _execute_one(db, run, now, cfg, rng, ctx)

    for gid, members in groups.items():
        members.sort(key=lambda r: r.group_index)
        leader = members[0]
        try:
            route = plan_route(db, leader, rng, now, cfg)
        except Exception as exc:  # noqa: BLE001
            ctx.bump("failed")
            print(f"group route FAILED for {leader.bot.username}: {exc}", file=sys.stderr)
            continue
        # One outing: the group runs at the pace of its slowest member, from
        # one start, along one route with one speed profile.
        paces = [bot_world.plan_run(random.Random(m.bot.user_id), user_id=m.bot.user_id)[1]
                 for m in members]
        pace = max(paces) * rng.gauss(1.0, 0.02)
        duration = route["distance_m"] / 1000.0 * pace
        ended = now - timedelta(minutes=rng.uniform(1.0, cfg.tick_minutes))
        start = ended - timedelta(seconds=duration + 10)
        profile_seed = rng.randrange(1 << 30)
        ctx.bump("club_groups_attempted")
        for m in members:
            skew = 0.0 if m is leader else rng.uniform(-3.0, 3.0)
            mrng = random.Random(rng.randrange(1 << 30))
            mpath = bot_world.member_path(route["path"], mrng)
            trace = bot_world.synth_trace(route["path"], start, duration, profile_seed, mrng,
                                          skew_s=skew)
            _execute_one(db, m, now, cfg, rng, ctx, route=route,
                         started_at=start + timedelta(seconds=skew),
                         duration_s=duration + rng.uniform(-2, 2), trace=trace,
                         path_override=mpath)


def _execute_one(db, run, now, cfg, rng, ctx, route=None, **kw):
    try:
        with unit(db, ctx):
            if route is None:
                route = plan_route(db, run, rng, now, cfg)
            out = execute_run(db, run, route, now, cfg, rng, ctx, **kw)
            if run.intent_row_id:
                if out.get("run_id"):
                    _resolve_intent(db, run.intent_row_id, "done", None, now, run_id=out["run_id"],
                                    bot_id=run.bot.user_id, outcome={
                                        k: out.get(k) for k in
                                        ("mode", "bounced", "stolen_m2", "steals", "defended",
                                         "gained_m2", "predicted_overlap_m2")})
                else:
                    _resolve_intent(db, run.intent_row_id, "skipped", out["status"], now)
            if run.target_is_human and out.get("run_id"):
                ctx.bump("human_interactions_created")
        ctx.runs.append(out)
    except Exception as exc:  # noqa: BLE001 — one bad run must not sink the tick
        ctx.bump("failed")
        print(f"bot run FAILED for {run.bot.username} ({run.intent}): {exc}", file=sys.stderr)
        if ctx.mode == "live" and run.intent_row_id:
            # Its rollback took the intent update with it; record why, so the
            # player's reaction does not silently stay due forever.
            try:
                _resolve_intent(db, run.intent_row_id, "skipped", "run_failed", now)
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()


# ---------------------------------------------------------------------------
# The tick
# ---------------------------------------------------------------------------

def tick(db, cfg, rng: random.Random, ctx: Ctx):
    now = bot_observe.db_now(db)
    snap = bot_observe.snapshot(db, now, cfg)
    plan = bot_director.plan_tick(snap, cfg, rng)
    if ctx.mode != "dry":
        execute_plan(db, plan, cfg, rng, ctx)
    return snap, plan


def summary(snap, plan, ctx: Ctx, cfg) -> dict:
    rep = plan.report
    s = ctx.stats
    return {
        "at_utc": plan.now.isoformat(timespec="minutes"),
        "sgt_hour": round(bot_director.local_hour(plan.now), 2),
        "targets_per_hour": rep.get("targets"),
        "activity_last_hour": rep.get("activity_1h"),
        "regions": {k: {"share": v["share"], "target": v["target_claims_h"],
                        "human": v["human_claims_1h"], "bot": v["bot_claims_1h"],
                        "quota": v["quota"], "planned": v["planned"]}
                    for k, v in rep.get("regions", {}).items()},
        "hotspots": rep.get("hotspots"),
        "intents_planned": rep.get("intents"),
        "runs": {"executed": s.get("runs", 0), "claims": s.get("claims", 0),
                 "bounced": s.get("bounced", 0), "failed": s.get("failed", 0),
                 "rests": len(plan.rests)},
        "battles": {"attempted": s.get("battles_attempted", 0), "steals": s.get("steals", 0),
                    "defences": s.get("defences", 0)},
        "human_pressure": {**rep.get("human_pressure", {}),
                           "interactions_created": s.get("human_interactions_created", 0)},
        "club": {"groups_attempted": s.get("club_groups_attempted", 0),
                 "validations_attempted": s.get("club_validations_attempted", 0),
                 "validations_passed": s.get("club_validations_passed", 0),
                 "club_runs_logged": s.get("club_runs_logged", 0)},
        "skips": rep.get("skips"),
        "notifications": len(ctx.notifies),
        "room": rep.get("room"),
        "disabled": rep.get("disabled", False),
    }


def print_summary(summ: dict, humans: list | None = None) -> None:
    t = summ["targets_per_hour"] or {}
    a = summ["activity_last_hour"] or {}
    print("BOT ACTIVITY TICK", summ["at_utc"], f"(SGT {summ['sgt_hour']:.2f}h)")
    if summ["disabled"]:
        print("  disabled: BOT_ACTIVITY_SCALE is 0")
        return
    print(f"  targets/h        claims {t.get('claims')}  battles {t.get('battles')}  "
          f"club {t.get('club')}  (time-of-day x{t.get('diurnal')})")
    print(f"  last hour        real runs {a.get('human_runs')}  real claims {a.get('human_claims')}  "
          f"bot claims {a.get('bot_claims')}  battles {a.get('human_battles')}h/{a.get('bot_battles')}b  "
          f"club {a.get('human_club')}h/{a.get('bot_club')}b")
    print("  regions          share  target  human  bot   quota(c/b/k)      planned")
    for k, v in summ["regions"].items():
        q, p = v["quota"], v["planned"]
        print(f"    {k:<8}       {v['share']:.2f}   {v['target']:>5}  {v['human']:>5}  {v['bot']:>4}"
              f"   {q['claims']:>4}/{q['battles']:>4}/{q['club']:>4}   "
              f"c{p['claims']} b{p['battles']} g{p['groups']} bg{p['background']} rest{p['rest']}")
    print(f"  hotspots         {', '.join(h['label'] + (' (new)' if h['new'] else '') for h in summ['hotspots'] or []) or '-'}")
    print(f"  intents          {summ['intents_planned']}")
    r, b = summ["runs"], summ["battles"]
    print(f"  runs             executed {r['executed']}  claims {r['claims']}  bounced {r['bounced']}  "
          f"failed {r['failed']}  rest-days {r['rests']}  (room {summ['room']})")
    print(f"  battles          attempted {b['attempted']}  steals {b['steals']}  defences {b['defences']}")
    hp = summ["human_pressure"]
    print(f"  human pressure   eligible {hp.get('eligible_humans')}  reactions+ {hp.get('reactions_scheduled')}  "
          f"floor+ {hp.get('floor_scheduled')}  due {hp.get('due')}  planned {hp.get('planned')}  "
          f"created {hp.get('interactions_created')}  deferred {hp.get('deferred')}  skipped {hp.get('skipped')}")
    c = summ["club"]
    print(f"  club group runs  attempted {c['groups_attempted']}  validations {c['validations_passed']}/"
          f"{c['validations_attempted']} passed  club-run logs {c['club_runs_logged']}")
    print(f"  skipped          {summ['skips']}")
    if humans:
        for h in humans:
            print(f"    human {h['user']:<20} tier {h['tier']}  score {h['score']}  need {h['need']}  "
                  f"stale {h['stale_h']}h  cooldown {h['cooldown_left_h']}h  floor: {h['floor']}")
    print("BOT_TICK_JSON " + json.dumps(summ, default=str))


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

def dry_run(cfg, seed=None) -> int:
    db = SessionLocal()
    try:
        bot_observe.utc_session(db)
        db.commit()
        # Enforced by Postgres, not by discipline: any write in here errors.
        db.execute(text("SET TRANSACTION READ ONLY"))
        rng = random.Random(seed)
        ctx = Ctx(mode="dry")
        snap, plan = tick(db, cfg, rng, ctx)
        print("DRY RUN — nothing below is written.\n")
        print_summary(summary(snap, plan, ctx, cfg), plan.report.get("humans"))

        print(f"\nworld: {len(snap.bots)} bots, {len(snap.territories)} live territories, "
              f"{len(snap.humans)} active real players, {len(snap.due_intents)} intents due")
        by_region = {}
        for b in snap.bots:
            ok_due = b.next_run_at and b.next_run_at <= snap.now
            e_due, _ = bot_director.eligible(b, snap.now, cfg, pulled=False)
            e_pull, why = bot_director.eligible(b, snap.now, cfg, pulled=True)
            d = by_region.setdefault(b.region_key, {"bots": 0, "due": 0, "pullable": 0, "blocked": {}})
            d["bots"] += 1
            d["due"] += 1 if ok_due and e_due else 0
            d["pullable"] += 1 if e_pull and not ok_due else 0
            if not e_pull:
                d["blocked"][why] = d["blocked"].get(why, 0) + 1
        print("eligible bots by region:")
        for k, d in sorted(by_region.items(), key=lambda p: str(p[0])):
            print(f"  {str(k):<8} bots {d['bots']:>3}  due {d['due']:>3}  pullable {d['pullable']:>3}  "
                  f"blocked {d['blocked']}")
        if plan.new_intents:
            print("\nwould schedule:")
            for r in plan.new_intents:
                print(f"  {r['stage']:<8} {r['kind']:<16} {r['status']:<8} due {r['due_at']:%m-%d %H:%M} "
                      f"target {r['target_user_id'][:8]}  {r['reason'] or ''}")
        if plan.intent_updates:
            print("\nwould resolve:")
            for iid, st, reason, due in plan.intent_updates:
                print(f"  {iid[:8]} -> {st} ({reason}){' due ' + due.strftime('%m-%d %H:%M') if due else ''}")
        if plan.report.get("pressure_diag"):
            print("\nwhy pressure found no bot (counts of bots excluded):")
            for d in plan.report["pressure_diag"]:
                print("  ", d)
        print(f"\nwould run ({len(plan.runs)}):")
        for r in plan.runs:
            line = (f"  {r.intent:<17} {r.bot.username:<18} {str(r.region):<8} {r.mode:<9}"
                    f"{' group ' + r.group_id[:6] + '#' + str(r.group_index) if r.group_id else ''}"
                    f"{' DUE' if r.due else ' pulled'} {r.note}")
            if r.target_territory_id:
                try:
                    route = plan_route(db, r, random.Random(1), snap.now, cfg, dry=True)
                    tgt = next((t for t in snap.territories if t.id == r.target_territory_id), None)
                    line += (f"  -> vs {'HUMAN ' if r.target_is_human else ''}"
                             f"{(tgt.owner_id[:8] if tgt else '?')} str {tgt.strength if tgt else '?'}"
                             f"  predicted overlap {route['predicted_overlap_m2'] / 1e4:.2f} ha")
                except Exception as exc:  # noqa: BLE001
                    line += f"  (route preview failed: {exc})"
            print(line)
        if plan.rests:
            print(f"\nwould give {len(plan.rests)} due bots a rest day: "
                  + ", ".join(b.username for b in plan.rests[:12]) + (" ..." if len(plan.rests) > 12 else ""))
        return 0
    finally:
        db.rollback()
        db.close()


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="plan only, write nothing")
    ap.add_argument("--simulate-hours", type=float, default=None,
                    help="simulate N hours in one rolled-back transaction (see bot_simulate.py)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--sim-humans", type=int, default=3)
    ap.add_argument("--sim-human-claims-per-hour", type=float, default=0.0)
    ap.add_argument("--sim-start-sgt", type=float, default=None,
                    help="Singapore hour the simulated day starts at (default: now)")
    ap.add_argument("--allow-remote", action="store_true",
                    help="let the simulation run against a non-local database")
    args = ap.parse_args(argv)
    cfg = bot_sim_config.load()

    if args.dry_run:
        return dry_run(cfg, args.seed)
    if args.simulate_hours is not None:
        import bot_simulate
        return bot_simulate.run(cfg, args)

    db = SessionLocal()
    ctx = Ctx(mode="live")
    try:
        bot_observe.utc_session(db)
        got = db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": _TICK_LOCK_KEY}).scalar()
        db.commit()
        if not got:
            print("bot_activity: another tick is still running, skipping this one")
            return 0
        try:
            snap, plan = tick(db, cfg, random.Random(args.seed), ctx)
            print_summary(summary(snap, plan, ctx, cfg), plan.report.get("humans"))
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _TICK_LOCK_KEY})
            db.commit()
    finally:
        db.close()

    # Best-effort, after every claim is committed — the order /claim uses.
    for n_args in ctx.notifies:
        try:
            notify(*n_args)
        except Exception as exc:  # noqa: BLE001
            print(f"notify FAILED: {exc}", file=sys.stderr)
    return 0 if not ctx.stats.get("failed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
