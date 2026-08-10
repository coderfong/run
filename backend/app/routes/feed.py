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

from .. import models, privacy, ranks, reactions as reaction_rules, schemas
from ..clans_meta import color_triple
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..security import current_user

router = APIRouter()

# Matches MAX_STEAL_HEADS in frontend/src/components/TerritoryStealBanner.js —
# the banner has six flight paths, so a seventh face has nowhere to be thrown.
MAX_FEED_VICTIMS = 6


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
                   u.avatar,
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, 0.00004)) AS poly_wkt,
                   ST_AsText(ST_Simplify(r.path, 0.00004)) AS path_wkt,
                   COALESCE(u.rank_points, 0), u.rank_points_at,
                   -- Privacy, selected alongside rather than looked up per row:
                   -- a page can carry fifty runs from fifty different runners.
                   COALESCE(r.visibility, 'public'),
                   u.route_trim_m, u.privacy_zones, u.route_publish_delay_h, u.birthday
            FROM runs r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN territories t ON t.run_id = r.id
            LEFT JOIN clan_members cm ON cm.user_id = r.user_id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE r.ended_at IS NOT NULL
              AND (r.verified OR r.user_id = :uid)
              -- A private run does not appear on anyone else's feed at all.
              -- It still records, still claims, still counts for every total.
              AND (COALESCE(r.visibility, 'public') = 'public' OR r.user_id = :uid)
              AND (:cursor IS NULL OR r.ended_at < :cursor)
            ORDER BY r.ended_at DESC
            LIMIT :limit
            """
        ),
        {"uid": user.id, "cursor": cursor, "limit": limit + 1},
    ).fetchall()

    has_more = len(rows) > limit
    rows = rows[:limit]

    # The steal, per run — the faces the card throws out of the blast. One
    # extra query for the whole page rather than a correlated subquery per
    # row, and capped at MAX_FEED_VICTIMS because the banner can only fling
    # six heads; anything past that is counted, not drawn.
    victims_by_run: dict[str, list] = {}
    stolen_by_run: dict[str, float] = {}
    run_ids = [r[0] for r in rows]
    if run_ids:
        for s in db.execute(
            text(
                """
                SELECT ts.run_id::text, ts.victim_id::text, u.username, u.avatar,
                       ts.area_m2, c.color_key,
                       COALESCE(u.rank_points, 0), u.rank_points_at
                FROM territory_steals ts
                JOIN users u ON u.id = ts.victim_id
                LEFT JOIN clan_members cm ON cm.user_id = ts.victim_id
                LEFT JOIN clans c ON c.id = cm.clan_id
                WHERE ts.run_id = ANY(CAST(:rids AS uuid[])) AND NOT ts.defended
                ORDER BY ts.run_id, ts.area_m2 DESC
                """
            ),
            {"rids": run_ids},
        ).fetchall():
            rid = s[0]
            stolen_by_run[rid] = stolen_by_run.get(rid, 0.0) + float(s[4] or 0)
            bucket = victims_by_run.setdefault(rid, [])
            if len(bucket) >= MAX_FEED_VICTIMS:
                continue
            bucket.append(
                schemas.ClaimVictim(
                    user_id=s[1],
                    username=s[2],
                    avatar=s[3],
                    rank_key=ranks.key_for(s[6], s[7]),
                    clan_color=schemas.ClanColor(**color_triple(s[5])) if s[5] else None,
                    area_m2=float(s[4] or 0),
                    defended=False,
                )
            )

    # Emotes for the whole page in one grouped query, for the same reason as
    # the steals above: fifty rows must not become fifty round trips.
    reactions_by_run, my_reaction_by_run = reaction_rules.summarise(db, run_ids, user.id)

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
            avatar=r[13],
            rank_key=ranks.key_for(r[16], r[17]),
            rings=_rings_from_wkt(r[14]),
            # The trace, but only as much of it as this viewer may see. The
            # feed used to ship a simplified path for every run on the page to
            # everyone — simplification hides a corner, not an address.
            path=privacy.path_for_viewer(
                _path_from_wkt(r[15]),
                owner_id=r[1],
                viewer_id=user.id,
                prefs=privacy.prefs_from_row(r[19], r[20], r[21], r[22]),
                visibility=r[18],
                ended_at=r[5],
            ),
            victims=victims_by_run.get(r[0], []),
            stolen_m2=stolen_by_run.get(r[0], 0.0),
            reactions=[schemas.RunReaction(**x) for x in reactions_by_run.get(r[0], [])],
            my_reaction=my_reaction_by_run.get(r[0]),
        )
        for r in rows
    ]
    next_cursor = items[-1].created_at if (has_more and items) else None
    return schemas.FeedOut(items=items, next_cursor=next_cursor)
