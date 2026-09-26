"""Club run status, as the runner sees it.

    GET /runs/{run_id}/club-run   SOLO / POTENTIAL / CONFIRMED for one run
    GET /me/clan/territory        the runner's own club on the club board

`club_run_status` is also what /end-run, the claim and the replay embed in
their responses, so every surface that says whether a run counted reads the
same function. The verdict itself is never made here: this only reads what
app/club_runs.py has already logged.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import club_runs, elo, models, schemas
from ..clans_meta import color_triple, photo_url
from ..config import settings
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["clubs"])
log = logging.getLogger(__name__)


def _goal_now(db, clan_id, viewer_id):
    """This week's goal, READ ONLY. A status lookup must never create one."""
    from .clans import _week_start

    row = db.execute(
        text(
            "SELECT g.target_distance_m, g.target_claims, g.progress_distance_m, "
            "g.progress_claims, g.reached, g.week_start, "
            "COALESCE(cw.distance_m, 0), COALESCE(cw.claims, 0) "
            "FROM clan_week_goals g "
            "LEFT JOIN clan_week_contrib cw ON cw.goal_id = g.id AND cw.user_id = CAST(:u AS uuid) "
            "WHERE g.clan_id = CAST(:c AS uuid) AND g.week_start = :ws"
        ),
        {"c": str(clan_id), "ws": _week_start(), "u": str(viewer_id)},
    ).fetchone()
    if not row:
        return None
    return schemas.WeekGoalOut(
        week_start=str(row[5]), target_distance_m=float(row[0]), target_claims=int(row[1]),
        progress_distance_m=float(row[2]), progress_claims=int(row[3]), reached=bool(row[4]),
        my_distance_m=float(row[6]), my_claims=int(row[7]),
    )


def _person(p) -> schemas.ClubRunPerson:
    return schemas.ClubRunPerson(
        user_id=p["user_id"], username=p["username"], avatar=p.get("avatar"),
        rank_key=p.get("rank_key") or "wood", run_id=p.get("run_id"),
        distance_m=float(p.get("distance_m") or 0.0), is_you=bool(p.get("is_you")),
    )


def status_model(db, d: dict, viewer_id, viewer_clan_id=None) -> schemas.ClubRunStatus:
    """A `club_runs` status or session dict, as the wire shape."""
    confirmed = d.get("state") == "confirmed" or d.get("qualified")
    goal = None
    if confirmed and viewer_clan_id and str(viewer_clan_id) == str(d.get("club_id")):
        goal = _goal_now(db, d["club_id"], viewer_id)
    return schemas.ClubRunStatus(
        state=d.get("state") or ("confirmed" if confirmed else "solo"),
        qualified=bool(confirmed),
        session_id=d.get("session_id"),
        club_id=d.get("club_id"),
        club_name=d.get("club_name"),
        club_tag=d.get("club_tag"),
        club_color=schemas.ClanColor(**color_triple(d["color_key"])) if d.get("color_key") else None,
        badge_icon=d.get("badge_icon"),
        photo_url=photo_url(d["club_id"], d.get("photo_etag")) if d.get("club_id") else None,
        participants=[_person(p) for p in d.get("participants") or []],
        participant_count=int(d.get("participant_count") or len(d.get("participants") or [])),
        shared_distance_m=d.get("shared_distance_m"),
        your_distance_m=d.get("your_distance_m"),
        distance_m=d.get("distance_m"),
        territory_gained_m2=d.get("territory_gained_m2"),
        captured_m2=float(d.get("captured_m2") or 0.0),
        captured_from=list(d.get("captured_from") or []),
        club_xp_earned=int(d.get("club_xp_earned") or 0),
        week_added_distance_m=float(d.get("week_added_distance_m") or 0.0),
        week_added_claims=int(d.get("week_added_claims") or 0),
        week_goal=goal,
        started_at=d.get("started_at"),
        ended_at=d.get("ended_at"),
        waiting_for=[_person(p) for p in d.get("waiting_for") or []],
    )


def club_run_status(db, run, viewer_id, viewer_clan_id=None) -> schemas.ClubRunStatus:
    """The one answer to "did this run count for the club?"."""
    d = club_runs.status_for_run(db, run, viewer_id, member_clan_id=viewer_clan_id)
    return status_model(db, d, viewer_id, viewer_clan_id)


def safe_club_run_status(db, run, viewer_id, viewer_clan_id=None):
    """For embedding in a response that must not fail because of it. A run's
    result is worth more than its club badge: on any error this is None and
    the client asks GET /runs/{id}/club-run instead."""
    try:
        return club_run_status(db, run, viewer_id, viewer_clan_id)
    except Exception:
        log.warning("club run status failed for run %s", getattr(run, "id", None), exc_info=True)
        db.rollback()
        return None


@router.get("/runs/{run_id}/club-run", response_model=schemas.ClubRunStatus)
def get_club_run(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    run = db.get(models.Run, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    if run.user_id != user.id:
        # A clubmate may look at a run that was logged for their club (the
        # feed links to it); nobody else learns anything about it.
        allowed = db.execute(
            text(
                "SELECT 1 FROM club_run_logs cr JOIN users u ON u.id = CAST(:me AS uuid) "
                "WHERE cr.run_id = CAST(:r AS uuid) AND cr.clan_id = u.clan_id"
            ),
            {"me": str(user.id), "r": str(run_id)},
        ).fetchone()
        if not allowed:
            raise HTTPException(404, "run not found")
        # Someone else's run is never "potential" for the viewer.
        return club_run_status(db, run, user.id, None) if club_runs.session_for_run(db, run.id) \
            else schemas.ClubRunStatus()
    return club_run_status(db, run, user.id, user.clan_id)


@router.get("/me/clan/territory", response_model=schemas.ClubTerritorySummary)
def my_club_territory(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """What the runner's club holds on the club board right now.

    The same live, verified, club-stamped rows the board draws, so the numbers
    and the map cannot disagree. `my_area_m2` is the part from the runner's own
    runs: club land they helped win, not all the land they hold.
    """
    if not user.clan_id:
        raise HTTPException(404, "not in a club")
    c = db.execute(
        text("SELECT id::text, name, tag, color_key, badge_icon, photo_etag FROM clans WHERE id = :c"),
        {"c": user.clan_id},
    ).fetchone()
    if not c:
        raise HTTPException(404, "club not found")
    row = db.execute(
        text(
            """
            SELECT COUNT(*), COALESCE(SUM(area_m2), 0),
                   COALESCE(SUM(area_m2) FILTER (WHERE user_id = CAST(:u AS uuid)), 0)
            FROM territories t
            WHERE t.clan_id = CAST(:c AS uuid) AND t.verified
              AND now() < COALESCE(t.expires_at, t.created_at + make_interval(
                  secs => GREATEST(t.strength, 0.1) * :life_per * 86400))
            """
        ),
        {"c": c[0], "u": str(user.id), "life_per": settings.territory_life_days_per_strength},
    ).fetchone()
    rating = elo.club_status(db, c[0])
    return schemas.ClubTerritorySummary(
        club_id=c[0], name=c[1], tag=c[2],
        color=schemas.ClanColor(**color_triple(c[3])),
        badge_icon=c[4] or "shield", photo_url=photo_url(c[0], c[5]),
        territories=int(row[0] or 0), area_m2=float(row[1] or 0), my_area_m2=float(row[2] or 0),
        rank_key=rating["key"], rank_label=rating["label"],
        rank_tier=int(rating.get("tier", 0) or 0),
    )
