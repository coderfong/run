"""The seeded-world activity director's policy, without a database.

    .venv/Scripts/python.exe -m pytest test_bot_director.py

Everything the director decides is a pure function of a snapshot
(bot_observe.Snapshot), so these build small synthetic worlds and hold the
rules to them: humans suppress bots, a quiet world is filled, a player's
world goes stale and gets pressure, cooldowns stop harassment, rivals rotate,
rank tiers are respected, group-run traces pass the SAME club matcher humans
pass, nights are quiet, regions and hotspots skew activity, and the safety
caps hold. The database-backed half is test_bot_director_db.py.
"""

import random
import uuid
from datetime import datetime, timedelta

import pytest

import bot_director as d
import bot_world
from app import club_runs, elo
from bot_observe import Bot, Hotspot, Human, HumanClaim, PairHistory, RegionActivity, Snapshot, Territory
from bot_sim_config import BotSimConfig

CFG = BotSimConfig()
# 12:00 UTC is 20:00 in Singapore: the evening peak.
PEAK = datetime(2026, 9, 23, 12, 0)
# 19:00 UTC is 03:00 in Singapore.
NIGHT = datetime(2026, 9, 23, 19, 0)

CLUB_A, CLUB_B, CLUB_X = (str(uuid.uuid4()) for _ in range(3))
CLUBS = [str(uuid.uuid4()) for _ in range(5)]

EAST = (1.3526, 103.9447)      # Tampines
CENTRAL = (1.3500, 103.8480)   # Bishan


def _id():
    return str(uuid.uuid4())


def _bot(lat=EAST[0], lon=EAST[1], tier=3, clan=None, region="east", due=True,
         last_end=None, runs_7d=1, runs_24h=0, attacker=False, uid=None):
    return Bot(
        user_id=uid or _id(), username=f"bot{random.randrange(10**6)}", clan_id=clan, avatar={},
        home_lat=lat, home_lon=lon, region_key=region,
        next_run_at=PEAK - timedelta(minutes=5) if due else PEAK + timedelta(days=1),
        tier=tier, attacker=attacker, last_run_end=last_end, runs_7d=runs_7d,
        runs_24h=runs_24h, live_territories=1,
    )


def _terr(owner, lat, lon, tier=3, is_bot=True, clan=None, attributed=None, area=250_000.0,
          strength=1.0):
    return Territory(id=_id(), owner_id=owner, owner_is_bot=is_bot, owner_clan=clan,
                     attributed_clan=attributed, owner_tier=tier, lat=lat, lon=lon,
                     area_m2=area, strength=strength)


def _human(tier=3, lat=EAST[0], lon=EAST[1], last_run_h=2.0, clan=None):
    uid = _id()
    return Human(user_id=uid, username="realrunner", clan_id=clan, tier=tier,
                 last_run_end=PEAK - timedelta(hours=last_run_h),
                 territories=[_terr(uid, lat, lon, tier=tier, is_bot=False)],
                 first_land_at=PEAK - timedelta(days=3))


def _regions(**overrides):
    regs = {k: RegionActivity(k, bot_population=70) for k in ("north", "south", "east", "west", "central")}
    for key, fields in overrides.items():
        for f, v in fields.items():
            setattr(regs[key], f, v)
    return regs


def _snap(bots=(), humans=(), territories=(), regions=None, due_intents=(), claims=(),
          hotspots=(), pairs=None, now=PEAK, bot_claims_last_hour=0):
    terr = list(territories)
    for h in humans:
        terr.extend(h.territories)
    return Snapshot(
        now=now, regions=regions or _regions(), territories=terr, bots=list(bots),
        humans=list(humans), new_human_claims=list(claims), due_intents=list(due_intents),
        hotspots=list(hotspots), recent_hotspots=[], pairs=pairs or {}, last_club_run={},
        human_run_points_24h=[], bot_claims_last_hour=bot_claims_last_hour,
    )


# ---------------------------------------------------------------------------
# humans always win
# ---------------------------------------------------------------------------

def test_human_activity_reduces_bot_activity():
    target = 10.0
    empty = d.bot_quota(target, human_1h=0, bot_1h=0, cfg=CFG)
    some = d.bot_quota(target, human_1h=6, bot_1h=0, cfg=CFG)
    full = d.bot_quota(target, human_1h=10, bot_1h=0, cfg=CFG)
    over = d.bot_quota(target, human_1h=35, bot_1h=0, cfg=CFG)
    assert empty > some > full
    assert full == 0.0 and over == 0.0


def test_humans_meeting_the_target_leave_only_the_background_floor():
    # Every region already full of real claims: the regional quota is zero,
    # so due bots only run at the background floor.
    regs = _regions(**{k: {"human_claims_1h": 50, "human_battles_1h": 50, "human_club_1h": 50}
                       for k in ("north", "south", "east", "west", "central")})
    bots = [_bot() for _ in range(200)]
    plan = d.plan_tick(_snap(bots=bots, regions=regs), CFG, random.Random(1))
    ran = len(plan.runs)
    assert ran < 200 * (CFG.background_floor + 0.1)
    assert ran + len(plan.rests) == 200
    assert all(r.note == "background" for r in plan.runs)


def test_an_inactive_world_increases_bot_activity():
    # Behind target with no bot claims in the last hour: the correction adds
    # to the base slice, so a quiet world catches up.
    behind = d.bot_quota(10.0, human_1h=0, bot_1h=0, cfg=CFG)
    on_pace = d.bot_quota(10.0, human_1h=0, bot_1h=10, cfg=CFG)
    ahead = d.bot_quota(10.0, human_1h=0, bot_1h=20, cfg=CFG)
    assert behind > on_pace > ahead >= 0
    assert behind == pytest.approx(10.0 * CFG.tick_hours * (1 + CFG.controller_gain))


def test_a_quiet_world_pulls_rested_bots_forward():
    # Nobody due, nobody has run: the director brings rested bots out.
    bots = [_bot(due=False, region="east") for _ in range(60)]
    plan = d.plan_tick(_snap(bots=bots), CFG, random.Random(3))
    assert len(plan.runs) > 0
    assert all(not r.due for r in plan.runs)


def test_scale_zero_is_a_kill_switch():
    cfg = BotSimConfig(activity_scale=0.0)
    plan = d.plan_tick(_snap(bots=[_bot() for _ in range(50)], humans=[_human()]), cfg, random.Random(1))
    assert plan.runs == [] and plan.new_intents == [] and plan.report["disabled"]


# ---------------------------------------------------------------------------
# time and place
# ---------------------------------------------------------------------------

def test_night_activity_is_lower():
    assert d.diurnal(NIGHT, CFG) == CFG.night_multiplier
    assert d.targets(NIGHT, CFG)["claims"] < 0.1 * d.targets(PEAK, CFG)["claims"]
    bots = [_bot(due=False) for _ in range(100)]
    day = sum(len(d.plan_tick(_snap(bots=bots), CFG, random.Random(i)).runs) for i in range(20))
    night = sum(len(d.plan_tick(_snap(bots=bots, now=NIGHT), CFG, random.Random(i)).runs)
                for i in range(20))
    assert night < day * 0.2


def test_scheduled_pressure_never_lands_in_the_small_hours():
    rng = random.Random(4)
    for _ in range(200):
        t = d.out_of_night(NIGHT + timedelta(minutes=rng.uniform(0, 300)), rng)
        assert not d.is_night(t)


def test_region_weighting_follows_humans_and_keeps_every_region_alive():
    regs = _regions(central={"human_runs_24h": 12, "human_claims_24h": 10, "human_territory": 8},
                    east={"human_runs_24h": 5, "human_claims_24h": 4},
                    west={"human_runs_24h": 1})
    shares = d.region_shares(regs, CFG)
    assert sum(shares.values()) == pytest.approx(1.0)
    assert shares["central"] > shares["east"] > shares["west"]
    assert min(shares.values()) >= CFG.region_min_share - 1e-9


def test_region_floor_holds_when_one_region_has_everything():
    cfg = BotSimConfig(region_weights={"human_runs": 1.0})
    shares = d.region_shares(_regions(central={"human_runs_24h": 100}), cfg)
    assert shares["central"] > 0.6
    assert all(v >= cfg.region_min_share - 1e-9 for v in shares.values())


def test_hotspots_increase_local_activity():
    spot = Hotspot(None, "east", EAST[0], EAST[1], 1800, 2.5, "east", PEAK, PEAK + timedelta(hours=8))
    assert d.hotspot_boost(EAST[0], EAST[1], [spot], CFG) == 2.5
    assert d.hotspot_boost(CENTRAL[0], CENTRAL[1], [spot], CFG) == 1.0
    # Bots near the hotspot are picked far more often than bots away from it.
    hot = [_bot(EAST[0], EAST[1], due=False) for _ in range(30)]
    cold = [_bot(1.3150, 103.9900, due=False) for _ in range(30)]
    hot_ids = {b.user_id for b in hot}
    picked = hot_n = 0
    one = BotSimConfig(hotspot_count=1)   # just this hotspot, no new ones
    for i in range(40):
        plan = d.plan_tick(_snap(bots=hot + cold, hotspots=[spot]), one, random.Random(i))
        for r in plan.runs:
            picked += 1
            hot_n += r.bot.user_id in hot_ids
    assert picked and hot_n / picked > 0.6


def test_hotspots_rotate_away_from_live_and_recent_ones():
    bots = [_bot(EAST[0] + i * 0.001, EAST[1]) for i in range(20)] + \
           [_bot(CENTRAL[0] + i * 0.001, CENTRAL[1], region="central") for i in range(20)] +            [_bot(1.3400 + i * 0.001, 103.7050, region="west") for i in range(20)]
    live = Hotspot(None, "east", EAST[0], EAST[1], 1800, 2.5, "x", PEAK, PEAK + timedelta(hours=4))
    new = d.plan_hotspots([live], [], bots, [], [], PEAK, random.Random(2), CFG)
    assert len(new) == CFG.hotspot_count - 1
    for h in new:
        assert d.metres(h.lat, h.lon, live.lat, live.lon) >= 3000
        assert CFG.hotspot_min_h <= (h.ends_at - h.starts_at).total_seconds() / 3600 <= CFG.hotspot_max_h


def test_frontier_prefers_borders_over_deep_interior():
    b = _bot()
    mine = _terr(b.user_id, EAST[0], EAST[1], area=1_000_000.0)
    other = _terr(_id(), EAST[0], EAST[1] + 0.012, area=250_000.0)
    idx = d.TerritoryIndex([mine, other])
    deep = d.frontier_score(EAST[0], EAST[1], b, idx, [], [], CFG)
    border = d.frontier_score(EAST[0], EAST[1] + 0.0075, b, idx, [], [], CFG)
    assert border > deep + 2


# ---------------------------------------------------------------------------
# the human engagement director
# ---------------------------------------------------------------------------

def test_human_territory_eventually_becomes_eligible_for_pressure():
    h = _human()
    eng = d.engagement(h, PEAK, CFG)
    assert eng["need"] > 0 and not eng["capped"]
    row, why = d.plan_floor(h, PEAK, random.Random(1), CFG)
    assert why == "scheduled" and row["target_user_id"] == h.user_id
    assert PEAK < row["due_at"] < PEAK + timedelta(hours=8)


def test_a_player_with_plenty_of_organic_fights_gets_no_bot_pressure():
    h = _human()
    h.interactions_24h = 3 * CFG.human_organic_weight
    h.interactions_48h = h.interactions_24h
    assert d.engagement(h, PEAK, CFG)["need"] <= 0
    assert d.plan_floor(h, PEAK, random.Random(1), CFG) == (None, "floor_met")


def test_a_player_away_for_days_is_owed_less():
    fresh, away = _human(last_run_h=2), _human(last_run_h=24 * 5)
    assert d.engagement(away, PEAK, CFG)["need"] < d.engagement(fresh, PEAK, CFG)["need"]


def test_a_human_claim_schedules_reactions_but_never_instantly_and_never_all():
    h = _human()
    claim = HumanClaim(_id(), h.user_id, PEAK - timedelta(minutes=10), EAST[0], EAST[1], [])
    pending = 0
    for i in range(300):
        rows = d.plan_reactions(claim, h, PEAK, random.Random(i), CFG)
        assert {r["stage"] for r in rows} == set(d.REACTION_STAGES)
        for r in rows:
            assert r["due_at"] > PEAK
            if r["status"] == "pending":
                pending += 1
                lo, hi = CFG.reaction_windows_h[r["stage"]]
                assert r["due_at"] >= claim.claimed_at + timedelta(hours=lo) - timedelta(minutes=1) \
                    or d.is_night(claim.claimed_at + timedelta(hours=lo))
        # Revenge needs a bot the human actually took land from.
        assert next(r for r in rows if r["stage"] == "revenge")["status"] == "skipped"
    # About one stage in three rolls; certainly not every claim gets all of them.
    assert 0.2 < pending / (300 * 3) < 0.5


def test_revenge_is_scheduled_for_the_bot_that_was_robbed():
    h = _human()
    victim = _id()
    claim = HumanClaim(_id(), h.user_id, PEAK, EAST[0], EAST[1], [victim])
    rolled = [r for i in range(200) for r in d.plan_reactions(claim, h, PEAK, random.Random(i), CFG)
              if r["stage"] == "revenge" and r["status"] == "pending"]
    assert rolled and all(r["bot_user_id"] == victim for r in rolled)
    assert all(r["due_at"] >= PEAK + timedelta(hours=24) for r in rolled)


def test_a_saturated_player_gets_no_new_reactions():
    h = _human()
    h.bot_interactions_24h = int(CFG.human_max_interactions_per_day)
    claim = HumanClaim(_id(), h.user_id, PEAK, EAST[0], EAST[1], [_id()])
    rows = d.plan_reactions(claim, h, PEAK, random.Random(1), CFG)
    assert all(r["status"] == "skipped" and r["reason"] == "saturated" for r in rows)


# ---------------------------------------------------------------------------
# cooldowns and rivals
# ---------------------------------------------------------------------------

def test_cooldown_prevents_repeated_harassment():
    h = _human()
    h.last_bot_interaction_at = PEAK - timedelta(hours=1)
    assert d.plan_floor(h, PEAK, random.Random(1), CFG) == (None, "cooldown")

    pair = PairHistory(fights=1, fights_48h=1, last_at=PEAK - timedelta(hours=2))
    ready, left = d.pair_ready(pair, PEAK, CFG, human=True)
    assert not ready and left == pytest.approx(CFG.rival_cooldown_h - 2)
    ready, _ = d.pair_ready(pair, PEAK + timedelta(hours=CFG.rival_cooldown_h), CFG, human=True)
    assert ready


def test_pair_cooldown_grows_with_repeated_fights_and_bounces():
    base = d.pair_cooldown_h(PairHistory(fights=1, fights_48h=1), CFG, human=True)
    busy = d.pair_cooldown_h(PairHistory(fights=3, fights_48h=3), CFG, human=True)
    walled = d.pair_cooldown_h(PairHistory(fights=3, fights_48h=3, recent_defended_streak=2),
                               CFG, human=True)
    assert base < busy < walled <= CFG.rival_cooldown_max_h


def test_a_due_pressure_intent_is_deferred_while_the_player_is_on_cooldown():
    h = _human()
    h.last_bot_interaction_at = PEAK - timedelta(hours=1)
    it = _intent(h, stage="attack", expires=PEAK + timedelta(hours=10))
    plan = d.plan_tick(_snap(bots=[_bot()], humans=[h], due_intents=[it]), CFG, random.Random(1))
    (iid, status, reason, due), = [u for u in plan.intent_updates if u[0] == it.id]
    assert status == "pending" and reason == "deferred_cooldown" and due > PEAK
    assert not any(r.target_is_human for r in plan.runs)


def _intent(h, stage="floor", expires=None, bot=None):
    from bot_observe import Intent
    return Intent(_id(), d.HUMAN_PRESSURE, stage, f"test:{_id()}", h.user_id, bot,
                  EAST[0], EAST[1], "east", PEAK - timedelta(minutes=1),
                  expires or PEAK + timedelta(hours=5))


def test_pressure_only_uses_bots_in_the_players_rank_tier_and_not_clubmates():
    h = _human(tier=4, clan=CLUB_A)
    wrong_tier = [_bot(tier=3) for _ in range(10)]
    clubmates = [_bot(tier=4, clan=CLUB_A) for _ in range(10)]
    right = _bot(tier=4, clan=CLUB_B)
    bot, terr, diag = d.pressure_candidates(h, wrong_tier + clubmates + [right], set(), {}, [],
                                            PEAK, CFG, random.Random(1))
    assert bot is right and terr.owner_id == h.user_id
    assert diag["tier"] == 10 and diag["club"] == 10


def test_pressure_skips_a_pair_still_cooling_down():
    h = _human()
    b = _bot()
    pairs = {(b.user_id, h.user_id): PairHistory(fights=1, fights_48h=1,
                                                 last_at=PEAK - timedelta(hours=1))}
    bot, _t, diag = d.pressure_candidates(h, [b], set(), pairs, [], PEAK, CFG, random.Random(1))
    assert bot is None and diag["pair_cooldown"] == 1


def test_different_rivals_rotate():
    h = _human()
    bots = [_bot() for _ in range(6)]
    h.recent_attackers = [bots[0].user_id, bots[1].user_id]
    picks = [d.pressure_candidates(h, bots, set(), {}, [], PEAK, CFG, random.Random(i))[0].user_id
             for i in range(300)]
    distinct = set(picks)
    assert len(distinct) >= 4
    recent_share = sum(p in h.recent_attackers for p in picks) / len(picks)
    assert recent_share < 2 / 6    # the last two attackers are chosen less than their fair share


def test_a_recognisable_rival_is_preferred_once_it_is_off_cooldown():
    h = _human()
    rival, stranger = _bot(), _bot()
    pairs = {(rival.user_id, h.user_id): PairHistory(fights=4, fights_48h=0, a_took_m2=90_000,
                                                     b_took_m2=60_000,
                                                     last_at=PEAK - timedelta(days=2))}
    picks = [d.pressure_candidates(h, [rival, stranger], set(), pairs, [], PEAK, CFG,
                                   random.Random(i))[0] for i in range(200)]
    assert sum(p is rival for p in picks) > 140


def test_bot_combat_respects_rank_tier_club_and_never_picks_a_human():
    me = _bot(tier=5, clan=CLUB_A)
    idx = d.TerritoryIndex([
        _terr(_id(), EAST[0] + 0.004, EAST[1], tier=4),                 # wrong tier
        _terr(_id(), EAST[0] + 0.004, EAST[1], tier=5, clan=CLUB_A),      # clubmate
        _terr(_id(), EAST[0] + 0.004, EAST[1], tier=5, is_bot=False),   # a real player
    ])
    assert d.combat_target(me, idx, {}, PEAK, CFG, random.Random(1), False)[0] is None
    ok = _terr(_id(), EAST[0] + 0.004, EAST[1], tier=5, clan=CLUB_B)
    idx = d.TerritoryIndex(list(idx.by_id.values()) + [ok])
    assert d.combat_target(me, idx, {}, PEAK, CFG, random.Random(1), False)[0] is ok


def test_elo_tier_bounds_are_what_combat_scopes_on():
    # The director compares tiers read through elo.tier_for_rating — the same
    # bracket `_rank_scope_sql` builds its SQL from.
    for tier in range(len(elo.ELO_TIERS)):
        lo, hi = elo.tier_bounds(tier)
        assert elo.tier_for_rating(lo)["tier"] == tier
        if hi is not None:
            assert elo.tier_for_rating(hi - 1)["tier"] == tier


# ---------------------------------------------------------------------------
# group runs pass the SAME club matcher humans do
# ---------------------------------------------------------------------------

def _route():
    return bot_world.synth_route(EAST[0], EAST[1], 6000, random.Random(5))


def test_group_runs_generate_valid_together_traces():
    path = _route()
    start = PEAK - timedelta(minutes=45)
    duration = 6000 / 1000 * 360
    a = bot_world.synth_trace(path, start, duration, 42, random.Random(1))
    b = bot_world.synth_trace(path, start, duration, 42, random.Random(2), skew_s=3.0)
    assert a and b and len(a[0]) == 3
    assert all(a[i][0] < a[i + 1][0] for i in range(len(a) - 1))
    assert club_runs.nearby_in_time(a, b)
    assert club_runs.together_ratio(a, b) > 0.9


def test_a_trace_starts_at_the_run_start_in_utc_epoch_seconds():
    from datetime import timezone
    path = _route()
    start = datetime(2026, 9, 23, 11, 0, 0)
    t = bot_world.synth_trace(path, start, 1800, 1, random.Random(1))
    assert t[0][0] == pytest.approx(start.replace(tzinfo=timezone.utc).timestamp())
    assert t[-1][0] == pytest.approx(start.replace(tzinfo=timezone.utc).timestamp() + 1800, abs=5)


def test_the_same_route_run_apart_in_time_does_not_pass():
    path = _route()
    start = PEAK - timedelta(hours=2)
    a = bot_world.synth_trace(path, start, 2100, 42, random.Random(1))
    b = bot_world.synth_trace(path, start + timedelta(minutes=8), 2100, 42, random.Random(2))
    assert not club_runs.nearby_in_time(a, b)


def test_members_running_at_their_own_paces_would_not_pass():
    # Why the executor gives a group ONE pace: at each bot's own pace, the
    # runners drift apart and the timed test fails — the old ±90 s skew and
    # per-bot pace could never have produced a club run.
    path = _route()
    start = PEAK - timedelta(hours=1)
    a = bot_world.synth_trace(path, start, 6 * 300, 42, random.Random(1))
    b = bot_world.synth_trace(path, start, 6 * 420, 42, random.Random(2))
    assert not club_runs.nearby_in_time(a, b)


def test_member_paths_stay_within_the_route_tolerance():
    path = _route()
    m = bot_world.member_path(path, random.Random(3))
    worst = max(d.metres(a[1], a[0], b[1], b[0]) for a, b in zip(path, m))
    assert worst < 15


def test_the_director_plans_club_groups_of_real_clubmates():
    bots = [_bot(EAST[0] + i * 0.002, EAST[1], clan=CLUB_X) for i in range(4)] + \
           [_bot(EAST[0], EAST[1] + i * 0.002) for i in range(10)]
    cfg = BotSimConfig(target_club_events_per_hour=40.0)
    groups = {}
    for i in range(10):
        for r in d.plan_tick(_snap(bots=bots), cfg, random.Random(i)).runs:
            if r.group_id:
                groups.setdefault((i, r.group_id), []).append(r)
    assert groups
    for members in groups.values():
        assert 2 <= len(members) <= cfg.club_group_max
        assert {m.bot.clan_id for m in members} == {CLUB_X}
        assert len({m.bot.user_id for m in members}) == len(members)


# ---------------------------------------------------------------------------
# schedules and safety
# ---------------------------------------------------------------------------

def test_archetypes_are_stable_and_spread():
    ids = [_id() for _ in range(2000)]
    first = [bot_world.archetype_for(i, False) for i in ids]
    assert first == [bot_world.archetype_for(i, False) for i in ids]
    counts = {a: first.count(a) for a in set(first)}
    assert set(counts) == {"casual", "regular", "daily", "hardcore"}
    assert counts["regular"] > counts["hardcore"]


def test_next_run_respects_the_gap_and_lands_in_running_hours():
    rng = random.Random(9)
    for _ in range(400):
        uid = _id()
        t = bot_world.next_run_for(rng, PEAK, uid, None, min_gap_h=5)
        assert t >= PEAK + timedelta(hours=5)
        assert not d.is_night(t)


def test_weekly_cadence_matches_the_archetype():
    uid = next(i for i in (_id() for _ in range(500)) if bot_world.archetype_for(i, False) == "casual")
    rng = random.Random(2)
    t, n = PEAK, 0
    end = PEAK + timedelta(days=70)
    while t < end:
        t = bot_world.next_run_for(rng, t, uid, None)
        n += 1
    per_week = n / 10
    lo, hi = bot_world.ARCHETYPE_WEEKLY_RUNS["casual"]
    assert lo - 0.8 <= per_week <= hi + 0.8


def test_eligibility_blocks_back_to_back_runs_and_daily_caps():
    b = _bot(last_end=PEAK - timedelta(hours=1))
    assert d.eligible(b, PEAK, CFG, pulled=True) == (False, "min_gap")
    b = _bot(runs_24h=5)
    assert d.eligible(b, PEAK, CFG, pulled=False) == (False, "daily_cap")
    b = _bot(runs_7d=20)
    assert d.eligible(b, PEAK, CFG, pulled=False) == (False, "weekly_budget")


def test_director_never_exceeds_the_safety_caps():
    cfg = BotSimConfig(target_claims_per_hour=5000, target_battles_per_hour=5000,
                       target_club_events_per_hour=500, max_runs_per_tick=25,
                       max_runs_per_hour=60, max_pressure_per_tick=2)
    humans = [_human() for _ in range(10)]
    intents = [_intent(h) for h in humans]
    bots = [_bot(EAST[0] + i * 0.0005, EAST[1], clan=CLUBS[i % 5]) for i in range(300)]
    for i in range(10):
        plan = d.plan_tick(_snap(bots=bots, humans=humans, due_intents=intents), cfg, random.Random(i))
        assert len(plan.runs) <= 25
        assert sum(1 for r in plan.runs if r.target_is_human) <= 2
        assert len({r.bot.user_id for r in plan.runs}) == len(plan.runs)   # nobody runs twice
    plan = d.plan_tick(_snap(bots=bots, bot_claims_last_hour=55), cfg, random.Random(1))
    assert len(plan.runs) <= 5


def test_one_player_gets_at_most_one_pressure_run_per_tick():
    h = _human()
    intents = [_intent(h, stage=s) for s in ("floor", "probe", "attack")]
    bots = [_bot() for _ in range(20)]
    plan = d.plan_tick(_snap(bots=bots, humans=[h], due_intents=intents), CFG, random.Random(1))
    assert sum(1 for r in plan.runs if r.target_owner_id == h.user_id) == 1


def test_real_humans_are_never_planned_as_bots():
    h = _human()
    bots = [_bot() for _ in range(30)]
    plan = d.plan_tick(_snap(bots=bots, humans=[h], due_intents=[_intent(h)]), CFG, random.Random(1))
    assert all(r.bot.user_id != h.user_id for r in plan.runs)
    assert all(b.user_id != h.user_id for b in plan.rests)
