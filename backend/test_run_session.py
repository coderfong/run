"""The server half of the run-session validity system (offline, no database).

The client sends only its accepted running segments, each point tagged with
`seg`, plus a summary of what it left out. The server must measure segments
separately (a drive between two stretches of running is not distance, and not
a teleport), take moving time from the points rather than from the clock, and
treat a short fast burst as evidence rather than a verdict.
"""
from datetime import datetime, timedelta

from app.anticheat import is_verified, overlap_share, validate_run
from app.geospatial import clean_segments, split_segments
from app.schemas import EndRunIn, GpsPoint, RunSessionIn

T0 = datetime(2026, 9, 24, 6, 0, 0)
M_PER_DEG = 111_320.0


def run_east(start_t, start_lon, metres, speed, seg=None, lat=1.3):
    """One fix a second heading east at `speed` m/s."""
    pts = []
    n = int(metres / speed)
    for i in range(n + 1):
        pts.append(GpsPoint(
            lat=lat,
            lon=start_lon + (i * speed) / (M_PER_DEG * 0.99974),
            t=start_t + timedelta(seconds=i),
            accuracy_m=5.0,
            seg=seg,
        ))
    return pts


def test_points_without_segments_are_one_segment():
    pts = run_east(T0, 103.8, 500, 3.0)
    assert len(split_segments(pts)) == 1


def test_a_drive_between_two_segments_is_not_distance():
    first = run_east(T0, 103.8, 2000, 3.0, seg=0)
    # 20 minutes later, 12 km east: the client excluded the drive in between.
    later = T0 + timedelta(minutes=35)
    second = run_east(later, 103.8 + 12_000 / M_PER_DEG, 1000, 3.0, seg=1)
    run = clean_segments(first + second, join_m=150)
    assert run is not None
    assert abs(run.distance_m - 3000) < 150
    # Moving time is the two segments, not the 35+ minutes between them.
    assert abs(run.moving_s - (2000 / 3 + 1000 / 3)) < 5
    # The route (territory geometry) is the longer chain only.
    assert abs(run.route.distance_m - 2000) < 120


def test_segments_that_meet_are_one_route():
    first = run_east(T0, 103.8, 1000, 3.0, seg=0)
    end = first[-1]
    # A cafe stop at the same spot, then on again from there.
    second = run_east(end.t + timedelta(minutes=20), end.lon, 1000, 3.0, seg=1)
    run = clean_segments(first + second, join_m=150)
    assert abs(run.route.distance_m - 2000) < 150
    assert abs(run.moving_s - 2000 / 3) < 5


def test_the_gap_between_segments_is_not_a_teleport():
    first = run_east(T0, 103.8, 600, 3.0, seg=0)
    second = run_east(first[-1].t + timedelta(seconds=30), 103.8 + 8000 / M_PER_DEG, 600, 3.0, seg=1)
    reasons = validate_run(first + second, 1200, None)
    assert "teleport" not in reasons
    assert "pace_too_fast" not in reasons


def test_an_interval_rep_is_a_soft_flag_not_an_unverified_run():
    easy = run_east(T0, 103.8, 1500, 3.0)
    rep = run_east(easy[-1].t + timedelta(seconds=1), easy[-1].lon, 700, 6.8)
    reasons = validate_run(easy + rep, 2200, None)
    assert "pace_fast_burst" in reasons
    assert is_verified(reasons)


def test_sustained_bike_pace_is_still_hard():
    ride = run_east(T0, 103.8, 3000, 7.5)
    reasons = validate_run(ride, 3000, None)
    assert "pace_too_fast" in reasons
    assert not is_verified(reasons)


def test_session_summary_is_evidence_only():
    pts = run_east(T0, 103.8, 1000, 3.0)
    session = RunSessionIn(recorded_s=3600, vehicle_suspect_s=1200, cycling_suspect_s=0, unknown_s=10)
    reasons = validate_run(pts, 1000, None, session=session)
    assert "session_vehicle_excluded" in reasons
    assert is_verified(reasons)


def test_session_payload_is_accepted_and_bounded():
    payload = EndRunIn.model_validate({
        "run_id": "r",
        "points": [{"lat": 1.3, "lon": 103.8, "t": 1789002000000, "seg": 0}],
        "session": {"recorded_s": 100, "active_running_s": 90, "unknown_field": 1},
    })
    assert payload.session.active_running_s == 90
    assert payload.points[0].seg == 0


def test_overlap_share():
    a0, a1 = T0, T0 + timedelta(hours=1)
    assert overlap_share(a0, a1, a0 + timedelta(minutes=30), a1 + timedelta(minutes=30)) == 0.5
    assert overlap_share(a0, a1, a1, a1 + timedelta(hours=1)) == 0.0
    assert overlap_share(a0, a1, a0 + timedelta(minutes=10), a0 + timedelta(minutes=20)) == 1.0
