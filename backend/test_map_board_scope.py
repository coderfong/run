"""The two map boards scope on two different ladders.

    .venv/Scripts/python.exe -m pytest test_map_board_scope.py

Pure: `board_scope` returns the join, the tier filter and its parameters, and
the whole difference between the solo and club boards lives in those three
values. Getting the rating column wrong produces a board that looks entirely
plausible and is quietly filtering on the wrong ladder, which is exactly the
kind of bug a rendered map will not show you.
"""

import pytest

from app import elo
from app.routes.territories import CLUB_BOARD, board_scope


def test_the_solo_board_scopes_by_the_owner():
    _join, clause, params = board_scope("solo", 3)
    assert "solo_elo" in clause
    assert "elo_rating" not in clause
    assert params == {"rank_floor": 1350, "rank_ceil": 1500}


def test_the_club_board_scopes_by_the_owning_club():
    """A club is what you are looking at, so a club's tier is what filters it.

    Scoping the club board by each plot's individual owner would show one
    club's Bronze member and hide their Diamond one.
    """
    _join, clause, params = board_scope(CLUB_BOARD, 3)
    assert "elo_rating" in clause
    assert "solo_elo" not in clause
    assert params == {"rank_floor": 1350, "rank_ceil": 1500}


def test_the_club_board_returns_club_held_land_only():
    """An INNER join. Clubless land cannot belong to a club tier, and fetching
    it only for the client to discard spends the endpoint's LIMIT on rows that
    are never drawn."""
    solo_join, _, _ = board_scope("solo", None)
    club_join, _, _ = board_scope(CLUB_BOARD, None)
    assert solo_join.startswith("LEFT JOIN")
    assert club_join.startswith("JOIN")


def test_an_unknown_board_falls_back_to_solo():
    """A stale client naming a board that no longer exists gets the ordinary
    board, not an empty one."""
    assert board_scope("clubs", 3) == board_scope("solo", 3)
    assert board_scope("", 3) == board_scope("solo", 3)


def test_no_rank_means_no_filter_on_either_board():
    for board in ("solo", CLUB_BOARD):
        _join, clause, params = board_scope(board, None)
        assert clause == ""
        assert params == {}


def test_the_top_tier_has_no_ceiling():
    """Mythic is open ended; a ceiling there would hide the very best clubs."""
    for board in ("solo", CLUB_BOARD):
        _join, clause, params = board_scope(board, 9)
        assert "rank_ceil" not in params
        assert ">= :rank_floor" in clause
        assert "< :rank_ceil" not in clause


def test_every_tier_is_addressable_and_the_bands_tile_the_ladder():
    """Consecutive tiers must abut exactly: a gap would make land unreachable
    on every board, and an overlap would draw it on two."""
    previous_ceiling = None
    for tier in range(len(elo.ELO_TIERS)):
        _join, _clause, params = board_scope(CLUB_BOARD, tier)
        floor = params["rank_floor"]
        if previous_ceiling is not None:
            assert floor == previous_ceiling, tier
        previous_ceiling = params.get("rank_ceil")


@pytest.mark.parametrize("tier", [-5, 99])
def test_an_out_of_range_tier_folds_onto_a_real_one(tier):
    """A stale client asking for tier 99 gets Mythic, never an empty board."""
    _join, clause, params = board_scope(CLUB_BOARD, tier)
    assert clause
    assert params["rank_floor"] in {t[0] for t in elo.ELO_TIERS} | {elo.MIN_RATING}
