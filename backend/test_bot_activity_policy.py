"""Fast unit checks for the seeded-world activity policy (no database needed)."""

import random
from datetime import datetime

import bot_activity
import bot_world


class _Rows:
    def __init__(self, *, one=None, many=None):
        self.one = one
        self.many = many or []

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.many


class _FakeDB:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return next(self.results)


def test_schedule_is_daily_weighted_and_never_exceeds_three_calendar_days():
    draws = [bot_world._run_gap_days(random.Random(i)) for i in range(10_000)]
    assert set(draws) == {1, 2, 3}
    assert 1.28 < sum(draws) / len(draws) < 1.38
    assert draws.count(1) / len(draws) > 0.70

    after = datetime(2026, 9, 3, 0, 0)
    scheduled = [bot_world.next_run_at(random.Random(i), after) for i in range(500)]
    assert all(t > after for t in scheduled)
    assert all((t - after).total_seconds() < 4 * 86400 for t in scheduled)


def test_player_target_is_scoped_to_the_attackers_rank():
    db = _FakeDB([_Rows(many=[(1.31, 103.82)])])
    assert bot_activity._target_territory(db, 3) == (1.31, 103.82)

    sql, params = db.calls[0]
    assert "rank_points" in sql
    assert params["target_rank_floor"] == 1500
    assert params["target_rank_ceil"] == 3000


def test_rival_target_prefers_rematch_then_falls_back_on_the_same_rank_board():
    db = _FakeDB([_Rows(one=None), _Rows(one=(1.32, 103.83))])
    got = bot_activity._rival_territory(
        db,
        home_lat=1.30,
        home_lon=103.80,
        clan_id=None,
        user_id="00000000-0000-0000-0000-000000000001",
        rank_tier=9,
        prefer_rematch=True,
    )

    assert got == (1.32, 103.83)
    assert len(db.calls) == 2
    assert "territory_steals" in db.calls[0][0]
    assert "territory_steals" not in db.calls[1][0]
    for sql, params in db.calls:
        assert "rank_points" in sql
        assert params["rival_rank_floor"] == 30000
        assert "rival_rank_ceil" not in params
        assert params["radius"] == 5000

