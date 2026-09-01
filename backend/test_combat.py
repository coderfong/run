"""Club defence falloff, the defence ceiling, and rank weighting.

The thing being prevented: a flat sum of clubmate strengths meant every extra
member added their whole strength to a defence, while an attacker's strength
tops out at `strength_max`. Past a certain club size the arithmetic produced
ground that could not be taken by anyone, ever, by any means. Club size is
supposed to be an advantage, not immunity.

Pure functions: no server, no database.

    python test_combat.py
"""

import sys

from app.config import settings
from app.routes.runs import club_support_falloff, effective_defence
from app import ranks

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


def close(label, got, want, tol=1e-6):
    return check(label, abs(got - want) <= tol, f"got {got} want {want}")


def test_falloff():
    print("\n[1] clubmates stack with falloff, not in full")
    close("nobody overlapping adds nothing", club_support_falloff([]), 0.0)
    close("one clubmate counts in full", club_support_falloff([1.5]), 1.5)
    close(
        "a second counts half",
        club_support_falloff([1.0, 1.0]),
        1.0 + 0.5,
    )
    close(
        "a third counts a quarter",
        club_support_falloff([1.0, 1.0, 1.0]),
        1.0 + 0.5 + 0.25,
    )
    close(
        "everyone after that counts a tenth",
        club_support_falloff([1.0] * 6),
        1.0 + 0.5 + 0.25 + 0.1 * 3,
    )
    # Order must not matter — the strongest gets the full weight whatever order
    # the database happened to return.
    close(
        "the STRONGEST takes the full weight, whatever order they arrive in",
        club_support_falloff([0.9, 2.0, 1.2]),
        2.0 + 0.5 * 1.2 + 0.25 * 0.9,
    )
    close("nulls are ignored", club_support_falloff([1.0, None, 1.0]), 1.0 + 0.5)


def test_ceiling():
    print("\n[2] nothing on the map defends harder than the ceiling")
    cap = settings.max_effective_defence
    close("a solo runner's fresh land defends at its own strength",
          effective_defence(1.0, 0.0), 1.0)
    close("a reinforced solo territory", effective_defence(2.0, 0.0), 2.0)
    close("a big club is capped", effective_defence(2.0, 10.0), cap)
    check(
        "an enormous club cannot exceed the cap",
        effective_defence(2.0, club_support_falloff([2.0] * 50)) == cap,
        effective_defence(2.0, club_support_falloff([2.0] * 50)),
    )


def test_immunity_is_real_without_chip():
    print("\n[3] the ceiling alone would still be immunity — hence chip damage")
    strongest_attack = settings.strength_max
    cap = settings.max_effective_defence
    check(
        "the best possible attack cannot beat the defence ceiling head-on",
        strongest_attack <= cap,
        f"attack {strongest_attack} vs cap {cap}",
    )
    # ...so a bounced attack has to leave a mark, or well-held ground is
    # permanently untakeable however many people attack it.
    chip = strongest_attack * settings.defence_chip_frac
    check("a bounced attack chips the defence", chip > 0, f"{chip:.3f} per attack")

    # How many bounced attacks it takes to bring capped ground within reach.
    strength = cap
    hits = 0
    while strength >= strongest_attack and hits < 1000:
        strength = max(settings.defence_chip_floor, strength - chip)
        hits += 1
        if strength <= settings.defence_chip_floor:
            break
    check(
        "a coordinated siege gets through eventually",
        strength < strongest_attack,
        f"{hits} bounced attacks to drop {cap} below {strongest_attack}",
    )
    check(
        "...but not in one or two attempts",
        hits >= 5,
        f"{hits} attacks",
    )
    check(
        "chipping never grinds land to nothing",
        strength >= settings.defence_chip_floor,
        strength,
    )


def test_rank_weighting():
    print("\n[4] rank rewards competing, not painting empty map")
    check(
        "a neutral claim is worth far less than a defence",
        ranks.POINTS_CLAIM * 3 <= ranks.POINTS_DEFEND,
        f"claim {ranks.POINTS_CLAIM} vs defend {ranks.POINTS_DEFEND}",
    )
    check(
        "...and far less than a steal",
        ranks.POINTS_CLAIM * 5 <= ranks.POINTS_STEAL,
        f"claim {ranks.POINTS_CLAIM} vs steal {ranks.POINTS_STEAL}",
    )
    check("losing ground costs more than a neutral claim pays",
          abs(ranks.POINTS_LOST) > ranks.POINTS_CLAIM,
          f"{ranks.POINTS_LOST} vs +{ranks.POINTS_CLAIM}")
    check("holding is a milestone, not an income",
          0 < ranks.POINTS_HOLD <= ranks.POINTS_CLAIM,
          ranks.POINTS_HOLD)
    # The daily neutral cap has to bind before neutral play rivals one steal.
    cap = settings.daily_neutral_claim_rank_cap
    check(
        "a full day of neutral expansion is worth less than two steals",
        cap < 2 * ranks.POINTS_STEAL,
        f"cap {cap} vs {2 * ranks.POINTS_STEAL}",
    )


def test_rank_weighting_by_tier():
    print("\n[5] the top of the ladder favours holding ground over taking it")
    n = len(ranks.RANK_TIERS)
    check(
        "every tier table covers every rank tier",
        len(ranks.STEAL_REWARD_BY_TIER) == n
        and len(ranks.LOSS_PENALTY_BY_TIER) == n
        and len(ranks.DEFEND_REWARD_BY_TIER) == n,
        n,
    )
    # Tier 0 has to reproduce the flat numbers test_rank_weighting already
    # checked, or this table silently changed the game for every new player.
    check(
        "wood still pays the original flat rates",
        (ranks.steal_reward(0), ranks.loss_penalty(0), ranks.defend_reward(0))
        == (ranks.POINTS_STEAL, ranks.POINTS_LOST, ranks.POINTS_DEFEND),
    )
    top = n - 1
    check(
        "stealing pays less the closer the fight is to Mythic",
        ranks.steal_reward(top) < ranks.steal_reward(0),
        f"mythic {ranks.steal_reward(top)} vs wood {ranks.steal_reward(0)}",
    )
    check(
        "losing ground costs more the closer the fight is to Mythic",
        ranks.loss_penalty(top) < ranks.loss_penalty(0),
        f"mythic {ranks.loss_penalty(top)} vs wood {ranks.loss_penalty(0)}",
    )
    check(
        "defending pays more the closer the fight is to Mythic",
        ranks.defend_reward(top) > ranks.defend_reward(0),
        f"mythic {ranks.defend_reward(top)} vs wood {ranks.defend_reward(0)}",
    )
    # The actual test of "harder to climb": at the top, successfully taking
    # ground off someone must pay the attacker LESS than losing it cost the
    # victim — a steal should shrink the total points on the board, not grow
    # it, or aggregate rank inflates and Mythic gets easier over time instead
    # of harder.
    check(
        "a top-tier steal is zero-sum or worse, not a net mint",
        ranks.steal_reward(top) <= abs(ranks.loss_penalty(top)),
        f"gain {ranks.steal_reward(top)} vs loss {abs(ranks.loss_penalty(top))}",
    )
    # And defending must be the better payday, so staying near Mythic means
    # holding your ground rather than farming raids on someone else's.
    check(
        "at the top, a successful defence outpays a successful steal",
        ranks.defend_reward(top) > ranks.steal_reward(top),
        f"defend {ranks.defend_reward(top)} vs steal {ranks.steal_reward(top)}",
    )
    check(
        "decay bites harder once you're actually near the top",
        ranks.DECAY_PER_WEEK_HIGH > ranks.DECAY_PER_WEEK
        and ranks.DECAY_HIGH_TIER_FLOOR == ranks.RANK_TIERS[5][0],
        f"{ranks.DECAY_PER_WEEK_HIGH} vs {ranks.DECAY_PER_WEEK} above {ranks.DECAY_HIGH_TIER_FLOOR}",
    )


def main():
    print(
        f"combat — club weights {settings.club_defence_w1}/{settings.club_defence_w2}/"
        f"{settings.club_defence_w3}/{settings.club_defence_rest}, "
        f"cap {settings.max_effective_defence}, chip {settings.defence_chip_frac}"
    )
    test_falloff()
    test_ceiling()
    test_immunity_is_real_without_chip()
    test_rank_weighting()
    test_rank_weighting_by_tier()
    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        sys.exit(1)
    print("COMBAT BALANCE HOLDS")


if __name__ == "__main__":
    main()
