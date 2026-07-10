"""
Run lifecycle: /start-run, /submit-path, /end-run, /claim-territory.

CIRCLE-CLAIM MODEL: a run's distance converts to a circle whose CIRCUMFERENCE
equals that distance (r = d/2π, area = d²/4π). /end-run finalises the run and
returns the claim radius/area; the territory itself is only created when the
runner places the circle along their trail via /claim-territory. /submit-path
remains a pure streaming endpoint for partial GPS traces.
"""

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import fitness, models, schemas
from ..anticheat import is_verified, validate_run
from ..notifications import notify
from .clans import clan_member_ids, record_clan_activity
from ..config import settings
from ..database import get_db
from ..geospatial import (
    circle_polygon_wgs,
    claim_area_m2,
    claim_radius_m,
    clean_path,
    detect_loop,
    geometry_to_rings,
    polygon_to_lonlat_ring,
)
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
    background: BackgroundTasks,
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

    # Circle claim earned by this run (placed later via /claim-territory).
    # Area is deterministic from distance, so PRs can record it now.
    eligible = run.distance_m >= settings.min_claim_distance_m
    radius = claim_radius_m(run.distance_m) if eligible else 0.0
    area = claim_area_m2(run.distance_m) if eligible else 0.0

    # Server-side splits + personal records (records only on verified runs).
    achievements = fitness.record_splits_and_prs(
        db, run.id, run.user_id, cleaned, run.distance_m, area, run.verified
    )

    # Advance the runner's clan weekly goal + season stats (no-op if clanless).
    # Flagged (unverified) runs never contribute to clan stats, goals, or XP.
    # Claim + steal credit lands at /claim-territory when the circle is placed.
    goal_reached, clan_id = (False, None)
    if run.verified:
        goal_reached, clan_id = record_clan_activity(
            db, user, distance_m=run.distance_m, closed_loop=False, stolen=0.0
        )
        xp_gain = round((run.distance_m / 1000.0) * settings.xp_per_km)
        if xp_gain > 0:
            db.execute(
                text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
                {"g": xp_gain, "uid": user.id},
            )

    db.commit()

    if goal_reached and clan_id:
        background.add_task(
            notify, clan_member_ids(db, clan_id, exclude=user.id), "clan_goal",
            "Weekly goal reached!", "Your club hit this week's goal. Badge frame unlocked.",
        )

    return schemas.RunResultOut(
        run_id=run.id,
        distance_m=run.distance_m,
        duration_s=run.duration_s,
        claim_radius_m=radius,
        claim_area_m2=area,
        achievements=achievements,
    )


@router.post("/claim-territory", response_model=schemas.ClaimOut)
@limiter.limit(settings.rate_limit_end_run)
def claim_territory(
    request: Request,
    response: Response,
    payload: schemas.ClaimIn,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Place the run's circle claim. The centre must lie on the run's trail
    (within claim_snap_tolerance_m); the circle's circumference equals the
    run distance. One claim per run, ever."""
    run = db.get(models.Run, payload.run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    if run.ended_at is None:
        raise HTTPException(409, "run not finished yet")
    if run.claimed_at is not None:
        raise HTTPException(409, "claim already placed for this run")
    if run.path is None or not run.distance_m or run.distance_m < settings.min_claim_distance_m:
        raise HTTPException(422, "run too short to claim territory")

    on_trail = db.execute(
        text(
            """
            SELECT ST_DWithin(
                path::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                :tol
            )
            FROM runs WHERE id = :rid
            """
        ),
        {"lon": payload.lon, "lat": payload.lat, "tol": settings.claim_snap_tolerance_m, "rid": run.id},
    ).scalar()
    if not on_trail:
        raise HTTPException(422, "claim centre must be on your route")

    radius = claim_radius_m(run.distance_m)
    circle = circle_polygon_wgs(payload.lat, payload.lon, radius)

    territory_out, stolen_m2, stolen_from = _claim_territory(
        db=db,
        user_id=run.user_id,
        run_id=run.id,
        polygon_wgs=circle,
        initial_area_m2=claim_area_m2(run.distance_m),
        verified=run.verified,
        clan_id=user.clan_id,
    )
    run.claimed_at = datetime.utcnow()

    goal_reached, clan_id = (False, None)
    if run.verified:
        goal_reached, clan_id = record_clan_activity(
            db, user, distance_m=0.0, closed_loop=True, stolen=stolen_m2
        )
        xp_gain = settings.xp_per_claim + (settings.xp_per_steal if stolen_m2 > 0 else 0)
        db.execute(
            text("UPDATE users SET xp = xp + :g WHERE id = :uid"),
            {"g": xp_gain, "uid": user.id},
        )

    db.commit()

    # Best-effort push notifications, off the request path.
    if stolen_m2 > 0 and stolen_from:
        victim = db.execute(
            text("SELECT id::text FROM users WHERE username = :u"), {"u": stolen_from}
        ).fetchone()
        if victim:
            background.add_task(
                notify, [victim[0]], "stolen", "Your land is under attack",
                f"{user.username} took {round(stolen_m2):,} m² of your territory.",
            )
    if goal_reached and clan_id:
        background.add_task(
            notify, clan_member_ids(db, clan_id, exclude=user.id), "clan_goal",
            "Weekly goal reached!", "Your club hit this week's goal. Badge frame unlocked.",
        )

    return schemas.ClaimOut(
        territory=territory_out,
        stolen_m2=stolen_m2,
        stolen_from=stolen_from,
    )


def _claim_territory(
    db: Session,
    user_id: str,
    run_id: str,
    polygon_wgs,
    initial_area_m2: float,
    verified: bool = True,
    clan_id: str | None = None,
):  # -> (TerritoryOut | None, stolen_m2, stolen_from)
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
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    false,
                    :clan_id
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt, "clan_id": clan_id},
        ).fetchone()
        return _territory_out(db, new_row[0]), 0.0, None

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

    # Steal summary for the Result screen: total area taken from rivals + the
    # rival who lost the most.
    stolen_total = 0.0
    best_steal = 0.0
    stolen_from = None

    for rid, _ruid in rivals:
        steal = db.execute(
            text(
                """
                SELECT ST_Area(ST_Intersection(t.polygon, ST_GeomFromText(:wkt, 4326))::geography),
                       u.username
                FROM territories t JOIN users u ON u.id = t.user_id
                WHERE t.id = :rid
                """
            ),
            {"wkt": new_geom_wkt, "rid": rid},
        ).fetchone()
        if steal and steal[0]:
            stolen_total += float(steal[0])
            if float(steal[0]) > best_steal:
                best_steal = float(steal[0])
                stolen_from = steal[1]

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
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id)
                SELECT gen_random_uuid(), :uid, :rid, g,
                       ST_Area(g::geography), now(), true, :clan_id
                FROM merged
                RETURNING id, area_m2, created_at
                """
            ),
            {
                "uid": user_id,
                "rid": run_id,
                "new_wkt": new_geom_wkt,
                "old_wkt": same_user_union,
                "clan_id": clan_id,
            },
        ).fetchone()
    else:
        new_row = db.execute(
            text(
                """
                INSERT INTO territories (id, user_id, run_id, polygon, area_m2, created_at, verified, clan_id)
                VALUES (
                    gen_random_uuid(),
                    :uid,
                    :rid,
                    ST_Multi(ST_GeomFromText(:wkt, 4326)),
                    ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                    now(),
                    true,
                    :clan_id
                )
                RETURNING id, area_m2, created_at
                """
            ),
            {"uid": user_id, "rid": run_id, "wkt": new_geom_wkt, "clan_id": clan_id},
        ).fetchone()

    return _territory_out(db, new_row[0]), stolen_total, stolen_from


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
