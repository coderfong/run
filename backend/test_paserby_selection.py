"""Pure PASERBY selection tests; no database or GPS disclosure required."""
from datetime import datetime, timedelta

from app import paserby


BASE = datetime(2026, 1, 1, 7, 0)
LAT, LON = 1.30, 103.80


def point(t, x, y=0):
    return (BASE + timedelta(seconds=t), LON + x / 111_000, LAT + y / 111_000)


def crossing(direction="opposite"):
    mine = [point(t, -120 + t * 2) for t in range(0, 121, 25)]
    if direction == "opposite":
        other = [point(t, 120 - t * 2) for t in range(0, 121, 25)]
    elif direction == "perpendicular":
        other = [point(t, 0, -120 + t * 2) for t in range(0, 121, 25)]
    else:  # a brief overtake that then separates
        other = [point(t, -70 + t * 1.3) for t in range(0, 121, 25)]
    return paserby.analyse_crossing(mine, other, BASE + timedelta(seconds=60))


def candidate(uid, minute=0, previous=0, quality=100, corun=False, x=0, friend=False):
    return {"user_id": uid, "run_id": f"run-{uid}", "crossed_at": BASE + timedelta(minutes=minute),
            "point": (LON + x / 111_000, LAT), "previous_count": previous,
            "quality": quality, "corun": corun, "accepted_paser": friend}


def test_crossing_shapes_are_valid():
    assert not crossing("opposite")["corun"]
    assert not crossing("perpendicular")["corun"]
    assert not crossing("overtake")["corun"]


def test_five_kilometre_corun_is_suppressed():
    mine = [point(t, t * 2) for t in range(0, 601, 25)]
    other = [point(t, t * 2, 20) for t in range(0, 601, 25)]
    evidence = paserby.analyse_crossing(mine, other, BASE + timedelta(seconds=300))
    assert evidence["corun"]
    assert evidence["close_duration_s"] >= 150


def test_friend_and_club_coruns_are_suppressed_by_motion_not_identity():
    rows = [candidate("friend", corun=True, friend=True), candidate("clubmate", corun=True), candidate("new")]
    selected, _ = paserby.select_discoveries(rows)
    assert [c["user_id"] for c in selected] == ["new"]


def test_big_group_is_two_and_an_independent_crossing_can_be_third():
    crowd = [candidate(f"crowd-{i:02}", minute=0, x=i) for i in range(30)]
    independent = candidate("independent", minute=30, x=2000)
    selected, clusters = paserby.select_discoveries(crowd + [independent])
    assert len(selected) == 3
    assert sum(c["user_id"].startswith("crowd") for c in selected) == 2
    assert any(c["user_id"] == "independent" for c in selected)
    assert clusters == 2


def test_dense_run_never_exceeds_three():
    selected, _ = paserby.select_discoveries([candidate(f"u{i:02}", minute=i * 4, x=i * 500) for i in range(60)])
    assert len(selected) == 3


def test_history_and_friendship_priority_are_deterministic():
    rows = [candidate("d", minute=20, previous=7, quality=999), candidate("c", minute=15, previous=2),
            candidate("b", minute=10, previous=1), candidate("a", minute=5, previous=0),
            candidate("friend", minute=25, previous=0, friend=True)]
    selected, _ = paserby.select_discoveries(rows)
    assert [c["user_id"] for c in selected] == ["a", "b", "c"]


def test_one_cluster_never_contributes_more_than_two():
    selected, clusters = paserby.select_discoveries([candidate(str(i), x=i) for i in range(50)])
    assert clusters == 1
    assert len(selected) == 2


def test_candidate_sql_keeps_privacy_cooldown_and_bidirectional_blocks():
    sql = paserby._CANDIDATES_SQL.lower()
    assert "user_blocks" in sql and "blocker_id" in sql and "blocked_id" in sql
    assert "last_encounter_at" in sql and "cooldown" in sql
    assert "crossed_lon" in sql  # internal selection signal
    # Public response models remain deliberately separate from this query.
    fields = set(__import__('app.schemas', fromlist=['PaserbyEncounter']).PaserbyEncounter.model_fields)
    assert not fields.intersection({"lat", "lon", "crossed_at", "route", "path", "run_id"})
