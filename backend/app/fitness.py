"""Server-side splits + personal records, computed at end-run from the
cleaned (projected, metric) path. Flagged runs never set records.
"""

import math

from sqlalchemy import text

# record kind -> (human label, "lower is better"?)
RECORD_KINDS = {
    "fastest_1k": ("Fastest 1K", True),
    "fastest_5k": ("Fastest 5K", True),
    "fastest_10k": ("Fastest 10K", True),
    "longest_run": ("Longest run", False),
    "biggest_claim": ("Biggest claim", False),
}


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def compute_splits(metric_coords, timestamps):
    """Per-km splits: [(km, seconds), ...] from the projected metric path."""
    splits = []
    if len(metric_coords) < 2:
        return splits
    km_dist = 0.0
    km_time = 0.0
    km_index = 1
    for i in range(1, len(metric_coords)):
        seg_d = _dist(metric_coords[i - 1], metric_coords[i])
        seg_t = (timestamps[i] - timestamps[i - 1]).total_seconds()
        if seg_t <= 0:
            continue
        while km_dist + seg_d >= 1000:
            need = 1000 - km_dist
            frac = need / seg_d if seg_d else 1
            splits.append((km_index, km_time + seg_t * frac))
            km_index += 1
            seg_d -= need
            seg_t -= seg_t * frac
            km_dist = 0.0
            km_time = 0.0
        km_dist += seg_d
        km_time += seg_t
    return splits


def _fastest_window(metric_coords, timestamps, target_m):
    """Min seconds to cover `target_m` continuous meters (sliding window)."""
    n = len(metric_coords)
    if n < 2:
        return None
    # cumulative distance + time
    cd = [0.0] * n
    ct = [0.0] * n
    for i in range(1, n):
        cd[i] = cd[i - 1] + _dist(metric_coords[i - 1], metric_coords[i])
        dt = (timestamps[i] - timestamps[i - 1]).total_seconds()
        ct[i] = ct[i - 1] + max(0.0, dt)
    if cd[-1] < target_m:
        return None
    best = None
    j = 0
    for i in range(n):
        while cd[i] - cd[j] > target_m and j < i:
            j += 1
        # window [j-1 .. i] just covers >= target_m
        k = j - 1 if j > 0 and cd[i] - cd[j - 1] >= target_m else j
        if cd[i] - cd[k] >= target_m:
            t = ct[i] - ct[k]
            if best is None or t < best:
                best = t
    return best


def record_splits_and_prs(db, run_id, user_id, cleaned, distance_m, area_claimed, verified):
    """Persist per-km splits; if verified, update PRs. Returns the list of
    human labels newly achieved (for RunResultOut.achievements)."""
    metric = cleaned.metric_coords
    ts = cleaned.timestamps

    for km, seconds in compute_splits(metric, ts):
        db.execute(
            text("INSERT INTO run_splits (run_id, km, seconds) VALUES (:r, :k, :s) "
                 "ON CONFLICT (run_id, km) DO NOTHING"),
            {"r": run_id, "k": km, "s": seconds},
        )

    if not verified:
        return []

    candidates = {
        "fastest_1k": _fastest_window(metric, ts, 1000),
        "fastest_5k": _fastest_window(metric, ts, 5000),
        "fastest_10k": _fastest_window(metric, ts, 10000),
        "longest_run": distance_m,
        "biggest_claim": area_claimed if area_claimed > 0 else None,
    }

    achieved = []
    for kind, value in candidates.items():
        if value is None:
            continue
        label, lower_better = RECORD_KINDS[kind]
        cur = db.execute(
            text("SELECT value FROM user_records WHERE user_id = :u AND kind = :k"),
            {"u": user_id, "k": kind},
        ).fetchone()
        beat = cur is None or (value < cur[0] if lower_better else value > cur[0])
        if beat:
            db.execute(
                text(
                    """
                    INSERT INTO user_records (user_id, kind, value, run_id, achieved_at)
                    VALUES (:u, :k, :v, :r, now())
                    ON CONFLICT (user_id, kind)
                    DO UPDATE SET value = :v, run_id = :r, achieved_at = now()
                    """
                ),
                {"u": user_id, "k": kind, "v": float(value), "r": run_id},
            )
            # Only celebrate an improvement, not the very first data point of a
            # brand-new account's only run (still counts as a PR though).
            achieved.append(label)
    return achieved
