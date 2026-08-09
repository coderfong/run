"""GET /me/stats and /me/runs — the You tab's stat wall and recent runs."""

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi import HTTPException

from .. import models, privacy, ranks, schemas
from ..config import settings
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["users"])


# ---------------------------------------------------------------------------
# Route privacy
# ---------------------------------------------------------------------------


@router.get("/me/privacy", response_model=schemas.PrivacyOut)
def get_privacy(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """What of this runner's routes other people can see.

    Defaults are returned as REAL numbers rather than nulls: an account that
    has never opened these settings is still protected, and the screen should
    show what is actually in force, not an empty form.
    """
    p = privacy.load(db, user.id)
    return schemas.PrivacyOut(
        route_trim_m=p["trim_m"],
        publish_delay_h=p["delay_h"],
        zones=[schemas.PrivacyZone(**z) for z in p["zones"]],
        min_zone_radius_m=privacy.MIN_ZONE_RADIUS_M,
        max_zone_radius_m=privacy.MAX_ZONE_RADIUS_M,
        max_zones=privacy.MAX_ZONES,
        minor=bool(p.get("minor")),
    )


@router.put("/me/privacy", response_model=schemas.PrivacyOut)
def set_privacy(
    payload: schemas.PrivacyIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Update any subset. Zones are clamped and capped on the way in, so a
    client cannot store a 5 m 'privacy' circle that identifies a doorway or a
    hundred of them."""
    sets, params = [], {"u": user.id}
    if payload.route_trim_m is not None:
        sets.append("route_trim_m = :trim")
        params["trim"] = int(payload.route_trim_m)
    if payload.publish_delay_h is not None:
        sets.append("route_publish_delay_h = :delay")
        params["delay"] = int(payload.publish_delay_h)
    if payload.zones is not None:
        import json

        cleaned = privacy.clean_zones([z.model_dump() for z in payload.zones])
        sets.append("privacy_zones = CAST(:zones AS jsonb)")
        params["zones"] = json.dumps(cleaned)
    if sets:
        db.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id = :u"), params)
        db.commit()
    return get_privacy(user=user, db=db)


@router.put("/runs/{run_id}/visibility")
def set_run_visibility(
    run_id: str,
    payload: schemas.RunVisibilityIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Hide or re-publish one run's route.

    A private run still records, still claims territory and still counts for
    every total — only its trace stops being shown to anyone else. Retroactive
    on purpose: the run you wish you had hidden is always one you already did.
    """
    if payload.visibility not in privacy.VISIBILITIES:
        raise HTTPException(400, f"visibility must be one of {list(privacy.VISIBILITIES)}")
    res = db.execute(
        text("UPDATE runs SET visibility = :v WHERE id = :r AND user_id = :u"),
        {"v": payload.visibility, "r": run_id, "u": user.id},
    )
    if res.rowcount == 0:
        raise HTTPException(404, "run not found")
    db.commit()
    return {"ok": True, "run_id": run_id, "visibility": payload.visibility}


def _streak_days(run_dates: List) -> int:
    """Consecutive calendar days (UTC) with >= 1 run, ending today or
    yesterday (so it doesn't break until a full day is missed)."""
    if not run_dates:
        return 0
    have = set(run_dates)
    today = datetime.now(timezone.utc).date()
    if today not in have and (today - timedelta(days=1)) not in have:
        return 0
    cursor = today if today in have else today - timedelta(days=1)
    streak = 0
    while cursor in have:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def _streak_weeks(week_starts: List[datetime]) -> int:
    """Consecutive ISO weeks (ending this week or last) with >= 1 run."""
    if not week_starts:
        return 0
    have = set(w.date() for w in week_starts)
    # Monday of the current week.
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    # Allow the streak to be "current" if you ran this week or last week.
    if monday not in have and (monday - timedelta(days=7)) not in have:
        return 0
    cursor = monday if monday in have else monday - timedelta(days=7)
    streak = 0
    while cursor in have:
        streak += 1
        cursor = cursor - timedelta(days=7)
    return streak


@router.get("/me/stats", response_model=schemas.MeStats)
def me_stats(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    terr = db.execute(
        text(
            "SELECT COALESCE(SUM(area_m2),0), COUNT(*), COALESCE(MAX(area_m2),0) "
            "FROM territories WHERE user_id = :uid "
            "AND now() < COALESCE(expires_at, created_at + make_interval("
            "secs => GREATEST(strength,0.1) * :life_per * 86400))"
        ),
        {"uid": user.id, "life_per": settings.territory_life_days_per_strength},
    ).fetchone()
    runs = db.execute(
        text(
            "SELECT COUNT(*), COALESCE(SUM(distance_m),0) "
            "FROM runs WHERE user_id = :uid AND ended_at IS NOT NULL"
        ),
        {"uid": user.id},
    ).fetchone()
    weeks = db.execute(
        text(
            "SELECT DISTINCT date_trunc('week', ended_at) AS wk "
            "FROM runs WHERE user_id = :uid AND ended_at IS NOT NULL ORDER BY wk DESC"
        ),
        {"uid": user.id},
    ).fetchall()
    day_rows = db.execute(
        text(
            "SELECT DISTINCT ended_at::date AS d "
            "FROM runs WHERE user_id = :uid AND ended_at IS NOT NULL ORDER BY d DESC"
        ),
        {"uid": user.id},
    ).fetchall()

    xp = int(
        db.execute(text("SELECT COALESCE(xp, 0) FROM users WHERE id = :uid"), {"uid": user.id}).scalar() or 0
    )
    level = int((xp / 100) ** 0.5)
    rk = ranks.status(db, user.id)
    return schemas.MeStats(
        rank_points=rk["points"],
        rank_key=rk["key"],
        rank_label=rk["label"],
        rank_next_points=rk["next_points"],
        rank_progress=rk["progress"],
        rank_best_key=rk["best_key"],
        total_area_m2=float(terr[0]),
        territory_count=int(terr[1]),
        biggest_claim_m2=float(terr[2]),
        runs_count=int(runs[0]),
        career_distance_m=float(runs[1]),
        current_streak_weeks=_streak_weeks([w[0] for w in weeks if w[0]]),
        current_streak_days=_streak_days([d[0] for d in day_rows if d[0]]),
        xp=xp,
        level=level,
        next_level_xp=100 * (level + 1) ** 2,
    )


@router.put("/me/avatar")
def set_avatar(
    payload: schemas.AvatarIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Store the user's equipped cosmetics so others can see their portrait."""
    import json

    db.execute(
        text("UPDATE users SET avatar = CAST(:a AS jsonb) WHERE id = :uid"),
        {"a": json.dumps(payload.avatar), "uid": user.id},
    )
    db.commit()
    return {"ok": True}


@router.get("/me/run-days", response_model=schemas.RunDaysOut)
def run_days(
    days: int = Query(120, ge=1, le=400),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Distinct calendar dates (UTC) the user completed a run in the window —
    drives the streak calendar on the You tab."""
    rows = db.execute(
        text(
            """
            SELECT DISTINCT to_char(ended_at, 'YYYY-MM-DD') AS d
            FROM runs
            WHERE user_id = :uid AND ended_at IS NOT NULL
              AND ended_at >= now() - make_interval(days => :win)
            ORDER BY d DESC
            """
        ),
        {"uid": user.id, "win": days},
    ).fetchall()
    return schemas.RunDaysOut(days=[r[0] for r in rows])


@router.get("/me/runs", response_model=List[schemas.RunSummary])
def me_runs(
    limit: int = Query(20, ge=1, le=100),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.distance_m, r.duration_s, r.ended_at,
                   COALESCE(t.area_m2, 0), (t.id IS NOT NULL)
            FROM runs r
            LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.user_id = :uid AND r.ended_at IS NOT NULL
            ORDER BY r.ended_at DESC
            LIMIT :limit
            """
        ),
        {"uid": user.id, "limit": limit},
    ).fetchall()
    return [
        schemas.RunSummary(
            run_id=r[0],
            distance_m=float(r[1] or 0),
            duration_s=float(r[2] or 0),
            created_at=r[3],
            area_m2=float(r[4] or 0),
            closed_loop=bool(r[5]),
        )
        for r in rows
    ]
