"""What a run is worth, and what a claim costs.

One place for every payout formula, because they only make sense against each
other. The rules they encode:

  * An activity has to BE a run before it pays anything. Below the rewarded
    line it earns nothing at all — not reduced rewards, nothing — because a
    flat payout for any finished activity made a 20 m walk the best
    coins-per-minute in the game, and no amount of tuning elsewhere survives
    that.
  * Rewards scale with the run, so 10 km beats 1 km, and are capped daily, so
    ten 1 km runs do not beat one 10 km run.
  * A claim's price depends on what it DOES. Expanding into empty ground is
    cheap, reinforcing your own is cheaper, and storming a defended border
    costs the most.

Everything here is a pure function of values the server already holds, so the
daily caps need no new tables: today's earnings are re-derived from the coin
ledger and the runs table.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy import text

from .config import settings


# Bumped whenever a number in here or in config.Settings changes shape. The
# client mirrors these rules for its live readout (frontend/src/config/
# economy.js) and reports its own version, so a drifting copy is detectable
# rather than silently wrong — which is exactly how the retired circle formula
# survived on the running screen.
ECONOMY_VERSION = 2


# ---------------------------------------------------------------------------
# What counts as a run
# ---------------------------------------------------------------------------

# The four states a finished activity can be in. Named rather than boolean
# because "earned nothing" and "earned rewards but cannot take ground" are
# different things to a runner, and telling them apart is the difference
# between a rule and a bug.
UNQUALIFIED = "unqualified_for_rewards"
REWARDED = "qualified_for_rewards_only"
CLAIMABLE = "qualified_for_claim"
SHADOW_FLAGGED = "shadow_flagged"

# User-facing reasons. Deliberately about what the RUNNER did, never about
# which anti-cheat rule fired — a shadow flag that explains itself is a
# tutorial for beating it, so it reports as an ordinary claim refusal.
REASON_MIN_REWARD_DISTANCE = "Complete at least 500 m to earn run rewards."
REASON_MIN_REWARD_DURATION = "Keep moving for at least 4 minutes to earn run rewards."
REASON_MIN_CLAIM_DISTANCE = "Complete at least 1 km to claim territory."
REASON_MIN_CLAIM_DURATION = "Keep moving for at least 7 minutes to claim territory."
REASON_MIN_UNIQUE = "This route did not contain enough unique movement."
# No longer names a number: the ration is configurable and off by default, so
# "three" was a promise the setting could break silently.
REASON_NEUTRAL_LIMIT = "You have used today's neutral expansions."
REASON_OFF_ROUTE = "Turned too far. This would claim streets you didn't run."
REASON_ALREADY_CLAIMED = "This run has already been used for a claim."


def _meets_reward_bar(distance_m: float, duration_s: float) -> bool:
    return (distance_m or 0.0) >= settings.min_rewarded_distance_m and (
        duration_s or 0.0
    ) >= settings.min_rewarded_duration_s


def _meets_claim_bar(distance_m: float, duration_s: float, unique_length_m: float) -> bool:
    return (
        (distance_m or 0.0) >= settings.min_claim_distance_m
        and (duration_s or 0.0) >= settings.min_claim_duration_s
        and (unique_length_m or 0.0) >= settings.min_unique_route_length_m
    )


def run_tier(
    distance_m: float, duration_s: float, unique_length_m: float, verified: bool = True
) -> str:
    """Which rewards this activity has earned the right to.

    `unique_length_m` is distinct ground covered (geospatial.route_unique_length_m),
    which is what stops laps of a corridor — or a phone on a shaking desk —
    from clearing a pure distance bar.

    A shadow-flagged run reports its own tier so the rest of the economy can
    treat it as the special case it is: it looks normal to its submitter but
    must not pay out, must not take public ground, and — importantly — must
    not consume the day's legitimate territorial entitlement.
    """
    if not _meets_reward_bar(distance_m, duration_s):
        return UNQUALIFIED
    if not verified:
        return SHADOW_FLAGGED
    if _meets_claim_bar(distance_m, duration_s, unique_length_m):
        return CLAIMABLE
    return REWARDED


VERIFIED = "verified"
PENDING = "pending"


def verification_state(tier: str) -> str:
    """A neutral status the runner can be shown.

    A run that reports full success while quietly contributing nothing public
    reads as a server bug, and "your run was fine, honest" is not a message we
    can send about land nobody else will ever see. This says something true and
    non-specific instead.

    It deliberately carries NO information about why: not which detector fired,
    not a threshold, not a mock-location percentage, not the evidence. A flag
    that explains itself is a tutorial for beating it.
    """
    return PENDING if tier == SHADOW_FLAGGED else VERIFIED


def rewards_earned(tier: str) -> bool:
    """Does this tier pay coins, energy and distance XP?"""
    return tier in (REWARDED, CLAIMABLE)


def claim_allowed(tier: str) -> bool:
    """May this run place a claim at all?

    A shadow-flagged run MAY — and must. The whole point of a shadow flag is
    that the submitter sees an ordinary success; a 422 at the claim step would
    tell them exactly which run tripped it and turn the flag into a debugging
    tool for spoofers. What the flag actually costs them is elsewhere: the
    territory is private, it steals nothing, it pays nothing, and (see
    `claim_distance_today`) it consumes none of the day's real entitlement.
    """
    return tier in (CLAIMABLE, SHADOW_FLAGGED)


def consumes_entitlement(tier: str) -> bool:
    """Does this run eat into the day's territorial allowance? Only if real."""
    return tier == CLAIMABLE


def reward_gate_reason(distance_m: float, duration_s: float) -> str | None:
    """Why this activity earned nothing at all, or None if it earned something."""
    if (distance_m or 0.0) < settings.min_rewarded_distance_m:
        return REASON_MIN_REWARD_DISTANCE
    if (duration_s or 0.0) < settings.min_rewarded_duration_s:
        return REASON_MIN_REWARD_DURATION
    return None


def claim_gate_reason(distance_m: float, duration_s: float, unique_length_m: float) -> str | None:
    """Why territory is off the table, or None if it isn't.

    Distinct from `reward_gate_reason` on purpose: an activity that earned XP
    and coins but cannot take ground must not be described as unqualified —
    that reads as "you got nothing" when the runner in fact got most of it.
    """
    if (distance_m or 0.0) < settings.min_claim_distance_m:
        return REASON_MIN_CLAIM_DISTANCE
    if (duration_s or 0.0) < settings.min_claim_duration_s:
        return REASON_MIN_CLAIM_DURATION
    if (unique_length_m or 0.0) < settings.min_unique_route_length_m:
        return REASON_MIN_UNIQUE
    return None


def gate_reason_for(
    tier: str, distance_m: float, duration_s: float, unique_length_m: float
) -> str | None:
    """The one sentence this activity should show, whatever its tier.

    A shadow-flagged run gets the ordinary claim-refusal wording rather than
    anything that hints a flag exists.
    """
    if tier == UNQUALIFIED:
        return reward_gate_reason(distance_m, duration_s)
    if tier == SHADOW_FLAGGED:
        # Only the bars the runner can actually see. A flagged run that met
        # every bar returns NO reason at all, because inventing one would be a
        # tell: the submitter is supposed to see an ordinary result and find
        # out nothing about why their land is invisible to everyone else.
        return claim_gate_reason(distance_m, duration_s, unique_length_m)
    if tier == REWARDED:
        return claim_gate_reason(distance_m, duration_s, unique_length_m)
    return None


# Kept for the previous call shape; new code should use `gate_reason_for`.
def unqualified_reason(distance_m: float, duration_s: float, unique_length_m: float) -> str | None:
    return reward_gate_reason(distance_m, duration_s) or claim_gate_reason(
        distance_m, duration_s, unique_length_m
    )


# ---------------------------------------------------------------------------
# Daily windows
# ---------------------------------------------------------------------------


def day_start_utc(now: datetime | None = None) -> datetime:
    """Midnight of the CURRENT local day, expressed in UTC.

    Everything is stored in UTC, but a UTC day boundary is 8am in Singapore —
    daily allowances would reset in the middle of a morning run.
    """
    now = now or datetime.utcnow()
    offset = timedelta(hours=settings.daily_reset_utc_offset_hours)
    local_midnight = (now + offset).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight - offset


# ---------------------------------------------------------------------------
# Run payouts
# ---------------------------------------------------------------------------


def run_coins(distance_m: float) -> int:
    """Coins a qualifying run pays, before the daily cap."""
    km = max(0.0, distance_m) / 1000.0
    return int(min(
        settings.coins_run_max,
        settings.coins_run_base + math.floor(km * settings.coins_run_per_km),
    ))


def run_energy(distance_m: float) -> int:
    """Energy a qualifying run pays back, before the daily cap."""
    km = max(0.0, distance_m) / 1000.0
    return int(min(settings.energy_run_max, settings.energy_run_base + math.floor(km)))


# ---------------------------------------------------------------------------
# The grant ledger — every payout happens exactly once
# ---------------------------------------------------------------------------

KIND_COINS = "coins"
KIND_ENERGY = "energy"
KIND_RUN_XP = "run_xp"
KIND_CLAIM_XP = "claim_xp"
KIND_NEUTRAL_RANK = "neutral_rank"
# Social XP — PASERBY high fives. Its own kind because it has its own daily
# ceiling and must never be mistaken for XP a run earned.
KIND_SOCIAL_XP = "social_xp"


def grant_key(run_id, kind: str) -> str:
    return f"run:{run_id}:{kind}"


def grant_once(db, user_id, key: str, kind: str, amount: int, run_id=None) -> bool:
    """Reserve a payout under an arbitrary key. True the first time only.

    The key IS the mechanism, so it has to name the thing being paid for — a
    run and a kind for run rewards, an encounter for a high five. Two racing
    requests collide on the primary key and only one of them moves a balance;
    no balance is ever consulted to decide whether a reward already happened.
    """
    res = db.execute(
        text(
            "INSERT INTO reward_grants (key, user_id, run_id, kind, amount) "
            "VALUES (:k, :u, :r, :kind, :a) ON CONFLICT (key) DO NOTHING"
        ),
        {
            "k": key, "u": user_id,
            "r": str(run_id) if run_id else None, "kind": kind, "a": int(amount),
        },
    )
    return res.rowcount > 0


def claim_grant(db, user_id, run_id, kind: str, amount: int) -> bool:
    """Reserve a RUN-derived payout. True the first time, False every time after.

    The key is derived from the run, so a retry, a double-tap or two racing
    requests all collide on it and only one of them proceeds to move a balance.
    Crucially the decision does NOT look at the balance — "they already have 50
    coins" can never distinguish a duplicate grant from a legitimate second run.
    """
    return grant_once(db, user_id, grant_key(run_id, kind), kind, amount, run_id=run_id)


def already_granted(db, run_id, kind: str) -> int | None:
    """The amount a previous grant recorded, or None if it never happened."""
    row = db.execute(
        text("SELECT amount FROM reward_grants WHERE key = :k"),
        {"k": grant_key(run_id, kind)},
    ).fetchone()
    return int(row[0]) if row else None


def granted_today(db, user_id, kind: str) -> int:
    """How much of one kind this user has been granted in the local day.

    Read off the grant ledger rather than replaying runs or trusting a
    counter: the ledger is the same record idempotency is enforced against, so
    the cap and the payout can never disagree about what happened.
    """
    row = db.execute(
        text(
            "SELECT COALESCE(SUM(amount), 0) FROM reward_grants "
            "WHERE user_id = :u AND kind = :k AND created_at >= :since"
        ),
        {"u": user_id, "k": kind, "since": day_start_utc()},
    ).fetchone()
    return int(row[0] or 0)


def award_for_run(db, user_id, run_id, distance_m: float, duration_s: float, tier: str) -> dict:
    """Coins and energy this run should pay, caps applied.

    Returns the amounts AND whether a cap bit, so the client can explain a
    small payout ("daily cap reached") instead of looking broken. This only
    COMPUTES — the caller reserves the grant before moving any balance.
    """
    prior_coins = granted_today(db, user_id, KIND_COINS)
    prior_energy = granted_today(db, user_id, KIND_ENERGY)
    if not rewards_earned(tier):
        return {
            "coins": 0, "energy": 0,
            "coins_capped": False, "energy_capped": False,
            "coins_today": prior_coins, "energy_today": prior_energy,
        }

    want_coins = run_coins(distance_m)
    want_energy = run_energy(distance_m)
    coins = max(0, min(want_coins, settings.coins_daily_run_cap - prior_coins))
    energy = max(0, min(want_energy, settings.energy_daily_run_cap - prior_energy))
    return {
        "coins": coins, "energy": energy,
        "coins_capped": coins < want_coins,
        "energy_capped": energy < want_energy,
        "coins_today": prior_coins + coins,
        "energy_today": prior_energy + energy,
    }


# ---------------------------------------------------------------------------
# The day's territorial entitlement
# ---------------------------------------------------------------------------


def claim_distance_today(db, user_id, exclude_run_id=None) -> float:
    """Metres of claim-qualified running already banked in this game day.

    Only claim-qualified, verified runs count (`runs.claim_distance_m` is 0 or
    null for anything else), so a shadow-flagged or too-short activity can
    never eat into the legitimate entitlement.
    """
    row = db.execute(
        text(
            "SELECT COALESCE(SUM(claim_distance_m), 0) FROM runs "
            "WHERE user_id = :u AND ended_at >= :since "
            "AND (CAST(:skip AS uuid) IS NULL OR id <> CAST(:skip AS uuid))"
        ),
        {
            "u": user_id, "since": day_start_utc(),
            "skip": str(exclude_run_id) if exclude_run_id else None,
        },
    ).fetchone()
    return float(row[0] or 0.0)


def entitled_area_m2(distance_before_m: float, run_distance_m: float) -> float:
    """The land this run adds, as a slice of the DAY's diminishing curve.

    Applying the curve per run meant ten 1 km runs each earned the untapered
    first kilometre — 750,000 m² against the 618,750 one 10 km run gets. The
    curve is a daily entitlement instead, and a run is worth the difference it
    makes to the day's total. Ten 1 km runs and one 10 km run now land within
    rounding of each other.

    Deliberately still tied to THIS run's route: the area is a size, not a
    balance, and it can only be deployed on the ground that earned it.
    """
    # Imported here rather than at module scope: geospatial imports config,
    # and economy is imported by the routes that import both.
    from .geospatial import claim_area_m2

    before = max(0.0, distance_before_m or 0.0)
    after = before + max(0.0, run_distance_m or 0.0)
    return max(0.0, claim_area_m2(after) - claim_area_m2(before))


# ---------------------------------------------------------------------------
# Neutral expansion limit
# ---------------------------------------------------------------------------


def neutral_claims_today(db, user_id) -> int:
    """Successful, verified neutral expansions in this game day.

    Attacks, reinforcements and shadow-flagged claims are all excluded — the
    limit exists to stop the map being painted by volume, not to ration
    fighting or upkeep. Failed claims never get here: `claim_action` is only
    written once the transaction commits.
    """
    row = db.execute(
        text(
            "SELECT COUNT(*) FROM runs "
            "WHERE user_id = :u AND verified AND claimed_at >= :since "
            "AND claim_action = :a"
        ),
        {"u": user_id, "since": day_start_utc(), "a": ACTION_EMPTY},
    ).fetchone()
    return int(row[0] or 0)


def neutral_limit_active() -> bool:
    """Is the neutral-expansion ration switched on at all?

    OFF by default (see `max_neutral_claims_per_game_day` in config). Energy is
    what caps claiming; this was a second, harsher cap on the same decision.

    Every caller that would REFUSE a claim has to ask this first — reading
    `neutral_claims_remaining() <= 0` on its own is not enough, because that
    function reports a full allowance when the rule is off and a caller which
    forgot the check would still be comparing against a number.
    """
    return settings.max_neutral_claims_per_game_day > 0


# What `neutral_claims_remaining` reports when the ration is off. A large
# POSITIVE number rather than 0 or -1 on purpose: the field is on the wire and
# older clients test it for "have I got any left", so both of those would be
# read as "none" and could grey out a button the server is perfectly willing to
# honour. Nothing should display this figure verbatim.
UNLIMITED_NEUTRAL_CLAIMS = 9999


def neutral_claims_remaining(db, user_id) -> int:
    """Neutral expansions left in this game day.

    When the ration is off this is not a count of anything — it reports
    `UNLIMITED_NEUTRAL_CLAIMS` and does not query the database, because there
    is no number for a caller to act on.
    """
    if not neutral_limit_active():
        return UNLIMITED_NEUTRAL_CLAIMS
    return max(0, settings.max_neutral_claims_per_game_day - neutral_claims_today(db, user_id))


# ---------------------------------------------------------------------------
# Daily progression rails
# ---------------------------------------------------------------------------


def claim_xp_allowance(db, user_id) -> int:
    """Claim + steal XP still available today.

    A per-run bound already stops one claim out-earning its run; this stops
    MANY claims out-earning a day of running. Temporary, until rank and XP are
    scored against the opponent rather than flat.
    """
    return max(0, settings.daily_claim_xp_cap - granted_today(db, user_id, KIND_CLAIM_XP))


def neutral_rank_allowance(db, user_id) -> int:
    """Rank points still available today from NEUTRAL claims.

    Taking ground off a rival and defending your own are uncapped — those are
    contested outcomes. Only quiet expansion is rationed, because it is the
    one a player can repeat at will.
    """
    return max(
        0, settings.daily_neutral_claim_rank_cap - granted_today(db, user_id, KIND_NEUTRAL_RANK)
    )


# ---------------------------------------------------------------------------
# Claim cost
# ---------------------------------------------------------------------------

ACTION_EMPTY = "empty"
ACTION_REINFORCE = "reinforce"
ACTION_ATTACK = "attack"
ACTION_FORTIFIED = "fortified"

_ACTION_COST = {
    ACTION_EMPTY: "energy_cost_claim_empty",
    ACTION_REINFORCE: "energy_cost_claim_reinforce",
    ACTION_ATTACK: "energy_cost_claim_attack",
    ACTION_FORTIFIED: "energy_cost_claim_fortified",
}

# Below this share of the claim, a rival's presence is an edge clip rather than
# a battle, and must not push the price up to "attack".
_CONTEST_FRAC = 0.02
_CONTEST_MIN_M2 = 1000.0


def claim_action(area_m2: float, enemy_m2: float, defended_m2: float, mine_m2: float) -> str:
    """What this placement is really doing, which is what it is priced on."""
    contested = (enemy_m2 or 0.0) + (defended_m2 or 0.0)
    floor = max(_CONTEST_MIN_M2, (area_m2 or 0.0) * _CONTEST_FRAC)
    if contested >= floor:
        # More of it holds than falls → this is storming a defended border.
        return ACTION_FORTIFIED if (defended_m2 or 0) > (enemy_m2 or 0) else ACTION_ATTACK
    if (mine_m2 or 0.0) >= (area_m2 or 0.0) * 0.5:
        return ACTION_REINFORCE
    return ACTION_EMPTY


def claims_today(db, user_id) -> int:
    row = db.execute(
        text("SELECT COUNT(*) FROM runs WHERE user_id = :u AND claimed_at >= :since"),
        {"u": user_id, "since": day_start_utc()},
    ).fetchone()
    return int(row[0] or 0)


def claim_cost(action: str, first_of_day: bool) -> int:
    """Energy for a claim of this kind. The first each day is half price, so
    anyone who actually went for a run can reliably do something with it."""
    base = getattr(settings, _ACTION_COST.get(action, ""), None) or settings.energy_cost_claim
    if first_of_day:
        return max(1, int(round(base * (1.0 - settings.energy_first_claim_discount))))
    return int(base)
