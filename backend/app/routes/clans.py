"""Clans — v1.1 groundwork. Minimal, auth-protected, rate-limited.

POST /clans           create (creator auto-joins)
GET  /clans/{id}      details + member count
POST /clans/{id}/join join
POST /clans/leave     leave current clan
GET  /leaderboard/clans  clans ranked by summed member territory area
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter(tags=["clans"])

# Hex colours only — these get painted straight onto the map.
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
TAG_RE = re.compile(r"^[A-Za-z0-9]{2,5}$")


def _clan_out(db: Session, clan: models.Clan) -> schemas.ClanOut:
    member_count = (
        db.query(func.count(models.User.id))
        .filter(models.User.clan_id == clan.id)
        .scalar()
    )
    return schemas.ClanOut(
        id=clan.id,
        name=clan.name,
        tag=clan.tag,
        color_fill=clan.color_fill,
        color_stroke=clan.color_stroke,
        color_glow=clan.color_glow,
        created_by=clan.created_by,
        created_at=clan.created_at,
        member_count=int(member_count or 0),
    )


@router.post("/clans", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def create_clan(
    request: Request,
    response: Response,
    payload: schemas.ClanCreate,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    tag = payload.tag.strip().upper()
    if not TAG_RE.match(tag):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tag must be 2-5 letters/digits")
    for c in (payload.color_fill, payload.color_stroke, payload.color_glow):
        if not COLOR_RE.match(c):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "colors must be hex (#RRGGBB)")

    taken = (
        db.query(models.Clan)
        .filter((func.lower(models.Clan.name) == name.lower()) | (models.Clan.tag == tag))
        .one_or_none()
    )
    if taken is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "clan name or tag already taken")

    clan = models.Clan(
        name=name,
        tag=tag,
        color_fill=payload.color_fill,
        color_stroke=payload.color_stroke,
        color_glow=payload.color_glow,
        created_by=user.id,
    )
    db.add(clan)
    db.flush()
    user.clan_id = clan.id  # creator auto-joins
    db.commit()
    db.refresh(clan)
    return _clan_out(db, clan)


@router.get("/clans/{clan_id}", response_model=schemas.ClanOut)
def get_clan(
    clan_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    clan = db.get(models.Clan, clan_id)
    if clan is None:
        raise HTTPException(404, "clan not found")
    return _clan_out(db, clan)


@router.post("/clans/{clan_id}/join", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def join_clan(
    request: Request,
    response: Response,
    clan_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    clan = db.get(models.Clan, clan_id)
    if clan is None:
        raise HTTPException(404, "clan not found")
    user.clan_id = clan.id
    db.commit()
    return _clan_out(db, clan)


@router.post("/clans/leave")
@limiter.limit(settings.rate_limit_auth)
def leave_clan(
    request: Request,
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    user.clan_id = None
    db.commit()
    return {"ok": True}


@router.get("/leaderboard/clans", response_model=list[schemas.ClanLeaderboardEntry])
def clan_leaderboard(
    db: Session = Depends(get_db),
    limit: int = 50,
):
    """Clans ranked by the summed area of their members' VERIFIED territories
    (clan_id is denormalized onto territories at claim time)."""
    rows = db.execute(
        text(
            """
            SELECT c.id::text, c.name, c.tag, c.color_stroke,
                   COALESCE(SUM(t.area_m2), 0) AS total_area,
                   COUNT(t.id) AS territory_count,
                   (SELECT COUNT(*) FROM users u WHERE u.clan_id = c.id) AS member_count
            FROM clans c
            LEFT JOIN territories t ON t.clan_id = c.id AND t.verified
            GROUP BY c.id, c.name, c.tag, c.color_stroke
            ORDER BY total_area DESC
            LIMIT :limit
            """
        ),
        {"limit": max(1, min(int(limit), 500))},
    ).fetchall()

    return [
        schemas.ClanLeaderboardEntry(
            clan_id=r[0],
            name=r[1],
            tag=r[2],
            color_stroke=r[3],
            total_area_m2=float(r[4]),
            territory_count=int(r[5]),
            member_count=int(r[6]),
        )
        for r in rows
    ]
