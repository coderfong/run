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
POINTS_CLAIM = 10        # claim a zone
POINTS_STEAL = 25        # take ground off another runner
POINTS_DEFEND = 15       # their attack failed against your land
POINTS_HOLD = 5          # a zone survived a decay cycle still yours
POINTS_LOST = -15        # someone took YOUR ground — the other half of a steal

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


def award(db, user_id, delta: int, reason: str) -> None:
    """Add points and stamp the activity clock, so decay restarts from now.

    `rank_best` only ever ratchets upward — GREATEST keeps it as the
    high-water mark even when the live balance later decays past it.
    Caller commits.
    """
    if not delta:
        return
    from sqlalchemy import text
    db.execute(
        text("UPDATE users SET rank_points = GREATEST(0, COALESCE(rank_points,0) + :d), "
             "rank_points_at = now() WHERE id = :u"),
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
