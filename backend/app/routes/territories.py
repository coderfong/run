"""GET /map-polygons — every territory in the world, optionally bounded by a bbox."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..geospatial import polygon_to_lonlat_ring

router = APIRouter()


@router.get("/map-polygons", response_model=schemas.MapPolygonsOut)
def map_polygons(
    db: Session = Depends(get_db),
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    limit: int = Query(2000, ge=1, le=10000),
):
    """Return all territories. If a bbox is supplied, use ST_Intersects with
    ST_MakeEnvelope so the GIST index on `polygon` is used. We intentionally
    do *not* simplify here — the polygon vertices are already small after
    Douglas-Peucker at insert time, and clients can decimate further if needed."""
    if all(v is not None for v in (min_lon, min_lat, max_lon, max_lat)):
        rows = db.execute(
            text(
                """
                SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                       ST_AsText(t.polygon)
                FROM territories t
                JOIN users u ON u.id = t.user_id
                WHERE ST_Intersects(
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
                ORDER BY t.area_m2 DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).fetchall()

    out = []
    for tid, uid, username, area_m2, created_at, wkt in rows:
        poly = shapely_wkt.loads(wkt)
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
        out.append(
            schemas.TerritoryOut(
                id=tid,
                user_id=uid,
                username=username,
                area_m2=float(area_m2),
                created_at=created_at,
                polygon=polygon_to_lonlat_ring(poly),
            )
        )

    return schemas.MapPolygonsOut(territories=out)
