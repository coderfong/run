"""Pasers — mutual friendship between runners.

The link is a single row per unordered pair (see migration 0014), so the
direction only records who asked. Everything user-facing is symmetric: once
status is 'accepted' both sides are pasers of each other.

Declines DELETE the row instead of parking it in a 'declined' status. Parking
it would mean the pair index blocks the requester from ever asking again while
giving the addressee no way to clear it — a decline should be "not now", not a
permanent block.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, paserby, ranks, schemas
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..notifications import notify
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter(tags=["pasers"])

SEARCH_LIMIT = 20


def _clan_color(key):
    return schemas.ClanColor(**color_triple(key)) if key else None


def _level(xp) -> int:
    return int(((xp or 0) / 100) ** 0.5)


def _state_for(row_requester, row_status, viewer_id) -> str:
    """Map a paser_links row onto the viewer's perspective."""
    if row_status is None:
        return "none"
    if row_status == "accepted":
        return "paser"
    return "pending_out" if row_requester == viewer_id else "pending_in"


# The relationship of :uid to every candidate row, as a joinable subquery.
# LEFT JOINed so runners with no link at all still come back as 'none'.
_LINK_JOIN = """
    LEFT JOIN paser_links pl
           ON (pl.requester_id = :uid AND pl.addressee_id = u.id)
           OR (pl.addressee_id = :uid AND pl.requester_id = u.id)
"""


# NOT /users/search: users.py already owns /users/{user_id}, which would match
# "search" as an id and 404 depending on router include order. /pasers/search
# can't collide with anything.
@router.get("/pasers/search", response_model=list[schemas.RunnerCard])
def search_users(
    q: str = Query(..., min_length=2, max_length=32),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Prefix search on username, with the viewer's link state on each hit."""
    term = q.strip().lower()
    if not term:
        return []
    rows = db.execute(
        text(
            f"""
            SELECT u.id::text, u.username, u.avatar, c.tag, c.color_key, u.xp,
                   pl.requester_id::text, pl.status, pl.id::text,
                   COALESCE(u.rank_points, 0), u.rank_points_at
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            {_LINK_JOIN}
            WHERE u.id <> :uid AND lower(u.username) LIKE :term
              AND NOT EXISTS (
                    SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = CAST(:uid AS uuid) AND b.blocked_id = u.id)
                       OR (b.blocker_id = u.id AND b.blocked_id = CAST(:uid AS uuid))
              )
            ORDER BY (lower(u.username) = :exact) DESC, length(u.username), lower(u.username)
            LIMIT :lim
            """
        ),
        {"uid": user.id, "term": f"{term}%", "exact": term, "lim": SEARCH_LIMIT},
    ).fetchall()
    return [
        schemas.RunnerCard(
            user_id=r[0],
            username=r[1],
            avatar=r[2],
            clan_tag=r[3],
            clan_color=_clan_color(r[4]),
            rank_key=ranks.key_for(r[9], r[10]),
            level=_level(r[5]),
            state=_state_for(r[6], r[7], user.id),
            # A hit can already be pending_in — the row offers Accept, which
            # needs the link id.
            request_id=r[8],
        )
        for r in rows
    ]


@router.get("/pasers", response_model=schemas.PaserListOut)
def my_pasers(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything the Pasers screen needs in one round trip: accepted pasers,
    requests waiting on me, and requests I'm waiting on."""
    rows = db.execute(
        text(
            """
            SELECT pl.id::text, pl.status, pl.requester_id::text,
                   u.id::text, u.username, u.avatar, c.tag, c.color_key, u.xp,
                   COALESCE(u.rank_points, 0), u.rank_points_at
            FROM paser_links pl
            JOIN users u
              ON u.id = CASE WHEN pl.requester_id = :uid THEN pl.addressee_id
                             ELSE pl.requester_id END
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE pl.requester_id = :uid OR pl.addressee_id = :uid
            ORDER BY pl.created_at DESC
            """
        ),
        {"uid": user.id},
    ).fetchall()

    pasers, incoming, outgoing = [], [], []
    for r in rows:
        state = _state_for(r[2], r[1], user.id)
        card = schemas.RunnerCard(
            user_id=r[3],
            username=r[4],
            avatar=r[5],
            clan_tag=r[6],
            clan_color=_clan_color(r[7]),
            rank_key=ranks.key_for(r[9], r[10]),
            level=_level(r[8]),
            state=state,
            request_id=r[0],
        )
        if state == "paser":
            pasers.append(card)
        elif state == "pending_in":
            incoming.append(card)
        else:
            outgoing.append(card)
    pasers.sort(key=lambda c: c.username.lower())
    return schemas.PaserListOut(pasers=pasers, incoming=incoming, outgoing=outgoing)


@router.post("/pasers/requests", response_model=schemas.RunnerCard)
@limiter.limit(settings.rate_limit_default)
def send_request(
    request: Request,
    response: Response,
    payload: schemas.PaserRequestIn,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    target_id = payload.user_id
    if target_id == user.id:
        raise HTTPException(400, "you are already your own paser")
    target = db.get(models.User, target_id)
    if target is None:
        raise HTTPException(404, "runner not found")
    if paserby.is_blocked(db, user.id, target_id):
        raise HTTPException(404, "runner not found")

    existing = db.execute(
        text(
            """
            SELECT id::text, requester_id::text, status FROM paser_links
            WHERE (requester_id = :a AND addressee_id = :b)
               OR (requester_id = :b AND addressee_id = :a)
            """
        ),
        {"a": user.id, "b": target_id},
    ).fetchone()

    if existing:
        if existing[2] == "accepted":
            raise HTTPException(409, "already pasers")
        if existing[1] == user.id:
            raise HTTPException(409, "request already sent")
        # They asked us first and we're now asking them: that's a mutual yes.
        # Accept their row rather than creating a second one the pair index
        # would reject anyway.
        db.execute(
            text("UPDATE paser_links SET status = 'accepted', responded_at = now() WHERE id = :id"),
            {"id": existing[0]},
        )
        db.commit()
        background.add_task(
            notify, [target_id], "pasers", "You're now pasers",
            f"{user.username} accepted your paser request.",
            {"kind": "paser_accepted", "user_id": user.id}, str(user.id),
        )
        return _card_for(db, target_id, user.id)

    db.execute(
        text(
            "INSERT INTO paser_links (requester_id, addressee_id, status) "
            "VALUES (:a, :b, 'pending')"
        ),
        {"a": user.id, "b": target_id},
    )
    db.commit()
    background.add_task(
        notify, [target_id], "pasers", "New paser request",
        f"{user.username} wants to be your paser.",
        {"kind": "paser_request", "user_id": user.id}, str(user.id),
    )
    return _card_for(db, target_id, user.id)


@router.post("/pasers/requests/{link_id}/{action}", response_model=schemas.RunnerCard)
def respond_to_request(
    link_id: str,
    action: str,
    background: BackgroundTasks,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if action not in ("accept", "decline"):
        raise HTTPException(400, "action must be accept or decline")
    row = db.execute(
        text(
            "SELECT requester_id::text, addressee_id::text, status "
            "FROM paser_links WHERE id = :id"
        ),
        {"id": link_id},
    ).fetchone()
    if not row:
        raise HTTPException(404, "request not found")
    # Only the addressee may answer, and only while it's still pending.
    if row[1] != user.id:
        raise HTTPException(403, "not your request to answer")
    if row[2] != "pending":
        raise HTTPException(409, "request already answered")

    requester_id = row[0]
    if action == "decline":
        db.execute(text("DELETE FROM paser_links WHERE id = :id"), {"id": link_id})
        db.commit()
        # Deliberately silent: telling someone they were declined is a worse
        # product than letting the request quietly lapse.
        return _card_for(db, requester_id, user.id)

    db.execute(
        text("UPDATE paser_links SET status = 'accepted', responded_at = now() WHERE id = :id"),
        {"id": link_id},
    )
    db.commit()
    background.add_task(
        notify, [requester_id], "pasers", "You're now pasers",
        f"{user.username} accepted your paser request.",
        {"kind": "paser_accepted", "user_id": user.id}, str(user.id),
    )
    return _card_for(db, requester_id, user.id)


@router.delete("/pasers/{other_id}")
def remove_paser(
    other_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Unfriend, or cancel a request you sent. Same row either way."""
    deleted = db.execute(
        text(
            """
            DELETE FROM paser_links
            WHERE (requester_id = :a AND addressee_id = :b)
               OR (requester_id = :b AND addressee_id = :a)
            """
        ),
        {"a": user.id, "b": other_id},
    ).rowcount
    db.commit()
    if not deleted:
        raise HTTPException(404, "not linked")
    return {"ok": True}


def _card_for(db, other_id: str, viewer_id: str) -> schemas.RunnerCard:
    """Re-read a runner + the viewer's link state, so the client can render the
    next button state straight from the mutation's response."""
    r = db.execute(
        text(
            f"""
            SELECT u.id::text, u.username, u.avatar, c.tag, c.color_key, u.xp,
                   pl.requester_id::text, pl.status, pl.id::text,
                   COALESCE(u.rank_points, 0), u.rank_points_at
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            {_LINK_JOIN}
            WHERE u.id = :other
            """
        ),
        {"uid": viewer_id, "other": other_id},
    ).fetchone()
    if not r:
        raise HTTPException(404, "runner not found")
    return schemas.RunnerCard(
        user_id=r[0],
        username=r[1],
        avatar=r[2],
        clan_tag=r[3],
        clan_color=_clan_color(r[4]),
        rank_key=ranks.key_for(r[9], r[10]),
        level=_level(r[5]),
        state=_state_for(r[6], r[7], viewer_id),
        request_id=r[8],
    )


@router.get("/users/{other_id}/profile", response_model=schemas.RunnerProfile)
def runner_profile(
    other_id: str,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Another runner's public profile — the tap-through from a paser row."""
    if other_id != str(user.id) and paserby.is_blocked(db, user.id, other_id):
        raise HTTPException(404, "runner not found")
    u = db.execute(
        text(
            f"""
            SELECT u.id::text, u.username, u.avatar, c.tag, c.name, c.color_key, u.xp,
                   pl.requester_id::text, pl.status, pl.id::text,
                   COALESCE(u.rank_points, 0), u.rank_points_at
            FROM users u
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            {_LINK_JOIN}
            WHERE u.id = :other
            """
        ),
        {"uid": user.id, "other": other_id},
    ).fetchone()
    if not u:
        raise HTTPException(404, "runner not found")

    state = "self" if other_id == user.id else _state_for(u[7], u[8], user.id)

    # Live territory only — mirrors /me/stats, which discounts land whose
    # strength-scaled lifetime has expired.
    terr = db.execute(
        text(
            "SELECT COALESCE(SUM(area_m2),0), COUNT(*), COALESCE(MAX(area_m2),0) "
            "FROM territories WHERE user_id = :uid AND verified "
            "AND now() < COALESCE(expires_at, created_at + make_interval("
            "secs => GREATEST(strength,0.1) * :life_per * 86400))"
        ),
        {"uid": other_id, "life_per": settings.territory_life_days_per_strength},
    ).fetchone()

    runs = db.execute(
        text(
            "SELECT COUNT(*), COALESCE(SUM(distance_m),0) FROM runs "
            "WHERE user_id = :uid AND ended_at IS NOT NULL AND verified"
        ),
        {"uid": other_id},
    ).fetchone()

    paser_count = db.execute(
        text(
            "SELECT COUNT(*) FROM paser_links WHERE status = 'accepted' "
            "AND (requester_id = :uid OR addressee_id = :uid)"
        ),
        {"uid": other_id},
    ).scalar()

    # Shadow-flagged runs stay private to their owner, same rule as run_detail.
    recent = db.execute(
        text(
            """
            SELECT r.id::text, r.distance_m, r.duration_s,
                   -- Ground WON by the run, not the merged holding it joined
                   -- (see ClaimOut.gained_m2); the join answers for runs
                   -- claimed before that was measured.
                   COALESCE((r.claim_result ->> 'gained_m2')::float, t.area_m2, 0),
                   (t.id IS NOT NULL), r.ended_at
            FROM runs r
            LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.user_id = :uid AND r.ended_at IS NOT NULL AND r.verified
            ORDER BY r.ended_at DESC
            LIMIT 5
            """
        ),
        {"uid": other_id},
    ).fetchall()

    xp = int(u[6] or 0)
    return schemas.RunnerProfile(
        user_id=u[0],
        username=u[1],
        avatar=u[2],
        clan_tag=u[3],
        clan_name=u[4],
        clan_color=_clan_color(u[5]),
        rank_key=ranks.key_for(u[10], u[11]),
        state=state,
        request_id=u[9],
        paser_count=int(paser_count or 0),
        level=_level(xp),
        xp=xp,
        total_area_m2=float(terr[0] or 0),
        territory_count=int(terr[1] or 0),
        biggest_claim_m2=float(terr[2] or 0),
        runs_count=int(runs[0] or 0),
        career_distance_m=float(runs[1] or 0),
        recent_runs=[
            schemas.RunSummary(
                run_id=r[0],
                distance_m=float(r[1] or 0),
                duration_s=float(r[2] or 0),
                area_m2=float(r[3] or 0),
                closed_loop=bool(r[4]),
                created_at=r[5],
            )
            for r in recent
        ],
    )
