"""
Run validation — shadow-flagging, never rejection.

`validate_run()` inspects the RAW submitted points (clean_path drops the
very samples that betray a cheat, so validation runs before/alongside it)
plus optional pedometer data, and returns a list of flag reasons.

Semantics:
  * HARD reasons mean the run is not `verified`: its territories still get
    created and returned to the submitter (normal-looking success), but are
    excluded from /leaderboard and /map-polygons for everyone else, and it
    neither steals from nor merges into other territories.
  * SOFT reasons (currently `gps_too_clean`) are recorded in flag_reasons
    for review but do NOT unverify a run on their own.

Never expose which rule fired to the client — flag_reasons is server-side
only. All thresholds live in config.Settings.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from .config import settings
from .schemas import GpsPoint

# Reasons that unverify a run on their own.
HARD_REASONS = {
    "mocked_points", "teleport", "pace_too_fast", "stride_implausible", "invalid_run_time",
    "overlapping_run",
    # A watch-submitted run whose claimed started_at does not agree with its
    # own points' first timestamp — see the `source == "watch"` check in
    # routes/runs.py end_run. Hard, because this is precisely the "declare a
    # two-second submission a forty-minute run" case start_run's backdating
    # comment exists to prevent.
    "watch_start_mismatch",
}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _segment_speeds(points: List[GpsPoint]) -> List[Tuple[float, float]]:
    """[(distance_m, dt_s)] for consecutive point pairs with positive dt.

    Pairs that straddle two accepted running segments are skipped: the gap
    between segments is ground the client deliberately did NOT count (a drive,
    a bike ride, a tunnel with no evidence), so it is neither a teleport nor
    a sprint."""
    out = []
    for a, b in zip(points, points[1:]):
        if a.seg is not None and b.seg is not None and a.seg != b.seg:
            continue
        dt = (b.t - a.t).total_seconds()
        if dt <= 0:
            continue
        out.append((_haversine_m(a.lat, a.lon, b.lat, b.lon), dt))
    return out


def _check_mocked(points: List[GpsPoint]) -> Optional[str]:
    """(a) A material fraction of points carry the mock-provider flag."""
    flagged = sum(1 for p in points if p.mocked)
    if flagged and flagged / len(points) > settings.cheat_max_mock_fraction:
        return "mocked_points"
    return None


def _check_teleport(points: List[GpsPoint]) -> Optional[str]:
    """(b) Sustained impossible speed: > teleport threshold across 3+
    CONSECUTIVE gaps. Single glitches are already dropped by clean_path's
    speed filter; a consistent streak is deliberate movement fakery."""
    streak = 0
    for dist, dt in _segment_speeds(points):
        if dist / dt > settings.cheat_teleport_speed_mps:
            streak += 1
            if streak >= settings.cheat_teleport_min_points:
                return "teleport"
        else:
            streak = 0
    return None


def _check_pace_floor(points: List[GpsPoint]) -> Optional[str]:
    """(c) Faster than the floor (default 2:50/km) over a rolling window.

    Two tiers, because a fast stretch is evidence, not a verdict. Over
    cheat_pace_hard_window_m (1.5 km) it is HARD: nobody casual holds that,
    and a bike or a car does. Over only cheat_pace_window_m (500 m) it is the
    SOFT `pace_fast_burst` — a 2:27/km interval rep or a downhill sprint
    is a real runner, and unverifying it would punish them for being fast."""
    if _pace_window_breached(points, settings.cheat_pace_hard_window_m):
        return "pace_too_fast"
    if _pace_window_breached(points, settings.cheat_pace_window_m):
        return "pace_fast_burst"
    return None


def _pace_window_breached(points: List[GpsPoint], window_m: float) -> bool:
    segs = _segment_speeds(points)
    if not segs:
        return False
    # Prefix sums over segments; two-pointer window.
    n = len(segs)
    i = 0
    dist_acc = 0.0
    time_acc = 0.0
    for j in range(n):
        dist_acc += segs[j][0]
        time_acc += segs[j][1]
        while dist_acc - segs[i][0] >= window_m and i < j:
            dist_acc -= segs[i][0]
            time_acc -= segs[i][1]
            i += 1
        if dist_acc >= window_m:
            s_per_km = time_acc / (dist_acc / 1000.0)
            if s_per_km < settings.cheat_pace_floor_s_per_km:
                return True
    return False


def _check_stride(distance_m: float, step_count: Optional[int]) -> Optional[str]:
    """(d) distance / steps outside a plausible human stride.

    step_count is None only when the phone has no (permitted) pedometer.
    A WORKING pedometer reporting (near-)zero steps over real distance is
    the vehicle signature — buses cover kilometres with no strides."""
    if step_count is None or distance_m < 100:
        return None
    if step_count <= 0:
        return "stride_implausible"
    stride = distance_m / step_count
    if stride < settings.cheat_stride_min_m or stride > settings.cheat_stride_max_m:
        return "stride_implausible"
    return None


def _check_too_clean(points: List[GpsPoint]) -> Optional[str]:
    """(e) SOFT: real GPS is noisy. Near-zero variance in point spacing
    across a long run — or a long run whose reported accuracy never moves —
    is a replay/simulator signature."""
    if len(points) < settings.cheat_clean_min_points:
        return None

    dists = [d for d, _ in _segment_speeds(points)]
    if len(dists) < 2:
        return None
    mean_d = sum(dists) / len(dists)
    if mean_d <= 0:
        return None
    var_d = sum((d - mean_d) ** 2 for d in dists) / len(dists)
    cv = math.sqrt(var_d) / mean_d
    if cv < settings.cheat_clean_spacing_cv:
        return "gps_too_clean"

    accs = [p.accuracy_m for p in points if p.accuracy_m is not None]
    if len(accs) >= settings.cheat_clean_min_points:
        mean_a = sum(accs) / len(accs)
        var_a = sum((a - mean_a) ** 2 for a in accs) / len(accs)
        if var_a < settings.cheat_clean_accuracy_var:
            return "gps_too_clean"
    return None


def _check_session(session) -> List[str]:
    """SOFT reasons from the client run session's summary, for review and
    tester calibration only. The client already left these stretches out of
    the route it sent; this records THAT it did, never unverifies on it."""
    if session is None:
        return []
    out = []
    if (session.vehicle_suspect_s or 0) >= 60:
        out.append("session_vehicle_excluded")
    if (session.cycling_suspect_s or 0) >= 120:
        out.append("session_cycling_excluded")
    recorded = session.recorded_s or 0
    if recorded >= 600 and (session.unknown_s or 0) > 0.5 * recorded:
        out.append("session_mostly_unknown")
    return out


def overlap_share(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    """How much of the shorter of two time spans the other one covers (0..1)."""
    inter = (min(a_end, b_end) - max(a_start, b_start)).total_seconds()
    shorter = min((a_end - a_start).total_seconds(), (b_end - b_start).total_seconds())
    if inter <= 0 or shorter <= 0:
        return 0.0
    return min(1.0, inter / shorter)


def validate_run(
    points: List[GpsPoint],
    distance_m: float,
    step_count: Optional[int] = None,
    *,
    started_at: Optional[datetime] = None,
    ended_at: Optional[datetime] = None,
    session=None,
) -> List[str]:
    """Return all flag reasons for a submitted run (possibly empty)."""
    if len(points) < 2:
        return []
    reasons = []
    # GPS time is client-controlled. Historical/future traces must not earn
    # rewards just because their internal pace looks plausible. Allow modest
    # phone clock drift and the cached fix commonly returned at run start.
    tolerance = timedelta(seconds=30)
    if (
        (started_at is not None and any(p.t < started_at - tolerance for p in points))
        or (ended_at is not None and any(p.t > ended_at + tolerance for p in points))
        or any(b.t < a.t for a, b in zip(points, points[1:]))
    ):
        reasons.append("invalid_run_time")
    for check in (
        _check_mocked(points),
        _check_teleport(points),
        _check_pace_floor(points),
        _check_stride(distance_m, step_count),
        _check_too_clean(points),
    ):
        if check:
            reasons.append(check)
    reasons.extend(_check_session(session))
    return reasons


def is_verified(reasons: List[str]) -> bool:
    """A run stays verified unless a HARD reason fired."""
    return not any(r in HARD_REASONS for r in reasons)


# --- watch-submitted runs ----------------------------------------------------
#
# A standalone Apple Watch workout reaches /start-run long after it actually
# began — the watch records it, then hands the finished route to the phone
# (frontend/targets/watch/WorkoutManager.swift,
# frontend/modules/paser-watch/ios/PhoneWatchSession.swift) — so honouring its
# real started_at needs an exception to the rule every other account is held
# to (see start_run's own comment in routes/runs.py). Both functions below are
# PURE: no database, same inputs always the same answer, so
# test_watch_run_backend.py exercises the actual decision without a server.


def resolve_run_start(
    claimed_started_at: Optional[datetime],
    source: Optional[str],
    *,
    is_dev: bool,
    now: datetime,
    max_backdate_s: float,
) -> Tuple[datetime, Optional[str]]:
    """What /start-run should store for `started_at`, and the `source` to
    record alongside it (None for every ordinary run — NULL in the column).

    A dev account's claimed start is always honoured (the run simulator,
    which the server-side allowlist in devtools.py is the real gate for).
    Anyone else's claimed start is honoured only when it names
    `source == "watch"` AND falls inside the bounded recent window — outside
    that window it is silently dropped, exactly like a bare backdated start
    always has been for a non-dev account."""
    if claimed_started_at is None:
        return now, None
    candidate = claimed_started_at
    # Naive UTC, to match the column — see start_run's own note on why an
    # aware value has nowhere to keep its offset.
    if candidate.tzinfo is not None:
        candidate = candidate.astimezone(timezone.utc).replace(tzinfo=None)
    if is_dev:
        return candidate, None
    if source == "watch":
        age_s = (now - candidate).total_seconds()
        if 0 <= age_s <= max_backdate_s:
            return candidate, "watch"
    return now, None


def watch_start_mismatch(points: List[GpsPoint], started_at: datetime, tolerance_s: float) -> bool:
    """True when a watch run's claimed started_at does not agree with its own
    points' first timestamp, within `tolerance_s` — the one thing a client
    cannot retroactively edit once the points are recorded. This is what
    actually stands behind `resolve_run_start` honouring the claim at all:
    that function only decides whether a start is ELIGIBLE to be backdated,
    this decides whether the points submitted alongside it corroborate it.

    True (a mismatch) with no points at all — nothing to corroborate a claim
    with is not the same as a claim that checked out."""
    if not points:
        return True
    first_t = min(p.t for p in points)
    return abs((first_t - started_at).total_seconds()) > tolerance_s
