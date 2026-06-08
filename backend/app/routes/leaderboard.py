"""GET /leaderboard — top users by total controlled area."""

from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db

router = APIRouter()


@router.get("/leaderboard", response_model=List[schemas.LeaderboardEntry])
def leaderboard(db: Session = Depends(get_db), limit: int = Query(50, ge=1, le=500)):
    rows = db.execute(
        text(
            """
            SELECT u.id::text, u.username,
                   COALESCE(SUM(t.area_m2), 0) AS total_area,
                   COUNT(t.id) AS territory_count
            FROM users u
            LEFT JOIN territories t ON t.user_id = u.id
            GROUP BY u.id, u.username
            HAVING COALESCE(SUM(t.area_m2), 0) > 0
            ORDER BY total_area DESC
            LIMIT :limit
            """
        ),
        {"limit": limit},
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
