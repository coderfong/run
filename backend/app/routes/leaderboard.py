"""GET /leaderboard — top users by total controlled area.

Shadow-flagging: unverified territories are invisible here for everyone
except their owner (who sees their own numbers looking normal).
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, ranks, schemas
from ..clans_meta import color_triple, photo_url
from ..config import settings
from ..database import get_db
from ..security import current_user_optional

router = APIRouter()

SeasonCategory = Literal["land", "claims", "captures", "defenses", "distance"]
SeasonScope = Literal["clans", "solo"]


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
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    """Current season standings across several competitive categories.

    Land is a live view of verified, unexpired territory. The other metrics
    are bounded by the season dates. Club distance/captures use the existing
    claim-time season ledger so changing club later cannot move that credit.
    """
    season = _season_window(db)
    if not season:
        return []

    params = {
        "season_id": season[0],
        "starts_at": season[1],
        "ends_at": season[2],
        "life_per": settings.territory_life_days_per_strength,
        "limit": limit,
        "viewer_id": viewer.id if viewer else None,
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
            WHERE cm.user_id IS NULL AND {metric_sql} > 0
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
