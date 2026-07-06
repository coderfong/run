"""GET /me/stats and /me/runs — the You tab's stat wall and recent runs."""

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["users"])


def _streak_weeks(week_starts: List[datetime]) -> int:
    """Consecutive ISO weeks (ending this week or last) with >= 1 run."""
    if not week_starts:
        return 0
    have = set(w.date() for w in week_starts)
    # Monday of the current week.
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    # Allow the streak to be "current" if you ran this week or last week.
    if monday not in have and (monday - timedelta(days=7)) not in have:
        return 0
    cursor = monday if monday in have else monday - timedelta(days=7)
    streak = 0
    while cursor in have:
        streak += 1
        cursor = cursor - timedelta(days=7)
    return streak


@router.get("/me/stats", response_model=schemas.MeStats)
def me_stats(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    terr = db.execute(
        text(
            "SELECT COALESCE(SUM(area_m2),0), COUNT(*), COALESCE(MAX(area_m2),0) "
            "FROM territories WHERE user_id = :uid"
        ),
        {"uid": user.id},
    ).fetchone()
    runs = db.execute(
        text(
            "SELECT COUNT(*), COALESCE(SUM(distance_m),0) "
            "FROM runs WHERE user_id = :uid AND ended_at IS NOT NULL"
        ),
        {"uid": user.id},
    ).fetchone()
    weeks = db.execute(
        text(
            "SELECT DISTINCT date_trunc('week', ended_at) AS wk "
            "FROM runs WHERE user_id = :uid AND ended_at IS NOT NULL ORDER BY wk DESC"
        ),
        {"uid": user.id},
    ).fetchall()

    return schemas.MeStats(
        total_area_m2=float(terr[0]),
        territory_count=int(terr[1]),
        biggest_claim_m2=float(terr[2]),
        runs_count=int(runs[0]),
        career_distance_m=float(runs[1]),
        current_streak_weeks=_streak_weeks([w[0] for w in weeks if w[0]]),
    )


@router.get("/me/runs", response_model=List[schemas.RunSummary])
def me_runs(
    limit: int = Query(20, ge=1, le=100),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.distance_m, r.duration_s, r.ended_at,
                   COALESCE(t.area_m2, 0), (t.id IS NOT NULL)
            FROM runs r
            LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.user_id = :uid AND r.ended_at IS NOT NULL
            ORDER BY r.ended_at DESC
            LIMIT :limit
            """
        ),
        {"uid": user.id, "limit": limit},
    ).fetchall()
    return [
        schemas.RunSummary(
            run_id=r[0],
            distance_m=float(r[1] or 0),
            duration_s=float(r[2] or 0),
            created_at=r[3],
            area_m2=float(r[4] or 0),
            closed_loop=bool(r[5]),
        )
        for r in rows
    ]
