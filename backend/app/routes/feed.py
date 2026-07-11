"""GET /feed — the activity feed.

Phase 4: a cursor-paginated stream of completed runs (own + others), each
carrying the area it claimed. Shadow-flagged runs are hidden from everyone
but their owner. Phase 5 enriches this with clan-scoped filtering and
territory/clan/goal events; Phase 6 adds kudos counts.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..clans_meta import color_triple
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..security import current_user

router = APIRouter()


def _rings_from_wkt(wkt):
    if not wkt:
        return []
    try:
        return geometry_to_rings(shapely_wkt.loads(wkt))
    except Exception:
        return []


def _path_from_wkt(wkt):
    if not wkt:
        return []
    try:
        return [(x, y) for x, y in shapely_wkt.loads(wkt).coords]
    except Exception:
        return []


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
                   (t.id IS NOT NULL) AS closed_loop,
                   c.tag, c.color_key,
                   (SELECT COUNT(*) FROM run_kudos k WHERE k.run_id = r.id) AS kudos_count,
                   EXISTS(SELECT 1 FROM run_kudos k WHERE k.run_id = r.id AND k.user_id = :uid) AS kudoed,
                   (SELECT COUNT(*) FROM run_comments rc WHERE rc.run_id = r.id) AS comment_count,
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, 0.00004)) AS poly_wkt,
                   ST_AsText(ST_Simplify(r.path, 0.00004)) AS path_wkt
            FROM runs r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN territories t ON t.run_id = r.id
            LEFT JOIN clan_members cm ON cm.user_id = r.user_id
            LEFT JOIN clans c ON c.id = cm.clan_id
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
            clan_tag=r[8],
            clan_color=schemas.ClanColor(**color_triple(r[9])) if r[9] else None,
            kudos_count=int(r[10] or 0),
            kudoed=bool(r[11]),
            comment_count=int(r[12] or 0),
            rings=_rings_from_wkt(r[13]),
            path=_path_from_wkt(r[14]),
        )
        for r in rows
    ]
    next_cursor = items[-1].created_at if (has_more and items) else None
    return schemas.FeedOut(items=items, next_cursor=next_cursor)
