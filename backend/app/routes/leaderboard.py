"""GET /leaderboard — top users by total controlled area.

Shadow-flagging: unverified territories are invisible here for everyone
except their owner (who sees their own numbers looking normal).

THE ONE RULE HERE. A runner must never have to wonder whether they are
winning. Their own position is free, on every board, whether or not they are
anywhere near the top — that is what `/leaderboard/standing` is for, and it is
deliberately outside the PRO gate. PASER PRO sells the ability to ask the board
OTHER questions (a different window of time, a smaller field of runners); it
never sells the answer to "where am I". Hiding somebody's rank behind a
subscription would make the competitive game feel rigged, which costs far more
than the subscription is worth. See app/entitlements.py.
"""

from datetime import datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import entitlements, models, ranks, schemas
from ..clans_meta import color_triple, photo_url
from ..config import settings
from ..database import get_db
from ..security import current_user, current_user_optional

router = APIRouter()

SeasonCategory = Literal["land", "claims", "captures", "defenses", "distance"]
SeasonScope = Literal["clans", "solo"]

# `standing` answers for one more board than the season lists do: the RANK
# board, which is its own endpoint (`/leaderboard/ranks`) rather than a season
# category, and which is the board a runner most wants to place themselves on.
StandingCategory = Literal["land", "claims", "captures", "defenses", "distance", "rank"]

# PRO filters. `season` + `all` is the free board every runner already had, so
# a client that sends nothing keeps exactly the behaviour it has today.
LeaderboardWindow = Literal["season", "week", "month", "all"]
LeaderboardFilter = Literal["all", "pasers", "club", "local"]

# How near counts as "near me". A city, not a suburb: too tight and the board
# is three people, which is a worse read than no board.
LOCAL_RADIUS_M = 25_000

# Far enough back to mean "everything", without needing a nullable window
# threaded through every query below.
_EPOCH = datetime(2020, 1, 1)


def _window_bounds(window: str, season) -> tuple[datetime, datetime]:
    """(starts_at, ends_at) for a window. Season falls back to all time when
    no season has ever been created, rather than returning an empty board."""
    now = datetime.utcnow()
    if window == "week":
        return now - timedelta(days=7), now
    if window == "month":
        return now - timedelta(days=30), now
    if window == "all":
        return _EPOCH, now
    return (season[1], season[2]) if season else (_EPOCH, now)


def _filter_clause(filter_: str, has_point: bool) -> str:
    """SQL predicate on `u` for a PRO field filter. A fixed literal per branch
    — never interpolated from input.

    Note what this REPLACES on the solo board: the standing `cm.user_id IS
    NULL` restriction, which exists so soloists compete against soloists. Once
    a runner has asked for their pasers or their club, "are they in a club" is
    not the question any more, and keeping the restriction would answer a
    different one silently — a paser board missing every paser in a club.
    """
    if filter_ == "pasers":
        # Includes the viewer. A board of your friends that you are not on
        # cannot answer "am I winning", which is the whole point of it.
        return (
            "(u.id = :viewer_id OR u.id IN ("
            " SELECT CASE WHEN pl.requester_id = :viewer_id THEN pl.addressee_id"
            "             ELSE pl.requester_id END"
            " FROM paser_links pl"
            " WHERE pl.status = 'accepted'"
            "   AND (pl.requester_id = :viewer_id OR pl.addressee_id = :viewer_id)))"
        )
    if filter_ == "club":
        return (
            "u.id IN (SELECT m.user_id FROM clan_members m WHERE m.clan_id = ("
            " SELECT clan_id FROM clan_members WHERE user_id = :viewer_id))"
        )
    if filter_ == "local":
        if not has_point:
            # No point to be local to. Fail loudly rather than quietly
            # returning the global board under a "near me" heading.
            raise HTTPException(400, "local standings need lat and lon")
        return (
            "EXISTS (SELECT 1 FROM territories lt"
            " WHERE lt.user_id = u.id AND lt.verified"
            "   AND ST_DWithin(lt.polygon::geography,"
            "                  ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, :radius))"
        )
    return "TRUE"


def _require_pro_for(viewer, window: str, filter_: str) -> None:
    """The free board is season-wide and unfiltered; anything else is PRO.

    This gates the QUESTION, never the answer to "where do I stand" — see the
    module docstring.
    """
    if window == "season" and filter_ == "all":
        return
    if not entitlements.is_pro(viewer):
        raise HTTPException(402, "PASER PRO required for this view")


def _season_window(db: Session):
    """Return the active season, or the most recently ended one."""
    row = db.execute(
        text(
            "SELECT id::text, starts_at, ends_at FROM seasons "
            "WHERE now() BETWEEN starts_at AND ends_at "
            "ORDER BY ends_at DESC LIMIT 1"
        )
    ).fetchone()
    if row:
        return row
    return db.execute(
        text("SELECT id::text, starts_at, ends_at FROM seasons ORDER BY ends_at DESC LIMIT 1")
    ).fetchone()


@router.get("/leaderboard/ranks", response_model=List[schemas.LeaderboardEntry])
def rank_leaderboard(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
):
    """Standings by RANK POINTS — the competitive board.

    Points decay with inactivity, so this ranks who's winning ground now
    rather than who has ever played the most. Decay is applied per row on read
    (same lazy model as everywhere else), which is why the ordering is done in
    Python after the fetch: a stored balance can be stale, and sorting on the
    stale column would show a decayed player above an active one.
    """
    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username, COALESCE(u.rank_points, 0),
                   u.rank_points_at, c.tag, c.color_key
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE COALESCE(u.rank_points, 0) > 0
            ORDER BY u.rank_points DESC
            LIMIT :limit
            """
        ),
        {"limit": limit * 2},   # over-fetch: decay can reorder the tail
    ).fetchall()

    scored = []
    for r in rows:
        pts = ranks.effective_points(int(r[2]), r[3])
        if pts <= 0:
            continue
        info = ranks.rank_for_points(pts)
        scored.append((pts, r, info))
    scored.sort(key=lambda x: -x[0])

    return [
        schemas.LeaderboardEntry(
            user_id=r[0],
            username=r[1],
            total_area_m2=0.0,
            territory_count=0,
            clan_tag=r[4],
            clan_color=schemas.ClanColor(**color_triple(r[5])) if r[5] else None,
            rank_points=pts,
            rank_key=info["key"],
            rank_label=info["label"],
        )
        for pts, r, info in scored[:limit]
    ]


@router.get("/leaderboard/season", response_model=List[schemas.SeasonLeaderboardEntry])
def season_leaderboard(
    scope: SeasonScope = Query("clans"),
    category: SeasonCategory = Query("land"),
    window: LeaderboardWindow = Query("season", description="PRO unless 'season'"),
    field: LeaderboardFilter = Query("all", alias="filter", description="PRO unless 'all'"),
    lat: Optional[float] = Query(None, description="required when filter=local"),
    lon: Optional[float] = Query(None),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    """Standings across several competitive categories.

    Land is a live view of verified, unexpired territory — it has no time
    dimension, so `window` genuinely does not apply to it and is ignored
    rather than pretended. Every other metric is bounded by the window. Club
    distance/captures use the existing claim-time season ledger so changing
    club later cannot move that credit.

    `window` and `filter` are the PASER PRO half. Sending neither gives the
    exact board this endpoint has always returned, which is what keeps every
    already-shipped build working.
    """
    _require_pro_for(viewer, window, field)
    if field != "all" and viewer is None:
        raise HTTPException(401, "sign in to filter the board")

    season = _season_window(db)
    starts_at, ends_at = _window_bounds(window, season)
    if not season and scope == "clans":
        # Club standings hang off `clan_season_stats`, which is keyed by
        # season — without one there is nothing to read.
        return []

    params = {
        "season_id": season[0] if season else None,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "life_per": settings.territory_life_days_per_strength,
        "limit": limit,
        "viewer_id": viewer.id if viewer else None,
        "lat": lat,
        "lon": lon,
        "radius": LOCAL_RADIUS_M,
    }

    if scope == "clans":
        metric_sql = {
            "land": "COALESCE(l.total_area_m2, 0)",
            "claims": "COALESCE(q.claim_count, 0)",
            "captures": "COALESCE(s.steals, 0)",
            "defenses": "COALESCE(d.defense_count, 0)",
            "distance": "COALESCE(s.distance_sum, 0)",
        }[category]
        rows = db.execute(
            text(
                f"""
                WITH land AS (
                    SELECT t.clan_id,
                           COALESCE(SUM(t.area_m2), 0) AS total_area_m2,
                           COUNT(t.id) AS territory_count
                    FROM territories t
                    WHERE t.clan_id IS NOT NULL
                      AND t.verified
                      AND now() < COALESCE(t.expires_at, t.created_at + make_interval(
                          secs => GREATEST(t.strength, 0.1) * :life_per * 86400
                      ))
                    GROUP BY t.clan_id
                ),
                claims AS (
                    SELECT cm.clan_id, COUNT(r.id) AS claim_count
                    FROM runs r
                    JOIN clan_members cm ON cm.user_id = r.user_id
                    WHERE r.verified
                      AND r.claimed_at >= :starts_at
                      AND r.claimed_at < :ends_at
                    GROUP BY cm.clan_id
                ),
                defenses AS (
                    SELECT cm.clan_id, COUNT(e.id) AS defense_count
                    FROM territory_steals e
                    JOIN clan_members cm ON cm.user_id = e.victim_id
                    LEFT JOIN runs attack_run ON attack_run.id = e.run_id
                    WHERE e.defended
                      AND e.created_at >= :starts_at
                      AND e.created_at < :ends_at
                      AND COALESCE(attack_run.verified, TRUE)
                    GROUP BY cm.clan_id
                )
                SELECT c.id::text, c.name, c.tag, c.color_key, c.badge_icon,
                       s.league,
                       (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS member_count,
                       COALESCE(l.total_area_m2, 0) AS total_area_m2,
                       COALESCE(l.territory_count, 0) AS territory_count,
                       COALESCE(q.claim_count, 0) AS claim_count,
                       COALESCE(s.steals, 0) AS capture_count,
                       COALESCE(d.defense_count, 0) AS defense_count,
                       COALESCE(s.distance_sum, 0) AS distance_m,
                       c.photo_etag
                FROM clans c
                LEFT JOIN clan_season_stats s
                  ON s.clan_id = c.id AND s.season_id = :season_id
                LEFT JOIN land l ON l.clan_id = c.id
                LEFT JOIN claims q ON q.clan_id = c.id
                LEFT JOIN defenses d ON d.clan_id = c.id
                WHERE {metric_sql} > 0
                ORDER BY {metric_sql} DESC, c.name ASC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
        return [
            schemas.SeasonLeaderboardEntry(
                clan_id=r[0],
                name=r[1],
                tag=r[2],
                color=schemas.ClanColor(**color_triple(r[3])),
                badge_icon=r[4] or "shield",
                photo_url=photo_url(r[0], r[13]),
                league=r[5],
                member_count=int(r[6] or 0),
                total_area_m2=float(r[7] or 0),
                territory_count=int(r[8] or 0),
                claim_count=int(r[9] or 0),
                capture_count=int(r[10] or 0),
                defense_count=int(r[11] or 0),
                distance_m=float(r[12] or 0),
            )
            for r in rows
        ]

    metric_sql = {
        "land": "COALESCE(l.total_area_m2, 0)",
        "claims": "COALESCE(q.claim_count, 0)",
        "captures": "COALESCE(capture.capture_count, 0)",
        "defenses": "COALESCE(defense.defense_count, 0)",
        "distance": "COALESCE(distance.distance_m, 0)",
    }[category]
    # Unfiltered, the individual board is soloists only — that is what makes it
    # a fair field against the club board beside it. A PRO filter answers a
    # different question and replaces that restriction; see `_filter_clause`.
    field_clause = (
        "cm.user_id IS NULL" if field == "all"
        else _filter_clause(field, lat is not None and lon is not None)
    )
    rows = db.execute(
        text(
            f"""
            WITH land AS (
                SELECT t.user_id,
                       COALESCE(SUM(t.area_m2), 0) AS total_area_m2,
                       COUNT(t.id) AS territory_count
                FROM territories t
                WHERE (t.verified OR t.user_id = :viewer_id)
                  AND now() < COALESCE(t.expires_at, t.created_at + make_interval(
                      secs => GREATEST(t.strength, 0.1) * :life_per * 86400
                  ))
                GROUP BY t.user_id
            ),
            claims AS (
                SELECT r.user_id, COUNT(r.id) AS claim_count
                FROM runs r
                WHERE (r.verified OR r.user_id = :viewer_id)
                  AND r.claimed_at >= :starts_at
                  AND r.claimed_at < :ends_at
                GROUP BY r.user_id
            ),
            captures AS (
                SELECT e.attacker_id AS user_id, COUNT(e.id) AS capture_count
                FROM territory_steals e
                LEFT JOIN runs attack_run ON attack_run.id = e.run_id
                WHERE NOT e.defended
                  AND e.created_at >= :starts_at
                  AND e.created_at < :ends_at
                  AND (COALESCE(attack_run.verified, TRUE) OR e.attacker_id = :viewer_id)
                GROUP BY e.attacker_id
            ),
            defenses AS (
                SELECT e.victim_id AS user_id, COUNT(e.id) AS defense_count
                FROM territory_steals e
                LEFT JOIN runs attack_run ON attack_run.id = e.run_id
                WHERE e.defended
                  AND e.created_at >= :starts_at
                  AND e.created_at < :ends_at
                  AND COALESCE(attack_run.verified, TRUE)
                GROUP BY e.victim_id
            ),
            distances AS (
                SELECT r.user_id, COALESCE(SUM(r.distance_m), 0) AS distance_m
                FROM runs r
                WHERE (r.verified OR r.user_id = :viewer_id)
                  AND r.ended_at >= :starts_at
                  AND r.ended_at < :ends_at
                GROUP BY r.user_id
            )
            SELECT u.id::text, u.username,
                   COALESCE(l.total_area_m2, 0) AS total_area_m2,
                   COALESCE(l.territory_count, 0) AS territory_count,
                   COALESCE(q.claim_count, 0) AS claim_count,
                   COALESCE(capture.capture_count, 0) AS capture_count,
                   COALESCE(defense.defense_count, 0) AS defense_count,
                   COALESCE(distance.distance_m, 0) AS distance_m
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN land l ON l.user_id = u.id
            LEFT JOIN claims q ON q.user_id = u.id
            LEFT JOIN captures capture ON capture.user_id = u.id
            LEFT JOIN defenses defense ON defense.user_id = u.id
            LEFT JOIN distances distance ON distance.user_id = u.id
            WHERE {field_clause} AND {metric_sql} > 0
            ORDER BY {metric_sql} DESC, u.username ASC
            LIMIT :limit
            """
        ),
        params,
    ).fetchall()
    return [
        schemas.SeasonLeaderboardEntry(
            user_id=r[0],
            username=r[1],
            total_area_m2=float(r[2] or 0),
            territory_count=int(r[3] or 0),
            claim_count=int(r[4] or 0),
            capture_count=int(r[5] or 0),
            defense_count=int(r[6] or 0),
            distance_m=float(r[7] or 0),
        )
        for r in rows
    ]


@router.get("/leaderboard/standing", response_model=schemas.LeaderboardStanding)
def my_standing(
    category: StandingCategory = Query("land"),
    window: LeaderboardWindow = Query("season"),
    field: LeaderboardFilter = Query("all", alias="filter"),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Where the signed-in runner actually stands — at any position, not just
    the top 50.

    THIS IS FREE, and it is the reason the rest of this module can charge for
    anything. A board that shows the top fifty and nothing else leaves everyone
    below fiftieth guessing, and a guessing player cannot tell whether they are
    losing to better runners or to somebody's wallet. So: one row, always
    available, ranked over the whole field.

    It answers for whichever board is being looked at, which is why it takes
    the same filters — but the FREE combination is still the free board, and
    asking about a PRO view of the field is gated exactly like the list is.

    Unlike the list, this counts every runner including club members: "you are
    404th" has to be true of the whole game, not of a subset the viewer never
    asked about.
    """
    _require_pro_for(user, window, field)

    season = _season_window(db)
    starts_at, ends_at = _window_bounds(window, season)
    field_clause = _filter_clause(field, lat is not None and lon is not None)

    metric_sql = {
        "land": """
            COALESCE((SELECT SUM(t.area_m2) FROM territories t
                      WHERE t.user_id = u.id
                        AND (t.verified OR t.user_id = :viewer_id)
                        AND now() < COALESCE(t.expires_at, t.created_at + make_interval(
                            secs => GREATEST(t.strength, 0.1) * :life_per * 86400))), 0)
        """,
        "claims": """
            COALESCE((SELECT COUNT(*) FROM runs r
                      WHERE r.user_id = u.id AND (r.verified OR r.user_id = :viewer_id)
                        AND r.claimed_at >= :starts_at AND r.claimed_at < :ends_at), 0)
        """,
        "captures": """
            COALESCE((SELECT COUNT(*) FROM territory_steals e
                      WHERE e.attacker_id = u.id AND NOT e.defended
                        AND e.created_at >= :starts_at AND e.created_at < :ends_at), 0)
        """,
        "defenses": """
            COALESCE((SELECT COUNT(*) FROM territory_steals e
                      WHERE e.victim_id = u.id AND e.defended
                        AND e.created_at >= :starts_at AND e.created_at < :ends_at), 0)
        """,
        "distance": """
            COALESCE((SELECT SUM(r.distance_m) FROM runs r
                      WHERE r.user_id = u.id AND (r.verified OR r.user_id = :viewer_id)
                        AND r.ended_at >= :starts_at AND r.ended_at < :ends_at), 0)
        """,
        # The competitive board, and so the one where "where am I" matters
        # most. Points decay with inactivity, and the decay has to happen
        # inside the ranking or an idle player sits above an active one.
        "rank": ranks.DECAY_SQL,
    }[category]

    row = db.execute(
        text(
            f"""
            WITH scored AS (
                SELECT u.id AS uid, ({metric_sql}) AS value
                -- Seeded players are NOT excluded. They are on the board the
                -- runner is looking at (that is what they are for), so leaving
                -- them out here would answer "12th of 40" against a list of
                -- 60 — a number that contradicts the screen showing it.
                FROM users u
                WHERE {field_clause}
            ),
            ranked AS (
                -- RANK, not ROW_NUMBER: runners level on the metric are level
                -- on the board, and telling one of them they are 8th while the
                -- other is 7th invents a difference the game does not have.
                SELECT uid, value,
                       RANK() OVER (ORDER BY value DESC) AS place,
                       COUNT(*) OVER () AS field_size
                FROM scored
                WHERE value > 0
            )
            SELECT place, field_size, value FROM ranked WHERE uid = :viewer_id
            """
        ),
        {
            "viewer_id": user.id, "starts_at": starts_at, "ends_at": ends_at,
            "life_per": settings.territory_life_days_per_strength,
            "lat": lat, "lon": lon, "radius": LOCAL_RADIUS_M,
        },
    ).fetchone()

    if not row:
        # On the board's terms they have done nothing yet. That is a real
        # answer and a much better one than a blank space: unranked, with the
        # size of the field they would be joining.
        total = db.execute(
            text(
                f"""
                SELECT COUNT(*) FROM users u
                WHERE {field_clause}
                  AND ({metric_sql}) > 0
                """
            ),
            {
                "viewer_id": user.id, "starts_at": starts_at, "ends_at": ends_at,
                "life_per": settings.territory_life_days_per_strength,
                "lat": lat, "lon": lon, "radius": LOCAL_RADIUS_M,
            },
        ).scalar()
        return schemas.LeaderboardStanding(
            user_id=str(user.id), username=user.username, category=category,
            window=window, filter=field, rank=None, field_size=int(total or 0), value=0.0,
        )

    return schemas.LeaderboardStanding(
        user_id=str(user.id),
        username=user.username,
        category=category,
        window=window,
        filter=field,
        rank=int(row[0]),
        field_size=int(row[1] or 0),
        value=float(row[2] or 0),
    )


@router.get("/leaderboard", response_model=List[schemas.LeaderboardEntry])
def leaderboard(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
    solo: bool = Query(False, description="only rank players not in a clan"),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    # solo board = clanless players only (the LEFT JOIN leaves cm.user_id NULL
    # for anyone without a membership). Clause is a fixed literal, not input.
    solo_clause = "WHERE cm.user_id IS NULL" if solo else ""
    rows = db.execute(
        text(
            f"""
            SELECT u.id::text, u.username,
                   COALESCE(SUM(t.area_m2), 0) AS total_area,
                   COUNT(t.id) AS territory_count,
                   c.tag, c.color_key
            FROM users u
            LEFT JOIN territories t
              ON t.user_id = u.id
             AND (t.verified OR t.user_id = :viewer_id)
             AND now() < COALESCE(t.expires_at, t.created_at + make_interval(secs => GREATEST(t.strength,0.1) * :life_per * 86400))
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            {solo_clause}
            GROUP BY u.id, u.username, c.tag, c.color_key
            HAVING COALESCE(SUM(t.area_m2), 0) > 0
            ORDER BY total_area DESC
            LIMIT :limit
            """
        ),
        {"limit": limit, "viewer_id": viewer.id if viewer else None,
         "life_per": settings.territory_life_days_per_strength},
    ).fetchall()

    return [
        schemas.LeaderboardEntry(
            user_id=r[0],
            username=r[1],
            total_area_m2=float(r[2]),
            territory_count=int(r[3]),
            clan_tag=r[4],
            clan_color=schemas.ClanColor(**color_triple(r[5])) if r[5] else None,
        )
        for r in rows
    ]
