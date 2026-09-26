"""The activity director against a real PostGIS database, all rolled back.

    BOT_DB_TESTS=1 DATABASE_URL=postgresql://.../territory_run_botsim \
        .venv/Scripts/python.exe -m pytest test_bot_director_db.py

Opt-in, and refuses any host but localhost: it runs real claims. Needs a
seeded world (seed_world.py --clans 24 --per-clan 16 against the SAME local
copy) and migration 0046. Every test works inside one transaction that is
rolled back, so the copy is left exactly as it was.

These are the halves that cannot be unit tested: that club matching accepts
a bot group run through the REAL partner SQL, that a bounced claim cannot
strand a bot, that a dry run cannot write, that a tick never touches a real
account as a bot, and that no fight crosses a rank tier.
"""

import os
import random
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import text

if os.environ.get("BOT_DB_TESTS") != "1":
    pytest.skip("set BOT_DB_TESTS=1 and point DATABASE_URL at a local seeded copy",
                allow_module_level=True)

import bot_activity  # noqa: E402
import bot_director  # noqa: E402
import bot_observe  # noqa: E402
import bot_sim_config  # noqa: E402
import bot_simulate  # noqa: E402
from app import elo  # noqa: E402
from app.database import SessionLocal  # noqa: E402

if bot_simulate._host() not in ("localhost", "127.0.0.1", "::1"):
    pytest.skip("refusing to run claims against a non-local database", allow_module_level=True)

CFG = bot_sim_config.BotSimConfig()


@pytest.fixture
def db():
    s = SessionLocal()
    bot_observe.utc_session(s)
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _club_pair(db, snap):
    by_club = {}
    for b in snap.bots:
        if b.clan_id:
            by_club.setdefault(b.clan_id, []).append(b)
    for members in by_club.values():
        if len(members) >= 3:
            return members[:3]
    pytest.skip("no seeded club with three members")


def _group_plan(now, members, anchor):
    plan = bot_director.TickPlan(now=now)
    gid = "00000000-0000-0000-0000-00000000c1ab"
    for i, b in enumerate(members):
        plan.runs.append(bot_director.PlannedRun(
            bot=b, intent=bot_director.CLUB_RUN, region=b.region_key, anchor=anchor,
            mode="frontier", group_id=gid, group_size=len(members), group_index=i))
    return plan


def _fresh(members):
    for b in members:
        b.last_run_end = None
        b.runs_24h = 0


def test_a_bot_group_run_passes_the_real_club_matcher(db):
    now = bot_observe.db_now(db)
    snap = bot_observe.snapshot(db, now, CFG)
    members = _club_pair(db, snap)
    _fresh(members)
    # Clear their recent history so the overlap guard cannot refuse them.
    db.execute(text("DELETE FROM runs WHERE user_id = ANY(CAST(:ids AS uuid[])) AND ended_at > :d"),
               {"ids": [m.user_id for m in members], "d": now - timedelta(hours=12)})
    ctx = bot_activity.Ctx(mode="sim")
    anchor = (members[0].home_lat, members[0].home_lon)
    bot_activity.execute_plan(db, _group_plan(now, members, anchor), CFG, random.Random(4), ctx)

    assert ctx.stats.get("failed", 0) == 0
    assert ctx.stats["club_validations_attempted"] == len(members) - 1
    assert ctx.stats["club_validations_passed"] == len(members) - 1
    run_ids = [r["run_id"] for r in ctx.runs]
    logged = db.execute(text(
        "SELECT count(*) FROM club_run_logs WHERE run_id = ANY(CAST(:ids AS uuid[]))"
    ), {"ids": run_ids}).scalar()
    assert logged == len(members)
    traces = db.execute(text(
        "SELECT count(*) FROM runs WHERE id = ANY(CAST(:ids AS uuid[])) "
        "AND jsonb_array_length(together_trace) > 50"
    ), {"ids": run_ids}).scalar()
    assert traces == len(members)
    # And the club holds ground it ran for together.
    club_land = db.execute(text(
        "SELECT count(*) FROM territories WHERE run_id = ANY(CAST(:ids AS uuid[])) AND clan_id IS NOT NULL"
    ), {"ids": run_ids}).scalar()
    assert club_land >= 1


def test_the_same_route_twenty_minutes_apart_is_not_a_club_run(db):
    now = bot_observe.db_now(db)
    snap = bot_observe.snapshot(db, now, CFG)
    a, b = _club_pair(db, snap)[:2]
    _fresh([a, b])
    db.execute(text("DELETE FROM runs WHERE user_id = ANY(CAST(:ids AS uuid[])) AND ended_at > :d"),
               {"ids": [a.user_id, b.user_id], "d": now - timedelta(hours=12)})
    import bot_world
    ctx = bot_activity.Ctx(mode="sim")
    rng = random.Random(9)
    run_a = bot_director.PlannedRun(bot=a, intent=bot_director.CLUB_RUN, region=a.region_key,
                                    anchor=(a.home_lat, a.home_lon), mode="frontier",
                                    group_id="g", group_size=2, group_index=0)
    route = bot_activity.plan_route(db, run_a, rng, now, CFG)
    dur = route["distance_m"] / 1000 * 360
    start = now - timedelta(seconds=dur) - timedelta(minutes=45)
    for i, (bot, offset) in enumerate(((a, 0), (b, 20 * 60))):
        run = bot_director.PlannedRun(bot=bot, intent=bot_director.CLUB_RUN, region=bot.region_key,
                                      group_id="g", group_size=2, group_index=i)
        s = start + timedelta(seconds=offset)
        trace = bot_world.synth_trace(route["path"], s, dur, 7, random.Random(i))
        with bot_activity.unit(db, ctx):
            bot_activity.execute_run(db, run, route, now, CFG, rng, ctx, started_at=s,
                                     duration_s=dur, trace=trace)
    assert ctx.stats["club_validations_attempted"] == 1
    assert ctx.stats.get("club_validations_passed", 0) == 0


def test_a_bounced_claim_does_not_leave_the_bot_permanently_due(db, monkeypatch):
    now = bot_observe.db_now(db)
    snap = bot_observe.snapshot(db, now, CFG)
    bot = snap.bots[0]
    _fresh([bot])
    db.execute(text("DELETE FROM runs WHERE user_id = CAST(:u AS uuid) AND ended_at > :d"),
               {"u": bot.user_id, "d": now - timedelta(hours=12)})
    db.execute(text("UPDATE bot_accounts SET next_run_at = :t WHERE user_id = CAST(:u AS uuid)"),
               {"t": now - timedelta(hours=1), "u": bot.user_id})

    def bounce(**_kw):
        raise HTTPException(409, "that land is too strong to take")

    monkeypatch.setattr(bot_activity, "_claim_territory", bounce)
    ctx = bot_activity.Ctx(mode="sim")
    run = bot_director.PlannedRun(bot=bot, intent=bot_director.RIVAL_ATTACK, region=bot.region_key,
                                  anchor=(bot.home_lat, bot.home_lon), mode="frontier")
    bot_activity._execute_one(db, run, now, CFG, random.Random(1), ctx)

    assert ctx.stats.get("failed", 0) == 0 and ctx.stats["bounced"] == 1
    nra = db.execute(text("SELECT next_run_at FROM bot_accounts WHERE user_id = CAST(:u AS uuid)"),
                     {"u": bot.user_id}).scalar()
    assert nra > now
    rid = ctx.runs[0]["run_id"]
    assert db.execute(text("SELECT count(*) FROM runs WHERE id = CAST(:r AS uuid)"), {"r": rid}).scalar() == 1
    assert db.execute(text("SELECT count(*) FROM territories WHERE run_id = CAST(:r AS uuid)"),
                      {"r": rid}).scalar() == 0


TABLES = ("runs", "territories", "territory_steals", "territory_events", "bot_world_intents",
          "bot_hotspots", "club_run_logs", "notifications", "rank_events")


def _counts(db):
    return {t: db.execute(text(f"SELECT count(*) FROM {t}")).scalar() for t in TABLES} | {
        "next_run_sum": db.execute(text(
            "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM next_run_at)), 0) FROM bot_accounts")).scalar()}


def test_dry_run_writes_nothing(db, capsys):
    before = _counts(db)
    db.commit()
    assert bot_activity.dry_run(CFG, seed=3) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "BOT_TICK_JSON" in out
    assert _counts(db) == before


def test_dry_run_is_enforced_read_only(db):
    db.commit()
    db.execute(text("SET TRANSACTION READ ONLY"))
    with pytest.raises(Exception):
        db.execute(text("UPDATE bot_accounts SET next_run_at = next_run_at"))


def test_a_tick_never_treats_a_real_account_as_a_bot_and_never_fights_across_tiers(db):
    now = bot_observe.db_now(db)
    humans_before = {r[0]: r[1] for r in db.execute(text(
        "SELECT id::text, is_bot FROM users WHERE NOT is_bot")).fetchall()}
    tiers = {r[0]: elo.tier_for_rating(int(r[1]))["tier"] for r in db.execute(text(
        f"SELECT id::text, {elo.rating_sql('u')} FROM users u")).fetchall()}
    rng = random.Random(5)
    # A real player with land and a due pressure intent, so the tick has a
    # human to consider.
    players = bot_simulate._stage_players(db, 2, rng, "dbtest_player_", now)
    terr = bot_observe.read_territories(db)
    ctx0 = bot_activity.Ctx(mode="sim")
    for p in players:
        bot_simulate._player_run(db, p, now, CFG, rng, ctx0, terr, [], attack=False)
        tiers[p.user_id] = p.as_runner(db, now).tier
    human_runs_before = db.execute(text(
        "SELECT count(*) FROM runs r JOIN users u ON u.id = r.user_id WHERE NOT u.is_bot")).scalar()

    ctx = bot_activity.Ctx(mode="sim")
    cfg = bot_sim_config.BotSimConfig(target_claims_per_hour=200, target_battles_per_hour=120)
    bot_activity.tick(db, cfg, rng, ctx)
    assert ctx.stats.get("runs", 0) > 0

    after = {r[0]: r[1] for r in db.execute(text(
        "SELECT id::text, is_bot FROM users WHERE id = ANY(CAST(:ids AS uuid[]))"
    ), {"ids": list(humans_before)}).fetchall()}
    assert after == humans_before
    assert db.execute(text(
        "SELECT count(*) FROM bot_accounts b JOIN users u ON u.id = b.user_id WHERE NOT u.is_bot"
    )).scalar() == 0
    # The tick ran no runs AS a real player.
    assert db.execute(text(
        "SELECT count(*) FROM runs r JOIN users u ON u.id = r.user_id WHERE NOT u.is_bot"
    )).scalar() == human_runs_before
    # Every fight this tick was between two runners of the same tier.
    new_ids = [r["run_id"] for r in ctx.runs if r.get("run_id")]
    fights = db.execute(text(
        "SELECT attacker_id::text, victim_id::text FROM territory_steals "
        "WHERE run_id = ANY(CAST(:ids AS uuid[]))"
    ), {"ids": new_ids}).fetchall()
    for a, v in fights:
        assert tiers[a] == tiers[v]
