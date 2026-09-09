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

MATCHING. Two runs are the same route when each one spends at least
`club_run_min_shared_frac` of its length within `club_run_path_tolerance_m` of
the other, and the shared stretch is at least `club_run_min_shared_m` long. The
test is deliberately SYMMETRIC: a 10 km run that happens to contain a
clubmate's 2 km loop is not two people running together, and measuring only the
short run against the long one would call it one. Time is checked the same way,
as an overlap of the two windows with a grace either side, because watches get
started by hand.

The metres are measured on a geography cast, so they are metres, not degrees.
The clip itself is planar in 4326, which at these distances is a rounding
error on a threshold that is already a judgement call.

WHOEVER FINISHES SECOND MAKES IT A CLUB RUN FOR BOTH. A partner's run must have
ENDED to be matched, so the first person over the line has nobody to match yet.
`log_run` therefore writes a `club_run_logs` row for the partners' runs too,
once, and returns the ones it logged for the first time so the caller can pay
the club credit those runs missed. The table is what makes that idempotent: a
run is logged for a club exactly once, however many clubmates finish after it.

Nothing here is a privacy surface. It reads `runs.path`, which the app already
stores, inside one query, and returns run ids to the caller — never a
coordinate, never a route, and nothing about a runner outside the club.
"""

from sqlalchemy import text

from .config import settings


# The candidate probe. Cheap filters first (club membership and the time
# window, both indexed) so the geometry only ever runs against the handful of
# clubmates who were out at the same time; ST_DWithin then throws out anyone
# who was out but nowhere near, and only the survivors are measured.
_PARTNER_SQL = """
WITH mine AS (
    SELECT path                              AS path,
           ST_Length(path::geography)        AS len_m,
           started_at                        AS started_at,
           COALESCE(ended_at, started_at)    AS ended_at
    FROM runs
    WHERE id = CAST(:run_id AS uuid)
      AND path IS NOT NULL
)
SELECT r.id::text      AS run_id,
       r.user_id::text AS user_id,
       COALESCE(r.distance_m, 0) AS distance_m,
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
  AND r.verified
  AND r.ended_at IS NOT NULL
  AND r.started_at <= mine.ended_at + make_interval(secs => :grace)
  AND r.ended_at >= mine.started_at - make_interval(secs => :grace)
  AND ST_DWithin(r.path::geography, mine.path::geography, :tol)
  AND ABS(EXTRACT(EPOCH FROM (r.started_at - mine.started_at))) <= :grace
  AND EXTRACT(EPOCH FROM (LEAST(r.ended_at, mine.ended_at)
      - GREATEST(r.started_at, mine.started_at))) >= :time_frac *
      GREATEST(EXTRACT(EPOCH FROM (r.ended_at - r.started_at)),
               EXTRACT(EPOCH FROM (mine.ended_at - mine.started_at)))
ORDER BY r.started_at
LIMIT :cap
"""


def partner_sql() -> str:
    """The probe, exposed so a test can hold the rules to it without a database."""
    return _PARTNER_SQL


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
            "time_frac": settings.club_run_min_shared_frac,
            "cap": settings.club_run_max_partners,
        },
    ).fetchall()
    found = []
    for row in rows:
        mine = shared_fraction(row.mine_shared_m, row.mine_len_m)
        theirs = shared_fraction(row.theirs_shared_m, row.theirs_len_m)
        shared_m = min(float(row.mine_shared_m or 0.0), float(row.theirs_shared_m or 0.0))
        if ran_together(mine, theirs, shared_m):
            found.append(
                {
                    "run_id": row.run_id,
                    "user_id": row.user_id,
                    "distance_m": float(row.distance_m or 0.0),
                    "shared": round(min(mine, theirs), 3),
                }
            )
    return found


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

    _log_one(db, run_id, user_id, clan_id, len(partners))
    newly_logged = []
    for partner in partners:
        # Their partner count is recorded as this group's size. Working out
        # each partner's own exact count would mean running everybody's probe
        # from inside one runner's request, and the number is a note on the
        # row, not something any rule reads.
        if _log_one(db, partner["run_id"], partner["user_id"], clan_id, len(partners)):
            newly_logged.append(partner)
    return (str(clan_id), partners, newly_logged)


def _log_one(db, run_id, user_id, clan_id, partners: int) -> bool:
    """Write one run's club log row. True only the first time — the primary
    key, not a prior SELECT, is what stops a run being paid for twice."""
    inserted = db.execute(
        text(
            """
            INSERT INTO club_run_logs (run_id, user_id, clan_id, partners)
            VALUES (CAST(:run_id AS uuid), CAST(:user_id AS uuid),
                    CAST(:clan_id AS uuid), :partners)
            ON CONFLICT (run_id) DO NOTHING
            RETURNING run_id
            """
        ),
        {
            "run_id": str(run_id),
            "user_id": str(user_id),
            "clan_id": str(clan_id),
            "partners": int(partners),
        },
    ).fetchone()
    return inserted is not None


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


def sync_credit(db, run_ids, clan_id):
    """Catch up both finishers, once per distance/claim/XP award."""
    from . import economy
    from .routes.clans import record_clan_activity, add_clan_xp
    if not clan_id:
        return False, None
    attribute_territories(db, run_ids, clan_id)
    rows = db.execute(text("""
        SELECT r.id, r.user_id, r.distance_m, r.reward_xp, r.claim_result,
               r.claimed_at, EXISTS(SELECT 1 FROM territories t WHERE t.run_id=r.id) AS has_land
        FROM runs r JOIN club_run_logs cr ON cr.run_id=r.id
        WHERE r.id = ANY(CAST(:ids AS uuid[])) AND cr.clan_id=CAST(:cid AS uuid)
          AND r.verified ORDER BY r.id
    """), {"ids": [str(r) for r in run_ids], "cid": str(clan_id)}).fetchall()
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
