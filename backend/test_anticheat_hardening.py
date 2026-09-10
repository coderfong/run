"""Offline regression tests for forged clocks, privileges and reward replay."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.anticheat import is_verified, validate_run
from app.schemas import GpsPoint, EndRunIn
from app import devtools
from app.config import settings


def trace(start):
    return [GpsPoint(lat=1.3, lon=103.8 + i * .00002,
                     t=start + timedelta(seconds=i)) for i in range(20)]


def test_clock_window():
    start = datetime(2026, 9, 10, 1)
    for offset, accepted in [(0, True), (-10, True), (-3600, False), (3600, False)]:
        reasons = validate_run(trace(start + timedelta(seconds=offset)), 42,
                               started_at=start, ended_at=start + timedelta(seconds=20))
        assert is_verified(reasons) == accepted


def test_backwards_clock_and_duplicate_fixes():
    start = datetime(2026, 9, 10, 1)
    points = trace(start)
    points.insert(2, points[1])
    assert is_verified(validate_run(points, 42))
    points[3], points[4] = points[4], points[3]
    assert not is_verified(validate_run(points, 42))


def test_mixed_timestamp_formats_normalised():
    times = ["2026-09-10T09:00:00+08:00", "2026-09-10T01:00:00Z",
             "2026-09-10T01:00:00", 1789002000000]
    points = [GpsPoint(lat=1.3, lon=103.8, t=t) for t in times]
    assert all(p.t == datetime(2026, 9, 10, 1) for p in points)


def test_editable_identity_cannot_impersonate_developer():
    user = SimpleNamespace(id="ordinary-id", username="trusted-id", email="trusted-id")
    with patch.object(settings, "dev_run_accounts", "trusted-id"):
        assert not devtools.is_dev_account(user)
        user.id = "trusted-id"
        assert devtools.is_dev_account(user)


def test_waiting_finalizer_replays_committed_result():
    from app.routes import runs
    run = SimpleNamespace(id="run-id", user_id="user-id", ended_at=None)
    db = Mock()
    db.get.return_value = run
    # Another transaction finishes while this request waits on the row lock.
    def refresh(row):
        assert "FOR UPDATE" in str(db.execute.call_args.args[0])
        row.ended_at = datetime(2026, 9, 10, 1)
    db.refresh.side_effect = refresh
    result = object()
    with patch.object(runs, "_end_run_replay", return_value=result), patch.object(runs, "clean_path") as clean:
        assert runs.end_run.__wrapped__(
            request=Mock(), response=Mock(), payload=EndRunIn(run_id=run.id, points=[]),
            background=Mock(), user=SimpleNamespace(id=run.user_id), db=db,
        ) is result
        clean.assert_not_called()
        db.commit.assert_not_called()
