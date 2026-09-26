"""CLUB RUNS — a run only counts for a club when the club ran it together.

THE RULE. A run is a club run when at least `club_run_min_partners` OTHER
members of the same club ran the same route at the same time. Anything else is
a solo run, whatever club badge the runner is wearing.

WHAT CHANGES AND WHAT DOES NOT. A solo run is still a full run: the distance,
the XP, the energy, the coins, the territory and the runner's own rank ladder
are all untouched. What a solo run no longer produces is anything CLUB shaped —
club land on the map, club XP, weekly goal progress, season area, or a move on
the club rating. The club board therefore stops being "the same map coloured by
who happens to be in a club" and becomes a record of runs a club actually did
together.

ELIGIBILITY IS ONE DEFINITION. `eligible(run)` (Python) and `eligible_sql()`
(the same test in SQL) are the only statement of which runs may take part in
matching at all: verified, finished, and past the REWARD bar. /end-run, the
claim, the probe's partner side and the credit sync all go through them, so a
run can never read SOLO on one endpoint and CLUB on another because two copies
of the condition drifted. The reward bar matters on the partner side too: a
run too short to earn its own runner anything cannot earn their club anything,
whichever of the two finished first.

MATCHING. Two runs are the same route when each one spends at least
`club_run_min_shared_frac` of its length within `club_run_path_tolerance_m` of
the other, and the shared stretch is at least `club_run_min_shared_m` long. The
test is deliberately SYMMETRIC: a 10 km run that happens to contain a
clubmate's 2 km loop is not two people running together, and measuring only the
short run against the long one would call it one. Time is checked the same way,
as an overlap of the two windows with a grace either side, because watches get
started by hand.

Timestamped GPS fixes must also put both runners within 35 metres for at
least 60% of the longer recording. Missing traces and GPS gaps earn no shared
time. This rejects opposite-direction runs and runners following minutes
apart even when their route shapes and overall time windows match.

The metres are measured on a geography cast, so they are metres, not degrees.
The clip itself is planar in 4326, which at these distances is a rounding
error on a threshold that is already a judgement call.

EVERY COMPARISON SAYS WHY. The probe returns every clubmate who was out at the
same time and anywhere near (`club_run_diagnostic_radius_m`), and `judge()`
walks the rules in order and names the first one a pair failed. That verdict
is logged as one `CLUB_RUN_MATCH` line per pair, so a false negative ("we ran
together and it said solo") can be read straight out of the logs. The wider
diagnostic radius changes nothing about who qualifies: a pair that never comes
within the path tolerance shares no metres and fails ROUTE_OVERLAP exactly as
it used to fail the old ST_DWithin filter.

WHOEVER FINISHES SECOND MAKES IT A CLUB RUN FOR BOTH. A partner's run must have
ENDED to be matched, so the first person over the line has nobody to match yet.
`log_run` therefore writes a `club_run_logs` row for the partners' runs too,
once, and returns the ones it logged for the first time so the caller can pay
the club credit those runs missed. The table is what makes that idempotent: a
run is logged for a club exactly once, however many clubmates finish after it.

THE GROUP IS WRITTEN DOWN (migration 0047). Every logged run belongs to a
`club_run_sessions` row: the people who ran together, as one thing. It is
decided at log time, under a per-club advisory lock, and is the only source of
"who ran with whom" — never recomputed, because the probe reads CURRENT club
membership and a partner who later leaves must not vanish from a run they
really did. Two groups that turn out to be one (a late finisher who matched
people in both) are merged into the older session.

The private matching query reads `runs.path` and `runs.together_trace`,
and returns run ids to the caller — never a coordinate, never a route, and
nothing about a runner outside the club. The same holds for live presence:
`runs.live_*` are compared on the server and never leave it.
"""

import logging
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt

from sqlalchemy import text

from . import economy
from .config import settings

log = logging.getLogger("app.club_runs")


# ---------------------------------------------------------------------------
# eligibility
# ---------------------------------------------------------------------------

# The tiers that clear the reward bar. `economy.rewards_earned` is the rule;
# this is the same set spelled out for SQL, and a test holds the two together.
ELIGIBLE_TIERS = (economy.REWARDED, economy.CLAIMABLE)


def _tier(tier):
    # A NULL tier is a row written by something that predates 0023 or does not
    # run the economy (the seeded world's bots). `_end_run_replay` reads the
    # same NULL as CLAIMABLE; matching reads it the same way, so there is one
    # convention. A human run after 0023 always carries a tier.
    return tier or economy.CLAIMABLE


def eligible(run) -> bool:
    """May this run take part in club matching? The single Python statement."""
    return (
        bool(getattr(run, "verified", False))
        and getattr(run, "ended_at", None) is not None
        and economy.rewards_earned(_tier(getattr(run, "tier", None)))
    )


def eligible_sql(alias: str = "r") -> str:
    """The same test as `eligible`, for a `runs` row aliased `alias`."""
    tiers = ", ".join(f"'{t}'" for t in ELIGIBLE_TIERS)
    return (
        f"{alias}.verified AND {alias}.ended_at IS NOT NULL "
        f"AND COALESCE({alias}.tier, '{economy.CLAIMABLE}') IN ({tiers})"
    )


# ---------------------------------------------------------------------------
# the probe
# ---------------------------------------------------------------------------

# Cheap filters first (club membership, eligibility and the time window, all
# indexed or on the row) so the geometry only ever runs against the handful of
# clubmates who were out at the same time; ST_DWithin at the DIAGNOSTIC radius
# then throws out anyone who was nowhere near, and only the survivors are
# measured. The time rules that decide the verdict are SELECTED rather than
# filtered on, so a near miss can say which one it missed — see `judge`.
_PARTNER_SQL = """
WITH mine AS (
    SELECT path                              AS path,
           together_trace,
           ST_Length(path::geography)        AS len_m,
           started_at                        AS started_at,
           COALESCE(ended_at, started_at)    AS ended_at
    FROM runs
    WHERE id = CAST(:run_id AS uuid)
      AND path IS NOT NULL
      AND {mine_eligible}
      AND user_id = CAST(:user_id AS uuid)
)
SELECT r.id::text      AS run_id,
       mine.together_trace AS mine_trace,
       r.together_trace AS theirs_trace,
       r.user_id::text AS user_id,
       COALESCE(r.distance_m, 0) AS distance_m,
       EXTRACT(EPOCH FROM (r.started_at - mine.started_at)) AS start_delta_s,
       EXTRACT(EPOCH FROM (LEAST(r.ended_at, mine.ended_at)
           - GREATEST(r.started_at, mine.started_at)))
         / NULLIF(GREATEST(EXTRACT(EPOCH FROM (r.ended_at - r.started_at)),
                           EXTRACT(EPOCH FROM (mine.ended_at - mine.started_at))), 0)
         AS overlap_frac,
       ST_Length(ST_CollectionExtract(ST_Intersection(
           mine.path, ST_Buffer(r.path::geography, :tol)::geometry
       ), 2)::geography) AS mine_shared_m,
       ST_Length(ST_CollectionExtract(ST_Intersection(
           r.path, ST_Buffer(mine.path::geography, :tol)::geometry
       ), 2)::geography) AS theirs_shared_m,
       mine.len_m                   AS mine_len_m,
       ST_Length(r.path::geography) AS theirs_len_m
FROM mine
JOIN runs r ON r.path IS NOT NULL
JOIN users u ON u.id = r.user_id
JOIN clan_members cm ON cm.user_id = r.user_id AND cm.clan_id = u.clan_id
JOIN clan_members mine_cm ON mine_cm.user_id = CAST(:user_id AS uuid)
    AND mine_cm.clan_id = u.clan_id
WHERE u.clan_id = CAST(:clan_id AS uuid)
  AND r.user_id <> CAST(:user_id AS uuid)
  AND r.id <> CAST(:run_id AS uuid)
  AND cm.joined_at <= r.started_at
  AND mine_cm.joined_at <= mine.started_at
  AND {theirs_eligible}
  AND r.started_at <= mine.ended_at + make_interval(secs => :grace)
  AND r.ended_at >= mine.started_at - make_interval(secs => :grace)
  AND ST_DWithin(r.path::geography, mine.path::geography, :probe_m)
ORDER BY ABS(EXTRACT(EPOCH FROM (r.started_at - mine.started_at)))
LIMIT :cap
""".format(
    mine_eligible=eligible_sql("runs").replace("runs.", ""),
    theirs_eligible=eligible_sql("r"),
)


def partner_sql() -> str:
    """The probe, exposed so a test can hold the rules to it without a database."""
    return _PARTNER_SQL


def record_trace(points):
    """Keep one private timestamped fix per five seconds for club matching."""
    trace = []
    for p in sorted(points, key=lambda p: p.t):
        t = p.t.replace(tzinfo=timezone.utc).timestamp()
        if p.accuracy_m is not None and p.accuracy_m > 35:
            continue
        if not trace or t - trace[-1][0] >= 5:
            trace.append([t, p.lat, p.lon])
    return trace


def _metres(a_lat, a_lon, b_lat, b_lon) -> float:
    lat1, lat2 = radians(a_lat), radians(b_lat)
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin(radians(b_lon - a_lon) / 2) ** 2
    return 6371000 * 2 * asin(sqrt(min(1, h)))


def together_ratio(mine, theirs):
    """Share of the longer recording the two runners spent side by side.

    None when there is no evidence to measure at all (a missing or one-fix
    trace). Time is sampled uniformly so a burst of GPS fixes cannot outweigh
    minutes apart, and gaps earn nothing.
    """
    if not mine or not theirs or len(mine) < 2 or len(theirs) < 2:
        return None
    duration = max(mine[-1][0] - mine[0][0], theirs[-1][0] - theirs[0][0])
    start, end = max(mine[0][0], theirs[0][0]), min(mine[-1][0], theirs[-1][0])
    if duration <= 0 or end <= start:
        return 0.0
    times = [[p[0] for p in trace] for trace in (mine, theirs)]
    shared = 0
    t = start
    while t + 10 <= end:
        fixes = []
        for trace, stamps in zip((mine, theirs), times):
            i = bisect_left(stamps, t)
            candidates = trace[max(0, i - 1):i + 1]
            fix = min(candidates, key=lambda p: abs(p[0] - t))
            if abs(fix[0] - t) > 10:
                break
            fixes.append(fix)
        if len(fixes) == 2:
            a, b = fixes
            if _metres(a[1], a[2], b[1], b[2]) <= settings.club_run_path_tolerance_m:
                shared += 10
        t += 10
    return shared / duration


def nearby_in_time(mine, theirs):
    """Require nearby fixes throughout both recordings; gaps earn no credit.

    Missing historical traces fail closed.
    """
    ratio = together_ratio(mine, theirs)
    return ratio is not None and ratio >= settings.club_run_min_shared_frac


def shared_fraction(shared_m, length_m) -> float:
    """How much of a run was spent alongside the other one, 0..1.

    A run with no measurable length shares nothing — returning 1.0 for 0/0
    would make every degenerate two-point trace a club run with everybody.
    """
    length = float(length_m or 0.0)
    if length <= 0:
        return 0.0
    return max(0.0, min(1.0, float(shared_m or 0.0) / length))


def ran_together(mine_frac: float, theirs_frac: float, shared_m: float) -> bool:
    """Did these two runs happen together?

    Symmetric on purpose — see the module docstring. The absolute floor is
    checked as well as the fraction so two 200 m shuffles round the same block
    cannot be a club run at 100%.
    """
    return (
        min(mine_frac, theirs_frac) >= settings.club_run_min_shared_frac
        and float(shared_m or 0.0) >= settings.club_run_min_shared_m
    )


# The order `judge` checks in, which is also the order a near miss is blamed:
# the first rule a pair failed is the one reported.
REASON_QUALIFIED = "QUALIFIED"
REASON_START_DELTA = "START_DELTA"
REASON_DURATION_OVERLAP = "DURATION_OVERLAP"
REASON_ROUTE_OVERLAP = "ROUTE_OVERLAP"
REASON_SHARED_DISTANCE = "SHARED_DISTANCE"
REASON_NO_TRACE = "NO_TRACE"
REASON_TEMPORAL_PROXIMITY = "TEMPORAL_PROXIMITY"


def judge(row) -> dict:
    """One candidate pair, every measurement, and the verdict.

    The rules are exactly the ones the probe used to apply as filters, in the
    same terms and against the same settings; only now a failure is named
    instead of silently dropped.
    """
    start_delta = getattr(row, "start_delta_s", None)
    overlap = getattr(row, "overlap_frac", None)
    route_a = shared_fraction(row.mine_shared_m, row.mine_len_m)
    route_b = shared_fraction(row.theirs_shared_m, row.theirs_len_m)
    shared_m = min(float(row.mine_shared_m or 0.0), float(row.theirs_shared_m or 0.0))
    frac = settings.club_run_min_shared_frac

    metrics = {
        "start_delta_s": None if start_delta is None else round(float(start_delta)),
        "duration_overlap": None if overlap is None else round(float(overlap), 3),
        "route_overlap_a": round(route_a, 3),
        "route_overlap_b": round(route_b, 3),
        "shared_distance_m": round(shared_m),
        "temporal_proximity_ratio": None,
    }

    def verdict(reason):
        return {"ok": reason == REASON_QUALIFIED, "reason": reason, **metrics}

    if start_delta is not None and abs(float(start_delta)) > settings.club_run_time_grace_s:
        return verdict(REASON_START_DELTA)
    if overlap is None or float(overlap) < frac:
        return verdict(REASON_DURATION_OVERLAP)
    if min(route_a, route_b) < frac:
        return verdict(REASON_ROUTE_OVERLAP)
    if shared_m < settings.club_run_min_shared_m:
        return verdict(REASON_SHARED_DISTANCE)
    ratio = together_ratio(row.mine_trace, row.theirs_trace)
    metrics["temporal_proximity_ratio"] = None if ratio is None else round(ratio, 3)
    if ratio is None:
        return verdict(REASON_NO_TRACE)
    if ratio < frac:
        return verdict(REASON_TEMPORAL_PROXIMITY)
    return verdict(REASON_QUALIFIED)


def _log_verdict(run_id, row, v) -> None:
    # One line per compared pair, only ever for clubmates who were out at the
    # same time nearby, so the volume is bounded by real group runs. INFO for
    # the near misses and matches alike: a false negative is only diagnosable
    # if its line exists in production.
    log.info(
        "CLUB_RUN_MATCH run_a=%s run_b=%s same_club=true start_delta_s=%s "
        "duration_overlap=%s route_overlap_a=%s route_overlap_b=%s "
        "shared_distance_m=%s temporal_proximity_ratio=%s result=%s reason=%s",
        run_id, row.run_id, v["start_delta_s"], v["duration_overlap"],
        v["route_overlap_a"], v["route_overlap_b"], v["shared_distance_m"],
        v["temporal_proximity_ratio"], "QUALIFIED" if v["ok"] else "REJECTED", v["reason"],
    )


def enough(partners) -> bool:
    """Two or more people, expressed as the partners one of them needs."""
    return len({p["user_id"] for p in partners}) >= settings.club_run_min_partners


def partners_for(db, run_id, user_id, clan_id) -> list[dict]:
    """The clubmates who ran this run with its owner. Empty for a clubless
    runner, and empty rather than an error for a run with no stored path."""
    if not clan_id:
        return []
    rows = db.execute(
        text(_PARTNER_SQL),
        {
            "run_id": str(run_id),
            "user_id": str(user_id),
            "clan_id": str(clan_id),
            "tol": settings.club_run_path_tolerance_m,
            "grace": settings.club_run_time_grace_s,
            "probe_m": max(
                settings.club_run_diagnostic_radius_m, settings.club_run_path_tolerance_m
            ),
            "cap": settings.club_run_max_partners,
        },
    ).fetchall()
    found = []
    for row in rows:
        v = judge(row)
        _log_verdict(run_id, row, v)
        if v["ok"]:
            found.append(
                {
                    "run_id": row.run_id,
                    "user_id": row.user_id,
                    "distance_m": float(row.distance_m or 0.0),
                    "shared": round(min(v["route_overlap_a"], v["route_overlap_b"]), 3),
                    "shared_m": float(v["shared_distance_m"]),
                }
            )
    if not rows:
        log.debug("CLUB_RUN_PROBE run=%s candidates=0", run_id)
    return found


# ---------------------------------------------------------------------------
# logging a club run, and the group it belongs to
# ---------------------------------------------------------------------------

def _lock_club(db, clan_id) -> None:
    """Serialise club-run logging per club for the rest of the transaction.

    Two clubmates finishing at the same moment would otherwise each see no
    session yet and each open one. An advisory lock keyed on the club is the
    smallest thing that makes "is there a session already?" authoritative.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"club_run:{clan_id}"},
    )


def log_run(db, run_id, user_id, clan_id) -> tuple:
    """Decide whether this run was a club run, and record it if it was.

    Returns `(clan_id_or_None, partners, newly_logged)`. `newly_logged` is the
    subset of `partners` whose own run had not been logged for this club
    before, which is exactly the club credit those earlier finishers went
    without — see the module docstring. Caller commits.
    """
    partners = partners_for(db, run_id, user_id, clan_id)
    if not enough(partners):
        return (None, [], [])

    _lock_club(db, clan_id)
    best_shared = max((p.get("shared_m") or 0.0) for p in partners)
    _log_one(db, run_id, user_id, clan_id, len(partners), best_shared)
    newly_logged = []
    for partner in partners:
        # Their partner count is recorded as this group's size. Working out
        # each partner's own exact count would mean running everybody's probe
        # from inside one runner's request, and the number is a note on the
        # row, not something any rule reads. The EXACT group is the session.
        if _log_one(
            db, partner["run_id"], partner["user_id"], clan_id, len(partners),
            partner.get("shared_m"),
        ):
            newly_logged.append(partner)
    attach_session(db, clan_id, [run_id] + [p["run_id"] for p in partners])
    return (str(clan_id), partners, newly_logged)


def _log_one(db, run_id, user_id, clan_id, partners: int, shared_m=None) -> bool:
    """Write one run's club log row. True only the first time — the primary
    key, not a prior SELECT, is what stops a run being paid for twice.

    A second sighting of an already logged run only ever RAISES its measured
    shared metres (a better partner was found), and only within the same club.
    """
    row = db.execute(
        text(
            """
            INSERT INTO club_run_logs (run_id, user_id, clan_id, partners, shared_m)
            VALUES (CAST(:run_id AS uuid), CAST(:user_id AS uuid),
                    CAST(:clan_id AS uuid), :partners, :shared_m)
            ON CONFLICT (run_id) DO UPDATE
                SET shared_m = GREATEST(COALESCE(club_run_logs.shared_m, 0),
                                        COALESCE(EXCLUDED.shared_m, 0))
                WHERE club_run_logs.clan_id = EXCLUDED.clan_id
            RETURNING (xmax = 0) AS inserted
            """
        ),
        {
            "run_id": str(run_id),
            "user_id": str(user_id),
            "clan_id": str(clan_id),
            "partners": int(partners),
            "shared_m": None if shared_m is None else float(shared_m),
        },
    ).fetchone()
    return bool(row and row[0])


def attach_session(db, clan_id, run_ids) -> str | None:
    """Put these logged runs into one session, merging any they already span.

    Called under `_lock_club`. The OLDEST existing session survives a merge,
    so a feed card that was already on screen keeps its identity.
    """
    ids = [str(r) for r in run_ids if r]
    if not ids or not clan_id:
        return None
    existing = db.execute(
        text(
            """
            SELECT s.id::text
            FROM club_run_sessions s
            WHERE s.id IN (
                SELECT session_id FROM club_run_logs
                WHERE run_id = ANY(CAST(:ids AS uuid[])) AND session_id IS NOT NULL
            )
            ORDER BY s.created_at, s.id
            """
        ),
        {"ids": ids},
    ).fetchall()
    if existing:
        keep = existing[0][0]
        others = [r[0] for r in existing[1:]]
        if others:
            db.execute(
                text(
                    "UPDATE club_run_logs SET session_id = CAST(:keep AS uuid) "
                    "WHERE session_id = ANY(CAST(:others AS uuid[]))"
                ),
                {"keep": keep, "others": others},
            )
            db.execute(
                text("DELETE FROM club_run_sessions WHERE id = ANY(CAST(:others AS uuid[]))"),
                {"others": others},
            )
    else:
        keep = db.execute(
            text(
                """
                INSERT INTO club_run_sessions (clan_id, started_at, ended_at)
                SELECT CAST(:cid AS uuid), MIN(started_at),
                       MAX(COALESCE(ended_at, started_at))
                FROM runs WHERE id = ANY(CAST(:ids AS uuid[]))
                RETURNING id::text
                """
            ),
            {"cid": str(clan_id), "ids": ids},
        ).scalar()
    db.execute(
        text(
            "UPDATE club_run_logs SET session_id = CAST(:sid AS uuid) "
            "WHERE run_id = ANY(CAST(:ids AS uuid[])) AND clan_id = CAST(:cid AS uuid)"
        ),
        {"sid": keep, "ids": ids, "cid": str(clan_id)},
    )
    db.execute(
        text(
            """
            UPDATE club_run_sessions s
            SET started_at = b.started_at, ended_at = b.ended_at, updated_at = now()
            FROM (
                SELECT MIN(r.started_at) AS started_at,
                       MAX(COALESCE(r.ended_at, r.started_at)) AS ended_at
                FROM club_run_logs cr JOIN runs r ON r.id = cr.run_id
                WHERE cr.session_id = CAST(:sid AS uuid)
            ) b
            WHERE s.id = CAST(:sid AS uuid) AND b.started_at IS NOT NULL
            """
        ),
        {"sid": keep},
    )
    return keep


def attribute_territories(db, run_ids, clan_id) -> int:
    """Hand a club the land its earlier finishers already claimed.

    Only rows that are still un-attributed are touched: a territory that
    already belongs to a club was won by a club run of its own, and a claim
    that merged into it has already had its say on the owner's colour.
    """
    ids = [str(r) for r in run_ids if r]
    if not ids or not clan_id:
        return 0
    result = db.execute(
        text(
            """
            UPDATE territories
            SET clan_id = CAST(:clan_id AS uuid)
            WHERE run_id = ANY(CAST(:ids AS uuid[]))
              AND clan_id IS NULL
            """
        ),
        {"ids": ids, "clan_id": str(clan_id)},
    )
    return int(result.rowcount or 0)


_SYNC_SQL = """
    SELECT r.id, r.user_id, r.distance_m, r.reward_xp, r.claim_result,
           r.claimed_at, EXISTS(SELECT 1 FROM territories t WHERE t.run_id=r.id) AS has_land
    FROM runs r JOIN club_run_logs cr ON cr.run_id=r.id
    WHERE r.id = ANY(CAST(:ids AS uuid[])) AND cr.clan_id=CAST(:cid AS uuid)
      AND {eligible} ORDER BY r.id
""".format(eligible=eligible_sql("r"))


def sync_credit(db, run_ids, clan_id):
    """Catch up both finishers, once per distance/claim/XP award."""
    from .routes.clans import record_clan_activity, add_clan_xp
    if not clan_id:
        return False, None
    attribute_territories(db, run_ids, clan_id)
    rows = db.execute(
        text(_SYNC_SQL), {"ids": [str(r) for r in run_ids], "cid": str(clan_id)}
    ).fetchall()
    reached = False
    for r in rows:
        claim = r.claim_result or {}
        distance = 0.0
        closed = False
        if economy.claim_grant(db, r.user_id, r.id, 'club_distance', 1):
            distance = float(r.distance_m or 0)
        if r.claimed_at and (claim or r.has_land):
            closed = economy.claim_grant(db, r.user_id, r.id, 'club_claim', 1)
        hit, _ = record_clan_activity(db, r.user_id, clan_id, distance,
                                     closed, float(claim.get('stolen_m2', 0)) if closed else 0)
        reached = reached or hit
        for kind, amount in [('club_run_xp', r.reward_xp),
                             ('club_claim_xp', claim.get('xp_gained'))]:
            if amount and economy.claim_grant(db, r.user_id, r.id, kind, int(amount)):
                add_clan_xp(db, clan_id, int(amount))
    return reached, str(clan_id)


# ---------------------------------------------------------------------------
# live presence (the running screen) and "still out" (the first finisher)
# ---------------------------------------------------------------------------

# A live fix older than this is not "now". /submit-path fires every few fixes,
# so a runner still out refreshes well inside it.
LIVE_FRESH_S = 120
# Close enough to call "nearby" on a running screen. "Together" is the path
# tolerance itself, the same distance the verdict uses.
NEARBY_M = 150.0
# How near a still-running clubmate's latest fix must be to a finished run's
# route for "waiting for them to finish" to be worth saying.
WAITING_NEAR_M = 300.0
# How long a finished run may keep waiting before the answer is simply solo.
WAITING_FOR_S = 3 * 3600


def record_live(run, points) -> None:
    """Keep the newest fix of a run in progress. Never read back to anyone."""
    if not points or run.ended_at is not None:
        return
    last = max(points, key=lambda p: p.t)
    run.live_lat, run.live_lon = float(last.lat), float(last.lon)
    run.live_at = datetime.utcnow()


def presence(db, run, clan_id) -> dict | None:
    """Which clubmates are out right now, close to this runner.

    Social status only, never a verdict: "running together" here means within
    the path tolerance at this moment, which is necessary for a club run and
    nowhere near sufficient. The verdict is still made at the end.
    """
    if not clan_id or run.live_lat is None or run.live_at is None:
        return None
    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username, u.avatar,
                   ST_Distance(
                       ST_SetSRID(ST_MakePoint(r.live_lon, r.live_lat), 4326)::geography,
                       ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                   ) AS metres
            FROM runs r
            JOIN users u ON u.id = r.user_id
            WHERE u.clan_id = CAST(:cid AS uuid)
              AND r.user_id <> CAST(:uid AS uuid)
              AND r.ended_at IS NULL
              AND r.live_at IS NOT NULL
              AND r.live_at >= :fresh
              AND ABS(EXTRACT(EPOCH FROM (r.started_at - :started))) <= :grace
              AND ST_DWithin(
                  ST_SetSRID(ST_MakePoint(r.live_lon, r.live_lat), 4326)::geography,
                  ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                  :near
              )
            ORDER BY metres
            LIMIT 6
            """
        ),
        {
            "cid": str(clan_id), "uid": str(run.user_id),
            "lat": run.live_lat, "lon": run.live_lon,
            "fresh": datetime.utcnow() - timedelta(seconds=LIVE_FRESH_S),
            "started": run.started_at,
            "grace": settings.club_run_time_grace_s,
            "near": NEARBY_M,
        },
    ).fetchall()
    mates = [
        {
            "user_id": r[0],
            "username": r[1],
            "avatar": r[2],
            "together": float(r[3] or 0) <= settings.club_run_path_tolerance_m,
        }
        for r in rows
    ]
    if not mates:
        return {"state": "none", "clubmates": []}
    state = "together" if any(m["together"] for m in mates) else "nearby"
    return {"state": state, "clubmates": mates}


def still_running_with(db, run, clan_id) -> list[dict]:
    """Clubmates still out who could yet make this finished run a club run.

    Evidence, not hope: they started inside the matching grace, their app
    reported a position in the last few minutes, and that position is close to
    this run's route. A clubmate out across town at the same hour is not
    listed. The UI says "may count", never "confirmed".
    """
    if not clan_id or run.ended_at is None or run.path is None:
        return []
    if (datetime.utcnow() - run.ended_at).total_seconds() > WAITING_FOR_S:
        return []
    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username, u.avatar
            FROM runs r
            JOIN users u ON u.id = r.user_id
            JOIN runs mine ON mine.id = CAST(:rid AS uuid)
            WHERE u.clan_id = CAST(:cid AS uuid)
              AND r.user_id <> mine.user_id
              AND r.ended_at IS NULL
              AND r.live_at IS NOT NULL
              AND r.live_at >= :fresh
              AND ABS(EXTRACT(EPOCH FROM (r.started_at - mine.started_at))) <= :grace
              AND ST_DWithin(
                  ST_SetSRID(ST_MakePoint(r.live_lon, r.live_lat), 4326)::geography,
                  mine.path::geography,
                  :near
              )
            ORDER BY r.started_at
            LIMIT 6
            """
        ),
        {
            "rid": str(run.id), "cid": str(clan_id),
            "fresh": datetime.utcnow() - timedelta(seconds=LIVE_FRESH_S * 5),
            "grace": settings.club_run_time_grace_s,
            "near": WAITING_NEAR_M,
        },
    ).fetchall()
    return [{"user_id": r[0], "username": r[1], "avatar": r[2]} for r in rows]


# ---------------------------------------------------------------------------
# reading a session back: the reveal, the feed card, the history
# ---------------------------------------------------------------------------

CLUB_GRANT_KINDS = ("club_distance", "club_claim", "club_run_xp", "club_claim_xp")


def _club_xp(amount) -> int:
    # Mirrors add_clan_xp exactly: what the club total actually moved by.
    return int(round(int(amount or 0) * settings.club_xp_share))


def describe_sessions(db, session_ids, viewer_id=None) -> dict:
    """Everything a card can truthfully say about these sessions.

    Every number is read from a record of what happened, never estimated:
    participants from the log, distance from the runs, "together" from the
    metres PostGIS measured at match time, ground from each claim's stored
    result, club XP and weekly progress from the grant ledger that paid them.
    A figure with no record (an old row, an unclaimed run) is None, and the
    client leaves it off rather than showing a zero that did not happen.
    """
    sids = [str(s) for s in session_ids if s]
    if not sids:
        return {}
    heads = db.execute(
        text(
            """
            SELECT s.id::text, s.clan_id::text, s.started_at, s.ended_at,
                   c.name, c.tag, c.color_key, c.badge_icon, c.photo_etag
            FROM club_run_sessions s JOIN clans c ON c.id = s.clan_id
            WHERE s.id = ANY(CAST(:sids AS uuid[]))
            """
        ),
        {"sids": sids},
    ).fetchall()
    people = db.execute(
        text(
            """
            SELECT cr.session_id::text, cr.run_id::text, cr.user_id::text,
                   u.username, u.avatar, COALESCE(u.solo_elo, 1000),
                   COALESCE(r.distance_m, 0), cr.shared_m, r.claimed_at,
                   (r.claim_result ->> 'gained_m2')::float,
                   r.started_at
            FROM club_run_logs cr
            JOIN runs r ON r.id = cr.run_id
            JOIN users u ON u.id = cr.user_id
            WHERE cr.session_id = ANY(CAST(:sids AS uuid[]))
            ORDER BY r.started_at, cr.run_id
            """
        ),
        {"sids": sids},
    ).fetchall()
    run_ids = [p[1] for p in people]
    grants = db.execute(
        text(
            """
            SELECT run_id::text, kind, amount, created_at
            FROM reward_grants
            WHERE run_id = ANY(CAST(:rids AS uuid[]))
              AND kind = ANY(CAST(:kinds AS text[]))
            """
        ),
        {"rids": run_ids, "kinds": list(CLUB_GRANT_KINDS)},
    ).fetchall() if run_ids else []
    steals = db.execute(
        text(
            """
            SELECT ts.run_id::text, SUM(ts.area_m2), c.tag, c.name
            FROM territory_steals ts
            JOIN users v ON v.id = ts.victim_id
            LEFT JOIN clans c ON c.id = v.clan_id
            WHERE ts.run_id = ANY(CAST(:rids AS uuid[])) AND NOT ts.defended
            GROUP BY ts.run_id, c.tag, c.name
            """
        ),
        {"rids": run_ids},
    ).fetchall() if run_ids else []

    from . import elo  # local: elo imports settings and nothing of ours
    from .routes.clans import _week_start

    week_start = datetime.combine(_week_start(), datetime.min.time())
    by_run_grants = {}
    for g in grants:
        by_run_grants.setdefault(g[0], []).append(g)
    by_run_steals = {}
    for s in steals:
        by_run_steals.setdefault(s[0], []).append(s)

    out = {}
    for h in heads:
        out[h[0]] = {
            "session_id": h[0],
            "club_id": h[1],
            "started_at": h[2],
            "ended_at": h[3],
            "club_name": h[4],
            "club_tag": h[5],
            "color_key": h[6],
            "badge_icon": h[7] or "shield",
            "photo_etag": h[8],
            "participants": [],
            "shared_distance_m": None,
            "distance_m": 0.0,
            "territory_gained_m2": None,
            "captured_m2": 0.0,
            "captured_from": [],
            "club_xp_earned": 0,
            "week_added_distance_m": 0.0,
            "week_added_claims": 0,
        }
    for p in people:
        s = out.get(p[0])
        if s is None:
            continue
        s["participants"].append(
            {
                "user_id": p[2],
                "run_id": p[1],
                "username": p[3],
                "avatar": p[4],
                "rank_key": elo.key_for(p[5]),
                "distance_m": float(p[6] or 0),
                "is_you": viewer_id is not None and p[2] == str(viewer_id),
            }
        )
        s["distance_m"] = max(s["distance_m"], float(p[6] or 0))
        if p[7] is not None:
            s["shared_distance_m"] = max(s["shared_distance_m"] or 0.0, float(p[7]))
        if p[8] is not None and p[9] is not None:
            s["territory_gained_m2"] = (s["territory_gained_m2"] or 0.0) + max(0.0, float(p[9]))
        for g in by_run_grants.get(p[1], []):
            kind, amount, created = g[1], g[2], g[3]
            if kind in ("club_run_xp", "club_claim_xp"):
                s["club_xp_earned"] += _club_xp(amount)
            elif kind == "club_distance" and created >= week_start:
                s["week_added_distance_m"] += float(p[6] or 0)
            elif kind == "club_claim" and created >= week_start:
                s["week_added_claims"] += 1
        for st in by_run_steals.get(p[1], []):
            s["captured_m2"] += float(st[1] or 0)
            label = st[3] or None
            if label and label not in s["captured_from"]:
                s["captured_from"].append(label)
    return out


def session_for_run(db, run_id) -> str | None:
    row = db.execute(
        text("SELECT session_id::text FROM club_run_logs WHERE run_id = CAST(:r AS uuid)"),
        {"r": str(run_id)},
    ).fetchone()
    return row[0] if row else None


def status_for_run(db, run, viewer_id, member_clan_id=None) -> dict:
    """SOLO, POTENTIAL or CONFIRMED for one run, as the server knows it now.

    CONFIRMED only when this run's own log row exists, i.e. the verdict has
    been reached and written. POTENTIAL only with live evidence that a
    clubmate who could still match is out near this route. Everything else is
    SOLO, which is also the honest answer for a run that is not eligible.
    """
    sid = session_for_run(db, run.id)
    if sid:
        detail = describe_sessions(db, [sid], viewer_id).get(sid)
        if detail:
            me = next((p for p in detail["participants"] if p["run_id"] == str(run.id)), None)
            own_shared = db.execute(
                text("SELECT shared_m FROM club_run_logs WHERE run_id = CAST(:r AS uuid)"),
                {"r": str(run.id)},
            ).scalar()
            detail = dict(detail)
            detail.update(
                {
                    "state": "confirmed",
                    "qualified": True,
                    "participant_count": len(detail["participants"]),
                    # "6.8 km together" is THIS runner's measured stretch.
                    "shared_distance_m": None if own_shared is None else float(own_shared),
                    "your_distance_m": me["distance_m"] if me else None,
                    "waiting_for": [],
                }
            )
            return detail
    waiting = []
    if member_clan_id and eligible(run):
        waiting = still_running_with(db, run, member_clan_id)
    return {
        "state": "potential" if waiting else "solo",
        "qualified": False,
        "club_id": str(member_clan_id) if waiting else None,
        "participants": [],
        "participant_count": 0,
        "waiting_for": waiting,
    }


def notify_confirmed(background, db, finisher_id, finisher_name, newly) -> None:
    """Tell each earlier finisher, once, that their run just became a club run.

    `newly` comes from `log_run` and holds a run only the first time it is
    logged, so however many clubmates finish after them, a runner hears this
    exactly once per run. Bots have nobody to tell.
    """
    if not newly:
        return
    from .notifications import notify

    ids = [p["user_id"] for p in newly]
    humans = db.execute(
        text(
            "SELECT id::text FROM users WHERE id = ANY(CAST(:ids AS uuid[])) "
            "AND NOT COALESCE(is_bot, false)"
        ),
        {"ids": ids},
    ).fetchall()
    human_ids = {r[0] for r in humans}
    for p in newly:
        if p["user_id"] not in human_ids:
            continue
        background.add_task(
            notify, [p["user_id"]], "club_run",
            "Club run confirmed",
            f"{finisher_name} finished. You ran this one together.",
            {"screen": "club_run", "run_id": p["run_id"]},
            finisher_id,
        )
