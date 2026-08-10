"""Allowlisted development scenarios that exercise real rivalry state.

These endpoints deliberately mutate the same territory and rivalry tables as
normal claims. They are never exposed to an ordinary account: both routes
enforce the server-side DEV_RUN_ACCOUNTS allowlist used by the run simulator.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from shapely import wkt as shapely_wkt
from shapely.ops import unary_union
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..devtools import is_dev_account
from ..notifications import notify
from ..security import current_user
from .runs import (
    STEAL_LEDGER_MIN_M2,
    _claim_territory,
    _run_route,
    _run_stamp,
)

router = APIRouter(prefix="/dev", tags=["dev"])


def _require_dev(user) -> None:
    # Hide the harness rather than advertising a privileged mutation surface.
    if not is_dev_account(user):
        raise HTTPException(404, "not found")


def _dev_rival(db: Session, user) -> models.User:
    """One deterministic, non-login rival account per allowed developer."""
    rival_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"paser-dev-rival:{user.id}"))
    rival = db.get(models.User, rival_id)
    if rival is not None:
        return rival
    compact = str(user.id).replace("-", "")[:12]
    rival = models.User(
        id=rival_id,
        username=f"DevRival_{compact}",
        password_hash=None,
        clan_id=None,
        avatar={},
    )
    db.add(rival)
    db.flush()
    return rival


@router.post("/runs/{run_id}/seed-rival")
def seed_rival_for_run(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Put weak rival land under this run's default claim pose.

    The result screen still performs the real preview and claim. This endpoint
    only arranges the board so that path has an opponent to take land from.
    """
    _require_dev(user)
    run = db.get(models.Run, run_id)
    if run is None or str(run.user_id) != str(user.id):
        raise HTTPException(404, "run not found")
    if run.ended_at is None or run.claimed_at is not None:
        raise HTTPException(409, "run must be finished and unclaimed")

    route = _run_route(db, run)
    stamp = _run_stamp(route, float(run.claim_area_m2 or 0.0))
    if stamp is None:
        raise HTTPException(422, "run has no usable claim shape")

    rival = _dev_rival(db, user)

    # Under EVERY pose the result screen might open on, not just one of them.
    #
    # This used to seed a single claim-shaped polygon at t = 0.5, on the
    # assumption that the middle of the route is where the claim starts. It is
    # not, and there are two different poses in play before the runner touches
    # anything: /end-run draws the shape at its RESTING pose (`stamp.t0`, which
    # for a lap is nowhere near 0.5), and /claim-options then moves it to
    # whichever sample it recommends. Seeding one and opening on the other put
    # the rival's land a quarter of a lap from the claim — measured on the
    # simulator's own presets, the overlap was 26% at 1.2 km and 0% from 3 km
    # up. Nothing to take means no victims, which means the capture beat
    # correctly plays the empty-ground landing and the scenario silently does
    # not do the one thing it exists for.
    #
    # The union of both poses costs nothing here and makes the harness
    # deterministic: wherever the claim opens, there is a rival underneath it.
    poses = {round(stamp.t0, 4), 0.5}
    polygon = unary_union([stamp.at(t, 0.0) for t in sorted(poses)])
    if polygon.geom_type == "GeometryCollection" or polygon.is_empty:
        polygon = stamp.at(stamp.t0, 0.0)
    # Each scenario starts clean for this developer's bot. This does not touch
    # any real runner's rows, including the developer's own territory.
    db.execute(text("DELETE FROM territories WHERE user_id = :u"), {"u": rival.id})
    row = db.execute(
        text(
            """
            INSERT INTO territories
                (id, user_id, run_id, polygon, area_m2, created_at, verified,
                 clan_id, strength, reinforcements, expires_at)
            VALUES
                (gen_random_uuid(), :uid, NULL,
                 ST_Multi(ST_GeomFromText(:wkt, 4326)),
                 ST_Area(ST_GeomFromText(:wkt, 4326)::geography),
                 now(), true, NULL, 0.05, 0, :expires)
            RETURNING id::text, area_m2,
                      ST_Y(ST_Centroid(polygon)), ST_X(ST_Centroid(polygon))
            """
        ),
        {
            "uid": rival.id,
            "wkt": polygon.wkt,
            "expires": datetime.utcnow() + timedelta(days=30),
        },
    ).fetchone()
    db.commit()
    return {
        "ok": True,
        "rival_id": str(rival.id),
        "rival_username": rival.username,
        "territory_id": row[0],
        "area_m2": float(row[1] or 0.0),
        "lat": float(row[2]),
        "lon": float(row[3]),
    }


@router.post("/rival-takes-mine")
def rival_takes_mine(
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Run a real, overpowering rival claim against the developer's land."""
    _require_dev(user)
    mine = db.execute(
        text(
            """
            SELECT id::text, ST_AsText(polygon), area_m2
            FROM territories
            WHERE user_id = :u AND verified
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY area_m2 DESC
            LIMIT 1
            """
        ),
        {"u": user.id},
    ).fetchone()
    if mine is None:
        raise HTTPException(409, "claim some territory first, then run this scenario")

    rival = _dev_rival(db, user)
    polygon = shapely_wkt.loads(mine[1])
    territory, _stolen, _from, events = _claim_territory(
        db=db,
        user_id=str(rival.id),
        run_id=None,
        polygon_wgs=polygon,
        initial_area_m2=float(mine[2] or 0.0),
        # Deliberately above any normal stacked defence: this scenario is for
        # reaching the loss UI reliably, not balancing a simulated workout.
        strength=1000.0,
        verified=True,
        clan_id=None,
        lifetime_days=30.0,
    )

    centre = polygon.centroid
    taken_from_me = 0.0
    for event in events:
        if event["area_m2"] < STEAL_LEDGER_MIN_M2:
            continue
        db.execute(
            text(
                """
                INSERT INTO territory_steals
                    (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, NULL, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": rival.id,
                "v": event["victim_id"],
                "area": event["area_m2"],
                "defended": event["defended"],
                "lat": centre.y,
                "lon": centre.x,
            },
        )
        if str(event["victim_id"]) == str(user.id) and not event["defended"]:
            taken_from_me += float(event["area_m2"])

    db.commit()
    if taken_from_me <= 0:
        raise HTTPException(409, "the dev rival did not take any of your land")

    background.add_task(
        notify,
        [str(user.id)],
        "stolen",
        "Your land is under attack",
        f"{rival.username} took {round(taken_from_me):,} m² of your territory.",
        None,
        str(rival.id),
    )
    return {
        "ok": True,
        "rival_id": str(rival.id),
        "rival_username": rival.username,
        "taken_m2": taken_from_me,
        "territory_id": str(territory.id) if territory else None,
        "lat": centre.y,
        "lon": centre.x,
    }
