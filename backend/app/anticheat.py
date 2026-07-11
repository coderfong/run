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
from typing import List, Optional, Tuple

from .config import settings
from .schemas import GpsPoint

# Reasons that unverify a run on their own.
HARD_REASONS = {"mocked_points", "teleport", "pace_too_fast", "stride_implausible"}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _segment_speeds(points: List[GpsPoint]) -> List[Tuple[float, float]]:
    """[(distance_m, dt_s)] for consecutive point pairs with positive dt."""
    out = []
    for a, b in zip(points, points[1:]):
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
    """(c) Any rolling window of >= cheat_pace_window_m covered at a pace
    faster than the floor (default 2:50/km) — elite-sprint sustained over
    half a kilometre is not a casual runner."""
    segs = _segment_speeds(points)
    if not segs:
        return None
    # Prefix sums over segments; two-pointer window.
    n = len(segs)
    i = 0
    dist_acc = 0.0
    time_acc = 0.0
    for j in range(n):
        dist_acc += segs[j][0]
        time_acc += segs[j][1]
        while dist_acc - segs[i][0] >= settings.cheat_pace_window_m and i < j:
            dist_acc -= segs[i][0]
            time_acc -= segs[i][1]
            i += 1
        if dist_acc >= settings.cheat_pace_window_m:
            s_per_km = time_acc / (dist_acc / 1000.0)
            if s_per_km < settings.cheat_pace_floor_s_per_km:
                return "pace_too_fast"
    return None


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


def validate_run(
    points: List[GpsPoint],
    distance_m: float,
    step_count: Optional[int] = None,
) -> List[str]:
    """Return all flag reasons for a submitted run (possibly empty)."""
    if len(points) < 2:
        return []
    reasons = []
    for check in (
        _check_mocked(points),
        _check_teleport(points),
        _check_pace_floor(points),
        _check_stride(distance_m, step_count),
        _check_too_clean(points),
    ):
        if check:
            reasons.append(check)
    return reasons


def is_verified(reasons: List[str]) -> bool:
    """A run stays verified unless a HARD reason fired."""
    return not any(r in HARD_REASONS for r in reasons)
