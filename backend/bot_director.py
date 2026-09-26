"""The world activity director: decides what the seeded world should DO next.

Individual bots still have homes, clubs, a stable pace, an archetype and a
schedule (bot_world.py). What used to be missing was anybody deciding whether
anything INTERESTING happened. Each bot rolled its own dice — 6% to raid the
player, 32% to raid a neighbour — so events were flat noise: a player could go
days without a single fight, and nothing ever happened BECAUSE of something
else. This module is the level above the bots. Every tick it looks at the
world (bot_observe.Snapshot) and plans a set of runs:

  * how much should happen, from rolling one-hour counts against targets that
    follow the Singapore day, with HUMAN activity counted first so bots only
    ever fill the gap (`bot_quota`)
  * where it should happen, by region share and a few rotating hotspots
  * what each run is for (an INTENT), and which bot is most plausible for it
  * what the world owes each active human: reactions scheduled off their own
    claims, and a soft floor of interactions per day, both under cooldowns

It never writes and never decides a fight. Every planned run is executed by
bot_activity.py as a real run through the same claim pipeline a human uses,
so whether an attack takes ground or bounces is the combat rules' call, not
this module's. Planning a fight only means choosing a route that reaches a
plausible opponent's border instead of a route that touches nobody.

Pure Python over the snapshot, so the whole policy is unit tested without a
database (test_bot_director.py).
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

import bot_world
from bot_observe import REGION_KEYS, Hotspot, metres, region_of, regions

# ---------------------------------------------------------------------------
# Intents
# ---------------------------------------------------------------------------

NEUTRAL_EXPANSION = "NEUTRAL_EXPANSION"   # open ground near home or a hotspot
LOCAL_EXPANSION = "LOCAL_EXPANSION"       # grow out of the bot's own border
RIVAL_ATTACK = "RIVAL_ATTACK"             # a neighbouring bot's border
RIVAL_REMATCH = "RIVAL_REMATCH"           # a bot this bot has fought before
HUMAN_PRESSURE = "HUMAN_PRESSURE"         # a real player's land or its edge
CLUB_RUN = "CLUB_RUN"                     # clubmates together, own frontier
CLUB_ATTACK = "CLUB_ATTACK"               # clubmates together, another club's land
RECOVERY_RUN = "RECOVERY_RUN"             # go back for ground lost in the last day

INTENTS = (NEUTRAL_EXPANSION, LOCAL_EXPANSION, RIVAL_ATTACK, RIVAL_REMATCH,
           HUMAN_PRESSURE, CLUB_RUN, CLUB_ATTACK, RECOVERY_RUN)
COMBAT = {RIVAL_ATTACK, RIVAL_REMATCH, HUMAN_PRESSURE, CLUB_ATTACK, RECOVERY_RUN}

REACTION_STAGES = ("nearby", "probe", "attack", "revenge")


# ---------------------------------------------------------------------------
# How much: targets and the controller
# ---------------------------------------------------------------------------

def local_hour(now: datetime) -> float:
    t = now + bot_world.local_offset()
    return t.hour + t.minute / 60.0


def is_night(now: datetime) -> bool:
    h = local_hour(now)
    return h >= 23.5 or h < 5.5


def diurnal(now: datetime, cfg) -> float:
    """Share of the peak target that applies at this Singapore hour."""
    h = local_hour(now)
    weekend = (now + bot_world.local_offset()).weekday() >= 5
    if 5.5 <= h < 8.0 or 17.5 <= h < 21.5:
        return 1.0
    if 8.0 <= h < 11.0:
        return 0.8 if weekend else cfg.late_morning_multiplier
    if 11.0 <= h < 17.5:
        return cfg.midday_multiplier
    if 21.5 <= h < 23.5:
        return cfg.late_evening_multiplier
    return cfg.night_multiplier


def targets(now: datetime, cfg) -> dict:
    """World targets per hour, for this moment."""
    m = diurnal(now, cfg) * cfg.activity_scale
    return {
        "claims": cfg.target_claims_per_hour * m,
        "battles": cfg.target_battles_per_hour * m,
        "club": cfg.target_club_events_per_hour * m,
        "diurnal": m,
    }


def region_shares(regs: dict, cfg) -> dict:
    """Each region's share of the world target.

    Every signal is first turned into shares across the five regions — so ten
    human runs and ten live bot territories are not compared as if they were
    the same unit — and then mixed by `cfg.region_weights`. A signal nobody
    has (no humans anywhere yet) contributes an even split rather than
    nothing, so the weights still add up. Finally a floor keeps every region
    alive.
    """
    signals = {
        "human_runs": lambda r: r.human_runs_24h,
        "human_claims": lambda r: r.human_claims_24h,
        "human_territory": lambda r: r.human_territory,
        "clubs": lambda r: r.active_clubs,
        "bots": lambda r: r.bot_population,
        "combat": lambda r: r.combat_24h,
        "hotspots": lambda r: r.hotspots,
    }
    keys = [k for k in REGION_KEYS if k in regs]
    mix = {k: 0.0 for k in keys}
    total_w = 0.0
    for name, read in signals.items():
        w = float(cfg.region_weights.get(name, 0.0))
        if w <= 0:
            continue
        vals = {k: max(0.0, float(read(regs[k]))) for k in keys}
        s = sum(vals.values())
        for k in keys:
            mix[k] += w * (vals[k] / s if s > 0 else 1.0 / len(keys))
        total_w += w
    if total_w <= 0:
        return {k: 1.0 / len(keys) for k in keys}
    shares = {k: mix[k] / total_w for k in keys}
    floor = min(cfg.region_min_share, 1.0 / len(keys))
    # Lift the starved regions to the floor and take it proportionally from
    # the rest, so the shares still sum to one.
    low = {k for k, v in shares.items() if v < floor}
    if low:
        rest = sum(v for k, v in shares.items() if k not in low)
        budget = 1.0 - floor * len(low)
        shares = {k: floor if k in low else (v / rest) * budget if rest > 0 else budget
                  for k, v in shares.items()}
    return shares


def bot_quota(target_per_hour: float, human_1h: float, bot_1h: float, cfg) -> float:
    """Expected bot units for this tick in one region.

    Humans first: what the bots OWE is only the part of the target humans did
    not already supply, capped by `max_bot_share`. The tick then pays its
    slice of that hourly debt plus a correction toward it — if the bots' own
    rolling count is behind what they owe, a little more; ahead, a little
    less. Proportional and bounded, so a quiet hour catches up over the next
    few ticks rather than in one burst.

    When humans alone meet the target, this is zero, and the only bot runs
    left are the background floor applied to bots whose own schedule came
    due (see `plan_tick`).
    """
    owed = max(0.0, target_per_hour - human_1h)
    owed = min(owed, target_per_hour * cfg.max_bot_share)
    base = owed * cfg.tick_hours
    correction = cfg.controller_gain * (owed - bot_1h) * cfg.tick_hours
    return max(0.0, min(base + correction, 2.0 * base))


def stochastic_round(x: float, rng: random.Random) -> int:
    """2.3 becomes 2 seven times in ten and 3 three times in ten, so small
    budgets still add up over a day instead of rounding to nothing."""
    if x <= 0:
        return 0
    lo = math.floor(x)
    return lo + (1 if rng.random() < x - lo else 0)


# ---------------------------------------------------------------------------
# Cooldowns and rivals
# ---------------------------------------------------------------------------

def pair_cooldown_h(pair, cfg, human: bool) -> float:
    """Hours the same two runners must wait between intentional fights.

    Grows with every extra fight inside 48h and doubles after two bounces in a
    row — a bot that keeps running into a wall it cannot take is harassment
    that does not even look like strategy.
    """
    base = cfg.rival_cooldown_h if human else cfg.bot_rival_cooldown_h
    if pair is None:
        return base
    extra = max(0, pair.fights_48h - 1)
    h = base * (cfg.rival_cooldown_growth ** extra)
    if pair.recent_defended_streak >= 2:
        h *= 2.0
    return min(h, cfg.rival_cooldown_max_h if human else cfg.rival_cooldown_max_h / 2)


def pair_ready(pair, now: datetime, cfg, human: bool) -> tuple:
    """(ready, hours_left)."""
    if pair is None or pair.last_at is None:
        return True, 0.0
    left = pair.last_at + timedelta(hours=pair_cooldown_h(pair, cfg, human)) - now
    hours = left.total_seconds() / 3600.0
    return hours <= 0, max(0.0, hours)


def rival_score(pair) -> float:
    """How recognisable a rivalry is: encounters, capped, and ground swapped."""
    if pair is None:
        return 0.0
    swapped = pair.a_took_m2 + pair.b_took_m2
    return min(pair.fights, 4) / 4.0 + min(swapped / 200_000.0, 1.0) * 0.5


# ---------------------------------------------------------------------------
# Human engagement
# ---------------------------------------------------------------------------

def engagement(h, now: datetime, cfg) -> dict:
    """How much the world owes this player today.

    `score` is their rolling interaction count (a fight with another real
    player counts extra; the 24-48h window counts half). `need` is the soft
    floor, scaled by how recently they ran — someone who ran today will open
    the map and see it, someone away for five days mostly will not — minus
    the score. Positive need means their world has gone stale.
    """
    hours_since_run = (now - h.last_run_end).total_seconds() / 3600.0 if h.last_run_end else 999
    recency = 1.0 if hours_since_run <= 24 else 0.7 if hours_since_run <= 72 else 0.4
    score = h.interactions_24h + 0.5 * max(0.0, h.interactions_48h - h.interactions_24h)
    need = cfg.human_daily_interactions * recency - score
    anchor = h.last_interaction_at or h.first_land_at or h.last_run_end or now
    stale_h = max(0.0, (now - anchor).total_seconds() / 3600.0)
    cooldown_left = 0.0
    if h.last_bot_interaction_at:
        left = h.last_bot_interaction_at + timedelta(hours=cfg.human_attack_cooldown_h) - now
        cooldown_left = max(0.0, left.total_seconds() / 3600.0)
    return {
        "score": round(score, 2), "need": round(need, 2), "recency": recency,
        "stale_h": round(stale_h, 1), "cooldown_left_h": round(cooldown_left, 2),
        "capped": h.bot_interactions_24h >= cfg.human_max_interactions_per_day,
    }


def out_of_night(t: datetime, rng: random.Random) -> datetime:
    """Push a time that lands in the small hours to the next morning window."""
    if not is_night(t):
        return t
    local = t + bot_world.local_offset()
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if local.hour >= 23:
        day += timedelta(days=1)
    return day + timedelta(hours=rng.uniform(5.6, 8.0)) - bot_world.local_offset()


def plan_reactions(claim, human, now: datetime, rng: random.Random, cfg) -> list:
    """What the world MIGHT do because this human claimed land.

    Nothing is instant and nothing is certain. Each stage rolls once, here,
    with its own window; the rows that did not roll are still written (as
    `skipped: not_rolled`) so the same claim is never rolled twice. A player
    already at their hard daily ceiling gets no new reactions at all, and one
    well above their floor gets fewer.
    """
    eng = engagement(human, now, cfg) if human else None
    damp = 1.0
    if eng is not None and eng["need"] < 0:
        damp = max(0.0, 1.0 + eng["need"] / max(cfg.human_daily_interactions, 0.1))
    rows = []
    for stage in REACTION_STAGES:
        lo, hi = cfg.reaction_windows_h.get(stage, (1.0, 6.0))
        p = cfg.reaction_probs.get(stage, 0.0) * damp
        bot_id = None
        if stage == "revenge":
            if not claim.stolen_from_bots:
                p = 0.0
            else:
                bot_id = rng.choice(claim.stolen_from_bots)
        reason = None
        if human is None:
            p, reason = 0.0, "target_inactive"
        elif eng["capped"]:
            p, reason = 0.0, "saturated"
        rolled = rng.random() < p
        due = out_of_night(claim.claimed_at + timedelta(hours=rng.uniform(lo, hi)), rng)
        if due < now:
            due = now + timedelta(minutes=rng.uniform(5, 40))
        rows.append({
            "kind": RIVAL_REMATCH if stage == "revenge" else HUMAN_PRESSURE,
            "stage": stage,
            "source": f"claim:{claim.run_id}",
            "target_user_id": claim.user_id,
            "bot_user_id": bot_id,
            "lat": claim.lat, "lon": claim.lon,
            "region_key": region_of(claim.lat, claim.lon),
            "due_at": due,
            "expires_at": due + timedelta(hours=max(3.0, (hi - lo) / 2)),
            "status": "pending" if rolled else "skipped",
            "reason": None if rolled else (reason or "not_rolled"),
        })
    return rows


def plan_floor(human, now: datetime, rng: random.Random, cfg) -> tuple:
    """(intent row or None, reason). One pending floor intent per player at
    most; its due time is jittered hours ahead so pressure does not arrive on
    a timetable."""
    eng = engagement(human, now, cfg)
    if eng["capped"]:
        return None, "capped"
    if eng["need"] <= 0.25:
        return None, "floor_met"
    if human.pending_floor:
        return None, "already_pending"
    if eng["cooldown_left_h"] > 0:
        return None, "cooldown"
    # Staler worlds come sooner: the longer since anything touched them, the
    # smaller the jitter.
    spread = max(0.75, 4.0 - eng["stale_h"] / 8.0)
    due = out_of_night(now + timedelta(hours=rng.uniform(0.25, spread)), rng)
    bucket = int((now - datetime(2026, 1, 1)).total_seconds() // 3600)
    return {
        "kind": HUMAN_PRESSURE,
        "stage": "floor",
        "source": f"floor:{human.user_id}:{bucket}",
        "target_user_id": human.user_id,
        "bot_user_id": None,
        "lat": human.territories[0].lat if human.territories else None,
        "lon": human.territories[0].lon if human.territories else None,
        "region_key": region_of(human.territories[0].lat, human.territories[0].lon)
        if human.territories else None,
        "due_at": due,
        "expires_at": due + timedelta(hours=6),
        "status": "pending",
        "reason": None,
    }, "scheduled"


_MODES = {
    "nearby": [("edge", 1.0)],
    "probe": [("nibble", 1.0)],
    "attack": [("push", 0.8), ("takeover", 0.2)],
    "revenge": [("push", 0.7), ("nibble", 0.3)],
    "floor": [("edge", 0.25), ("nibble", 0.4), ("push", 0.3), ("takeover", 0.05)],
}


def pressure_mode(stage: str, rng: random.Random) -> str:
    """How close to the player's land a pressure run goes. `edge` claims the
    open ground against their border (a new neighbour, no fight); `nibble`
    clips one edge; `push` drives into it; `takeover` is the rare big one."""
    opts = _MODES.get(stage, _MODES["floor"])
    return rng.choices([m for m, _ in opts], weights=[w for _, w in opts], k=1)[0]


# ---------------------------------------------------------------------------
# Hotspots
# ---------------------------------------------------------------------------

def hotspot_boost(lat: float, lon: float, hotspots, cfg) -> float:
    """Selection multiplier for a point: the hotspot multiplier inside one,
    fading to 1 at twice its radius."""
    best = 1.0
    for h in hotspots:
        d = metres(lat, lon, h.lat, h.lon)
        if d <= h.radius_m:
            best = max(best, h.multiplier)
        elif d <= 2 * h.radius_m:
            f = 1 - (d - h.radius_m) / h.radius_m
            best = max(best, 1 + (h.multiplier - 1) * f)
    return best


def _cell(lat: float, lon: float, size: float = 0.011) -> tuple:
    return (round(lat / size), round(lon / size))


def plan_hotspots(active, recent, bots, human_points, human_territories,
                  now: datetime, rng: random.Random, cfg) -> list:
    """New hotspots to bring the active count up to `hotspot_count`.

    Candidates are ~1.2 km cells weighted by where people actually are: bot
    homes, and — heavier — where real players ran and hold land. A cell near a
    live hotspot, or one that was hot in the last day, is excluded so the
    heat moves around the island instead of settling.
    """
    need = cfg.hotspot_count - len(active)
    if need <= 0:
        return []
    weight: dict = {}
    for b in bots:
        c = _cell(b.home_lat, b.home_lon)
        weight[c] = weight.get(c, 0.0) + 1.0
    for lat, lon in human_points:
        c = _cell(lat, lon)
        weight[c] = weight.get(c, 0.0) + 4.0
    for t in human_territories:
        c = _cell(t.lat, t.lon)
        weight[c] = weight.get(c, 0.0) + 2.0
    blocked = list(active) + list(recent)
    out = []
    for _ in range(need):
        cands = []
        for (ci, cj), w in weight.items():
            lat, lon = ci * 0.011, cj * 0.011
            if any(metres(lat, lon, h.lat, h.lon) < 3000 for h in blocked):
                continue
            cands.append((lat, lon, w))
        if not cands:
            break
        cands.sort(key=lambda c: -c[2])
        top = cands[:25]
        lat, lon, _w = rng.choices(top, weights=[c[2] for c in top], k=1)[0]
        lat += rng.uniform(-0.003, 0.003)
        lon += rng.uniform(-0.003, 0.003)
        key = region_of(lat, lon)
        hours = rng.uniform(cfg.hotspot_min_h, cfg.hotspot_max_h)
        spot = Hotspot(
            id=None, region_key=key, lat=lat, lon=lon, radius_m=cfg.hotspot_radius_m,
            multiplier=cfg.hotspot_multiplier,
            label=f"{regions()[key]['name'] if key else 'Singapore'} {lat:.3f},{lon:.3f}",
            starts_at=now, ends_at=now + timedelta(hours=hours),
        )
        out.append(spot)
        blocked.append(spot)
    return out


# ---------------------------------------------------------------------------
# Where: frontier scoring
# ---------------------------------------------------------------------------

class TerritoryIndex:
    """Territories bucketed by ~1.2 km cell for cheap neighbourhood reads."""

    def __init__(self, territories):
        self.cells: dict = {}
        self.by_owner: dict = {}
        self.by_id: dict = {}
        for t in territories:
            self.cells.setdefault(_cell(t.lat, t.lon), []).append(t)
            self.by_owner.setdefault(t.owner_id, []).append(t)
            self.by_id[t.id] = t

    def near(self, lat: float, lon: float, radius_m: float):
        span = int(radius_m / 1200) + 1
        ci, cj = _cell(lat, lon)
        for di in range(-span, span + 1):
            for dj in range(-span, span + 1):
                for t in self.cells.get((ci + di, cj + dj), ()):
                    d = metres(lat, lon, t.lat, t.lon)
                    if d <= radius_m:
                        yield t, d


def frontier_score(lat: float, lon: float, bot, index: TerritoryIndex,
                   human_points, hotspots, cfg) -> float:
    """How much a run starting here would visibly change the map.

    High on a border: open ground within a few hundred metres of somebody's
    land, a corridor several owners touch, the edge of the bot's own land,
    anywhere near real players. Low deep inside land the bot already holds —
    the old failure, where most runs repainted their own interior and nothing
    on the map moved — and a little low out in empty country.
    """
    nearest_gap = 10_000.0
    owners = set()
    own_gap = 10_000.0
    human_near = False
    for t, d in index.near(lat, lon, 1500):
        gap = d - t.radius_m
        if t.owner_id == bot.user_id:
            own_gap = min(own_gap, gap)
            continue
        nearest_gap = min(nearest_gap, gap)
        if d < 1200:
            owners.add(t.owner_id)
        if not t.owner_is_bot:
            human_near = True
    score = 0.0
    if own_gap < -250:
        score -= 3.0                      # deep inside own land
    elif own_gap < 600:
        score += 0.8                      # growing out of own edge
    if nearest_gap < -150:
        score -= 1.0                      # inside someone else's: that is a raid, not expansion
    elif nearest_gap <= 400:
        score += 2.0                      # on a border
    elif nearest_gap <= 1200:
        score += 1.0
    elif nearest_gap > 2000 and own_gap > 2000:
        score -= 0.5                      # nobody for kilometres
    score += min(len(owners), 5) * 0.4    # contested corridor
    if human_near:
        score += 1.0
    if any(metres(lat, lon, a, b) < 1500 for a, b in human_points[:200]):
        score += 0.8
    score += (hotspot_boost(lat, lon, hotspots, cfg) - 1.0) * 0.6
    return score


def frontier_point(bot, index: TerritoryIndex, human_points, hotspots, cfg,
                   rng: random.Random, local: bool) -> tuple:
    """Pick a start point by sampling candidates and softmax-choosing on score.

    LOCAL candidates ring the bot's own territories just past their edge;
    NEUTRAL ones scatter around home and toward a nearby hotspot. Returns
    ((lat, lon), score).
    """
    cands = []
    own = index.by_owner.get(bot.user_id, [])
    if local and own:
        for _ in range(8):
            t = rng.choice(own)
            ang = rng.uniform(0, 2 * math.pi)
            dist = t.radius_m + rng.uniform(60, 350)
            cands.append(_offset(t.lat, t.lon, dist, ang))
    for _ in range(6):
        cands.append(_offset(bot.home_lat, bot.home_lon, rng.uniform(100, 1600),
                             rng.uniform(0, 2 * math.pi)))
    for h in hotspots:
        if metres(bot.home_lat, bot.home_lon, h.lat, h.lon) < 6000:
            for _ in range(3):
                cands.append(_offset(h.lat, h.lon, rng.uniform(0, h.radius_m),
                                     rng.uniform(0, 2 * math.pi)))
    land = regions().get(bot.region_key or "")
    if land is not None:
        from shapely.geometry import Point as _P
        kept = [c for c in cands if land["prepared"].contains(_P(c[1], c[0]))]
        cands = kept or cands
    scored = [(c, frontier_score(c[0], c[1], bot, index, human_points, hotspots, cfg))
              for c in cands]
    top = max(s for _, s in scored)
    weights = [math.exp(1.2 * (s - top)) for _, s in scored]
    return rng.choices(scored, weights=weights, k=1)[0]


def _offset(lat: float, lon: float, dist_m: float, ang: float) -> tuple:
    return (lat + dist_m * math.sin(ang) / 111_320.0,
            lon + dist_m * math.cos(ang) / (111_320.0 * math.cos(math.radians(lat))))


# ---------------------------------------------------------------------------
# Who: eligibility and choice
# ---------------------------------------------------------------------------

def eligible(bot, now: datetime, cfg, pulled: bool) -> tuple:
    """Whether this bot may run now. `pulled` is a run the director brings
    forward: it must fit inside the bot's weekly habit. A bot whose own
    schedule came due gets one run of grace on top."""
    if bot.last_run_end and (now - bot.last_run_end) < timedelta(hours=cfg.min_run_gap_h):
        return False, "min_gap"
    arche = bot_world.archetype_for(bot.user_id, bool(bot.clan_id))
    if bot.runs_24h >= bot_world.daily_cap(arche):
        return False, "daily_cap"
    weekly = bot_world.weekly_runs(bot.user_id, arche)
    limit = math.floor(weekly) if pulled else math.ceil(weekly) + 1
    if bot.runs_7d >= limit:
        return False, "weekly_budget"
    return True, "ok"


def aggression(bot) -> float:
    """A stable temperament. The seeder's attacker flag still means something:
    those bots are the ones most drawn to a fight."""
    return 0.6 + 0.8 * bot_world._hash_frac(bot.user_id, 11) + (0.5 if bot.attacker else 0.0)


def pick_weighted(items, scores, rng: random.Random, top: int = 5, temp: float = 1.0):
    """Softmax over the best few: usually the best candidate, not always."""
    if not items:
        return None
    ranked = sorted(zip(items, scores), key=lambda p: -p[1])[:top]
    best = ranked[0][1]
    weights = [math.exp((s - best) / max(temp, 1e-6)) for _, s in ranked]
    return rng.choices([i for i, _ in ranked], weights=weights, k=1)[0]


def same_side(a_clan, b_clan) -> bool:
    return bool(a_clan) and a_clan == b_clan


def pressure_candidates(human, bots, used, pairs, hotspots, now, cfg, rng,
                        preferred: Optional[str] = None) -> tuple:
    """(chosen bot, target territory, diagnostics) for pressure on a human.

    Eligible: same live rank tier (combat is rank-scoped, so a bot from
    another tier would claim beside them without ever fighting and would not
    even be on their board), not their clubmate, close enough to plausibly
    run there, free to run now, and past the pair cooldown with this player.

    Preferred: a recognisable rival (fought before), a bot with a grudge (lost
    land to them), closer homes, hotspots. Penalised: the last attackers of
    this player, so the faces rotate instead of one bot owning the feud.
    """
    diag = {"tier": 0, "club": 0, "radius": 0, "busy": 0, "pair_cooldown": 0, "ok": 0}
    anchor = human.territories
    if not anchor:
        return None, None, diag
    for radius in (cfg.human_pressure_radius_m, cfg.human_pressure_fallback_radius_m):
        # Diagnostics describe the widest search, the one that decided.
        diag = {k: 0 for k in diag}
        cands, scores = [], []
        for b in bots:
            if b.user_id in used:
                diag["busy"] += 1
                continue
            if preferred and b.user_id != preferred:
                continue
            if b.tier != human.tier:
                diag["tier"] += 1
                continue
            if same_side(b.clan_id, human.clan_id):
                diag["club"] += 1
                continue
            t, d = min(((t, metres(b.home_lat, b.home_lon, t.lat, t.lon)) for t in anchor),
                       key=lambda p: p[1])
            if d > radius:
                diag["radius"] += 1
                continue
            ok, _why = eligible(b, now, cfg, pulled=False)
            if not ok:
                diag["busy"] += 1
                continue
            pair = pairs.get((b.user_id, human.user_id))
            ready, _left = pair_ready(pair, now, cfg, human=True)
            if not ready:
                diag["pair_cooldown"] += 1
                continue
            diag["ok"] += 1
            grudge = pair is not None and pair.b_took_m2 > 0
            recent_idx = (human.recent_attackers.index(b.user_id)
                          if b.user_id in human.recent_attackers else None)
            s = (2.0 * rival_score(pair)
                 + (1.5 if grudge else 0.0)
                 - (1.2 if recent_idx is not None and recent_idx < 2 else 0.0)
                 - d / 4000.0
                 + 0.3 * (aggression(b) - 1.0)
                 + 0.4 * (hotspot_boost(b.home_lat, b.home_lon, hotspots, cfg) - 1.0)
                 + rng.gauss(0, 0.5))
            cands.append((b, t))
            scores.append(s)
        if cands:
            choice = pick_weighted(cands, scores, rng)
            return choice[0], choice[1], diag
    return None, None, diag


def combat_target(bot, index: TerritoryIndex, pairs, now, cfg, rng, rematch: bool):
    """A bot-owned enemy territory in this bot's tier, near a front line.

    Humans are never chosen here: pressure on a real player is rationed by
    the engagement director and nowhere else. Returns (territory, intent) or
    (None, reason)."""
    own = index.by_owner.get(bot.user_id, [])
    cands, scores = [], []
    for t, d in index.near(bot.home_lat, bot.home_lon, cfg.rival_radius_m):
        if t.owner_id == bot.user_id or not t.owner_is_bot:
            continue
        if t.owner_tier != bot.tier or same_side(bot.clan_id, t.owner_clan):
            continue
        pair = pairs.get((bot.user_id, t.owner_id))
        if rematch and (pair is None or pair.fights == 0):
            continue
        ready, _ = pair_ready(pair, now, cfg, human=False)
        if not ready:
            continue
        # Front line: how close this land sits to the bot's own. A raid on the
        # territory next door reads as a border war; one across the estate
        # reads as a stranger.
        front = min((metres(t.lat, t.lon, o.lat, o.lon) - t.radius_m - o.radius_m for o in own),
                    default=d)
        est = 1.05 * (1.2 - 0.3 * (bot_world.ability(bot.user_id) - 0.82) / 0.36)
        hopeless = t.strength > 2.2 * est
        s = (-max(front, 0.0) / 1200.0
             - d / 5000.0
             + (1.2 * rival_score(pair) if rematch else 0.0)
             - (2.0 if hopeless else 0.0)
             + rng.gauss(0, 0.4))
        cands.append(t)
        scores.append(s)
    if not cands:
        return None, "no_rematch" if rematch else "no_target"
    return pick_weighted(cands, scores, rng), RIVAL_REMATCH if rematch else RIVAL_ATTACK


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

@dataclass
class PlannedRun:
    bot: object
    intent: str
    region: Optional[str]
    anchor: Optional[tuple] = None          # (lat, lon) the route starts from
    target_territory_id: Optional[str] = None
    target_owner_id: Optional[str] = None
    target_is_human: bool = False
    mode: str = "home"                       # home/edge/nibble/push/takeover/frontier
    intent_row_id: Optional[str] = None
    stage: Optional[str] = None
    group_id: Optional[str] = None
    group_size: int = 1
    group_index: int = 0
    due: bool = False
    note: str = ""


@dataclass
class TickPlan:
    now: datetime
    runs: list = field(default_factory=list)
    rests: list = field(default_factory=list)        # bots whose due run is skipped
    new_intents: list = field(default_factory=list)
    intent_updates: list = field(default_factory=list)  # (id, status, reason, new_due)
    new_hotspots: list = field(default_factory=list)
    report: dict = field(default_factory=dict)
    room: int = 0



def plan_tick(snap, cfg, rng: random.Random) -> TickPlan:
    now = snap.now
    plan = TickPlan(now=now)
    rep = plan.report
    tg = targets(now, cfg)
    rep["targets"] = {k: round(v, 1) for k, v in tg.items()}
    rep["activity_1h"] = {
        "human_runs": sum(r.human_runs_1h for r in snap.regions.values()),
        "human_claims": sum(r.human_claims_1h for r in snap.regions.values()),
        "bot_claims": sum(r.bot_claims_1h for r in snap.regions.values()),
        "human_battles": sum(r.human_battles_1h for r in snap.regions.values()),
        "bot_battles": sum(r.bot_battles_1h for r in snap.regions.values()),
        "human_club": sum(r.human_club_1h for r in snap.regions.values()),
        "bot_club": sum(r.bot_club_1h for r in snap.regions.values()),
    }
    skips: dict = {}
    rep["skips"] = skips

    def skip(reason: str, n: int = 1):
        skips[reason] = skips.get(reason, 0) + n

    if cfg.activity_scale <= 0:
        rep["disabled"] = True
        return plan

    # Hotspots first: they shape both the regional split and the choices.
    plan.new_hotspots = plan_hotspots(
        snap.hotspots, snap.recent_hotspots, snap.bots, snap.human_run_points_24h,
        [t for t in snap.territories if not t.owner_is_bot], now, rng, cfg,
    )
    hotspots = list(snap.hotspots) + plan.new_hotspots
    for h in plan.new_hotspots:
        if h.region_key in snap.regions:
            snap.regions[h.region_key].hotspots += 1
    shares = region_shares(snap.regions, cfg)
    rep["hotspots"] = [
        {"label": h.label, "until": h.ends_at.strftime("%m-%d %H:%M"), "new": h.id is None}
        for h in hotspots
    ]

    index = TerritoryIndex(snap.territories)
    bots_by_id = {b.user_id: b for b in snap.bots}
    humans_by_id = {h.user_id: h for h in snap.humans}
    used: set = set()

    # Global safety: nothing this tick may push the bots past the hourly cap.
    room = max(0, min(cfg.max_runs_per_tick, cfg.max_runs_per_hour - snap.bot_claims_last_hour))
    rep["room"] = room
    plan.room = room

    def add(run: PlannedRun) -> bool:
        if len(plan.runs) >= room:
            skip("safety_cap")
            return False
        plan.runs.append(run)
        used.add(run.bot.user_id)
        return True

    # ---- 1. reactions to what humans just did --------------------------------
    hp = {"eligible_humans": 0, "reactions_scheduled": 0, "floor_scheduled": 0,
          "due": len(snap.due_intents), "planned": 0, "deferred": 0, "skipped": {}}
    rep["human_pressure"] = hp
    for claim in snap.new_human_claims:
        rows = plan_reactions(claim, humans_by_id.get(claim.user_id), now, rng, cfg)
        plan.new_intents.extend(rows)
        hp["reactions_scheduled"] += sum(1 for r in rows if r["status"] == "pending")

    # ---- 2. the engagement floor ---------------------------------------------
    rep["humans"] = []
    for h in snap.humans:
        eng = engagement(h, now, cfg)
        row, why = plan_floor(h, now, rng, cfg)
        if eng["need"] > 0:
            hp["eligible_humans"] += 1
        if row:
            plan.new_intents.append(row)
            hp["floor_scheduled"] += 1
        rep["humans"].append({"user": h.username, "tier": h.tier, **eng, "floor": why})

    # ---- 3. pressure that has come due ---------------------------------------
    hp_skip = hp["skipped"]
    pressure_runs = 0
    for it in snap.due_intents:
        if pressure_runs >= cfg.max_pressure_per_tick:
            hp_skip["tick_cap"] = hp_skip.get("tick_cap", 0) + 1
            continue
        h = humans_by_id.get(it.target_user_id)
        if h is None:
            plan.intent_updates.append((it.id, "skipped", "target_inactive", None))
            hp_skip["target_inactive"] = hp_skip.get("target_inactive", 0) + 1
            continue
        eng = engagement(h, now, cfg)
        if eng["capped"]:
            plan.intent_updates.append((it.id, "skipped", "saturated", None))
            hp_skip["saturated"] = hp_skip.get("saturated", 0) + 1
            continue
        if it.stage == "floor" and eng["need"] <= 0:
            plan.intent_updates.append((it.id, "skipped", "floor_met", None))
            hp_skip["floor_met"] = hp_skip.get("floor_met", 0) + 1
            continue
        if it.stage in ("nearby", "probe", "attack") and eng["need"] <= -cfg.human_daily_interactions:
            plan.intent_updates.append((it.id, "skipped", "saturated", None))
            hp_skip["saturated"] = hp_skip.get("saturated", 0) + 1
            continue
        if eng["cooldown_left_h"] > 0:
            new_due = now + timedelta(hours=eng["cooldown_left_h"] + rng.uniform(0.1, 1.0))
            if new_due < it.expires_at:
                plan.intent_updates.append((it.id, "pending", "deferred_cooldown", new_due))
                hp["deferred"] += 1
            else:
                plan.intent_updates.append((it.id, "skipped", "cooldown", None))
                hp_skip["cooldown"] = hp_skip.get("cooldown", 0) + 1
            continue
        bot, terr, diag = pressure_candidates(
            h, snap.bots, used, snap.pairs, hotspots, now, cfg, rng,
            preferred=it.bot_user_id if it.stage == "revenge" else None,
        )
        if bot is None:
            reason = "revenge_bot_unavailable" if it.stage == "revenge" else "no_eligible_bot"
            plan.intent_updates.append((it.id, "skipped", reason, None))
            hp_skip[reason] = hp_skip.get(reason, 0) + 1
            rep.setdefault("pressure_diag", []).append({"user": h.username, **diag})
            continue
        mode = pressure_mode(it.stage, rng)
        run = PlannedRun(
            bot=bot, intent=RIVAL_REMATCH if it.stage == "revenge" else HUMAN_PRESSURE,
            region=bot.region_key, target_territory_id=terr.id, target_owner_id=h.user_id,
            target_is_human=True, mode=mode, intent_row_id=it.id, stage=it.stage,
            due=bool(bot.next_run_at and bot.next_run_at <= now),
            note=f"{h.username} ({it.stage})",
        )
        if add(run):
            pressure_runs += 1
            hp["planned"] += 1
            # One per player per tick, and the cooldown starts now.
            h.last_bot_interaction_at = now
            h.bot_interactions_24h += 1

    # ---- 4. regional budgets --------------------------------------------------
    rep["regions"] = {}
    region_runs = {k: [r for r in plan.runs if r.region == k] for k in shares}
    for key, share in shares.items():
        reg = snap.regions[key]
        q_claims = bot_quota(tg["claims"] * share, reg.human_claims_1h, reg.bot_claims_1h, cfg)
        q_battles = bot_quota(tg["battles"] * share, reg.human_battles_1h, reg.bot_battles_1h, cfg)
        q_club = bot_quota(tg["club"] * share, reg.human_club_1h, reg.bot_club_1h, cfg)
        already = region_runs.get(key, [])
        n_claims = max(0, stochastic_round(q_claims, rng) - len(already))
        n_battles = max(0, stochastic_round(q_battles, rng)
                        - sum(1 for r in already if r.intent in COMBAT))
        n_groups = stochastic_round(q_club, rng)
        rep["regions"][key] = {
            "share": round(share, 3),
            "target_claims_h": round(tg["claims"] * share, 1),
            "human_claims_1h": reg.human_claims_1h, "bot_claims_1h": reg.bot_claims_1h,
            "quota": {"claims": round(q_claims, 2), "battles": round(q_battles, 2),
                      "club": round(q_club, 2)},
            "planned": {"claims": 0, "battles": 0, "groups": 0, "background": 0, "rest": 0},
        }
        _plan_region(key, n_claims, n_battles, n_groups, snap, index, bots_by_id,
                     hotspots, used, add, plan, rep["regions"][key]["planned"],
                     now, cfg, rng, skip)

    counts: dict = {}
    for r in plan.runs:
        counts[r.intent] = counts.get(r.intent, 0) + 1
    rep["intents"] = counts
    return plan


def _plan_region(key, n_claims, n_battles, n_groups, snap, index, bots_by_id,
                 hotspots, used, add, plan, tally, now, cfg, rng, skip):
    region_bots = [b for b in snap.bots if b.region_key == key]
    elig_cache: dict = {}

    def can(b, pulled: bool) -> bool:
        if b.user_id in used:
            return False
        k = (b.user_id, pulled)
        if k not in elig_cache:
            ok, why = eligible(b, now, cfg, pulled)
            elig_cache[k] = ok
            if not ok:
                skip(f"bot_{why}")
        return elig_cache[k]

    due = [b for b in region_bots if b.next_run_at and b.next_run_at <= now and can(b, False)]
    rng.shuffle(due)

    def rested():
        pool = [b for b in region_bots
                if b not in due and can(b, True)
                and not (b.next_run_at and b.next_run_at <= now)]
        return pool

    def take(pool, weight_fn, exclude):
        pool = [b for b in pool if b.user_id not in used and b.user_id not in exclude]
        if not pool:
            return None
        return rng.choices(pool, weights=[max(0.01, weight_fn(b)) for b in pool], k=1)[0]

    def hot(b):
        return hotspot_boost(b.home_lat, b.home_lon, hotspots, cfg)

    def next_bot(weight_fn=hot, exclude=frozenset()):
        # A bot whose own schedule came due runs first: that is its natural
        # time. Only when the region still needs more does the director bring
        # a rested bot forward.
        b = take(due, weight_fn, exclude)
        if b is None:
            b = take(rested(), weight_fn, exclude)
        return b

    slots = n_claims

    # ---- club group runs ----
    for _ in range(n_groups):
        group = _pick_group(key, region_bots, due, can, snap, hotspots, now, cfg, rng, used)
        if not group:
            skip("club_no_group")
            continue
        if len(plan.runs) + len(group) > plan.room:
            skip("safety_cap")
            break
        leader = group[0]
        gid = str(uuid.uuid4())
        attack = rng.random() < cfg.club_attack_share
        terr = _club_enemy_target(leader, index, now, cfg, rng) if attack else None
        if attack and terr is None:
            skip("club_no_enemy_border")
        if terr is not None:
            intent, mode, anchor = CLUB_ATTACK, rng.choice(["nibble", "push"]), None
        else:
            intent, mode = CLUB_RUN, "frontier"
            anchor, _s = frontier_point(leader, index, snap.human_run_points_24h,
                                        hotspots, cfg, rng, local=True)
        placed = 0
        for i, b in enumerate(group):
            ok = add(PlannedRun(
                bot=b, intent=intent, region=key, anchor=anchor,
                target_territory_id=terr.id if terr else None,
                target_owner_id=terr.owner_id if terr else None, mode=mode,
                group_id=gid, group_size=len(group), group_index=i,
                due=b in due, note=f"club {b.clan_id[:8]}",
            ))
            placed += 1 if ok else 0
        if placed >= 2:
            tally["groups"] += 1
        slots -= placed

    # ---- combat ----
    battles = min(n_battles, max(0, slots))
    tried: set = set()
    while battles > 0 and len(tried) < n_battles * 6 + 6:
        b = next_bot(lambda x: aggression(x) * hot(x), exclude=tried)
        if b is not None:
            tried.add(b.user_id)
        if b is None:
            skip("combat_no_bot")
            break
        run = None
        # A bot that lost ground in the last day goes back for it first.
        for attacker, lat, lon, _at in b.losses:
            other = bots_by_id.get(attacker)
            if other is None or other.tier != b.tier or same_side(other.clan_id, b.clan_id):
                continue
            ready, _ = pair_ready(snap.pairs.get((b.user_id, attacker)), now, cfg, human=False)
            if not ready:
                skip("recovery_cooldown")
                continue
            near = sorted(index.by_owner.get(attacker, []),
                          key=lambda t: metres(lat, lon, t.lat, t.lon))
            if near and metres(lat, lon, near[0].lat, near[0].lon) < cfg.rival_radius_m:
                run = PlannedRun(bot=b, intent=RECOVERY_RUN, region=key,
                                 target_territory_id=near[0].id, target_owner_id=attacker,
                                 mode="push", due=b in due, note="retake")
                break
        if run is None:
            rematch = rng.random() < cfg.rematch_share
            terr, intent = combat_target(b, index, snap.pairs, now, cfg, rng, rematch)
            if terr is None and rematch:
                terr, intent = combat_target(b, index, snap.pairs, now, cfg, rng, False)
            if terr is None:
                # Nobody to fight within reach; this bot can still expand below.
                skip(f"combat_{intent}")
                continue
            run = PlannedRun(bot=b, intent=intent, region=key, target_territory_id=terr.id,
                             target_owner_id=terr.owner_id,
                             mode=rng.choices(["nibble", "push", "takeover"],
                                              weights=[55, 35, 10], k=1)[0],
                             due=b in due)
        if add(run):
            battles -= 1
            slots -= 1
            tally["battles"] += 1

    # ---- expansion ----
    while slots > 0:
        b = next_bot()
        if b is None:
            skip("expansion_no_bot")
            break
        if b.live_territories >= cfg.max_live_territories:
            local = True
        else:
            local = bool(index.by_owner.get(b.user_id)) and rng.random() < 0.55
        anchor, _score = frontier_point(b, index, snap.human_run_points_24h, hotspots,
                                        cfg, rng, local=local)
        if add(PlannedRun(bot=b, intent=LOCAL_EXPANSION if local else NEUTRAL_EXPANSION,
                          region=key, anchor=anchor, mode="frontier", due=b in due)):
            slots -= 1
            tally["claims"] += 1
        else:
            break

    # ---- the rest of the due bots: background floor or a rest day ----
    for b in due:
        if b.user_id in used:
            continue
        if rng.random() < cfg.background_floor:
            anchor, _ = frontier_point(b, index, snap.human_run_points_24h, hotspots, cfg,
                                       rng, local=bool(index.by_owner.get(b.user_id)))
            if add(PlannedRun(bot=b, intent=LOCAL_EXPANSION if index.by_owner.get(b.user_id)
                              else NEUTRAL_EXPANSION, region=key, anchor=anchor,
                              mode="frontier", due=True, note="background")):
                tally["background"] += 1
                continue
        plan.rests.append(b)
        used.add(b.user_id)
        tally["rest"] += 1


def _pick_group(key, region_bots, due, can, snap, hotspots, now, cfg, rng, used):
    """Two to four clubmates who can all run now, near each other.

    Clubs in their standing session are strongly preferred, then clubs that
    have not been seen together for a while, then hotspots. This is what makes
    a club "do something visible" rather than exist as a badge.
    """
    clubs: dict = {}
    for b in region_bots:
        if b.clan_id and b.user_id not in used and (b in due or can(b, True)):
            clubs.setdefault(b.clan_id, []).append(b)
    cands, scores = [], []
    for clan, members in clubs.items():
        if len(members) < cfg.club_group_min:
            continue
        last = snap.last_club_run.get(clan)
        stale_h = (now - last).total_seconds() / 3600.0 if last else 72.0
        s = (3.0 if bot_world.in_club_window(clan, now) else 0.0) + min(stale_h / 12.0, 2.0)
        s += 0.5 * (max(hotspot_boost(m.home_lat, m.home_lon, hotspots, cfg) for m in members) - 1)
        s += rng.gauss(0, 0.5)
        cands.append(members)
        scores.append(s)
    members = pick_weighted(cands, scores, rng)
    if not members:
        return None
    leader = rng.choice([m for m in members if m in due] or members)
    near = sorted((m for m in members if m is not leader),
                  key=lambda m: metres(m.home_lat, m.home_lon, leader.home_lat, leader.home_lon))
    near = [m for m in near
            if metres(m.home_lat, m.home_lon, leader.home_lat, leader.home_lon) < 6000]
    size = min(len(near) + 1, rng.choices(range(cfg.club_group_min, cfg.club_group_max + 1),
                                          weights=[50, 35, 15][: cfg.club_group_max - cfg.club_group_min + 1],
                                          k=1)[0])
    if size < cfg.club_group_min:
        return None
    return [leader] + near[: size - 1]


def _club_enemy_target(leader, index: TerritoryIndex, now, cfg, rng):
    """Another club's attributed land, in the leader's tier, near the group."""
    cands, scores = [], []
    for t, d in index.near(leader.home_lat, leader.home_lon, cfg.rival_radius_m):
        if not t.attributed_clan or t.attributed_clan == leader.clan_id:
            continue
        if same_side(leader.clan_id, t.owner_clan) or t.owner_tier != leader.tier:
            continue
        if not t.owner_is_bot:
            continue   # a real player's club land is the engagement director's call
        cands.append(t)
        scores.append(-d / 2000.0 + rng.gauss(0, 0.4))
    return pick_weighted(cands, scores, rng)
