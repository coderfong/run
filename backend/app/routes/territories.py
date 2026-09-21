"""GET /map-polygons — territories for the game board.

- bbox (min/max lon/lat) uses the GIST index via ST_Intersects/ST_MakeEnvelope.
- `zoom` drives server-side ST_SimplifyPreserveTopology + a feature cap so
  low zooms ship far lighter geometry (the client renders one GeoJSON source,
  not one component per polygon).
- Shadow-flagged (unverified) territories are hidden from everyone but their
  owner (optional bearer token).
- `contested` marks land claimed within `contested_days` (the heat signal).
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import elo, models, schemas
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..security import current_user_optional


def _clan_color(color_key):
    return schemas.ClanColor(**color_triple(color_key)) if color_key else None

router = APIRouter()


def _simplify_for_zoom(zoom: Optional[float]):
    """(tolerance_degrees, feature_cap_or_None) for a client zoom level.

    Tolerance is now CONSTANT (fine) across zoom levels: territories here are
    small (~170m plots) and the coarse per-zoom tolerances (up to ~100m) turned
    a run's actual route into a shifting blob whose area visibly changed as the
    user zoomed. Only the feature cap tightens far out, purely for payload."""
    if zoom is None or zoom >= settings.map_zoom_vlow:
        return settings.map_tol_high, None
    return settings.map_tol_high, settings.map_cap_low_zoom


# TWO BOARDS, TWO LADDERS.
#
# The solo board scopes by the OWNER's rating: you see the runners you are
# actually racing. The club board has to scope by the owning CLUB's rating
# instead, because a club is what you are looking at — scoping it by each
# plot's individual owner would show one club's Bronze member and hide their
# Diamond one, which is not a board of anything.
#
# Until this existed the clubs view sent NO rank at all, so every club on the
# planet landed on one map at once and the view was unreadable at any zoom.
CLUB_BOARD = "club"


def board_scope(board: str, rank: Optional[int]):
    """The join, the tier filter and its parameters for one board.

    Pulled out of the handler so both halves are testable without a database:
    the difference between the two boards is entirely in these three values,
    and getting either the join or the rating column wrong produces a board
    that looks plausible and is quietly filtering on the wrong ladder.

    The tier filter MUST be SQL rather than a Python post-pass: this endpoint
    has a LIMIT, and filtering after the fact would return far fewer rows than
    asked for whenever a tier is sparse.
    """
    club_board = board == CLUB_BOARD
    rating_sql = elo.CLUB_RATING_SQL if club_board else elo.RATING_SQL

    # An INNER join on the club board: land with no club cannot belong to a
    # club tier, and it used to be fetched only for the client to throw away
    # (see boardPresentation). Now the LIMIT is spent entirely on rows that
    # will actually be drawn.
    clan_join = (
        "JOIN clans c ON c.id = t.clan_id" if club_board
        else "LEFT JOIN clans c ON c.id = t.clan_id"
    )

    params: dict = {}
    clause = ""
    if rank is not None:
        floor, ceil = elo.tier_bounds(rank)
        clause = f"AND ({rating_sql}) >= :rank_floor"
        params["rank_floor"] = floor
        if ceil is not None:
            clause += f" AND ({rating_sql}) < :rank_ceil"
            params["rank_ceil"] = ceil
    return clan_join, clause, params


@router.get("/map-polygons", response_model=schemas.MapPolygonsOut)
def map_polygons(
    db: Session = Depends(get_db),
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    zoom: Optional[float] = Query(None, description="client map zoom; drives simplification"),
    rank: Optional[int] = Query(
        None,
        description="scope the board to one rank tier (0=Wood … 9=Mythic); omit for all ranks",
    ),
    board: str = Query(
        "solo",
        description="'solo' scopes by the OWNER's tier; 'club' by the owning CLUB's tier "
                    "and returns club held land only",
    ),
    limit: int = Query(2000, ge=1, le=10000),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    viewer_id = viewer.id if viewer else None
    tol, cap = _simplify_for_zoom(zoom)
    eff_limit = min(limit, cap) if cap else limit
    contested_since = datetime.utcnow() - timedelta(days=settings.contested_days)

    has_bbox = all(v is not None for v in (min_lon, min_lat, max_lon, max_lat))
    bbox_clause = (
        "AND ST_Intersects(t.polygon, ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326))"
        if has_bbox
        else ""
    )

    clan_join, rank_clause, rank_params = board_scope(board, rank)

    rows = db.execute(
        text(
            f"""
            WITH candidates AS MATERIALIZED (
                SELECT t.id::text AS id, t.user_id::text AS user_id, u.username,
                       t.area_m2, t.created_at,
                       (t.created_at >= :contested_since) AS contested,
                       c.tag, c.color_key,
                       COALESCE((SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = t.clan_id), 1) AS defenders,
                       t.strength,
                       u.avatar,
                       GREATEST(0, LEAST(1,
                           EXTRACT(EPOCH FROM (COALESCE(
                               t.expires_at,
                               t.created_at + make_interval(secs => GREATEST(t.strength, 0.1) * :life_per * 86400)
                           ) - now()))
                           / GREATEST(1, EXTRACT(EPOCH FROM (COALESCE(
                               t.expires_at,
                               t.created_at + make_interval(secs => GREATEST(t.strength, 0.1) * :life_per * 86400)
                           ) - t.created_at)))
                       )) AS freshness,
                       t.reinforcements,
                       ({elo.RATING_SQL}) AS rank_pts,
                       CASE WHEN t.clan_id IS NULL THEN NULL
                            ELSE ({elo.CLUB_RATING_SQL}) END AS clan_rank_pts,
                       t.polygon
                FROM territories t
                JOIN users u ON u.id = t.user_id
                {clan_join}
                WHERE (t.verified OR t.user_id = :viewer_id)
                  AND now() < COALESCE(t.expires_at, t.created_at + make_interval(secs => GREATEST(t.strength, 0.1) * :life_per * 86400))
                  {bbox_clause}
                  {rank_clause}
                -- Resolve the strongest ground first. A deterministic newest/id
                -- tie-break means equal-strength legacy overlaps still have one owner.
                ORDER BY t.strength DESC, t.created_at DESC, t.id
                LIMIT :limit
            ), resolved AS (
                SELECT *, ST_CollectionExtract(ST_MakeValid(ST_Difference(
                    polygon,
                    COALESCE(
                        ST_Union(polygon) OVER (
                            ORDER BY strength DESC, created_at DESC, id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ),
                        ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)
                    )
                )), 3) AS visible_polygon
                FROM candidates
            )
            SELECT id, user_id, username, ST_Area(visible_polygon::geography), created_at, contested,
                   tag, color_key, defenders, strength, avatar, freshness,
                   reinforcements, rank_pts, clan_rank_pts,
                   ST_AsText(ST_SimplifyPreserveTopology(visible_polygon, :tol))
            FROM resolved
            WHERE NOT ST_IsEmpty(visible_polygon)
            ORDER BY strength DESC, created_at DESC, id
            """
        ),
        {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
            "tol": tol,
            "limit": eff_limit,
            "viewer_id": viewer_id,
            "contested_since": contested_since,
            "life_per": settings.territory_life_days_per_strength,
            **rank_params,
        },
    ).fetchall()

    out = []
    for (tid, uid, username, area_m2, created_at, contested, clan_tag, color_key, defenders,
         strength, avatar, freshness, reinforcements, rank_pts, clan_rank_pts, wkt) in rows:
        geom = shapely_wkt.loads(wkt)
        rings = geometry_to_rings(geom)  # largest-first
        if not rings:
            continue
        rinfo = elo.tier_for_rating(int(rank_pts or elo.INITIAL_RATING))
        cinfo = (elo.tier_for_rating(int(clan_rank_pts)) if clan_rank_pts is not None else None)
        out.append(
            schemas.TerritoryOut(
                id=tid,
                user_id=uid,
                username=username,
                area_m2=float(area_m2),
                created_at=created_at,
                polygon=rings[0],  # legacy: largest ring
                rings=rings,
                contested=bool(contested),
                clan_tag=clan_tag,
                clan_color=_clan_color(color_key),
                defenders=max(1, int(defenders or 1)),
                strength=float(strength or 1.0),
                avatar=avatar,
                freshness=float(freshness if freshness is not None else 1.0),
                reinforcements=int(reinforcements or 0),
                rank_key=rinfo["key"],
                rank_tier=rinfo["tier"],
                rank_label=rinfo["label"],
                clan_rank_key=cinfo["key"] if cinfo else None,
                clan_rank_tier=cinfo["tier"] if cinfo else None,
                clan_rank_label=cinfo["label"] if cinfo else None,
            )
        )

    return schemas.MapPolygonsOut(territories=out)
