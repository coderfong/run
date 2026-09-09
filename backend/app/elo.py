"""Area-weighted solo ratings and zero-sum club Elo ratings.

One claim can touch several territory rows owned by the same rival.  That is
still one encounter, not several rating opportunities, so events are grouped
by opponent and scored by the share of contested area the attacker actually
took.  Club results are grouped once more by opposing club for the same
reason: hitting three members of one club in a single claim is one club match.

The helpers at the top are pure and deliberately small enough to test without
a database.  ``record_claim_matches`` owns the locked, transactional writes;
its caller owns the commit so Elo lands atomically with the territory change.
"""

from __future__ import annotations

import math
from collections import defaultdict

from sqlalchemy import text


INITIAL_RATING = 1000
MIN_RATING = 100
K_FACTOR = 32
MIN_MATCH_AREA_M2 = 25.0

# ---------------------------------------------------------------------------
# What each outcome is worth
# ---------------------------------------------------------------------------
#
# The scoring underneath is unchanged: `rating_delta` is still Elo, so the
# rating gap still decides how much an encounter was worth and beating someone
# above you still pays more than beating someone below. What sits on top of it
# is deliberately NOT symmetric any more, because a ladder that pays the same
# for every kind of outcome cannot say which of them the game is about:
#
#   losing ground   > taking ground   > holding ground off an attacker
#                                     > painting empty map
#
# Taking land is the act the whole game is built around, so it pays the most
# of anything you can go out and do. A successful defence pays real points but
# less than an attack, because the defender did not choose the fight and the
# ground was already theirs. Losing land is the heaviest single move on the
# board: it is the only one that can be done TO you, and it is what stops the
# ladder from being a slower level.
#
# THIS IS NO LONGER ZERO SUM, which the old engine deliberately was. A steal
# now costs the victim more than it pays the attacker, so PvP drains rating
# from the pool overall, and open claims trickle a little back in. That is a
# real change of character: tier floors are absolute, so a deflationary ladder
# makes the climb harder over a season rather than everybody drifting up.
# `WEIGHT_STEAL` against `WEIGHT_LOSS` is the dial for it.
WEIGHT_STEAL = 0.75    # you took ground off somebody
WEIGHT_DEFEND = 0.50   # their attack bounced off your land
WEIGHT_FAILED = 0.50   # your attack bounced (the mirror of DEFEND: that pair
                       # stays zero sum, so a bounced raid moves nothing net)
WEIGHT_LOSS = 1.00     # they took ground off you

# The most any single outcome can move, so a help screen can state a range and
# be telling the truth. K_FACTOR is still the ceiling of the fight itself; the
# weights scale it, and the caps are what the app shows.
CAP_STEAL = int(round(K_FACTOR * WEIGHT_STEAL))    # 24
CAP_DEFEND = int(round(K_FACTOR * WEIGHT_DEFEND))  # 16
CAP_LOSS = int(round(K_FACTOR * WEIGHT_LOSS))      # 32
CAP_CLAIM_OPEN = 4                                 # the smallest move on the board
CAP_DECAY = 8                                      # land lost to the clock, not to a rival

# How much ground was involved, not just who won it. `rating_delta` scores the
# SHARE of the contested area an attacker took, which says nothing about
# whether the fight was over a car park or half a suburb. This scales the
# result by the absolute size, on a square root so that ten times the ground is
# worth about three times the points rather than ten.
#
# Two references because the two things are different sizes: a fight is over
# the overlap between two claims, while an open claim (and the plot that later
# decays) is a whole run's worth of ground — 75 m² per territorial metre, so a
# 2.5 km run is about 200,000 m².
AREA_REF_FIGHT_M2 = 50_000.0
AREA_REF_CLAIM_M2 = 200_000.0
AREA_FACTOR_MIN = 0.4
AREA_FACTOR_MAX = 1.5

# What an open claim pays and what decay costs, before the area scale. Both are
# small on purpose: neither is a fight.
CLAIM_OPEN_BASE = 3
DECAY_BASE = 5

# Keys deliberately match the portrait-border assets already used by the app.
# A new runner starts in Wood, close enough to Bronze that the first few real
# matchups visibly move the bar.
ELO_TIERS = [
    (800, "wood", "Wood"),
    (1050, "bronze", "Bronze"),
    (1200, "silver", "Silver"),
    (1350, "gold", "Gold"),
    (1500, "platinum", "Platinum"),
    (1650, "diamond", "Diamond"),
    (1800, "onyx", "Onyx"),
    (1950, "ember", "Ember"),
    (2150, "prismatic", "Prismatic"),
    (2400, "mythic", "Mythic"),
]


def expected_score(rating: int, opponent_rating: int) -> float:
    """Standard Elo expected score on the 400-point scale."""
    exponent = max(-16.0, min(16.0, (int(opponent_rating) - int(rating)) / 400.0))
    return 1.0 / (1.0 + 10.0 ** exponent)


def rating_delta(rating: int, opponent_rating: int, score: float) -> int:
    """The first competitor's zero-sum change for a score in ``[0, 1]``."""
    score = max(0.0, min(1.0, float(score)))
    expected = expected_score(rating, opponent_rating)
    raw = K_FACTOR * (score - expected)
    # Round halves away from zero. Python's banker rounding makes equivalent
    # matchups occasionally feel different solely because a value is even.
    delta = math.floor(raw + 0.5) if raw >= 0 else math.ceil(raw - 0.5)
    if delta == 0 and score != expected:
        delta = 1 if raw > 0 else -1

    # Preserve zero-sum at the rating floor: if the losing side cannot pay the
    # whole change, the winner cannot receive points created from nowhere.
    lower = MIN_RATING - int(rating)
    upper = int(opponent_rating) - MIN_RATING
    return int(max(lower, min(upper, delta)))


def area_factor(area_m2: float, reference: float = AREA_REF_FIGHT_M2) -> float:
    """How much the SIZE of the ground scales a result, square rooted."""
    area = max(0.0, float(area_m2 or 0.0))
    if area <= 0:
        return AREA_FACTOR_MIN
    return max(AREA_FACTOR_MIN, min(AREA_FACTOR_MAX, math.sqrt(area / max(1.0, reference))))


def _scaled(base: int, weight: float, cap: int, area_m2: float) -> int:
    """One side's move: the Elo swing, weighted by role and by ground."""
    value = abs(int(base)) * float(weight) * area_factor(area_m2)
    out = int(math.floor(value + 0.5))
    if base and out == 0:
        out = 1  # a fight that scored at all is never worth nothing
    return min(cap, out)


def steal_gain(base: int, area_m2: float) -> int:
    """Points the attacker wins for taking ground."""
    return _scaled(base, WEIGHT_STEAL, CAP_STEAL, area_m2)


def loss_penalty(base: int, area_m2: float) -> int:
    """Points the victim pays for ground taken off them (positive)."""
    return _scaled(base, WEIGHT_LOSS, CAP_LOSS, area_m2)


def defend_gain(base: int, area_m2: float) -> int:
    """Points the defender wins when an attack bounces."""
    return _scaled(base, WEIGHT_DEFEND, CAP_DEFEND, area_m2)


def failed_attack_penalty(base: int, area_m2: float) -> int:
    """Points the attacker pays for a raid that bounced (positive).

    The mirror of `defend_gain`, so that exchange stays zero sum.
    """
    return _scaled(base, WEIGHT_FAILED, CAP_DEFEND, area_m2)


def open_claim_reward(area_m2: float) -> int:
    """Points for painting ground nobody held. The smallest move there is."""
    if not area_m2 or area_m2 < MIN_MATCH_AREA_M2:
        return 0
    scale = area_factor(area_m2, AREA_REF_CLAIM_M2)
    return max(1, min(CAP_CLAIM_OPEN, int(math.floor(CLAIM_OPEN_BASE * scale + 0.5))))


def decay_penalty(area_m2: float) -> int:
    """Points for land that expired under you (positive).

    Losing ground to the clock has to cost something — an empire that shrinks
    while you sit still is not the same standing as one that holds — but far
    less than losing it to a runner, which is a fight you were in and lost.
    """
    if not area_m2 or area_m2 < MIN_MATCH_AREA_M2:
        return 0
    scale = area_factor(area_m2, AREA_REF_CLAIM_M2)
    return max(1, min(CAP_DECAY, int(math.floor(DECAY_BASE * scale + 0.5))))


def apply_land_delta(db, user_id, delta: int) -> int:
    """Apply a non-combat change atomically without changing match counts."""
    return db.execute(text(
        "UPDATE users SET solo_elo=GREATEST(:floor, solo_elo+:delta), "
        "solo_elo_peak=GREATEST(solo_elo_peak, solo_elo+:delta) "
        "WHERE id=CAST(:id AS uuid) RETURNING solo_elo"
    ), {"id": str(user_id), "delta": delta, "floor": MIN_RATING}).scalar()


def record_expired_land(db, rows):
    """Charge only deleted rows, once, aggregated by owner per sweep."""
    areas = defaultdict(float)
    for uid, area in rows:
        areas[str(uid)] += float(area or 0)
    for uid in sorted(areas):
        apply_land_delta(db, uid, -decay_penalty(areas[uid]))


def tier_for_rating(rating: int) -> dict:
    """Tier and progress to the next tier for a live Elo rating."""
    value = max(MIN_RATING, int(rating or INITIAL_RATING))
    idx = 0
    for i, (floor, _key, _label) in enumerate(ELO_TIERS):
        if value >= floor:
            idx = i
    floor, key, label = ELO_TIERS[idx]
    nxt = ELO_TIERS[idx + 1] if idx + 1 < len(ELO_TIERS) else None
    progress = 1.0 if not nxt else min(1.0, max(0.0, (value - floor) / (nxt[0] - floor)))
    return {
        "rating": value,
        "key": key,
        "label": label,
        "tier": idx,
        "floor": floor,
        "next_rating": nxt[0] if nxt else None,
        "next_label": nxt[2] if nxt else None,
        "points_to_next": max(0, nxt[0] - value) if nxt else 0,
        "progress": progress,
    }


def tier_bounds(tier: int) -> tuple[int, int | None]:
    idx = max(0, min(len(ELO_TIERS) - 1, int(tier)))
    # Ratings below the display floor are still Wood and must remain visible
    # on the Wood map board.
    floor = MIN_RATING if idx == 0 else ELO_TIERS[idx][0]
    ceiling = ELO_TIERS[idx + 1][0] if idx + 1 < len(ELO_TIERS) else None
    return floor, ceiling


def rating_for_tier(tier: int, progress: float = 0.25) -> int:
    """A deterministic seed inside a tier, used only for simulated players."""
    idx = max(0, min(len(ELO_TIERS) - 1, int(tier)))
    floor = ELO_TIERS[idx][0]
    ceiling = ELO_TIERS[idx + 1][0] if idx + 1 < len(ELO_TIERS) else floor + 250
    return int(round(floor + (ceiling - floor) * max(0.0, min(1.0, progress))))


def rating_sql(alias: str = "u") -> str:
    if not alias.replace("_", "").isalnum():
        raise ValueError("Elo SQL alias must be an identifier")
    return f"COALESCE({alias}.solo_elo, {INITIAL_RATING})"


RATING_SQL = rating_sql()


def club_rating_sql(alias: str = "c") -> str:
    """The same expression for a CLUB's rating, over a `clans` alias.

    Clubs carry their own zero-sum rating on `clans.elo_rating`, moved by the
    club half of `record_claim_matches`. It needs its own accessor because the
    club board scopes by the CLUB's tier, not by the tier of whichever member
    happens to own a given plot — see `/map-polygons`'s `board` parameter.
    Without it the clubs view was the only board in the app with no rank scope
    at all, so every club in the world landed on one map.
    """
    if not alias.replace("_", "").isalnum():
        raise ValueError("Elo SQL alias must be an identifier")
    return f"COALESCE({alias}.elo_rating, {INITIAL_RATING})"


CLUB_RATING_SQL = club_rating_sql()
# Two columns keep existing avatar-list SELECT layouts stable while call sites
# migrate from the old points + timestamp pair to Elo.
SELECT_COLS = f"{RATING_SQL}, NULL::timestamp"


def key_for(rating, _unused=None) -> str:
    return tier_for_rating(int(rating or INITIAL_RATING))["key"]


def _status(row) -> dict:
    if not row:
        row = (INITIAL_RATING, INITIAL_RATING, 0, 0, 0, 0)
    out = tier_for_rating(int(row[0] or INITIAL_RATING))
    peak = max(int(row[1] or INITIAL_RATING), out["rating"])
    out.update(
        peak=peak,
        peak_key=tier_for_rating(peak)["key"],
        matches=int(row[2] or 0),
        wins=int(row[3] or 0),
        losses=int(row[4] or 0),
        draws=int(row[5] or 0),
        # Compatibility names for the already-shipped progression UI. New
        # clients read the explicit Elo names from the same object.
        points=out["rating"],
        next_points=out["next_rating"],
        best_key=tier_for_rating(peak)["key"],
        best_label=tier_for_rating(peak)["label"],
        decayed=False,
    )
    return out


def solo_status(db, user_id) -> dict:
    row = db.execute(
        text(
            "SELECT COALESCE(solo_elo, :initial), COALESCE(solo_elo_peak, :initial), "
            "COALESCE(solo_elo_matches,0), COALESCE(solo_elo_wins,0), "
            "COALESCE(solo_elo_losses,0), COALESCE(solo_elo_draws,0) "
            "FROM users WHERE id = :id"
        ),
        {"id": user_id, "initial": INITIAL_RATING},
    ).fetchone()
    return _status(row)


def club_status(db, clan_id) -> dict:
    row = db.execute(
        text(
            "SELECT COALESCE(elo_rating, :initial), COALESCE(elo_peak, :initial), "
            "COALESCE(elo_matches,0), COALESCE(elo_wins,0), "
            "COALESCE(elo_losses,0), COALESCE(elo_draws,0) "
            "FROM clans WHERE id = :id"
        ),
        {"id": clan_id, "initial": INITIAL_RATING},
    ).fetchone()
    return _status(row)


def _outcome_counts(score: float) -> tuple[int, int, int, int, int, int]:
    if score > 0.5:
        return (1, 0, 0, 0, 1, 0)
    if score < 0.5:
        return (0, 1, 0, 1, 0, 0)
    return (0, 0, 1, 0, 0, 1)


def _group_by_opponent(events) -> dict[str, dict[str, float]]:
    grouped = defaultdict(lambda: {"won": 0.0, "total": 0.0})
    for event in events or []:
        area = float(event.get("area_m2") or 0)
        victim_id = str(event.get("victim_id") or "")
        if not victim_id or area < MIN_MATCH_AREA_M2:
            continue
        grouped[victim_id]["total"] += area
        if not event.get("defended"):
            grouped[victim_id]["won"] += area
    return dict(grouped)


def record_claim_matches(db, attacker_id, run_id, events, attacker_clan_id=None,
                         club_match: bool = True) -> dict:
    """Apply one claim's solo and club Elo matches; caller commits.

    Returns the attacker's aggregate movement and final ratings for immediate
    claim feedback. A player facing several rivals can gain and lose rating in
    the same claim, hence aggregate deltas rather than a win-only number.

    `club_match=False` plays the solo half only. A claim off a run the club did
    not do together is not the club's fight: it wins the club no land (see
    app/club_runs.py), so it must not move the club's rating either, or the
    ladder the club board is scoped by would be measuring something that is
    not on it. The attacker's own rating always moves — they still ran.
    """
    grouped = _group_by_opponent(events)
    if not grouped:
        solo = solo_status(db, attacker_id)
        club = club_status(db, attacker_clan_id) if attacker_clan_id else None
        return {
            "solo_rating": solo["rating"], "solo_delta": 0,
            "club_rating": club["rating"] if club else None, "club_delta": 0,
        }

    ids = sorted({str(attacker_id), *grouped.keys()})
    rows = db.execute(
        text(
            "SELECT id::text, clan_id::text, COALESCE(solo_elo, :initial) "
            "FROM users WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id FOR UPDATE"
        ),
        {"ids": ids, "initial": INITIAL_RATING},
    ).fetchall()
    people = {r[0]: {"clan_id": r[1], "rating": int(r[2])} for r in rows}
    attacker_key = str(attacker_id)
    if attacker_key not in people:
        return {"solo_rating": INITIAL_RATING, "solo_delta": 0, "club_rating": None, "club_delta": 0}

    solo_delta_total = 0
    for victim_id in sorted(grouped):
        if victim_id not in people:
            continue
        score = grouped[victim_id]["won"] / max(1.0, grouped[victim_id]["total"])
        before_a = people[attacker_key]["rating"]
        before_b = people[victim_id]["rating"]
        # The Elo swing for the encounter, then each side's own price for it.
        # The two are no longer the same number: see the weights at the top of
        # this module. Ground taken is what the fight was over, so it is what
        # the size scales by.
        base = rating_delta(before_a, before_b, score)
        contested = grouped[victim_id]["total"]
        if base > 0:
            delta = steal_gain(base, grouped[victim_id]["won"])
            victim_delta = -loss_penalty(base, grouped[victim_id]["won"])
        elif base < 0:
            delta = -failed_attack_penalty(base, contested)
            victim_delta = defend_gain(base, contested)
        else:
            delta = victim_delta = 0
        # Each side independently respects the rating floor.
        delta = max(delta, MIN_RATING - before_a)
        victim_delta = max(victim_delta, MIN_RATING - before_b)
        after_a, after_b = before_a + delta, before_b + victim_delta
        people[attacker_key]["rating"] = after_a
        people[victim_id]["rating"] = after_b
        solo_delta_total += delta
        aw, al, ad, bw, bl, bd = _outcome_counts(score)
        for uid, rating, wins, losses, draws in (
            (attacker_key, after_a, aw, al, ad),
            (victim_id, after_b, bw, bl, bd),
        ):
            db.execute(
                text(
                    "UPDATE users SET solo_elo=:rating, solo_elo_peak=GREATEST(solo_elo_peak,:rating), "
                    "solo_elo_matches=solo_elo_matches+1, solo_elo_wins=solo_elo_wins+:wins, "
                    "solo_elo_losses=solo_elo_losses+:losses, solo_elo_draws=solo_elo_draws+:draws "
                    "WHERE id=CAST(:id AS uuid)"
                ),
                {"id": uid, "rating": rating, "wins": wins, "losses": losses, "draws": draws},
            )
        db.execute(
            text(
                "INSERT INTO elo_events (run_id, scope, user_a_id, user_b_id, score_a, delta_a, "
                "rating_a_before, rating_b_before, rating_a_after, rating_b_after) "
                "VALUES (:run, 'solo', :a, :b, :score, :delta, :ab, :bb, :aa, :ba)"
            ),
            {"run": run_id, "a": attacker_key, "b": victim_id, "score": score, "delta": delta,
             "ab": before_a, "bb": before_b, "aa": after_a, "ba": after_b},
        )

    # Aggregate every opposing member touched into one result per club.
    #
    # The CLUB ladder stays plain zero sum. The weights above are about what a
    # runner's own week should feel like — a raid on you hurting more than your
    # raid on somebody else pays — and a club board is a table of clubs against
    # each other, where a rating that leaks would just tilt the whole table.
    club_grouped = defaultdict(lambda: {"won": 0.0, "total": 0.0})
    attacker_clan = str(attacker_clan_id) if attacker_clan_id else people[attacker_key]["clan_id"]
    if attacker_clan and club_match:
        for victim_id, result in grouped.items():
            victim_clan = people.get(victim_id, {}).get("clan_id")
            if victim_clan and victim_clan != attacker_clan:
                club_grouped[victim_clan]["won"] += result["won"]
                club_grouped[victim_clan]["total"] += result["total"]

    club_delta_total = 0
    club_rating = None
    if club_grouped:
        clan_ids = sorted({attacker_clan, *club_grouped.keys()})
        clan_rows = db.execute(
            text(
                "SELECT id::text, COALESCE(elo_rating, :initial) FROM clans "
                "WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id FOR UPDATE"
            ),
            {"ids": clan_ids, "initial": INITIAL_RATING},
        ).fetchall()
        clubs = {r[0]: int(r[1]) for r in clan_rows}
        for rival_clan in sorted(club_grouped):
            if attacker_clan not in clubs or rival_clan not in clubs:
                continue
            result = club_grouped[rival_clan]
            score = result["won"] / max(1.0, result["total"])
            before_a, before_b = clubs[attacker_clan], clubs[rival_clan]
            delta = rating_delta(before_a, before_b, score)
            after_a, after_b = before_a + delta, before_b - delta
            clubs[attacker_clan], clubs[rival_clan] = after_a, after_b
            club_delta_total += delta
            aw, al, ad, bw, bl, bd = _outcome_counts(score)
            for cid, rating, wins, losses, draws in (
                (attacker_clan, after_a, aw, al, ad),
                (rival_clan, after_b, bw, bl, bd),
            ):
                db.execute(
                    text(
                        "UPDATE clans SET elo_rating=:rating, elo_peak=GREATEST(elo_peak,:rating), "
                        "elo_matches=elo_matches+1, elo_wins=elo_wins+:wins, "
                        "elo_losses=elo_losses+:losses, elo_draws=elo_draws+:draws "
                        "WHERE id=CAST(:id AS uuid)"
                    ),
                    {"id": cid, "rating": rating, "wins": wins, "losses": losses, "draws": draws},
                )
            db.execute(
                text(
                    "INSERT INTO elo_events (run_id, scope, clan_a_id, clan_b_id, score_a, delta_a, "
                    "rating_a_before, rating_b_before, rating_a_after, rating_b_after) "
                    "VALUES (:run, 'club', :a, :b, :score, :delta, :ab, :bb, :aa, :ba)"
                ),
                {"run": run_id, "a": attacker_clan, "b": rival_clan, "score": score, "delta": delta,
                 "ab": before_a, "bb": before_b, "aa": after_a, "ba": after_b},
            )
        club_rating = clubs.get(attacker_clan)

    if attacker_clan and club_rating is None:
        club_rating = club_status(db, attacker_clan)["rating"]

    return {
        "solo_rating": people[attacker_key]["rating"],
        "solo_delta": solo_delta_total,
        "club_rating": club_rating,
        "club_delta": club_delta_total,
    }
