"""GET /feed — the activity feed.

A cursor-paginated stream of completed runs, scoped like a Strava social
timeline: you see your own runs plus those of your accepted pasers and your
clanmates — not the whole city. Each item carries the area it claimed.
Shadow-flagged and private runs are hidden from everyone but their owner.
The audience predicate lives in the main query's WHERE clause; kudos, emote,
and steal counts are enriched per page below.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import elo, models, post_media, privacy, reactions as reaction_rules, schemas
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


def _claim_rings(stored):
    """The claim shape a run recorded for itself, if it recorded one.

    Stored as JSON on the claim result rather than read back off `territories`,
    because the territory row is the runner's MERGED holding — the claim stops
    being separable from it the moment the two are unioned.
    """
    if not stored:
        return []
    try:
        return [
            [(float(x), float(y)) for x, y in ring]
            for ring in stored
            if len(ring) >= 3
        ]
    except (TypeError, ValueError):
        return []


def _path_from_wkt(wkt):
    if not wkt:
        return []
    try:
        return [(x, y) for x, y in shapely_wkt.loads(wkt).coords]
    except Exception:
        return []


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Drop a cursor's timezone after converting it to UTC.

    `ended_at` and `created_at` are `timestamp WITHOUT time zone` columns
    holding UTC, so an AWARE datetime must never reach the comparison: Postgres
    would coerce it using the session's TimeZone and silently shift the page
    boundary by the offset.

    This matters now because responses serialize timestamps as `...Z` (see
    `UtcDatetime` in schemas.py), so the cursor the app echoes back is parsed
    as aware where it used to be naive. Both forms are accepted and both end up
    as the same naive UTC value.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/feed", response_model=schemas.FeedOut)
def feed(
    cursor: Optional[datetime] = Query(None, description="return items older than this"),
    limit: int = Query(20, ge=1, le=50),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    cursor = _naive_utc(cursor)
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.user_id::text, u.username,
                   r.distance_m, r.duration_s, r.ended_at,
                   -- What the RUN won, not what its owner ended up holding.
                   -- `t` is the merged territory row, so a claim placed on
                   -- the runner's own land would post their whole holding —
                   -- weeks of ground — as this morning's take. `gained_m2`
                   -- (see ClaimOut) is the part of the claim that was nobody
                   -- else's and not already theirs; the join is the fallback
                   -- for runs claimed before that was measured.
                   COALESCE((r.claim_result ->> 'gained_m2')::float, t.area_m2, 0) AS area_m2,
                   (t.id IS NOT NULL) AS closed_loop,
                   c.tag, c.color_key,
                   (SELECT COUNT(*) FROM run_kudos k WHERE k.run_id = r.id) AS kudos_count,
                   EXISTS(SELECT 1 FROM run_kudos k WHERE k.run_id = r.id AND k.user_id = :uid) AS kudoed,
                   (SELECT COUNT(*) FROM run_comments rc
                    WHERE rc.run_id = r.id AND NULLIF(BTRIM(rc.body), '') IS NOT NULL) AS comment_count,
                   u.avatar,
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, 0.00004)) AS poly_wkt,
                   ST_AsText(ST_Simplify(r.path, 0.00004)) AS path_wkt,
                   COALESCE(u.solo_elo, 1000), NULL::timestamp,
                   -- Privacy, selected alongside rather than looked up per row:
                   -- a page can carry fifty runs from fifty different runners.
                   COALESCE(r.visibility, 'public'),
                   u.route_trim_m, u.privacy_zones, u.route_publish_delay_h, u.birthday,
                   r.caption, COALESCE(r.post_media, '[]'::jsonb), r.post_media_etag,
                   -- This run's own claim shape, for the same reason as the
                   -- area above: `t.polygon` is the merged holding, so a card
                   -- about one run would be illustrated with a map of
                   -- everything its owner holds around there. Appended, not
                   -- slotted next to `poly_wkt` where it belongs — every row
                   -- below is read positionally.
                   r.claim_result -> 'claim_rings' AS claim_rings
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
              -- Strava-style social timeline: the feed is the activity of people
              -- you actually know, not the whole city. A run shows only if it is
              -- YOURS, an accepted paser's, or a clanmate's (same clan). A
              -- stranger's run — a bot, a rival, someone who stole your land — no
              -- longer streams past here. It stays reachable by direct link,
              -- profile, the rival/steal surfaces, and the map; this scoping only
              -- decides what fills the timeline. The visibility clause above
              -- still hides a private run even from pasers.
              AND (
                    r.user_id = :uid
                    OR EXISTS (
                          SELECT 1 FROM paser_links pl
                          WHERE pl.status = 'accepted'
                            AND ((pl.requester_id = :uid AND pl.addressee_id = r.user_id)
                              OR (pl.addressee_id = :uid AND pl.requester_id = r.user_id))
                    )
                    OR EXISTS (
                          -- clan_members.user_id is UNIQUE, so this is "shares
                          -- my one clan", not a fan-out across many.
                          SELECT 1 FROM clan_members me
                          JOIN clan_members them ON them.clan_id = me.clan_id
                          WHERE me.user_id = :uid AND them.user_id = r.user_id
                    )
              )
              AND NOT EXISTS (
                    SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = CAST(:uid AS uuid) AND b.blocked_id = r.user_id)
                       OR (b.blocker_id = r.user_id AND b.blocked_id = CAST(:uid AS uuid))
              )
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
                       COALESCE(u.solo_elo, 1000), NULL::timestamp
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
                    rank_key=elo.key_for(s[6], s[7]),
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
            rank_key=elo.key_for(r[16], r[17]),
            rings=_claim_rings(r[26]) or _rings_from_wkt(r[14]),
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
            caption=r[23],
            # URLs, not the images: a page of base64 photos is megabytes the
            # client cannot cache, which is what stopped Home from painting
            # instantly the moment anybody added a picture to a run.
            media=post_media.photo_urls(r[0], r[25], list(r[24] or [])),
        )
        for r in rows
    ]
    next_cursor = items[-1].created_at if (has_more and items) else None
    return schemas.FeedOut(items=items, next_cursor=next_cursor)
