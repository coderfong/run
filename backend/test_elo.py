"""Pure contract tests for the solo/club Elo ladder.

    .venv/Scripts/python.exe test_elo.py
"""

from app import elo


def test_equal_match_is_symmetric():
    delta = elo.rating_delta(1000, 1000, 1)
    assert delta == 16
    assert (1000 + delta) + (1000 - delta) == 2000


def test_upset_is_worth_more_than_expected_win():
    upset = elo.rating_delta(900, 1300, 1)
    favourite = elo.rating_delta(1300, 900, 1)
    assert upset > favourite > 0


def test_area_split_is_a_fractional_result():
    assert elo.rating_delta(1000, 1000, 0.75) == 8
    assert elo.rating_delta(1000, 1000, 0.25) == -8
    assert elo.rating_delta(1000, 1000, 0.5) == 0


def test_floor_does_not_create_points():
    delta = elo.rating_delta(100, 1000, 0)
    assert delta == 0


def test_extreme_rating_gap_is_numerically_safe():
    assert elo.rating_delta(100, 999999, 1) > 0


def test_progression_ladder():
    start = elo.tier_for_rating(1000)
    assert start["key"] == "wood"
    assert start["next_rating"] == 1050
    assert start["points_to_next"] == 50
    assert 0 < start["progress"] < 1
    assert elo.tier_for_rating(2400)["key"] == "mythic"
    assert elo.tier_for_rating(2400)["progress"] == 1
    assert elo.tier_for_rating(elo.rating_for_tier(3))["tier"] == 3


if __name__ == "__main__":
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    for test in tests:
        test()
        print(f"  ok  {test.__name__}")
    print(f"ALL PASSED ({len(tests)})")
