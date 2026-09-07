"""Contract tests for daily missions.

    .venv/Scripts/python.exe -m pytest test_missions.py

Pure half only: the selection, the day boundary and the week strip. The
derivation SQL is exercised by the live suite, since the whole point of it is
that it reads the tables the rest of the game writes.
"""

from datetime import date, datetime, timedelta

from app import missions
from app.config import settings


def test_a_day_draws_one_mission_from_each_band():
    """Four errands of the same size is the failure the bands exist to stop."""
    picks = missions.missions_for("user-a", date(2026, 9, 7))
    assert len(picks) == missions.MISSIONS_PER_DAY
    assert sorted(m["band"] for m in picks) == missions.BANDS


def test_the_set_is_stable_for_a_player_and_a_day():
    """Nothing stores which missions a day held, so the seed IS the record."""
    a = missions.missions_for("user-a", date(2026, 9, 7))
    b = missions.missions_for("user-a", date(2026, 9, 7))
    assert [m["id"] for m in a] == [m["id"] for m in b]


def test_different_players_and_days_get_different_sets():
    same_day = {
        tuple(m["id"] for m in missions.missions_for(f"user-{i}", date(2026, 9, 7)))
        for i in range(40)
    }
    same_player = {
        tuple(m["id"] for m in missions.missions_for("user-a", date(2026, 9, 1) + timedelta(days=i)))
        for i in range(40)
    }
    assert len(same_day) > 1
    assert len(same_player) > 1


def test_every_catalogue_entry_has_a_derivation():
    """A mission whose metric has no SQL would sit at zero forever."""
    for m in missions.CATALOGUE:
        assert m["metric"] in missions._METRICS, m["id"]
        assert missions._metric_sql(m["metric"]), m["id"]


def test_an_unknown_metric_yields_no_sql_rather_than_a_broken_query():
    assert missions._metric_sql("vibes") is None


def test_every_derivation_buckets_on_the_economy_day():
    """A UTC bucket would file a 1am run under the wrong day for half the world."""
    offset = settings.daily_reset_utc_offset_hours
    for metric in missions._METRICS:
        sql = missions._metric_sql(metric)
        assert f"INTERVAL '{offset} hours'" in sql, metric
        # Grouped, or the week strip is back to one query per day.
        assert "GROUP BY 1" in sql, metric


def test_the_whole_screen_is_a_handful_of_queries_not_forty():
    """The week strip resolves in one read per metric plus one for the claims.

    Written as a REGRESSION BOUND, not a micro benchmark: the naive shape (one
    query per metric per day) cost thirty nine round trips for this one screen,
    against a backend that spins down between visits.
    """
    class Result:
        def fetchall(self):
            return []

    class CountingDB:
        def __init__(self):
            self.n = 0

        def execute(self, *a, **k):
            self.n += 1
            return Result()

    today = date(2026, 9, 10)
    db = CountingDB()
    week = [d for d in missions.week_days(today) if d <= today]
    states = missions.day_states(db, "user-a", sorted({*week, today}))
    assert len(states) == len(week)
    # At most one per distinct metric in the week, plus the single claims read.
    assert db.n <= len(missions._METRICS) + 1
    assert db.n < 15


def test_a_day_with_no_rows_reads_as_zero_rather_than_missing():
    """Callers must never have to branch on a day being absent."""
    class Result:
        def fetchall(self):
            return []

    class DB:
        def execute(self, *a, **k):
            return Result()

    day = date(2026, 9, 7)
    state = missions.day_states(DB(), "user-a", [day])[day]
    assert state["complete_count"] == 0
    assert state["all_complete"] is False
    assert len(state["missions"]) == missions.MISSIONS_PER_DAY
    assert all(m["value"] == 0 and m["progress"] == 0 for m in state["missions"])


def test_catalogue_ids_are_unique():
    ids = [m["id"] for m in missions.CATALOGUE]
    assert len(ids) == len(set(ids))


def test_no_dashes_in_player_facing_copy():
    """House rule: zero em, en or hyphen characters in anything a player reads."""
    for m in missions.CATALOGUE:
        assert not set(m["text"]) & set("-‐‑‒–—"), m["id"]


def test_the_day_window_is_the_economy_day_and_covers_it_exactly():
    day = date(2026, 9, 7)
    start, end = missions.day_window(day)
    assert end - start == timedelta(days=1)
    assert start.hour == int(24 - settings.daily_reset_utc_offset_hours) % 24
    # An instant just inside the window resolves back to the same local day.
    assert missions.local_day(start) == day
    assert missions.local_day(end - timedelta(seconds=1)) == day
    assert missions.local_day(end) == day + timedelta(days=1)


def test_the_week_strip_is_a_fixed_monday_week():
    """A rolling seven days would move Wednesday's circle every day."""
    week = missions.week_days(date(2026, 9, 10))   # a Thursday
    assert len(week) == 7
    assert week[0] == date(2026, 9, 7)             # Monday
    assert week[0].weekday() == 0
    assert week[-1] == date(2026, 9, 13)
    assert date(2026, 9, 10) in week


def test_the_day_bonus_id_cannot_collide_with_a_mission():
    """Both share one claims table, so the reserved id has to stay reserved."""
    assert missions.DAY_BONUS_ID not in missions.BY_ID


def test_local_day_matches_the_economy_boundary():
    """Missions must reset with the coin cap they pay into, not beside it."""
    from app.economy import day_start_utc
    now = datetime(2026, 9, 7, 15, 30)
    assert missions.day_window(missions.local_day(now))[0] == day_start_utc(now)
