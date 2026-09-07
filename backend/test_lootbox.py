"""Contract tests for the box gamble.

    .venv/Scripts/python.exe -m pytest test_lootbox.py

Pure: `roll_sequence` takes an injected Random, so every property below is
checked against a real distribution rather than a mocked one.
"""

import random
from collections import Counter

from app import lootbox


def _finals(base, n=20000, seed=11):
    rng = random.Random(seed)
    return Counter(lootbox.roll_sequence(base, rng)["final_rarity"] for _ in range(n))


def test_a_box_never_opens_worse_than_it_was_granted():
    """The whole mechanic is upside only. Nothing may ever go backwards."""
    rng = random.Random(5)
    for base in lootbox.RARITY_ORDER:
        floor = lootbox.RARITY_ORDER.index(base)
        for _ in range(2000):
            rolled = lootbox.roll_sequence(base, rng)
            assert lootbox.RARITY_ORDER.index(rolled["final_rarity"]) >= floor


def test_steps_match_the_pips_on_screen():
    """`chances` is what the tap pips count, so it must equal the step list."""
    rng = random.Random(2)
    for base in lootbox.RARITY_ORDER:
        for _ in range(200):
            rolled = lootbox.roll_sequence(base, rng)
            assert rolled["chances"] == len(rolled["steps"])
            assert rolled["chances"] == lootbox.chances_for(base)


def test_each_step_reports_the_rarity_after_that_tap():
    """The client fades to `steps[i].rarity`; it must never recompute a ladder."""
    rng = random.Random(9)
    for _ in range(2000):
        rolled = lootbox.roll_sequence("common", rng)
        current = "common"
        for step in rolled["steps"]:
            if step["upgraded"]:
                current = lootbox.next_rarity(current)
            assert step["rarity"] == current
        assert rolled["final_rarity"] == current


def test_promotion_is_capped_so_a_cheap_box_cannot_reach_the_top():
    """A common box may reach epic and no further, however lucky the taps."""
    assert "legendary" not in _finals("common")


def test_legendary_has_nothing_left_to_gamble_for():
    rolled = lootbox.roll_sequence("legendary")
    assert rolled["chances"] == 0
    assert rolled["steps"] == []
    assert rolled["final_rarity"] == "legendary"


def test_the_odds_taper_so_boxes_do_not_compound():
    """Better boxes must be harder to promote, or opening everything you own
    becomes a reliable legendary factory."""
    common_up = 1 - _finals("common")["common"] / 20000
    epic_up = 1 - _finals("epic")["epic"] / 20000
    assert common_up > epic_up
    assert 0.0 < epic_up < 0.35


def test_an_unknown_rarity_falls_back_to_the_floor():
    """A box row written by an older build must not crash the opener."""
    rolled = lootbox.roll_sequence("mythic-typo")
    assert rolled["rarity"] == lootbox.RARITY_ORDER[0]
