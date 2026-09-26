"""Club battles, club rivals, the club's activity and a plot's story.

    GET /me/club/rivals             every club yours has fought, newest first
    GET /me/club/rivals/{clan_id}   one club rivalry, battle by battle
    GET /clans/{clan_id}/activity   club runs, club battles and reached goals
    GET /territories/{id}/story     who holds a plot, how, and what it has seen

All of it is a read of app/game_events.py, the one place that decides what a
beat was (solo or club) and whose side it is told from. Nothing here keeps
state of its own.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import game_events, models, schemas
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["clubs"])


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    # Stored timestamps are naive UTC; a cursor echoed back as "...Z" is aware.
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _us(db, user) -> schemas.ClubRef | None:
    if not user.clan_id:
        return None
    return game_events.clubs(db, [user.clan_id], user.clan_id).get(str(user.clan_id))


@router.get("/me/club/rivals", response_model=schemas.ClubRivalsOut)
def my_club_rivals(
    limit: int = Query(25, ge=1, le=50),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Clubs yours keeps trading ground with. Empty, not an error, for a runner
    in no club: the Rivals screen shows the solo list either way."""
    us = _us(db, user)
    if us is None:
        return schemas.ClubRivalsOut()
    return schemas.ClubRivalsOut(
        club=us,
        rivals=game_events.club_rivals(db, user.clan_id, viewer_id=user.id, limit=limit),
    )


@router.get("/me/club/rivals/{clan_id}", response_model=schemas.ClubRivalDetail)
def my_club_rival(
    clan_id: str,
    limit: int = Query(30, ge=1, le=100),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    us = _us(db, user)
    if us is None:
        raise HTTPException(404, "you are not in a club")
    if clan_id == str(user.clan_id):
        raise HTTPException(400, "a club can't be its own rival")
    cards = game_events.club_rivals(db, user.clan_id, viewer_id=user.id, other_clan_id=clan_id, limit=1)
    if not cards:
        raise HTTPException(404, "no battles with that club yet")
    battles = game_events.club_battles(
        db, user.clan_id, other_clan_id=clan_id, limit=limit, viewer_id=user.id
    )
    return schemas.ClubRivalDetail(us=us, rival=cards[0], battles=battles)


@router.get("/clans/{clan_id}/activity", response_model=schemas.ClubActivityOut)
def club_activity(
    clan_id: str,
    cursor: Optional[datetime] = Query(None, description="return items older than this"),
    limit: int = Query(20, ge=1, le=50),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """What a club has been doing together. Public like the club profile: the
    club runs, the battles and the goals are the club's record, and none of it
    carries a route."""
    return game_events.club_activity(
        db, clan_id, viewer_id=user.id, viewer_clan_id=user.clan_id,
        before=_naive_utc(cursor), limit=limit,
    )


@router.get("/territories/{territory_id}/story", response_model=schemas.TerritoryClubStory)
def territory_story(
    territory_id: str,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """The tapped plot's history. `lat`/`lon` (the tap) find the plot under
    the finger when the id went stale in a merge."""
    story = game_events.territory_story(
        db, territory_id, lat=lat, lon=lon, viewer_id=user.id, viewer_clan_id=user.clan_id
    )
    if story is None:
        raise HTTPException(404, "that land is gone")
    return story
