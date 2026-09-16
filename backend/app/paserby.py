"""PASERBY — the runners whose paths crossed yours.

Two people ran past each other. Neither noticed. Afterwards, both runs are
finished and stored, and this module is what turns that into a card with a
character on it.

WHAT IT MAY KNOW AND WHAT IT MAY SAY are deliberately different things.

To match at all it needs where and when, so a qualifying run is sampled down to
a point every ~25 seconds (`run_traces`) and those samples are kept for a
couple of days. That is the only location data the feature touches, it is
derived from `runs.path` which the app already stores, and no endpoint returns
a row of it.

What it says is far less: a name, a character, a club, "earlier today", and how
many times you have crossed. No coordinate, no route, no distance, no crossing
time, not even a timestamp on the encounter — the API's most precise temporal
answer is a broad phrase, which is why the encounter row stores a DATE and the
`created_at` it orders by is never serialised.

MATCHING. `process_run` takes ONE run's samples (tens to a few hundred rows)
and probes the trace table with them: a time window on an indexed column and
`ST_DWithin` on a GIST-indexed geography column. It is a bounded index probe
per sample, never a comparison of every point against every other point. Both
runs must have ENDED before a match can exist, because a trace is only written
when a run finishes.

WHAT STOPS IT BEING FARMED. Only verified runs that cleared the reward bar are
sampled, so the existing impossible-speed / spoofing / too-short checks gate
this feature for free. A pair can produce one encounter per cooldown window
(24h), so running tiny loops past the same person all afternoon produces one
card. A high five pays a token amount of XP, once per encounter, under a daily
ceiling — and nothing else: no coins, no energy, no territory, no rank.
"""

import logging
import math
from bisect import bisect_left
from datetime import date, datetime, timedelta

from sqlalchemy import text

from . import economy, privacy
from .config import settings
from .database import SessionLocal
from .notifications import notify

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Familiar faces
# ---------------------------------------------------------------------------

# Labels only. Deliberately NOT a relationship system — the count is derived
# from encounters, and the label is derived from the count.
FAMILIARITY = [
    (10, "local_legend", "Local Legend"),
    (5, "running_regular", "Running Regular"),
    (2, "familiar_face", "Familiar Face"),
    (1, "crossed_paths", "Crossed Paths"),
]


def familiarity_for(times: int):
    """(key, label) for a pair that has crossed `times` times."""
    for threshold, key, label in FAMILIARITY:
        if (times or 0) >= threshold:
            return key, label
    return "crossed_paths", "Crossed Paths"


def crossed_paths_line(count: int) -> str:
    """The one sentence the post-run reveal is allowed to say.

    A count. No name, no place, no time — mirrored on the client in
    frontend/src/config/paserby.js so the notification and the reveal say the
    same thing.
    """
    n = int(count or 0)
    return f"You crossed paths with {n} {'PASER' if n == 1 else 'PASERs'} today."


def crossroads_waiting_line(count: int) -> str:
    """The push, and the in-app banner that mirrors it.

    Same privacy rule as `crossed_paths_line` — a count and nothing else — but
    it names the PLACE rather than the event. The push exists to bring somebody
    back to the plaza, and "you crossed paths with 1 PASER today" was a fact
    with no door on it. Mirrored in frontend/src/config/paserby.js.
    """
    n = int(count or 0)
    if n <= 1:
        return "A new PASER is waiting for you at the Crossroads."
    return f"{n} new PASERs are waiting for you at the Crossroads."


# ---------------------------------------------------------------------------
# Time, broadly
# ---------------------------------------------------------------------------


def local_today() -> date:
    """The current LOCAL day (the same boundary the daily caps use)."""
    return (
        datetime.utcnow() + timedelta(hours=settings.daily_reset_utc_offset_hours)
    ).date()


def when_label(encounter_date, today: date | None = None) -> str:
    """The only temporal answer the API is allowed to give.

    Never a time, never a date — a phrase. "Earlier today" is as precise as
    this gets, because anything sharper narrows down where somebody was.
    """
    today = today or local_today()
    if encounter_date is None:
        return "Recently"
    days = (today - encounter_date).days
    if days <= 0:
        return "Earlier today"
    if days == 1:
        return "Yesterday"
    if days < 7:
        return "This week"
    return "A while back"


def _level(xp) -> int:
    return int(((xp or 0) / 100) ** 0.5)


# ---------------------------------------------------------------------------
# The setting
# ---------------------------------------------------------------------------


def enabled_for(db, user_id) -> bool:
    """Is this runner taking part? An absent row means the configured default."""
    row = db.execute(
        text("SELECT enabled FROM paserby_settings WHERE user_id = :u"),
        {"u": str(user_id)},
    ).fetchone()
    return bool(row[0]) if row else bool(settings.paserby_default_enabled)


def set_enabled(db, user_id, enabled: bool) -> bool:
    """Flip the switch.

    Turning it OFF deletes the runner's stored trace samples immediately — the
    location data this feature keeps exists only to find future crossings, so
    opting out has to take it with it. Past encounters are left alone: they
    carry no location, and they are the other runner's memory too. Anything a
    runner does not want to see there can be hidden, and blocking removes the
    pair's history outright.
    """
    db.execute(
        text(
            """
            INSERT INTO paserby_settings (user_id, enabled, updated_at)
            VALUES (:u, :e, now())
            ON CONFLICT (user_id) DO UPDATE SET enabled = :e, updated_at = now()
            """
        ),
        {"u": str(user_id), "e": bool(enabled)},
    )
    if not enabled:
        db.execute(
            text("DELETE FROM run_traces WHERE user_id = :u"), {"u": str(user_id)}
        )
    db.commit()
    return bool(enabled)


# ---------------------------------------------------------------------------
# Traces — the internal, short-lived samples matching runs on
# ---------------------------------------------------------------------------


def _metres(a, b) -> float:
    """Great-circle metres between two (lon, lat) pairs."""
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def _samples(cleaned, interval_s: float, cap: int, trim_m: float = 0.0, zones=()):
    """Thin a cleaned path down to (lon, lat, when) every `interval_s`.

    Time-based rather than vertex-based: the path is already simplified, so a
    straight kilometre may be two vertices and a lap of a park thirty. Sampling
    by the clock keeps the gap between samples bounded in the thing that
    matters — how far a runner can have moved between them.

    The runner's OWN route-privacy settings are applied first, and they matter
    more here than anywhere: an encounter is discovered where two people were,
    so a sample kept at the start of a run is a sample taken at somebody's
    front door. Both ends are trimmed and every privacy zone is cut out, and
    unlike the published-route version there is no stitching to do — the
    survivors are matched individually, so a gap in the middle costs nothing.
    """
    coords = list(cleaned.wgs_coords or [])
    times = list(cleaned.timestamps or [])
    n = min(len(coords), len(times))
    if n == 0:
        return []

    pairs = list(zip(coords[:n], times[:n]))

    if trim_m > 0 and len(pairs) >= 2:
        cum, total = [0.0], 0.0
        for a, b in zip(pairs, pairs[1:]):
            total += _metres(a[0], b[0])
            cum.append(total)
        if total <= 2 * trim_m:
            return []
        pairs = [p for p, d in zip(pairs, cum) if trim_m <= d <= total - trim_m]

    if zones:
        pairs = [
            (c, t)
            for c, t in pairs
            if not any(_metres(c, (z["lon"], z["lat"])) <= z["radius_m"] for z in zones)
        ]

    out = []
    last_at = None
    for i, (c, at) in enumerate(pairs):
        if last_at is None or (at - last_at).total_seconds() >= interval_s or i == len(pairs) - 1:
            out.append((c[0], c[1], at))
            last_at = at
    # A very long run still has a ceiling: keep an evenly spread subset rather
    # than the first `cap`, so the tail of the run is represented too.
    if len(out) > cap:
        stride = len(out) / float(cap)
        out = [out[int(i * stride)] for i in range(cap)]
    return out


def record_trace(db, run, cleaned) -> int:
    """Store this run's samples, if it is the kind of run that may be matched.

    The bars are the app's existing ones: the run has to be verified (so every
    anti-cheat rule already gates this feature), to have cleared the reward tier
    (so a 20 m walk is not a social event), and to be a public run — a run whose
    route the runner has chosen not to publish does not go looking for company
    either. The caller commits.
    """
    if run is None or cleaned is None:
        return 0
    if not run.verified:
        return 0
    if not economy.rewards_earned(run.tier or economy.UNQUALIFIED):
        return 0
    if not enabled_for(db, run.user_id):
        return 0
    # Read visibility from the ROW, not the mapped object: `runs.visibility`
    # arrived with the route-privacy pass and the ORM model does not carry it,
    # so an attribute read would answer "public" for every run forever. A run
    # marked private later is also dropped at match time — see the candidate
    # query — so both ends of the window are covered.
    visibility = db.execute(
        text("SELECT COALESCE(visibility, 'public') FROM runs WHERE id = :r"),
        {"r": str(run.id)},
    ).scalar()
    if visibility != privacy.PUBLIC:
        return 0

    prefs = privacy.load(db, run.user_id)
    rows = _samples(
        cleaned,
        settings.paserby_trace_interval_s,
        settings.paserby_trace_max_points,
        trim_m=prefs.get("trim_m", 0.0),
        zones=prefs.get("zones", ()),
    )
    if not rows:
        return 0

    # Re-running the same finished run must not double the samples.
    db.execute(text("DELETE FROM run_traces WHERE run_id = :r"), {"r": str(run.id)})
    db.execute(
        text(
            "INSERT INTO run_traces (run_id, user_id, at, geog) VALUES "
            "(:r, :u, :at, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)"
        ),
        [
            {"r": str(run.id), "u": str(run.user_id), "at": at, "lon": lon, "lat": lat}
            for lon, lat, at in rows
        ],
    )
    return len(rows)


def sweep_traces(db) -> None:
    """Drop samples past the retention window. Indexed on `at`, so it is cheap
    enough to do on the back of the matching that needs them."""
    db.execute(
        text("DELETE FROM run_traces WHERE at < now() - make_interval(days => :d)"),
        {"d": settings.paserby_trace_retention_days},
    )


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

# One run's samples against the trace table. The `mine` CTE is small (tens to a
# few hundred rows) and everything on the right of the join is served by an
# index: `at` narrows to the minutes around each sample, ST_DWithin walks the
# GIST index. Filters after the join are the eligibility rules — both runs
# finished and verified, both users opted in, neither blocking the other, and
# the pair outside its cooldown.
_CANDIDATES_SQL = """
WITH mine AS (
    SELECT at, geog FROM run_traces WHERE run_id = :run
),
hits AS (
    SELECT DISTINCT ON (t.user_id)
           t.run_id, t.user_id, m.at AS crossed_at,
           ST_X(m.geog::geometry) AS crossed_lon,
           ST_Y(m.geog::geometry) AS crossed_lat,
           ST_Distance(t.geog, m.geog) AS closest_m
    FROM run_traces t
    JOIN mine m
      ON t.at BETWEEN m.at - make_interval(secs => :win) AND m.at + make_interval(secs => :win)
     AND ST_DWithin(t.geog, m.geog, :radius)
    WHERE t.user_id <> :me
      AND t.at >= now() - make_interval(hours => :lookback)
    ORDER BY t.user_id, ST_Distance(t.geog, m.geog), ABS(EXTRACT(EPOCH FROM (t.at - m.at))), t.run_id
)
SELECT h.run_id::text, h.user_id::text, h.crossed_at,
       h.crossed_lon, h.crossed_lat,
       COALESCE(pp.encounter_count, 0) AS previous_count,
       EXISTS (
         SELECT 1 FROM paser_links pl
         WHERE pl.status = 'accepted'
           AND ((pl.requester_id = CAST(:me AS uuid) AND pl.addressee_id = h.user_id)
             OR (pl.addressee_id = CAST(:me AS uuid) AND pl.requester_id = h.user_id))
       ) AS accepted_paser
FROM hits h
JOIN runs r ON r.id = h.run_id
LEFT JOIN paserby_pairs pp
  ON pp.lower_user_id = LEAST(CAST(:me AS uuid), h.user_id)
 AND pp.higher_user_id = GREATEST(CAST(:me AS uuid), h.user_id)
WHERE r.ended_at IS NOT NULL
  AND r.verified
  AND COALESCE(r.visibility, 'public') = 'public'
  AND COALESCE(
        (SELECT s.enabled FROM paserby_settings s WHERE s.user_id = h.user_id),
        :default_enabled
      )
  AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = CAST(:me AS uuid) AND b.blocked_id = h.user_id)
           OR (b.blocker_id = h.user_id AND b.blocked_id = CAST(:me AS uuid))
      )
  AND NOT EXISTS (
        SELECT 1 FROM paserby_pairs p
        WHERE p.lower_user_id = LEAST(CAST(:me AS uuid), h.user_id)
          AND p.higher_user_id = GREATEST(CAST(:me AS uuid), h.user_id)
          AND p.last_encounter_at > now() - make_interval(hours => :cooldown)
      )
  AND (SELECT COUNT(*) FROM paserby_encounters e
       WHERE e.run_a_id = h.run_id OR e.run_b_id = h.run_id) < :max_per_run
ORDER BY previous_count, accepted_paser, h.closest_m, h.user_id
LIMIT :cap
"""

_TRACE_SQL = """
SELECT run_id::text, at, ST_X(geog::geometry), ST_Y(geog::geometry)
FROM run_traces
WHERE run_id = ANY(CAST(:runs AS uuid[]))
ORDER BY run_id, at
"""


def _bearing(a, b):
    """Approximate bearing in degrees; sufficient for short run segments."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    x = math.sin(lon2 - lon1) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _angle_delta(a, b):
    return abs((a - b + 180) % 360 - 180)


def _nearest(trace, at, tolerance_s):
    stamps = [p[0] for p in trace]
    i = bisect_left(stamps, at)
    choices = trace[max(0, i - 1):i + 1]
    if not choices:
        return None
    point = min(choices, key=lambda p: abs((p[0] - at).total_seconds()))
    return point if abs((point[0] - at).total_seconds()) <= tolerance_s else None


def analyse_crossing(mine, theirs, crossed_at):
    """Return co-run evidence and a quality score from two bounded traces.

    Nearby samples must align in time. This prevents the same popular path,
    run minutes apart, from looking like company and avoids any pairwise scan
    outside the already index-narrowed candidate set.
    """
    aligned = []
    for p in mine:
        q = _nearest(theirs, p[0], settings.paserby_trace_alignment_s)
        if q:
            aligned.append((p[0], _metres((p[1], p[2]), (q[1], q[2]))))
    close = [p for p in aligned if p[1] <= settings.paserby_corun_radius_m]
    # Longest continuous nearby spell, not simply first-to-last: two brief
    # crossings on a loop must not be mistaken for minutes spent together.
    close_span = 0.0
    spell_start = previous = None
    max_gap = max(settings.paserby_trace_interval_s * 2.5, settings.paserby_trace_alignment_s)
    for at, _ in close:
        if previous is None or (at - previous).total_seconds() > max_gap:
            spell_start = at
        close_span = max(close_span, (at - spell_start).total_seconds())
        previous = at

    def heading(trace):
        before = [p for p in trace if p[0] <= crossed_at]
        after = [p for p in trace if p[0] >= crossed_at]
        return _bearing(before[-1][1:], after[0][1:]) if before and after and before[-1] != after[0] else None

    ha, hb = heading(mine), heading(theirs)
    delta = _angle_delta(ha, hb) if ha is not None and hb is not None else 90.0
    sustained = close_span >= settings.paserby_corun_min_duration_s
    same_direction = (
        close_span >= settings.paserby_same_direction_min_duration_s
        and delta <= settings.paserby_same_direction_degrees
    )
    later = [d for at, d in aligned if at > crossed_at]
    separated = bool(later and max(later) >= settings.paserby_separation_m)
    quality = min(delta, 180.0) + (35 if separated else 0) - min(close_span, 180) / 6
    nearest = min(aligned, key=lambda p: p[1]) if aligned else None
    return {"valid": bool(nearest and nearest[1] <= settings.paserby_radius_m),
            "crossed_at": nearest[0] if nearest else crossed_at,
            "corun": sustained or same_direction, "quality": quality, "separated": separated,
            "close_duration_s": close_span, "heading_delta": delta}


def cluster_candidates(candidates):
    """Group one physical crowd encounter without exposing that fact outward."""
    clusters = []
    for candidate in sorted(candidates, key=lambda c: (c["crossed_at"], c["user_id"])):
        match = next((group for group in clusters if
            abs((candidate["crossed_at"] - group[0]["crossed_at"]).total_seconds()) <= settings.paserby_cluster_window_s
            and _metres(candidate["point"], group[0]["point"]) <= settings.paserby_cluster_radius_m), None)
        if match is None:
            clusters.append([candidate])
        else:
            match.append(candidate)
    return clusters


def select_discoveries(candidates):
    """Deterministic discovery-first selection with invisible global/group caps."""
    eligible = [c for c in candidates if c.get("valid", True) and not c.get("corun")]
    # Frequent faces remain in history but only fill empty space after genuine
    # discoveries; accepted Pasers receive the same lower-priority treatment.
    def key(c):
        frequent = c["previous_count"] >= settings.paserby_frequent_threshold
        return (frequent, c.get("accepted_paser", False), c["previous_count"], -c["quality"], c["user_id"])
    ranked = sorted(eligible, key=key)
    cluster_of = {}
    for i, group in enumerate(cluster_candidates(ranked)):
        for c in group:
            cluster_of[c["user_id"]] = i
    selected, counts = [], {}
    for candidate in ranked:
        cluster = cluster_of[candidate["user_id"]]
        if counts.get(cluster, 0) >= settings.paserby_max_per_cluster:
            continue
        selected.append(candidate)
        counts[cluster] = counts.get(cluster, 0) + 1
        if len(selected) >= settings.paserby_max_encounters_per_run:
            break
    return selected, len(cluster_of and set(cluster_of.values()))


def process_run(db, run_id) -> int:
    """Find this run's crossings and write them. Returns how many were new.

    Idempotent twice over: `runs.paserby_at` stops the work being repeated, and
    the unique index on the pair of runs means the same crossing processed from
    either side produces exactly one row.
    """
    run = db.execute(
        text(
            "SELECT user_id::text, ended_at, verified, paserby_at FROM runs WHERE id = :r"
        ),
        {"r": str(run_id)},
    ).fetchone()
    if not run or run[1] is None or run[3] is not None:
        return 0
    me, verified = run[0], bool(run[2])

    # Stamp first: a run that produces nothing must not be re-scanned on every
    # later request that asks about it.
    db.execute(
        text("UPDATE runs SET paserby_at = now() WHERE id = :r"), {"r": str(run_id)}
    )
    if not verified or not enabled_for(db, me):
        db.commit()
        return 0

    rows = db.execute(
        text(_CANDIDATES_SQL),
        {
            "run": str(run_id),
            "me": me,
            "win": settings.paserby_time_window_s,
            "radius": settings.paserby_radius_m,
            "lookback": settings.paserby_lookback_hours,
            "cooldown": settings.paserby_pair_cooldown_hours,
            "default_enabled": bool(settings.paserby_default_enabled),
            "cap": settings.paserby_candidate_pool_size,
            "max_per_run": settings.paserby_max_encounters_per_run,
        },
    ).fetchall()

    # Detailed analysis happens only after the indexed spatial/time probe has
    # reduced the world to a bounded candidate pool. One bulk query avoids an
    # N+1 trace fetch even in a race or large club crossing.
    traces = {}
    run_ids = [str(run_id)] + [row[0] for row in rows]
    if rows:
        for trace_run, at, lon, lat in db.execute(text(_TRACE_SQL), {"runs": run_ids}).fetchall():
            traces.setdefault(trace_run, []).append((at, float(lon), float(lat)))

    candidates = []
    for other_run_id, other_user_id, crossed_at, lon, lat, previous_count, accepted_paser in rows:
        evidence = analyse_crossing(
            traces.get(str(run_id), []), traces.get(other_run_id, []), crossed_at
        )
        actual_crossed_at = evidence.pop("crossed_at")
        candidates.append({
            "run_id": other_run_id, "user_id": other_user_id,
            "crossed_at": actual_crossed_at, "point": (float(lon), float(lat)),
            "previous_count": int(previous_count or 0),
            "accepted_paser": bool(accepted_paser), **evidence,
        })
    selected, cluster_count = select_discoveries(candidates)
    log.info(
        "paserby selection raw=%d eligible=%d clusters=%d selected=%d corun_suppressed=%d",
        len(rows), sum(not c["corun"] for c in candidates), cluster_count, len(selected),
        sum(c["corun"] for c in candidates),
    )

    # Lock every involved run in stable order. An encounter belongs to BOTH
    # runs; this prevents two simultaneous finishers from pushing either run
    # over the hard product cap.
    lock_ids = sorted({str(run_id), *(c["run_id"] for c in selected)})
    if lock_ids:
        db.execute(text("SELECT id FROM runs WHERE id = ANY(CAST(:runs AS uuid[])) ORDER BY id FOR UPDATE"), {"runs": lock_ids}).fetchall()

    today = local_today()
    created = 0
    for candidate in selected:
        other_user_id, other_run_id = candidate["user_id"], candidate["run_id"]
        counts = db.execute(text("""
            SELECT r.id::text, COUNT(e.id)
            FROM runs r LEFT JOIN paserby_encounters e ON e.run_a_id=r.id OR e.run_b_id=r.id
            WHERE r.id IN (CAST(:mine AS uuid), CAST(:other AS uuid))
            GROUP BY r.id
        """), {"mine": str(run_id), "other": other_run_id}).fetchall()
        if any(int(n) >= settings.paserby_max_encounters_per_run for _, n in counts):
            continue
        a, b = sorted([me, other_user_id])
        run_a, run_b = (str(run_id), other_run_id) if a == me else (other_run_id, str(run_id))
        made = db.execute(
            text(
                """
                INSERT INTO paserby_encounters
                    (user_a_id, user_b_id, run_a_id, run_b_id, encounter_date)
                VALUES (:a, :b, :ra, :rb, :d)
                ON CONFLICT (run_a_id, run_b_id) DO NOTHING
                RETURNING id::text
                """
            ),
            {"a": a, "b": b, "ra": run_a, "rb": run_b, "d": today},
        ).fetchone()
        if not made:
            continue
        created += 1
        # The counter and the cooldown live on the same row, so they can never
        # disagree about how many times these two have met.
        db.execute(
            text(
                """
                INSERT INTO paserby_pairs
                    (lower_user_id, higher_user_id, encounter_count, last_encounter_at)
                VALUES (:a, :b, 1, now())
                ON CONFLICT (lower_user_id, higher_user_id) DO UPDATE
                SET encounter_count = paserby_pairs.encounter_count + 1,
                    last_encounter_at = now()
                """
            ),
            {"a": a, "b": b},
        )

    sweep_traces(db)
    db.commit()
    return created


def process_run_task(run_id) -> None:
    """Background entry point: own session, never raises into the request.

    The OTHER side is the one told. The runner who just finished is looking at
    their result screen and gets the reveal there; the person who was already
    home has no idea any of this happened, and they are the one for whom a
    badge is worth lighting up. Exactly one encounter per person comes out of a
    single run (see `first_run_of`), so the wording is the singular case —
    a count and nothing else, no name, no place, no time.
    """
    db = SessionLocal()
    try:
        if not process_run(db, run_id):
            return
        others = db.execute(
            text(
                """
                SELECT CASE WHEN e.run_a_id = CAST(:r AS uuid) THEN e.user_b_id::text
                            ELSE e.user_a_id::text END
                FROM paserby_encounters e
                WHERE e.run_a_id = CAST(:r AS uuid) OR e.run_b_id = CAST(:r AS uuid)
                """
            ),
            {"r": str(run_id)},
        ).fetchall()
    except Exception:
        return
    finally:
        db.close()

    for uid in {row[0] for row in others}:
        # `kind` is what the foreground client keys on to raise its own banner
        # (frontend/src/components/CrossroadsAlert.js) rather than letting the
        # push slide past behind the app, and `screen` is where a tap goes.
        notify(
            [uid], "paserby", "Crossroads", crossroads_waiting_line(1),
            {"kind": "paserby_arrival", "screen": "crossroads", "count": 1},
        )


def ensure_processed(db, run_id) -> int:
    """Match this run now if the background task has not already.

    The reveal is the one place where "it will happen shortly" is not good
    enough — the runner is looking at the screen. `paserby_at` makes asking
    twice free.
    """
    stamped = db.execute(
        text("SELECT paserby_at FROM runs WHERE id = :r"), {"r": str(run_id)}
    ).fetchone()
    if stamped and stamped[0] is not None:
        return 0
    return process_run(db, run_id)


# ---------------------------------------------------------------------------
# Reading encounters
# ---------------------------------------------------------------------------

# Everything is phrased from the VIEWER's side, and the viewer's side is
# decided by the ordered pair rather than by anything the client sends.
_MINE = "CASE WHEN e.user_a_id = CAST(:me AS uuid) THEN {a} ELSE {b} END"

_ENCOUNTER_SELECT = f"""
SELECT e.id::text,
       ({_MINE.format(a='e.user_b_id', b='e.user_a_id')})::text AS other_id,
       e.encounter_date,
       ({_MINE.format(a='e.user_a_seen_at', b='e.user_b_seen_at')}) IS NOT NULL AS seen,
       ({_MINE.format(a='e.user_a_high_five_at', b='e.user_b_high_five_at')}) IS NOT NULL AS i_high_fived,
       ({_MINE.format(a='e.user_b_high_five_at', b='e.user_a_high_five_at')}) IS NOT NULL AS they_high_fived,
       COALESCE(p.encounter_count, 1) AS times,
       u.username, u.avatar, u.xp,
       COALESCE(u.solo_elo, 1000), NULL::timestamp,
       c.tag, c.name, c.color_key
FROM paserby_encounters e
JOIN users u
  ON u.id = ({_MINE.format(a='e.user_b_id', b='e.user_a_id')})
LEFT JOIN paserby_pairs p
  ON p.lower_user_id = e.user_a_id AND p.higher_user_id = e.user_b_id
LEFT JOIN clan_members cm ON cm.user_id = u.id
LEFT JOIN clans c ON c.id = cm.clan_id
WHERE (e.user_a_id = CAST(:me AS uuid) OR e.user_b_id = CAST(:me AS uuid))
  AND e.status = 'active'
  AND ({_MINE.format(a='e.user_a_hidden_at', b='e.user_b_hidden_at')}) IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = CAST(:me AS uuid) AND b.blocked_id = u.id)
           OR (b.blocker_id = u.id AND b.blocked_id = CAST(:me AS uuid))
      )
"""


def _card(row, today):
    """One row of `_ENCOUNTER_SELECT` as the client sees it.

    Note what is NOT here: no coordinate, no crossing time, no created_at, no
    run id. `when` is a phrase, and it is the only temporal field.
    """
    from . import elo
    from .clans_meta import color_triple

    times = int(row[6] or 1)
    key, label = familiarity_for(times)
    return {
        "id": row[0],
        "user_id": row[1],
        "username": row[7],
        "avatar": row[8],
        "level": _level(row[9]),
        "rank_key": elo.key_for(row[10], row[11]),
        "clan_tag": row[12],
        "clan_name": row[13],
        "clan_color": color_triple(row[14]) if row[14] else None,
        "when": when_label(row[2], today),
        "times_crossed": times,
        "familiarity": key,
        "familiarity_label": label,
        "seen": bool(row[3]),
        "high_fived": bool(row[4]),
        "high_five_received": bool(row[5]),
    }


def encounters_for(db, user_id, limit: int = 50, offset: int = 0, run_id=None,
                   unseen_only: bool = False):
    """The viewer's encounters, newest first.

    Paged by offset rather than by a timestamp cursor on purpose: a cursor
    would have to be a real `created_at`, and handing the client the exact
    moment two people crossed is the one thing this feature must not do.
    """
    clauses = ""
    params = {"me": str(user_id), "lim": max(1, min(int(limit), 50)), "off": max(0, int(offset))}
    if run_id is not None:
        clauses += " AND (e.run_a_id = CAST(:run AS uuid) OR e.run_b_id = CAST(:run AS uuid))"
        params["run"] = str(run_id)
    if unseen_only:
        clauses += (
            " AND (CASE WHEN e.user_a_id = CAST(:me AS uuid) THEN e.user_a_seen_at"
            " ELSE e.user_b_seen_at END) IS NULL"
        )
    rows = db.execute(
        text(f"{_ENCOUNTER_SELECT}{clauses} ORDER BY e.created_at DESC LIMIT :lim OFFSET :off"),
        params,
    ).fetchall()
    today = local_today()
    return [_card(r, today) for r in rows]


def summary_for(db, user_id) -> dict:
    """What the Home badge needs: the switch, and how many are waiting."""
    row = db.execute(
        text(
            """
            SELECT COUNT(*) FILTER (
                       WHERE (CASE WHEN e.user_a_id = CAST(:me AS uuid)
                                   THEN e.user_a_seen_at ELSE e.user_b_seen_at END) IS NULL
                   ),
                   COUNT(*)
            FROM paserby_encounters e
            WHERE (e.user_a_id = CAST(:me AS uuid) OR e.user_b_id = CAST(:me AS uuid))
              AND e.status = 'active'
              AND (CASE WHEN e.user_a_id = CAST(:me AS uuid)
                        THEN e.user_a_hidden_at ELSE e.user_b_hidden_at END) IS NULL
            """
        ),
        {"me": str(user_id)},
    ).fetchone()
    return {
        "enabled": enabled_for(db, user_id),
        "unseen": int(row[0] or 0) if row else 0,
        "total": int(row[1] or 0) if row else 0,
    }


# ---------------------------------------------------------------------------
# Acting on an encounter
# ---------------------------------------------------------------------------
#
# Every mutation below finds the encounter BY the authenticated user's own id.
# A caller who is not one of the two people in it gets "not found" — there is
# no path where a user id off the wire decides whose row is touched.


def _side(db, user_id, encounter_id):
    """('a'|'b', other_user_id) for an encounter this user belongs to."""
    row = db.execute(
        text(
            "SELECT user_a_id::text, user_b_id::text FROM paserby_encounters "
            "WHERE id = CAST(:e AS uuid) AND status = 'active' "
            "AND (user_a_id = CAST(:me AS uuid) OR user_b_id = CAST(:me AS uuid))"
        ),
        {"e": str(encounter_id), "me": str(user_id)},
    ).fetchone()
    if not row:
        return None, None
    return ("a", row[1]) if row[0] == str(user_id) else ("b", row[0])


def mark_seen(db, user_id, ids=None) -> int:
    """Mark encounters as seen — all of them, or the listed ones."""
    where = (
        " AND id = ANY(CAST(:ids AS uuid[]))" if ids else ""
    )
    params = {"me": str(user_id)}
    if ids:
        params["ids"] = [str(i) for i in ids]
    n = db.execute(
        text(
            f"""
            UPDATE paserby_encounters
            SET user_a_seen_at = CASE WHEN user_a_id = CAST(:me AS uuid)
                                      THEN COALESCE(user_a_seen_at, now()) ELSE user_a_seen_at END,
                user_b_seen_at = CASE WHEN user_b_id = CAST(:me AS uuid)
                                      THEN COALESCE(user_b_seen_at, now()) ELSE user_b_seen_at END
            WHERE (user_a_id = CAST(:me AS uuid) OR user_b_id = CAST(:me AS uuid)){where}
            """
        ),
        params,
    ).rowcount
    db.commit()
    return int(n or 0)


def high_five(db, user_id, encounter_id, username: str | None = None):
    """Send a high five. Once per encounter, ever.

    The XP is a token: `paserby_high_five_xp`, under a daily social ceiling,
    reserved against the encounter in the same grant ledger every other payout
    uses — so a double-tap, a retry or two racing requests pay once. Being over
    the daily cap does NOT block the high five; it just pays nothing.
    """
    side, other_id = _side(db, user_id, encounter_id)
    if side is None:
        return None
    col = "user_a_high_five_at" if side == "a" else "user_b_high_five_at"
    sent = db.execute(
        text(
            f"UPDATE paserby_encounters SET {col} = now() "
            f"WHERE id = CAST(:e AS uuid) AND {col} IS NULL RETURNING id"
        ),
        {"e": str(encounter_id)},
    ).fetchone()
    if not sent:
        db.commit()
        return {"already": True, "high_fived": True, "xp_gained": 0, "user_id": other_id}

    allowance = max(
        0,
        settings.paserby_daily_social_xp_cap
        - economy.granted_today(db, user_id, economy.KIND_SOCIAL_XP),
    )
    xp = min(settings.paserby_high_five_xp, allowance)
    if xp > 0 and economy.grant_once(
        db, user_id, f"paserby:{encounter_id}:high_five", economy.KIND_SOCIAL_XP, xp
    ):
        db.execute(
            text("UPDATE users SET xp = COALESCE(xp, 0) + :g WHERE id = CAST(:u AS uuid)"),
            {"g": xp, "u": str(user_id)},
        )
    else:
        xp = 0
    db.commit()
    return {
        "already": False,
        "high_fived": True,
        "xp_gained": xp,
        "capped": xp == 0,
        "user_id": other_id,
        "username": username,
    }


def hide(db, user_id, encounter_id) -> bool:
    """Take one encounter off the viewer's own Crossroads. The other side keeps
    theirs — hiding is not a mutual act."""
    side, _other = _side(db, user_id, encounter_id)
    if side is None:
        return False
    col = "user_a_hidden_at" if side == "a" else "user_b_hidden_at"
    db.execute(
        text(f"UPDATE paserby_encounters SET {col} = now() WHERE id = CAST(:e AS uuid)"),
        {"e": str(encounter_id)},
    )
    db.commit()
    return True


def block(db, user_id, other_id) -> bool:
    """Block a runner, from either side of an encounter.

    A block is stronger than a hide: the pair's shared history goes, the
    familiar-faces counter goes with it, and the matcher will never pair them
    again (see `_CANDIDATES_SQL`). Deleting rather than tombstoning matches how
    the rest of the app handles a severed link.
    """
    if str(other_id) == str(user_id):
        return False
    db.execute(
        text(
            "INSERT INTO user_blocks (blocker_id, blocked_id) "
            "VALUES (CAST(:me AS uuid), CAST(:them AS uuid)) ON CONFLICT DO NOTHING"
        ),
        {"me": str(user_id), "them": str(other_id)},
    )
    a, b = sorted([str(user_id), str(other_id)])
    db.execute(
        text(
            "DELETE FROM paserby_encounters WHERE user_a_id = CAST(:a AS uuid) "
            "AND user_b_id = CAST(:b AS uuid)"
        ),
        {"a": a, "b": b},
    )
    db.execute(
        text(
            "DELETE FROM paserby_pairs WHERE lower_user_id = CAST(:a AS uuid) "
            "AND higher_user_id = CAST(:b AS uuid)"
        ),
        {"a": a, "b": b},
    )
    db.commit()
    return True


def unblock(db, user_id, other_id) -> bool:
    n = db.execute(
        text(
            "DELETE FROM user_blocks WHERE blocker_id = CAST(:me AS uuid) "
            "AND blocked_id = CAST(:them AS uuid)"
        ),
        {"me": str(user_id), "them": str(other_id)},
    ).rowcount
    db.commit()
    return bool(n)


def is_blocked(db, user_id, other_id) -> bool:
    """True when either runner has blocked the other."""
    if str(user_id) == str(other_id):
        return False
    return bool(
        db.execute(
            text(
                """
                SELECT 1 FROM user_blocks
                WHERE (blocker_id = CAST(:me AS uuid) AND blocked_id = CAST(:them AS uuid))
                   OR (blocker_id = CAST(:them AS uuid) AND blocked_id = CAST(:me AS uuid))
                LIMIT 1
                """
            ),
            {"me": str(user_id), "them": str(other_id)},
        ).fetchone()
    )


def report(
    db, user_id, other_id, reason: str, detail=None, encounter_id=None, surface="content"
) -> str:
    """File a report for moderation. Stored, never acted on automatically."""
    row = db.execute(
        text(
            """
            INSERT INTO user_reports
                (reporter_id, reported_id, surface, reason, detail, encounter_id)
            VALUES (CAST(:me AS uuid), CAST(:them AS uuid), :surface, :reason, :detail,
                    CAST(:enc AS uuid))
            RETURNING id::text
            """
        ),
        {
            "me": str(user_id),
            "them": str(other_id),
            "reason": reason,
            "detail": detail,
            "enc": str(encounter_id) if encounter_id else None,
            "surface": surface,
        },
    ).fetchone()
    db.commit()
    return row[0]
