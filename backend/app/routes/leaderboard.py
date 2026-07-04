"""GET /leaderboard — top users by total controlled area.

Shadow-flagging: unverified territories are invisible here for everyone
except their owner (who sees their own numbers looking normal).
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import current_user_optional

router = APIRouter()


@router.get("/leaderboard", response_model=List[schemas.LeaderboardEntry])
def leaderboard(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username,
                   COALESCE(SUM(t.area_m2), 0) AS total_area,
                   COUNT(t.id) AS territory_count
            FROM users u
            LEFT JOIN territories t
              ON t.user_id = u.id
             AND (t.verified OR t.user_id = :viewer_id)
            GROUP BY u.id, u.username
            HAVING COALESCE(SUM(t.area_m2), 0) > 0
            ORDER BY total_area DESC
            LIMIT :limit
            """
        ),
        {"limit": limit, "viewer_id": viewer.id if viewer else None},
    ).fetchall()

    return [
        schemas.LeaderboardEntry(
            user_id=r[0],
            username=r[1],
            total_area_m2=float(r[2]),
            territory_count=int(r[3]),
        )
        for r in rows
    ]
