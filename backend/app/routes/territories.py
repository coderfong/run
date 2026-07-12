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

from .. import models, schemas
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


@router.get("/map-polygons", response_model=schemas.MapPolygonsOut)
def map_polygons(
    db: Session = Depends(get_db),
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    zoom: Optional[float] = Query(None, description="client map zoom; drives simplification"),
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

    rows = db.execute(
        text(
            f"""
            SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                   (t.created_at >= :contested_since) AS contested,
                   c.tag, c.color_key,
                   COALESCE((SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = t.clan_id), 1) AS defenders,
                   t.strength,
                   u.avatar,
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, :tol))
            FROM territories t
            JOIN users u ON u.id = t.user_id
            LEFT JOIN clans c ON c.id = t.clan_id
            WHERE (t.verified OR t.user_id = :viewer_id)
              {bbox_clause}
            ORDER BY t.area_m2 DESC
            LIMIT :limit
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
        },
    ).fetchall()

    out = []
    for tid, uid, username, area_m2, created_at, contested, clan_tag, color_key, defenders, strength, avatar, wkt in rows:
        geom = shapely_wkt.loads(wkt)
        rings = geometry_to_rings(geom)  # largest-first
        if not rings:
            continue
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
            )
        )

    return schemas.MapPolygonsOut(territories=out)
