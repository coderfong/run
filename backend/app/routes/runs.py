"""
Run lifecycle: /start-run, /submit-path, /end-run.

Territory creation only happens at /end-run. /submit-path is purely a
streaming endpoint: clients can call it as the user runs to upload partial
GPS traces, and we'll opportunistically detect a closed loop and tell the
client about it (so the UI can show a "loop closed!" indicator). The
authoritative territory write still happens at /end-run.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..anticheat import is_verified, validate_run
from ..config import settings
from ..database import get_db
from ..geospatial import clean_path, detect_loop, geometry_to_rings, polygon_to_lonlat_ring
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter()


@router.post("/start-run", response_model=schemas.StartRunOut)
def start_run(
    payload: schemas.StartRunIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    started = payload.started_at or datetime.utcnow()
    run = models.Run(user_id=user.id, started_at=started)
    db.add(run)
    db.commit()
    db.refresh(run)
    return schemas.StartRunOut(run_id=run.id, started_at=run.started_at)


@router.post("/submit-path")
@limiter.limit(settings.rate_limit_submit_path)
def submit_path(
    request: Request,
    response: Response,
    payload: schemas.SubmitPathIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Stream-update endpoint. Returns whether a loop was detected so the
    client can give the user immediate feedback. Does NOT persist a
    territory — that only happens on /end-run, to keep the lifecycle clean."""
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")

    cleaned = clean_path(payload.points)
    if cleaned is None:
        return {"closed_loop": False, "preview_area_m2": None}

    loop = detect_loop(cleaned)
    if loop is None:
        return {"closed_loop": False, "preview_area_m2": None}

    return {
        "closed_loop": True,
        "preview_area_m2": loop.area_m2,
        "preview_polygon": polygon_to_lonlat_ring(loop.polygon_wgs),
    }


@router.post("/end-run", response_model=schemas.RunResultOut)
@limiter.limit(settings.rate_limit_end_run)
def end_run(
    request: Request,
    response: Response,
    payload: schemas.EndRunIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is not None:
        raise HTTPException(409, "run already ended")

    cleaned = clean_path(payload.points)
    if cleaned is None or len(cleaned.metric_coords) < 2:
        # No usable path. Mark run ended with zero metrics rather than 500.
        run.ended_at = datetime.utcnow()
        run.distance_m = 0.0
        run.duration_s = (run.ended_at - run.started_at).total_seconds()
        db.commit()
        return schemas.RunResultOut(
            run_id=run.id,
            distance_m=0.0,
            duration_s=run.duration_s,
            closed_loop=False,
            territory=None,
        )

    # Persist the full cleaned path (in WGS84) for visualisation/debugging.
    line_wgs = LineString(cleaned.wgs_coords)
    run.path = from_shape(line_wgs, srid=4326)
    run.ended_at = datetime.utcnow()
    run.distance_m = cleaned.distance_m
    run.duration_s = (run.ended_at - run.started_at).total_seconds()

    # Anti-cheat on the RAW submitted points (clean_path scrubs exactly the
    # samples that betray a spoof). Shadow-flag: the response below looks
    # identical either way; flag_reasons never leaves the server.
    reasons = validate_run(payload.points, cleaned.distance_m, payload.step_count)
    run.flag_reasons = reasons or None
    run.verified = is_verified(reasons)

    loop = detect_loop(cleaned)
    territory_out = None

    if loop is not None:
        territory_out = _claim_territory(
            db=db,
            user_id=run.user_id,
            run_id=run.id,
            polygon_wgs=loop.polygon_wgs,
            initial_area_m2=loop.area_m2,
            verified=run.verified,
        )

    db.commit()

    return schemas.RunResultOut(
        run_id=run.id,
        distance_m=run.distance_m,
        duration_s=run.duration_s,
        closed_loop=loop is not None,
        territory=territory_out,
    )


def _claim_territory(
    db: Session,
    user_id: str,
    run_id: str,
    polygon_wgs,
    initial_area_m2: float,
    verified: bool = True,
) -> schemas.TerritoryOut | None:
    """Insert the new polygon, resolving overlaps with existing territories.

    Rules:
      * Where this polygon overlaps another *user's* territory, the new
        runner steals the overlap. We update the rival's geometry by
        ST_Difference, then drop any rival rows that became empty/sliver.
      * Where this polygon overlaps the *same user's* existing territory,
        we union them (the user just expanded their land).
      * The new territory is stored as the original polygon minus any
        re-unioned same-user territory (to avoid double-counted area).
        Then any same-user union geometry is folded into the new row.
      * SHADOW-FLAGGED runs (verified=False) get a standalone unverified
        row: no stealing from rivals, no merging into verified land. The
        submitter still sees a normal-looking territory in the response.

    All overlap math is done in PostGIS (server-side) to keep it
    transactional and to use the GIST index on territories.polygon.
    The returned area is recomputed via ST_Area on a geography cast,
    which handles WGS84 properly.
    """
    new_geom_wkt = polygon_wgs.wkt  # WGS84

    if not verified:
        # Flagged: insert the row for the owner's eyes only and stop —
        # a cheat must not damage anyone else's land.
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    false
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt},
        ).fetchone()
        return _territory_out(db, new_row[0])

    # Pull rivals (other users) that intersect.
    rivals = db.execute(
        text(
            """
            SELECT id, user_id
            FROM territories
            WHERE user_id <> :uid
              AND verified
              AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt},
    ).fetchall()

    for rid, _ruid in rivals:
        # Subtract the new polygon from the rival's territory. ALL surviving
        # fragments are kept as one MultiPolygon — only sub-1m² slivers are
        # dropped. A rival row that loses everything is deleted below.
        db.execute(
            text(
                """
                WITH diff AS (
                    SELECT ST_MakeValid(
                        ST_Difference(polygon, ST_GeomFromText(:wkt, 4326))
                    ) AS g
                    FROM territories WHERE id = :rid
                ),
                parts AS (
                    SELECT (ST_Dump(ST_CollectionExtract(g, 3))).geom AS g FROM diff
                ),
                kept AS (
                    SELECT ST_Multi(ST_Collect(g)) AS g
                    FROM parts
                    WHERE ST_Area(g::geography) >= :min_area
                )
                UPDATE territories t
                SET polygon = kept.g,
                    area_m2 = ST_Area(kept.g::geography)
                FROM kept
                WHERE t.id = :rid AND kept.g IS NOT NULL
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, "min_area": 1.0},
        )
        # Fully consumed (nothing above the sliver floor survived): the
        # UPDATE above no-ops, so remove the row explicitly.
        db.execute(
            text(
                """
                DELETE FROM territories
                WHERE id = :rid
                  AND ST_Area(
                        ST_MakeValid(
                            ST_Difference(polygon, ST_GeomFromText(:wkt, 4326))
                        )::geography
                      ) < :min_area
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid, "min_area": 1.0},
        )

    # Drop rival rows that became empty/sliver after subtraction.
    db.execute(
        text(
            """
            DELETE FROM territories
            WHERE user_id <> :uid
              AND verified
              AND (polygon IS NULL OR ST_IsEmpty(polygon) OR area_m2 < :min_area)
            """
        ),
        {"uid": user_id, "min_area": 1.0},
    )

    # Union with same-user existing territories so the runner's land grows.
    same_user_union = db.execute(
        text(
            """
            SELECT ST_AsText(ST_Union(polygon))
            FROM territories
            WHERE user_id = :uid
              AND verified
              AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
            """
        ),
        {"uid": user_id, "wkt": new_geom_wkt},
    ).scalar()

    if same_user_union is not None:
        # Replace existing same-user overlapping rows with a single merged row.
        db.execute(
            text(
                """
                DELETE FROM territories
                WHERE user_id = :uid
                  AND verified
                  AND ST_Intersects(polygon, ST_GeomFromText(:wkt, 4326))
                """
            ),
            {"uid": user_id, "wkt": new_geom_wkt},
        )
        # Union new polygon with the existing same-user union. ST_Union may
        # naturally yield a MultiPolygon (e.g. the new run doesn't bridge
        # two previously disjoint territories) — we keep every piece.
        new_row = db.execute(
            text(
                """
                WITH merged AS (
                    SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(
                        ST_GeomFromText(:new_wkt, 4326),
                        ST_GeomFromText(:old_wkt, 4326)
                    )), 3)) AS g
                )
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified)
                SELECT gen_random_uuid(), :uid, :rid, g,
                       ST_Area(g::geography), now(), true
                FROM merged
                RETURNING id, area_m2, created_at
                """
            ),
            {
                "uid": user_id,
                "rid": run_id,
                "new_wkt": new_geom_wkt,
                "old_wkt": same_user_union,
            },
        ).fetchone()
    else:
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    true
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt},
        ).fetchone()

    return _territory_out(db, new_row[0])


def _territory_out(db: Session, tid) -> schemas.TerritoryOut | None:
    """Read a territory back and shape it for the API response."""
    row = db.execute(
        text(
            """
            SELECT t.id::text, t.user_id::text, u.username, t.area_m2, t.created_at,
                   ST_AsText(t.polygon)
            FROM territories t
            JOIN users u ON u.id = t.user_id
            WHERE t.id = :tid
            """
        ),
        {"tid": tid},
    ).fetchone()

    if row is None:
        return None

    _id, uid, username, a, created, wkt = row
    from shapely import wkt as shapely_wkt

    geom = shapely_wkt.loads(wkt)
    rings = geometry_to_rings(geom)  # largest-first

    return schemas.TerritoryOut(
        id=_id,
        user_id=uid,
        username=username,
        area_m2=float(a),
        created_at=created,
        polygon=rings[0] if rings else [],  # legacy: largest ring
        rings=rings,
    )
