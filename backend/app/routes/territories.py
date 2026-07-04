"""GET /map-polygons — every territory in the world, optionally bounded by a bbox.

Shadow-flagging: unverified territories are omitted for everyone except
their owner (identified via an optional bearer token).
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..security import current_user_optional

router = APIRouter()


@router.get("/map-polygons", response_model=schemas.MapPolygonsOut)
def map_polygons(
    db: Session = Depends(get_db),
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    limit: int = Query(2000, ge=1, le=10000),
    viewer: Optional[models.User] = Depends(current_user_optional),
):
    """Return all territories. If a bbox is supplied, use ST_Intersects with
    ST_MakeEnvelope so the GIST index on `polygon` is used. We intentionally
    do *not* simplify here — the polygon vertices are already small after
    Douglas-Peucker at insert time, and clients can decimate further if needed."""
    viewer_id = viewer.id if viewer else None
    if all(v is not None for v in (min_lon, min_lat, max_lon, max_lat)):
        rows = db.execute(
            text(
                """
                SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                       ST_AsText(t.polygon)
                FROM territories t
                JOIN users u ON u.id = t.user_id
                WHERE (t.verified OR t.user_id = :viewer_id)
                  AND ST_Intersects(
                    t.polygon,
                    ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
                )
                ORDER BY t.area_m2 DESC
                LIMIT :limit
                """
            ),
            {
                "min_lon": min_lon,
                "min_lat": min_lat,
                "max_lon": max_lon,
                "max_lat": max_lat,
                "limit": limit,
                "viewer_id": viewer_id,
            },
        ).fetchall()
    else:
        rows = db.execute(
            text(
                """
                SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                       ST_AsText(t.polygon)
                FROM territories t
                JOIN users u ON u.id = t.user_id
                WHERE (t.verified OR t.user_id = :viewer_id)
                ORDER BY t.area_m2 DESC
                LIMIT :limit
                """
            ),
            {"limit": limit, "viewer_id": viewer_id},
        ).fetchall()

    out = []
    for tid, uid, username, area_m2, created_at, wkt in rows:
        geom = shapely_wkt.loads(wkt)
        rings = geometry_to_rings(geom)  # largest-first
        out.append(
            schemas.TerritoryOut(
                id=tid,
                user_id=uid,
                username=username,
                area_m2=float(area_m2),
                created_at=created_at,
                polygon=rings[0] if rings else [],  # legacy: largest ring
                rings=rings,
            )
        )

    return schemas.MapPolygonsOut(territories=out)
