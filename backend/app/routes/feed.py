"""GET /feed — the activity feed.

Phase 4: a cursor-paginated stream of completed runs (own + others), each
carrying the area it claimed. Shadow-flagged runs are hidden from everyone
but their owner. Phase 5 enriches this with clan-scoped filtering and
territory/clan/goal events; Phase 6 adds kudos counts.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import current_user

router = APIRouter()


@router.get("/feed", response_model=schemas.FeedOut)
def feed(
    cursor: Optional[datetime] = Query(None, description="return items older than this"),
    limit: int = Query(20, ge=1, le=50),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.user_id::text, u.username,
                   r.distance_m, r.duration_s, r.ended_at,
                   COALESCE(t.area_m2, 0) AS area_m2,
                   (t.id IS NOT NULL) AS closed_loop
            FROM runs r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.ended_at IS NOT NULL
              AND (r.verified OR r.user_id = :uid)
              AND (:cursor IS NULL OR r.ended_at < :cursor)
            ORDER BY r.ended_at DESC
            LIMIT :limit
            """
        ),
        {"uid": user.id, "cursor": cursor, "limit": limit + 1},
    ).fetchall()

    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [
        schemas.FeedItem(
            id=r[0],
            user_id=r[1],
            username=r[2],
            is_you=(r[1] == user.id),
            distance_m=float(r[3] or 0),
            duration_s=float(r[4] or 0),
            created_at=r[5],
            area_m2=float(r[6] or 0),
            closed_loop=bool(r[7]),
        )
        for r in rows
    ]
    next_cursor = items[-1].created_at if (has_more and items) else None
    return schemas.FeedOut(items=items, next_cursor=next_cursor)
