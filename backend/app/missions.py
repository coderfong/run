"""Daily missions — four things to do today, and a box for doing all four.

THERE IS NO PROGRESS TABLE, AND THAT IS THE DESIGN.

The obvious build is a counter per mission per day, bumped from every write
path that could advance one. It means touching `end-run`, the claim path, the
steal loop and the high five endpoint, and every one of those bumps is a place
progress can be missed, double counted, or left behind when a mission's
definition changes. A player who ran 5 km while the counter was broken has no
way to get that back.

So progress is DERIVED, every time it is asked for, from the tables the game
already writes for its own reasons: `runs`, `territory_steals`, `rank_events`,
`coin_ledger`. A mission is a query over today's window, nothing more. Nothing
to instrument, nothing to backfill, nothing to drift — fix a mission's SQL and
yesterday's answer is right too. The only thing persisted is which missions
have been COLLECTED, because a payout is the one fact that cannot be re-derived
from play.

THE DAY IS THE ECONOMY'S DAY. `economy.day_start_utc` already decides when
daily caps roll over, and missions resetting at a different hour than the coin
cap they pay into would be indefensible. Both come from the one offset.

THE SET IS DETERMINISTIC, NOT STORED. Which four missions today holds is
seeded from (user, date), so the server can answer for any day — including a
day already past — without a row saying what that day's missions were. That is
what lets the week strip show an honest verdict on Monday when you open it on
Friday.

Pure data + SQL helpers. Route handlers own their transactions.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta

from sqlalchemy import text

from .economy import day_start_utc

# How many missions a day holds, and what finishing all of them is worth.
MISSIONS_PER_DAY = 4
# The all-four bonus is a BOX, not coins. Coins are what the individual
# missions already pay, and a bonus in the same currency is just a fifth
# mission with a bigger number on it. A box is a different kind of thing, and
# it routes into the gamble (see app/lootbox.py), which is the reward this
# whole screen is really building toward.
DAY_BONUS_RARITY = "rare"
# Reserved mission id for the all-four bonus, so the claims table needs no
# second shape. Cannot collide: every real id in CATALOGUE is checked below.
DAY_BONUS_ID = "day_bonus"


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
# `metric` names the derivation in `_METRIC_SQL`. `goal` is in the metric's own
# unit (metres, seconds, or a count). `text` is what the card says, and follows
# the house copy rule: no dashes anywhere in player facing text.
#
# Tiers exist so a day is not four errands of the same size. Each day draws one
# mission from each of four BANDS, which is what stops a roll producing four
# 10 km runs or four things you finish by opening the app.
CATALOGUE = [
    # --- band 0: opening the app and moving at all ---------------------
    {"id": "run_once", "band": 0, "metric": "runs", "goal": 1,
     "text": "Finish a run", "reward": 120},
    {"id": "distance_2k", "band": 0, "metric": "distance", "goal": 2000,
     "text": "Run 2 km", "reward": 150},
    {"id": "minutes_15", "band": 0, "metric": "duration", "goal": 15 * 60,
     "text": "Run for 15 minutes", "reward": 150},
    {"id": "claim_once", "band": 0, "metric": "claims", "goal": 1,
     "text": "Claim territory once", "reward": 140},

    # --- band 1: a real session ---------------------------------------
    {"id": "distance_5k", "band": 1, "metric": "distance", "goal": 5000,
     "text": "Run 5 km", "reward": 300},
    {"id": "minutes_30", "band": 1, "metric": "duration", "goal": 30 * 60,
     "text": "Run for 30 minutes", "reward": 300},
    {"id": "run_twice", "band": 1, "metric": "runs", "goal": 2,
     "text": "Finish 2 runs", "reward": 320},
    {"id": "claim_twice", "band": 1, "metric": "claims", "goal": 2,
     "text": "Claim territory twice", "reward": 300},

    # --- band 2: territorial, so the day involves the map --------------
    {"id": "steal_once", "band": 2, "metric": "steals", "goal": 1,
     "text": "Take ground from a rival", "reward": 400},
    {"id": "steal_area", "band": 2, "metric": "steal_area", "goal": 20_000,
     "text": "Take 20,000 m2 off rivals", "reward": 450},
    {"id": "defend_once", "band": 2, "metric": "defends", "goal": 1,
     "text": "Hold your ground against an attack", "reward": 400},
    {"id": "rank_60", "band": 2, "metric": "rank_points", "goal": 60,
     "text": "Earn 60 rank points", "reward": 380},

    # --- band 3: the long one ------------------------------------------
    {"id": "distance_10k", "band": 3, "metric": "distance", "goal": 10_000,
     "text": "Run 10 km", "reward": 650},
    {"id": "rank_150", "band": 3, "metric": "rank_points", "goal": 150,
     "text": "Earn 150 rank points", "reward": 600},
    {"id": "coins_400", "band": 3, "metric": "coins", "goal": 400,
     "text": "Earn 400 coins", "reward": 500},
    {"id": "steal_big", "band": 3, "metric": "steals", "goal": 3,
     "text": "Take ground from 3 rivals", "reward": 700},
]

BY_ID = {m["id"]: m for m in CATALOGUE}
BANDS = sorted({m["band"] for m in CATALOGUE})
assert DAY_BONUS_ID not in BY_ID, "day bonus id collides with a real mission"
assert len(BANDS) == MISSIONS_PER_DAY, "one mission is drawn per band"


# ---------------------------------------------------------------------------
# Which missions a given day holds
# ---------------------------------------------------------------------------
def local_day(now: datetime | None = None) -> date:
    """The player facing date, on the economy's day boundary.

    `day_start_utc` returns the UTC instant local midnight fell at; shifting it
    back by the offset recovers the local calendar date, which is what the week
    strip labels its circles with.
    """
    from .config import settings
    start = day_start_utc(now)
    return (start + timedelta(hours=settings.daily_reset_utc_offset_hours)).date()


def day_window(day: date) -> tuple[datetime, datetime]:
    """The half open UTC range ``[start, end)`` covering one local day."""
    from .config import settings
    offset = timedelta(hours=settings.daily_reset_utc_offset_hours)
    start = datetime(day.year, day.month, day.day) - offset
    return start, start + timedelta(days=1)


def missions_for(user_id, day: date) -> list[dict]:
    """The four missions this account holds on this date.

    Seeded from the user and the date, so it is stable for that player on that
    day and different from their neighbour's — and answerable for any date
    without having stored a thing.
    """
    rng = random.Random(f"{user_id}:{day.isoformat()}")
    out = []
    for band in BANDS:
        pool = sorted((m for m in CATALOGUE if m["band"] == band), key=lambda m: m["id"])
        out.append(rng.choice(pool))
    return out


# ---------------------------------------------------------------------------
# Progress, derived
# ---------------------------------------------------------------------------
# HOW A METRIC IS DERIVED, AND WHY IT IS BUCKETED BY DAY.
#
# Each entry names the table, the timestamp that decides which day a row falls
# in, the aggregate, and any extra condition. They are assembled below into ONE
# query per metric that returns a row per local day across a whole range.
#
# The naive shape — one query per metric per day — is what this replaced. The
# missions screen shows a week strip, so answering it that way meant four
# aggregates times seven days plus seven claim reads: thirty nine round trips
# for one screen, on a backend that spins down between visits. Grouping by day
# makes it one query per distinct metric for the entire week, plus one for the
# claims. Same numbers, about a tenth of the work.
#
# THE BUCKET IS THE ECONOMY'S DAY, not a UTC date. `DAY_BUCKET` shifts a
# timestamp by the same offset `economy.day_start_utc` uses before taking its
# date, so a run at 1am local counts for the day it felt like.
#
# Runs are filtered on `verified`: a flagged run looks normal to its submitter
# everywhere else in the app, and a mission is not the place to start telling
# them otherwise, but it must not pay out either.

def _bucket(column: str) -> str:
    from .config import settings
    hours = settings.daily_reset_utc_offset_hours
    return f"(({column} + INTERVAL '{hours} hours')::date)"


# metric -> (table, time column, aggregate expression, extra WHERE, owner column)
_METRICS = {
    "runs": ("runs", "ended_at", "COUNT(*)", "verified", "user_id"),
    "distance": ("runs", "ended_at", "COALESCE(SUM(distance_m), 0)", "verified", "user_id"),
    "duration": ("runs", "ended_at", "COALESCE(SUM(duration_s), 0)", "verified", "user_id"),
    "claims": ("runs", "claimed_at", "COUNT(*)", "verified", "user_id"),
    # A steal is one row per (claim, victim) pair, so "3 rivals" counts
    # distinct victims rather than rows — three bites out of one runner is one
    # rival, and the copy says rivals.
    "steals": ("territory_steals", "created_at", "COUNT(DISTINCT victim_id)",
               "NOT defended", "attacker_id"),
    "steal_area": ("territory_steals", "created_at", "COALESCE(SUM(area_m2), 0)",
                   "NOT defended", "attacker_id"),
    "defends": ("territory_steals", "created_at", "COUNT(*)", "defended", "victim_id"),
    # Gains only. A day spent being raided must not be able to run a mission
    # backwards, and a bar that retreats while you watch is the worst thing
    # this screen could do.
    "rank_points": ("rank_events", "created_at", "COALESCE(SUM(delta), 0)",
                    "delta > 0", "user_id"),
    # Earnings, not the balance: `delta` is signed and a shop purchase is a
    # negative row, so summing everything would let buying a hat undo a
    # mission. Matches how `economy.py` reads the same ledger for daily caps.
    "coins": ("coin_ledger", "created_at", "COALESCE(SUM(delta), 0)", "delta > 0", "user_id"),
}


def _metric_sql(metric: str) -> str | None:
    spec = _METRICS.get(metric)
    if not spec:
        return None
    table, tcol, agg, extra, owner = spec
    bucket = _bucket(tcol)
    return f"""
        SELECT {bucket} AS day, {agg}
          FROM {table}
         WHERE {owner} = :u AND {extra}
           AND {tcol} >= :start AND {tcol} < :end
         GROUP BY 1
    """


def progress_over(db, user_id, days, metrics) -> dict:
    """Evaluate the named metrics for each of `days`. One query per metric.

    Returns ``{date: {metric: value}}``, with every requested day present and
    every requested metric filled in — a day with no rows reads as zero rather
    than as missing, so callers never branch on absence.
    """
    days = sorted(set(days))
    out = {d: {m: 0.0 for m in metrics} for d in days}
    if not days or not metrics:
        return out
    # One window spanning the whole range, so the index on (owner, timestamp)
    # is used once instead of seven times.
    start, _ = day_window(days[0])
    _, end = day_window(days[-1])
    params = {"u": user_id, "start": start, "end": end}
    wanted = set(days)

    for metric in sorted(set(metrics)):
        sql = _metric_sql(metric)
        if sql is None:
            continue
        for row in db.execute(text(sql), params).fetchall():
            day = row[0]
            if day in wanted:
                out[day][metric] = float(row[1] or 0)
    return out


def progress_for(db, user_id, day: date, metrics) -> dict:
    """One day's metrics. The single day case of :func:`progress_over`."""
    return progress_over(db, user_id, [day], metrics)[day]


def claimed_ids(db, user_id, days) -> dict:
    """Mission ids already collected, per day, the day bonus included.

    Takes a LIST of days and answers for all of them in one read, because the
    week strip needs seven and asking seven times was most of what made this
    endpoint expensive.
    """
    days = sorted(set(days))
    out = {d: set() for d in days}
    if not days:
        return out
    rows = db.execute(
        text("SELECT day, mission_id FROM mission_claims "
             "WHERE user_id = :u AND day >= :a AND day <= :b"),
        {"u": user_id, "a": days[0], "b": days[-1]},
    ).fetchall()
    for day, mission_id in rows:
        if day in out:
            out[day].add(mission_id)
    return out


def _resolve(day: date, picks, values, claimed) -> dict:
    """Assemble one day's card from data already fetched. No queries."""
    items = []
    for m in picks:
        value = values.get(m["metric"], 0.0)
        done = value >= m["goal"]
        items.append({
            "id": m["id"],
            "text": m["text"],
            "metric": m["metric"],
            "goal": m["goal"],
            "value": min(value, m["goal"]),
            "progress": min(1.0, value / m["goal"]) if m["goal"] else 1.0,
            "complete": done,
            "claimed": m["id"] in claimed,
            "reward": m["reward"],
        })
    complete = sum(1 for i in items if i["complete"])
    return {
        "day": day.isoformat(),
        "missions": items,
        "complete_count": complete,
        "total": len(items),
        "all_complete": complete == len(items),
        "bonus_claimed": DAY_BONUS_ID in claimed,
        "bonus_rarity": DAY_BONUS_RARITY,
    }


def day_states(db, user_id, days) -> dict:
    """Resolve several days at once. ``{date: state}``.

    Two batched reads for the whole set — one per distinct metric across every
    day, and one for the claims — instead of five per day. `complete` means
    every mission's goal is met, which is deliberately independent of whether
    the rewards were collected: the day bonus is earned by DOING the four
    things, and stays claimable afterwards.
    """
    days = sorted(set(days))
    picks = {d: missions_for(user_id, d) for d in days}
    metrics = {m["metric"] for d in days for m in picks[d]}
    values = progress_over(db, user_id, days, metrics)
    claims = claimed_ids(db, user_id, days)
    return {d: _resolve(d, picks[d], values[d], claims[d]) for d in days}


def day_state(db, user_id, day: date) -> dict:
    """One day, fully resolved: its missions, their progress, what is claimed."""
    return day_states(db, user_id, [day])[day]


def week_days(today: date) -> list[date]:
    """The seven dates of the week `today` falls in, Monday first.

    A fixed week rather than a rolling seven days: the strip labels its
    circles Mon..Sun, and a rolling window would put Wednesday in a different
    slot every day.
    """
    monday = today - timedelta(days=today.weekday())
    return [monday + timedelta(days=i) for i in range(7)]


def week_summary(db, user_id, today: date) -> list[dict]:
    """A verdict per day of this week, for the strip across the top.

    Future days report nothing beyond being locked — there is no progress to
    derive and no reason to look for any.
    """
    past = [d for d in week_days(today) if d <= today]
    states = day_states(db, user_id, past)
    out = []
    for day in week_days(today):
        if day > today:
            out.append({"day": day.isoformat(), "locked": True, "complete_count": 0,
                        "total": MISSIONS_PER_DAY, "all_complete": False,
                        "bonus_claimed": False})
            continue
        state = states[day]
        out.append({
            "day": state["day"],
            "locked": False,
            "complete_count": state["complete_count"],
            "total": state["total"],
            "all_complete": state["all_complete"],
            "bonus_claimed": state["bonus_claimed"],
        })
    return out
