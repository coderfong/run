"""PASERBY — Crossed Paths.

Thin HTTP over `app/paserby.py`, which owns every rule. Two things this layer
is responsible for and must not get wrong:

  * EVERY mutation is scoped by the authenticated user. An encounter id is
    looked up together with `current_user`, so a caller who is not one of the
    two people in it gets a 404 — there is no request shape in which a user id
    off the wire decides whose row is touched.

  * The responses carry no location and no times. That is enforced in the
    service layer's `_card`, not here, but it is the reason the encounter list
    is paged by OFFSET rather than by a `created_at` cursor: a cursor would put
    the exact moment two people crossed on the wire.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from .. import models, paserby, schemas
from ..config import settings
from ..database import get_db
from ..notifications import notify
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter(tags=["paserby"])

DEFAULT_LIMIT = 50


def _out(card: dict) -> schemas.PaserbyEncounter:
    colour = card.get("clan_color")
    return schemas.PaserbyEncounter(
        **{**card, "clan_color": schemas.ClanColor(**colour) if colour else None}
    )


@router.get("/me/paserby", response_model=schemas.PaserbySummary)
def paserby_summary(
    user: models.User = Depends(current_user), db: Session = Depends(get_db)
):
    """The switch and the badge — what Home asks for on every focus."""
    return schemas.PaserbySummary(**paserby.summary_for(db, user.id))


@router.put("/me/paserby", response_model=schemas.PaserbySummary)
def set_paserby(
    payload: schemas.PaserbySettingsIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Allow Crossed Paths. Turning it off also deletes this runner's stored
    trace samples — see `paserby.set_enabled`."""
    paserby.set_enabled(db, user.id, payload.enabled)
    return schemas.PaserbySummary(**paserby.summary_for(db, user.id))


@router.get("/me/paserby/encounters", response_model=schemas.PaserbyEncountersOut)
def my_encounters(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=50),
    offset: int = Query(0, ge=0),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """The Crossroads list, newest first."""
    summary = paserby.summary_for(db, user.id)
    cards = paserby.encounters_for(db, user.id, limit=limit, offset=offset)
    return schemas.PaserbyEncountersOut(
        encounters=[_out(c) for c in cards],
        unseen=summary["unseen"],
        total=summary["total"],
        enabled=summary["enabled"],
    )


@router.get("/me/paserby/reveal/{run_id}", response_model=schemas.PaserbyRevealOut)
def reveal_for_run(
    run_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """What this run turned up, for the post-run beat.

    Matching normally happens on a background task the moment the run ends, but
    the runner is looking at the screen — so this forces it if it has not
    happened yet. `runs.paserby_at` makes that free to ask for twice.
    """
    run = db.get(models.Run, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "run not found")
    paserby.ensure_processed(db, run_id)

    cards = paserby.encounters_for(
        db, user.id, limit=DEFAULT_LIMIT, run_id=run_id, unseen_only=True
    )
    cast = max(1, int(settings.paserby_reveal_cast))
    return schemas.PaserbyRevealOut(
        encounters=[_out(c) for c in cards[:cast]],
        new_count=len(cards),
        more_at_crossroads=max(0, len(cards) - cast),
    )


@router.post("/me/paserby/seen")
def mark_seen(
    payload: schemas.PaserbySeenIn | None = None,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Clear the badge — for the listed encounters, or all of them."""
    n = paserby.mark_seen(db, user.id, (payload.ids if payload else None) or None)
    return {"ok": True, "updated": n}


@router.post("/me/paserby/encounters/{encounter_id}/high-five", response_model=schemas.HighFiveOut)
@limiter.limit(settings.rate_limit_default)
def send_high_five(
    request: Request,
    response: Response,
    encounter_id: str,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """One high five per encounter, ever. A second press is a no-op that pays
    nothing rather than an error — the button has already done its job."""
    result = paserby.high_five(db, user.id, encounter_id, username=user.username)
    if result is None:
        raise HTTPException(404, "encounter not found")
    if not result["already"]:
        background.add_task(
            notify, [result["user_id"]], "paserby", "High five!",
            f"{user.username} high-fived you for crossing paths.",
            {"kind": "paserby_high_five", "screen": "crossroads"}, str(user.id),
        )
    return schemas.HighFiveOut(
        high_fived=True,
        already=bool(result["already"]),
        xp_gained=int(result.get("xp_gained") or 0),
        capped=bool(result.get("capped")),
    )


@router.post("/me/paserby/encounters/{encounter_id}/hide")
def hide_encounter(
    encounter_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Take one card off your own Crossroads. Not mutual."""
    if not paserby.hide(db, user.id, encounter_id):
        raise HTTPException(404, "encounter not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Blocking + reporting — deliberately general, not PASERBY-specific
# ---------------------------------------------------------------------------


@router.post("/me/blocks")
@limiter.limit(settings.rate_limit_default)
def block_user(
    request: Request,
    response: Response,
    payload: schemas.BlockIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Block a runner. Removes the pair's crossed-paths history and stops the
    matcher from ever pairing them again."""
    if payload.user_id == str(user.id):
        raise HTTPException(400, "you cannot block yourself")
    if db.get(models.User, payload.user_id) is None:
        raise HTTPException(404, "runner not found")
    paserby.block(db, user.id, payload.user_id)
    return {"ok": True, "blocked": True}


@router.delete("/me/blocks/{other_id}")
def unblock_user(
    other_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not paserby.unblock(db, user.id, other_id):
        raise HTTPException(404, "not blocked")
    return {"ok": True, "blocked": False}


@router.post("/me/reports")
@limiter.limit(settings.rate_limit_default)
def report_user(
    request: Request,
    response: Response,
    payload: schemas.ReportIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """File a report for moderation. Stored for review; nothing is automatic."""
    if payload.user_id == str(user.id):
        raise HTTPException(400, "you cannot report yourself")
    if db.get(models.User, payload.user_id) is None:
        raise HTTPException(404, "runner not found")
    report_id = paserby.report(
        db,
        user.id,
        payload.user_id,
        payload.reason,
        payload.detail,
        payload.encounter_id,
        surface="paserby" if payload.encounter_id else "content",
    )
    return {"ok": True, "report_id": report_id}
