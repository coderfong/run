"""Ranks — the territorial ladder that portrait borders hang off.

Why this is separate from levels: XP comes from DISTANCE, so a level says
"you run a lot". Rank points come only from ground taken and held, so a rank
says "you're winning right now". Borders moved here because they're the one
thing everyone sees on your portrait, and the visible badge should reflect the
competitive ladder, not the treadmill one.

Points decay with inactivity (see `effective_points`), which is what stops a
high border meaning "played hard once, in March". `rank_best` keeps the
high-water mark so nothing is ever truly lost — the current rank is a status,
the best rank is an achievement.

Pure data + helpers, no DB access: callers pass values in and get values back.
"""

from datetime import datetime

# What each territorial action is worth. Rank is a LADDER, not a counter:
# points move both ways, so standing reflects how you're doing now. (Levels
# are the opposite — XP only ever accumulates and never falls.)
# Rebalanced so rank answers "how well are you competing?" rather than "how
# often did you press Claim". A neutral expansion used to pay 10 against a
# defence's 15 — two thirds of the reward of actually holding your ground off
# somebody, for running somewhere nobody contests. It is now a rounding error
# next to a contested outcome, which is the point: painting empty map can
# contribute a little, but it must never be the easiest way up the PvP ladder.
POINTS_CLAIM = 3         # claim open ground — participation, not achievement
POINTS_STEAL = 25        # take ground off another runner
POINTS_DEFEND = 15       # their attack failed against your land
POINTS_HOLD = 2          # a zone survived 48h still yours (see hold_credit)
POINTS_LOST = -10        # someone took YOUR ground — the other half of a steal

# Rank thresholds, widening so the top tiers stay rare. Keys match
# BORDER_TIERS in progression.py so the art lines up 1:1.
RANK_TIERS = [
    (0, "wood", "Wood"),
    (250, "bronze", "Bronze"),
    (700, "silver", "Silver"),
    (1500, "gold", "Gold"),
    (3000, "platinum", "Platinum"),
    (5500, "diamond", "Diamond"),
    (9000, "onyx", "Onyx"),
    (14000, "ember", "Ember"),
    (21000, "prismatic", "Prismatic"),
    (30000, "mythic", "Mythic"),
]

# Inactivity decay. Applied per FULL week with no points earned, so a normal
# week of running never loses anything.
DECAY_PER_WEEK = 0.02
DECAY_GRACE_DAYS = 7
_WEEK = 7 * 86400


def effective_points(points: int, last_earned_at: datetime | None,
                     now: datetime | None = None) -> int:
    """Points after inactivity decay — the value everything else reads.

    Decay is computed lazily from the timestamp rather than by a cron job, the
    same approach energy regen uses. Whole weeks only, so the number never
    drifts while a player is looking at it.
    """
    if not points or points <= 0:
        return 0
    if last_earned_at is None:
        return int(points)
    now = now or datetime.utcnow()
    idle = (now - last_earned_at).total_seconds() - DECAY_GRACE_DAYS * 86400
    if idle <= 0:
        return int(points)
    weeks = int(idle // _WEEK) + 1
    return int(round(points * ((1 - DECAY_PER_WEEK) ** weeks)))


# The same decay, as a SQL expression over `u.rank_points` / `u.rank_points_at`.
#
# WHY A SECOND COPY EXISTS. `effective_points` is applied per row in Python,
# which is fine when the caller has already fetched the rows — the rank board
# over-fetches and re-sorts afterwards for exactly that reason. It does not
# work for "what position is this ONE runner in", which has to rank them
# against every other player without pulling the whole users table into memory.
#
# It is a DUPLICATE and has to stay in step. `test_rank_decay_sql.py` runs both
# over the same inputs and fails the moment they disagree, which is the only
# thing that makes having two of them acceptable.
DECAY_SQL = f"""
    CASE
        WHEN COALESCE(u.rank_points, 0) <= 0 THEN 0
        WHEN u.rank_points_at IS NULL THEN u.rank_points
        WHEN EXTRACT(EPOCH FROM (timezone('utc', now()) - u.rank_points_at))
             <= {DECAY_GRACE_DAYS} * 86400
            THEN u.rank_points
        ELSE ROUND(u.rank_points * POWER(
            {1 - DECAY_PER_WEEK}::numeric,
            FLOOR((EXTRACT(EPOCH FROM (timezone('utc', now()) - u.rank_points_at))
                   - {DECAY_GRACE_DAYS} * 86400) / {_WEEK}) + 1))
    END
"""


def rank_for_points(points: int) -> dict:
    """Current tier plus progress toward the next one."""
    pts = max(0, int(points or 0))
    idx = 0
    for i, (need, _key, _label) in enumerate(RANK_TIERS):
        if pts >= need:
            idx = i
    need, key, label = RANK_TIERS[idx]
    nxt = RANK_TIERS[idx + 1] if idx + 1 < len(RANK_TIERS) else None
    return {
        "key": key,
        "label": label,
        "tier": idx,
        "points": pts,
        "floor": need,
        "next_points": nxt[0] if nxt else None,
        "next_label": nxt[2] if nxt else None,
        "progress": (
            0.0 if not nxt else
            min(1.0, max(0.0, (pts - need) / max(1, nxt[0] - need)))
        ),
    }


def tier_bounds(tier: int) -> tuple[int, int | None]:
    """The half-open points band ``[floor, ceil)`` that maps to a tier index.

    Used to filter a board to a single rank: a row belongs to tier ``t`` when
    its decayed points sit at or above this tier's floor and below the next
    tier's. The top tier has no ceiling (``None``). Callers clamp nothing —
    an out-of-range index is folded onto the nearest real tier, so a stale
    client asking for tier 99 gets Mythic rather than an empty board.
    """
    t = max(0, min(len(RANK_TIERS) - 1, int(tier)))
    floor = RANK_TIERS[t][0]
    ceil = RANK_TIERS[t + 1][0] if t + 1 < len(RANK_TIERS) else None
    return floor, ceil


SELECT_COLS = "COALESCE(u.rank_points, 0), u.rank_points_at"


def key_for(points, last_earned_at, now: datetime | None = None) -> str:
    """Border tier key straight from a row's two raw rank columns.

    Every payload that carries an `avatar` also carries a `rank_key`, because
    the client draws the portrait's frame from it — a portrait without one
    would render bare. Select `ranks.SELECT_COLS` alongside the avatar and
    hand both values here; decay is applied on the way through, so a list and
    the profile it links to can never disagree about someone's tier.
    """
    return rank_for_points(effective_points(int(points or 0), last_earned_at, now))["key"]


def award(db, user_id, delta: int, reason: str) -> None:
    """Add points and stamp the activity clock, so decay restarts from now.

    `rank_best` only ever ratchets upward — GREATEST keeps it as the
    high-water mark even when the live balance later decays past it.
    Caller commits.
    """
    if not delta:
        return
    from sqlalchemy import text
    # UTC, not `now()`. `rank_points_at` is a naive TIMESTAMP that
    # `effective_points` compares against `datetime.utcnow()`, so writing the
    # server's LOCAL time here skews the decay grace period by the server's UTC
    # offset — invisible on Render, which runs in UTC, and hours wrong on any
    # deploy or dev box that does not. `timezone('utc', now())` stores the same
    # convention Python reads.
    db.execute(
        text("UPDATE users SET rank_points = GREATEST(0, COALESCE(rank_points,0) + :d), "
             "rank_points_at = timezone('utc', now()) WHERE id = :u"),
        {"d": int(delta), "u": user_id},
    )
    db.execute(
        text("INSERT INTO rank_events (user_id, delta, reason) VALUES (:u, :d, :r)"),
        {"u": user_id, "d": int(delta), "r": reason},
    )
    row = db.execute(
        text("SELECT COALESCE(rank_points,0) FROM users WHERE id = :u"), {"u": user_id}
    ).fetchone()
    if row:
        tier = rank_for_points(int(row[0]))["tier"]
        db.execute(
            text("UPDATE users SET rank_best = GREATEST(COALESCE(rank_best,0), :t) "
                 "WHERE id = :u"),
            {"t": tier, "u": user_id},
        )


def status(db, user_id) -> dict:
    """The player's rank right now, decay already applied."""
    from sqlalchemy import text
    row = db.execute(
        text("SELECT COALESCE(rank_points,0), rank_points_at, COALESCE(rank_best,0) "
             "FROM users WHERE id = :u"),
        {"u": user_id},
    ).fetchone()
    if not row:
        return {**rank_for_points(0), "best_key": RANK_TIERS[0][1],
                "best_label": RANK_TIERS[0][2]}
    pts = effective_points(int(row[0]), row[1])
    out = rank_for_points(pts)
    best_idx = max(0, min(len(RANK_TIERS) - 1, int(row[2])))
    out["best_key"] = RANK_TIERS[best_idx][1]
    out["best_label"] = RANK_TIERS[best_idx][2]
    out["decayed"] = pts < int(row[0])
    return out


def seed_points_for_level(level: int) -> int:
    """Starting points for accounts that predate ranks.

    territory_steals only records from the 0016 deploy, so there's no history
    to replay. 12*level^2 maps level 50 exactly onto Mythic (30000), which
    keeps existing players on the border they already wear instead of dropping
    everyone to Wood on launch day.
    """
    lvl = max(0, int(level or 0))
    return int(12 * lvl * lvl)
