"""Fast unit checks for the seeded-world schedule (no database needed).

Target selection moved from per-bot dice in bot_activity.py to the activity
director; its rank-tier, club and cooldown rules are held by
test_bot_director.py.
"""

import random
from datetime import datetime

import bot_world


def test_schedule_is_daily_weighted_and_never_exceeds_three_calendar_days():
    # The seeder's legacy cadence, still used for a freshly seeded bot's first
    # run before the cron moves it onto its archetype.
    draws = [bot_world._run_gap_days(random.Random(i)) for i in range(10_000)]
    assert set(draws) == {1, 2, 3}
    assert 1.28 < sum(draws) / len(draws) < 1.38
    assert draws.count(1) / len(draws) > 0.70

    after = datetime(2026, 9, 3, 0, 0)
    scheduled = [bot_world.next_run_at(random.Random(i), after) for i in range(500)]
    assert all(t > after for t in scheduled)
    assert all((t - after).total_seconds() < 4 * 86400 for t in scheduled)
