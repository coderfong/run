"""The lootbox gamble — a box's rarity is bid upward before it is opened.

A box used to be a rarity and nothing else: the server handed one over, the
client rolled an item of that rarity, and the whole thing was over in the time
it took the modal to fade. That is a receipt, not a reward.

THE GAMBLE. A box now arrives with a small number of CHANCES on it. Each
chance is spent on one tap, and each tap either promotes the box a rarity or
does nothing. Nothing is ever lost — the floor is the rarity the box was
granted at — so the tension is entirely upside, which is the only shape of
this mechanic that belongs in a running app rather than a casino: you cannot
end the sequence with less than you started it with, and there is no second
currency to feed it.

WHY THE WHOLE SEQUENCE IS DECIDED HERE, IN ONE CALL. The obvious build is a
tap endpoint — the client asks, the server rolls, the client animates the
answer. It is wrong twice. A tap that waits on a round trip is not a tap, and
the same request retried is a re-roll: a client that dislikes an outcome just
asks again, and the server has no way to tell that from a dropped response.

So `roll_sequence` decides EVERY outcome at open time, the client is handed the
finished list, and each tap merely reveals the step that was already true. The
box row is marked opened in the same transaction that produces it, so there is
exactly one sequence per box and replaying the call yields nothing to open.

Pure functions, no DB access — `routes/progression.py` owns the transaction.
"""

from __future__ import annotations

import random

# The ladder a box climbs. Ordered, and the last entry is the ceiling: a
# legendary box has nothing to be promoted to and simply keeps its chances
# unspent (see `roll_sequence`).
RARITY_ORDER = ["common", "rare", "epic", "legendary"]

# How many taps a box of each rarity gets.
#
# Fewer chances the better the box starts, which is what stops the ladder
# compounding: a common box with three swings at 30% reaches legendary about
# 2.7% of the time, while an epic box gets one swing at a much longer price.
# Without the taper, "open every box you own" would be a reliable legendary
# factory rather than an occasional one.
CHANCES_BY_RARITY = {"common": 3, "rare": 3, "epic": 2, "legendary": 0}

# The odds one chance promotes the box, by the rarity it is promoting FROM.
# Deliberately steep at the top: the gap between epic and legendary is the
# only one in the game worth a held breath.
UPGRADE_ODDS = {"common": 0.34, "rare": 0.22, "epic": 0.09, "legendary": 0.0}

# A box may climb at most this far above where it was granted, however lucky
# the taps are. Two is enough for a common box to reach epic and for the
# headline moment to exist at all; it also means a level 5 box can never
# quietly out-earn the level 40 tier that is supposed to be the reward for
# getting there.
MAX_PROMOTIONS = 2


def chances_for(rarity: str) -> int:
    """How many taps a box of this rarity is opened with."""
    return CHANCES_BY_RARITY.get(rarity, 0)


def next_rarity(rarity: str) -> str | None:
    """The rarity one step up, or None at the ceiling."""
    try:
        idx = RARITY_ORDER.index(rarity)
    except ValueError:
        return None
    return RARITY_ORDER[idx + 1] if idx + 1 < len(RARITY_ORDER) else None


def roll_sequence(rarity: str, rng: random.Random | None = None) -> dict:
    """Decide a whole box: every tap's outcome, and what it ends up as.

    Returns the payload the client animates against::

        {
          "rarity": "rare",              # what the box was granted at
          "final_rarity": "epic",        # what it actually opens as
          "chances": 3,
          "steps": [                     # one per chance, in tap order
            {"upgraded": False, "rarity": "rare"},
            {"upgraded": True,  "rarity": "epic"},
            {"upgraded": False, "rarity": "epic"},
          ],
        }

    Every step carries the rarity the box is at AFTER that tap, so the client
    never recomputes the ladder — it reads the colour to fade to straight off
    the step it just spent. A step that upgrades past `MAX_PROMOTIONS`, or past
    the top of `RARITY_ORDER`, simply reports no upgrade: the chance is spent
    and the box holds. That keeps `chances` and `len(steps)` equal, which is
    what the tap pips on screen are counting.
    """
    rng = rng or random.Random()
    base = rarity if rarity in RARITY_ORDER else RARITY_ORDER[0]
    current = base
    promotions = 0
    steps: list[dict] = []

    for _ in range(chances_for(base)):
        upgraded = False
        target = next_rarity(current)
        if target is not None and promotions < MAX_PROMOTIONS:
            if rng.random() < UPGRADE_ODDS.get(current, 0.0):
                current = target
                promotions += 1
                upgraded = True
        steps.append({"upgraded": upgraded, "rarity": current})

    return {
        "rarity": base,
        "final_rarity": current,
        "chances": len(steps),
        "steps": steps,
    }
