"""Every tunable number the seeded-world simulation runs on, in one place.

Read from the environment so the live world can be turned up, down or off on
Render without a deploy: change the env var on the `run-bots` cron and the
next tick uses it. Defaults are what the world runs on when nothing is set.

The director (bot_director.py) decides WHAT the world needs; these numbers
decide HOW MUCH. Nothing in here fabricates activity: every unit of "activity"
is a real bot run pushed through the same claim pipeline a human run uses, so
turning a number up means more real runs, never more fake feed items.

    BOT_ACTIVITY_SCALE=0   -> the director schedules nothing at all (kill switch)

Every variable, its default, and what it moves:

WORLD TARGETS (per hour, at the peak of the day; scaled down off peak)
  BOT_WORLD_TARGET_CLAIMS_PER_HOUR    30   new/changed territories, humans + bots
  BOT_WORLD_TARGET_BATTLES_PER_HOUR   12   steal or defend outcomes, humans + bots
  BOT_WORLD_TARGET_CLUB_EVENTS_PER_HOUR 4  validated club group runs
  BOT_ACTIVITY_SCALE                  1.0  multiplies all three targets; 0 = off

  Humans count toward every target. Bots only fill the gap, so when real play
  reaches a target the bots' share of it falls to the background floor.

CONTROLLER
  BOT_CONTROLLER_GAIN                 0.5  how hard a tick corrects the bots'
                                           own rolling count toward what they
                                           owe; 0 = open loop, 1 = aggressive
  BOT_BACKGROUND_FLOOR                0.25 when humans already meet a target, a
                                           due bot still runs with this chance
                                           (a population never stops cold)
  BOT_MAX_BOT_SHARE                   1.0  bots may supply at most this share of
                                           any regional target

TIME OF DAY (Singapore local time)
  BOT_NIGHT_MULTIPLIER                0.08 targets between 23:30 and 05:30
  BOT_MIDDAY_MULTIPLIER               0.35 targets between 11:00 and 17:30
  BOT_LATE_MORNING_MULTIPLIER         0.55 targets 08:00-11:00 (0.8 at weekends)
  BOT_LATE_EVENING_MULTIPLIER         0.40 targets 21:30-23:30

REGIONS
  BOT_REGION_WEIGHTS  "human_runs=3,human_claims=3,human_territory=2,clubs=1,
                       bots=2,combat=1,hotspots=2"
                      relative weight of each signal in a region's share of the
                      world target. Each signal is first turned into shares
                      across the five regions, so the weights mix shares.
  BOT_REGION_MIN_SHARE                0.08 no region ever gets less than this
                                           share, so an unplayed region is
                                           quiet but never dead

HUMAN ENGAGEMENT
  BOT_HUMAN_DAILY_INTERACTIONS        2.0  soft floor of meaningful territory
                                           interactions per active human per day
  BOT_HUMAN_ACTIVE_DAYS               7    a human counts as active if they ran
                                           within this many days
  BOT_HUMAN_ATTACK_COOLDOWN_H         4    minimum hours between two intentional
                                           bot interactions with one human (any bot)
  BOT_HUMAN_MAX_INTERACTIONS_PER_DAY  4    hard ceiling of bot interactions per
                                           human per rolling 24h
  BOT_HUMAN_ORGANIC_WEIGHT            1.5  a fight with another REAL player counts
                                           this many times toward the floor
  BOT_HUMAN_PRESSURE_RADIUS_M         8000 how far from home a bot will travel to
                                           pressure a human
  BOT_HUMAN_PRESSURE_FALLBACK_RADIUS_M 15000 widened once when nobody is closer
  BOT_REACTION_PROBS  "nearby=0.35,probe=0.35,attack=0.30,revenge=0.50"
                      chance a human claim schedules each reaction stage
  BOT_REACTION_WINDOWS_H "nearby=0.5-3,probe=2-8,attack=6-24,revenge=24-72"

RIVALS
  BOT_RIVAL_COOLDOWN_H                8    minimum hours between two intentional
                                           fights of the same bot/human pair
  BOT_RIVAL_COOLDOWN_GROWTH           1.5  cooldown multiplier per extra fight of
                                           that pair inside 48h
  BOT_RIVAL_COOLDOWN_MAX_H            36   ceiling on the grown cooldown
  BOT_BOT_RIVAL_COOLDOWN_H            3    same idea between two bots
  BOT_RIVAL_RADIUS_M                  5000 how far a bot travels to raid a bot
  BOT_REMATCH_SHARE                   0.55 share of bot-vs-bot raids that go to a
                                           previous opponent when one is eligible

HOTSPOTS
  BOT_HOTSPOT_COUNT                   3    simultaneously hot areas
  BOT_HOTSPOT_MULTIPLIER              2.5  selection weight for bots/points in one
  BOT_HOTSPOT_RADIUS_M                1800
  BOT_HOTSPOT_MIN_H / BOT_HOTSPOT_MAX_H  6 / 24   lifetime of one hotspot

CLUBS
  BOT_CLUB_GROUP_MIN / BOT_CLUB_GROUP_MAX  2 / 4   runners in one group run
  BOT_CLUB_ATTACK_SHARE               0.4  share of group runs aimed at another
                                           club's border rather than own frontier

SAFETY CAPS
  BOT_MAX_RUNS_PER_TICK               40   hard ceiling of bot runs in one tick
  BOT_MAX_RUNS_PER_HOUR               90   hard ceiling of bot claims in any 60m
  BOT_MAX_PRESSURE_PER_TICK           6    human-targeted runs in one tick
  BOT_MIN_RUN_GAP_H                   5    no bot runs twice inside this gap
  BOT_MAX_LIVE_TERRITORIES            40   a bot holding this many live rows
                                           stops expanding into new ground
  BOT_TICK_MINUTES                    15   the cron interval, so budgets per tick
                                           add up to budgets per hour
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _f(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return float(default)
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number, got {raw!r}") from None


def _pairs(name: str, default: str) -> dict:
    """`a=1,b=2` into {"a": 1.0, "b": 2.0}. Defaults fill any key left out, so
    overriding one weight does not silently zero the rest."""
    out = {}
    for src in (default, os.environ.get(name) or ""):
        for part in src.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = float(v)
    return out


def _windows(name: str, default: str) -> dict:
    """`stage=lo-hi` into {"stage": (lo, hi)} hours."""
    out = {}
    for src in (default, os.environ.get(name) or ""):
        for part in src.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                lo, hi = v.split("-", 1)
                out[k.strip()] = (float(lo), float(hi))
    return out


@dataclass(frozen=True)
class BotSimConfig:
    target_claims_per_hour: float = 30.0
    target_battles_per_hour: float = 12.0
    target_club_events_per_hour: float = 4.0
    activity_scale: float = 1.0

    controller_gain: float = 0.5
    background_floor: float = 0.25
    max_bot_share: float = 1.0

    night_multiplier: float = 0.08
    midday_multiplier: float = 0.35
    late_morning_multiplier: float = 0.55
    late_evening_multiplier: float = 0.40

    region_weights: dict = field(default_factory=lambda: {
        "human_runs": 3.0, "human_claims": 3.0, "human_territory": 2.0,
        "clubs": 1.0, "bots": 2.0, "combat": 1.0, "hotspots": 2.0,
    })
    region_min_share: float = 0.08

    human_daily_interactions: float = 2.0
    human_active_days: float = 7.0
    human_attack_cooldown_h: float = 4.0
    human_max_interactions_per_day: float = 4.0
    human_organic_weight: float = 1.5
    human_pressure_radius_m: float = 8000.0
    human_pressure_fallback_radius_m: float = 15000.0
    reaction_probs: dict = field(default_factory=lambda: {
        "nearby": 0.35, "probe": 0.35, "attack": 0.30, "revenge": 0.50,
    })
    reaction_windows_h: dict = field(default_factory=lambda: {
        "nearby": (0.5, 3.0), "probe": (2.0, 8.0),
        "attack": (6.0, 24.0), "revenge": (24.0, 72.0),
    })

    rival_cooldown_h: float = 8.0
    rival_cooldown_growth: float = 1.5
    rival_cooldown_max_h: float = 36.0
    bot_rival_cooldown_h: float = 3.0
    rival_radius_m: float = 5000.0
    rematch_share: float = 0.55

    hotspot_count: int = 3
    hotspot_multiplier: float = 2.5
    hotspot_radius_m: float = 1800.0
    hotspot_min_h: float = 6.0
    hotspot_max_h: float = 24.0

    club_group_min: int = 2
    club_group_max: int = 4
    club_attack_share: float = 0.4

    max_runs_per_tick: int = 40
    max_runs_per_hour: int = 90
    max_pressure_per_tick: int = 6
    min_run_gap_h: float = 5.0
    max_live_territories: int = 40
    tick_minutes: float = 15.0

    @property
    def tick_hours(self) -> float:
        return self.tick_minutes / 60.0


def load() -> BotSimConfig:
    """The live configuration, read fresh. Called once per tick."""
    d = BotSimConfig()
    return BotSimConfig(
        target_claims_per_hour=_f("BOT_WORLD_TARGET_CLAIMS_PER_HOUR", d.target_claims_per_hour),
        target_battles_per_hour=_f("BOT_WORLD_TARGET_BATTLES_PER_HOUR", d.target_battles_per_hour),
        target_club_events_per_hour=_f("BOT_WORLD_TARGET_CLUB_EVENTS_PER_HOUR",
                                       d.target_club_events_per_hour),
        activity_scale=max(0.0, _f("BOT_ACTIVITY_SCALE", d.activity_scale)),
        controller_gain=_f("BOT_CONTROLLER_GAIN", d.controller_gain),
        background_floor=_f("BOT_BACKGROUND_FLOOR", d.background_floor),
        max_bot_share=_f("BOT_MAX_BOT_SHARE", d.max_bot_share),
        night_multiplier=_f("BOT_NIGHT_MULTIPLIER", d.night_multiplier),
        midday_multiplier=_f("BOT_MIDDAY_MULTIPLIER", d.midday_multiplier),
        late_morning_multiplier=_f("BOT_LATE_MORNING_MULTIPLIER", d.late_morning_multiplier),
        late_evening_multiplier=_f("BOT_LATE_EVENING_MULTIPLIER", d.late_evening_multiplier),
        region_weights=_pairs(
            "BOT_REGION_WEIGHTS",
            "human_runs=3,human_claims=3,human_territory=2,clubs=1,bots=2,combat=1,hotspots=2",
        ),
        region_min_share=_f("BOT_REGION_MIN_SHARE", d.region_min_share),
        human_daily_interactions=_f("BOT_HUMAN_DAILY_INTERACTIONS", d.human_daily_interactions),
        human_active_days=_f("BOT_HUMAN_ACTIVE_DAYS", d.human_active_days),
        human_attack_cooldown_h=_f("BOT_HUMAN_ATTACK_COOLDOWN_H", d.human_attack_cooldown_h),
        human_max_interactions_per_day=_f("BOT_HUMAN_MAX_INTERACTIONS_PER_DAY",
                                          d.human_max_interactions_per_day),
        human_organic_weight=_f("BOT_HUMAN_ORGANIC_WEIGHT", d.human_organic_weight),
        human_pressure_radius_m=_f("BOT_HUMAN_PRESSURE_RADIUS_M", d.human_pressure_radius_m),
        human_pressure_fallback_radius_m=_f("BOT_HUMAN_PRESSURE_FALLBACK_RADIUS_M",
                                            d.human_pressure_fallback_radius_m),
        reaction_probs=_pairs("BOT_REACTION_PROBS",
                              "nearby=0.35,probe=0.35,attack=0.30,revenge=0.50"),
        reaction_windows_h=_windows("BOT_REACTION_WINDOWS_H",
                                    "nearby=0.5-3,probe=2-8,attack=6-24,revenge=24-72"),
        rival_cooldown_h=_f("BOT_RIVAL_COOLDOWN_H", d.rival_cooldown_h),
        rival_cooldown_growth=_f("BOT_RIVAL_COOLDOWN_GROWTH", d.rival_cooldown_growth),
        rival_cooldown_max_h=_f("BOT_RIVAL_COOLDOWN_MAX_H", d.rival_cooldown_max_h),
        bot_rival_cooldown_h=_f("BOT_BOT_RIVAL_COOLDOWN_H", d.bot_rival_cooldown_h),
        rival_radius_m=_f("BOT_RIVAL_RADIUS_M", d.rival_radius_m),
        rematch_share=_f("BOT_REMATCH_SHARE", d.rematch_share),
        hotspot_count=int(_f("BOT_HOTSPOT_COUNT", d.hotspot_count)),
        hotspot_multiplier=_f("BOT_HOTSPOT_MULTIPLIER", d.hotspot_multiplier),
        hotspot_radius_m=_f("BOT_HOTSPOT_RADIUS_M", d.hotspot_radius_m),
        hotspot_min_h=_f("BOT_HOTSPOT_MIN_H", d.hotspot_min_h),
        hotspot_max_h=_f("BOT_HOTSPOT_MAX_H", d.hotspot_max_h),
        club_group_min=int(_f("BOT_CLUB_GROUP_MIN", d.club_group_min)),
        club_group_max=int(_f("BOT_CLUB_GROUP_MAX", d.club_group_max)),
        club_attack_share=_f("BOT_CLUB_ATTACK_SHARE", d.club_attack_share),
        max_runs_per_tick=int(_f("BOT_MAX_RUNS_PER_TICK", d.max_runs_per_tick)),
        max_runs_per_hour=int(_f("BOT_MAX_RUNS_PER_HOUR", d.max_runs_per_hour)),
        max_pressure_per_tick=int(_f("BOT_MAX_PRESSURE_PER_TICK", d.max_pressure_per_tick)),
        min_run_gap_h=_f("BOT_MIN_RUN_GAP_H", d.min_run_gap_h),
        max_live_territories=int(_f("BOT_MAX_LIVE_TERRITORIES", d.max_live_territories)),
        tick_minutes=_f("BOT_TICK_MINUTES", d.tick_minutes),
    )
