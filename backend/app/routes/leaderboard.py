"""GET /leaderboard — top users by total controlled area.

Shadow-flagging: unverified territories are invisible here for everyone
except their owner (who sees their own numbers looking normal).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..security import current_user_optional

router = APIRouter()


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
             AND now() < t.created_at + make_interval(secs => GREATEST(t.strength,0.1) * :life_per * 86400)
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
