"""Clans — the Clash-Royale layer. Create/join/invite, roles, seasons,
leagues, and the weekly "clan chest" goal. Membership lives in clan_members
(one clan per user); users.clan_id is a denormalized pointer kept in sync so
claim-time attribution stays a single column read.

All mutating endpoints are auth-protected and rate-limited. Note: the app's
"team" was always a client-side hash of the username and never appeared in
the API, so retiring teams needs no /v2 break — clan fields are additive on
the existing map/feed/leaderboard endpoints and old clients simply ignore
them.
"""

import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import content_moderation, images, models, schemas
from ..clans_meta import (
    CLAN_BADGES,
    CLAN_COLORS,
    LEAGUES,
    NEUTRAL_COLOR,
    color_triple,
    photo_url as _photo_url,
)
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user, current_user_optional, require_admin

router = APIRouter(tags=["clans"])

TAG_RE = re.compile(r"^[A-Z0-9]{2,5}$")
NAME_RE = re.compile(r"^[A-Za-z0-9 ._-]{3,24}$")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _color(key):
    return schemas.ClanColor(**color_triple(key))


def _week_start():
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=today.weekday())  # Monday


def _current_season(db: Session):
    row = db.execute(
        text(
            "SELECT id::text, name, ends_at FROM seasons "
            "WHERE now() BETWEEN starts_at AND ends_at "
            "ORDER BY ends_at DESC LIMIT 1"
        )
    ).fetchone()
    if row:
        return row
    return db.execute(text("SELECT id::text, name, ends_at FROM seasons ORDER BY ends_at DESC LIMIT 1")).fetchone()


def _membership(db: Session, user_id: str):
    return db.execute(
        text("SELECT clan_id::text, role FROM clan_members WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchone()


def _member_count(db: Session, clan_id: str) -> int:
    return int(db.execute(text("SELECT COUNT(*) FROM clan_members WHERE clan_id = :cid"), {"cid": clan_id}).scalar() or 0)


def _ensure_week_goal(db: Session, clan_id: str):
    """This week's goal, created (scaled to member count) if absent."""
    ws = _week_start()
    goal = db.execute(
        text("SELECT id::text, target_distance_m, target_claims, progress_distance_m, progress_claims, reached "
             "FROM clan_week_goals WHERE clan_id = :cid AND week_start = :ws"),
        {"cid": clan_id, "ws": ws},
    ).fetchone()
    if goal:
        return goal, ws
    members = max(1, _member_count(db, clan_id))
    target_dist = members * 15000.0  # 15 km per member / week
    target_claims = members * 2
    goal = db.execute(
        text("INSERT INTO clan_week_goals (clan_id, week_start, target_distance_m, target_claims) "
             "VALUES (:cid, :ws, :td, :tc) "
             "RETURNING id::text, target_distance_m, target_claims, progress_distance_m, progress_claims, reached"),
        {"cid": clan_id, "ws": ws, "td": target_dist, "tc": target_claims},
    ).fetchone()
    return goal, ws


def _season_area_and_rank(db: Session, clan_id: str):
    season = _current_season(db)
    if not season:
        return 0.0, None, None
    stat = db.execute(
        text("SELECT area_current, league FROM clan_season_stats WHERE season_id = :sid AND clan_id = :cid"),
        {"sid": season[0], "cid": clan_id},
    ).fetchone()
    area = float(stat[0]) if stat else 0.0
    league = stat[1] if stat else None
    rank = db.execute(
        text("SELECT 1 + COUNT(*) FROM clan_season_stats WHERE season_id = :sid AND area_current > :a"),
        {"sid": season[0], "a": area},
    ).scalar()
    return area, league, int(rank) if rank else None


def _clan_summary(db: Session, row) -> schemas.ClanSummary:
    area, league, _ = _season_area_and_rank(db, row[0])
    return schemas.ClanSummary(
        id=row[0], name=row[1], tag=row[2], color=_color(row[3]), badge_icon=row[4],
        photo_url=_photo_url(row[0], row[6]),
        privacy=row[5], member_count=_member_count(db, row[0]), league=league, season_area_m2=area,
    )


def _clan_out(db: Session, clan_id: str, viewer_id, full=False) -> schemas.ClanOut:
    c = db.execute(
        text("SELECT id::text, name, tag, description, color_key, badge_icon, privacy, member_cap, "
             "created_by::text, created_at, COALESCE(xp, 0), photo_etag FROM clans WHERE id = :cid"),
        {"cid": clan_id},
    ).fetchone()
    if not c:
        raise HTTPException(404, "club not found")
    area, league, rank = _season_area_and_rank(db, clan_id)
    my = _membership(db, viewer_id) if viewer_id else None

    members = []
    week_goal = None
    if full:
        ws = _week_start()
        rows = db.execute(
            text(
                """
                SELECT cm.user_id::text, u.username, cm.role, cm.joined_at,
                       COALESCE(cw.distance_m, 0), COALESCE(cw.claims, 0)
                FROM clan_members cm
                JOIN users u ON u.id = cm.user_id
                LEFT JOIN clan_week_goals g ON g.clan_id = cm.clan_id AND g.week_start = :ws
                LEFT JOIN clan_week_contrib cw ON cw.goal_id = g.id AND cw.user_id = cm.user_id
                WHERE cm.clan_id = :cid
                ORDER BY COALESCE(cw.distance_m, 0) DESC, cm.joined_at ASC
                """
            ),
            {"cid": clan_id, "ws": ws},
        ).fetchall()
        role_rank = {"leader": 0, "officer": 1, "member": 2}
        members = [
            schemas.ClanMemberOut(
                user_id=r[0], username=r[1], role=r[2], joined_at=r[3],
                week_distance_m=float(r[4]), week_claims=int(r[5]),
            )
            for r in sorted(rows, key=lambda r: (role_rank.get(r[2], 3), -float(r[4])))
        ]
        goal, ws = _ensure_week_goal(db, clan_id)
        mine = db.execute(
            text("SELECT COALESCE(distance_m,0), COALESCE(claims,0) FROM clan_week_contrib WHERE goal_id = :gid AND user_id = :uid"),
            {"gid": goal[0], "uid": viewer_id},
        ).fetchone() if viewer_id else None
        week_goal = schemas.WeekGoalOut(
            week_start=str(ws), target_distance_m=float(goal[1]), target_claims=int(goal[2]),
            progress_distance_m=float(goal[3]), progress_claims=int(goal[4]), reached=bool(goal[5]),
            my_distance_m=float(mine[0]) if mine else 0.0, my_claims=int(mine[1]) if mine else 0,
        )

    return schemas.ClanOut(
        id=c[0], name=c[1], tag=c[2], description=c[3], color_key=c[4] or "azure",
        color=_color(c[4]), badge_icon=c[5], photo_url=_photo_url(c[0], c[11]),
        privacy=c[6], member_cap=c[7],
        member_count=_member_count(db, clan_id), created_by=c[8], created_at=c[9],
        my_role=my[1] if my else None, league=league, season_area_m2=area, season_rank=rank,
        members=members, week_goal=week_goal, xp=int(c[10] or 0),
    )


def _require_role(db, clan_id, user_id, allowed):
    m = _membership(db, user_id)
    if not m or m[0] != clan_id or m[1] not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient club role")
    return m[1]


# ---------------------------------------------------------------------------
# claim-time hooks (imported by runs.py)
# ---------------------------------------------------------------------------

def record_clan_activity(db: Session, user, distance_m: float, closed_loop: bool, stolen: float):
    """On end-run: advance the weekly goal + season stats for the runner's
    clan. Returns (goal_reached_now, clan_id) so the caller can notify."""
    m = _membership(db, user.id)
    if not m:
        return (False, None)
    clan_id = m[0]
    goal, ws = _ensure_week_goal(db, clan_id)
    was_reached = bool(goal[5])
    db.execute(
        text(
            """
            INSERT INTO clan_week_contrib (goal_id, user_id, distance_m, claims)
            VALUES (:gid, :uid, :d, :c)
            ON CONFLICT (goal_id, user_id)
            DO UPDATE SET distance_m = clan_week_contrib.distance_m + :d,
                          claims = clan_week_contrib.claims + :c
            """
        ),
        {"gid": goal[0], "uid": user.id, "d": distance_m, "c": 1 if closed_loop else 0},
    )
    db.execute(
        text(
            """
            UPDATE clan_week_goals
            SET progress_distance_m = progress_distance_m + :d,
                progress_claims = progress_claims + :c,
                reached = (progress_distance_m + :d) >= target_distance_m
                          AND (progress_claims + :c) >= target_claims
            WHERE id = :gid
            """
        ),
        {"gid": goal[0], "d": distance_m, "c": 1 if closed_loop else 0},
    )
    season = _current_season(db)
    if season:
        area = db.execute(
            text("SELECT COALESCE(SUM(area_m2),0) FROM territories WHERE clan_id = :cid AND verified "
                 "AND now() < COALESCE(expires_at, created_at + make_interval("
                 "secs => GREATEST(strength,0.1) * :life_per * 86400))"),
            {"cid": clan_id, "life_per": settings.territory_life_days_per_strength},
        ).scalar()
        db.execute(
            text(
                """
                INSERT INTO clan_season_stats (season_id, clan_id, area_current, area_peak, steals, distance_sum)
                VALUES (:sid, :cid, :area, :area, :st, :dist)
                ON CONFLICT (season_id, clan_id)
                DO UPDATE SET area_current = :area,
                              area_peak = GREATEST(clan_season_stats.area_peak, :area),
                              steals = clan_season_stats.steals + :st,
                              distance_sum = clan_season_stats.distance_sum + :dist
                """
            ),
            {"sid": season[0], "cid": clan_id, "area": float(area or 0),
             "st": 1 if stolen > 0 else 0, "dist": distance_m},
        )

    now_reached = db.execute(
        text("SELECT reached FROM clan_week_goals WHERE id = :gid"), {"gid": goal[0]}
    ).scalar()
    return (bool(now_reached) and not was_reached, clan_id)


def clan_member_ids(db: Session, clan_id: str, exclude=None):
    rows = db.execute(text("SELECT user_id::text FROM clan_members WHERE clan_id = :c"), {"c": clan_id}).fetchall()
    return [r[0] for r in rows if r[0] != exclude]


def add_clan_xp(db: Session, clan_id: str | None, amount: int):
    """Advance a club's collective XP total. No-op for clanless runners or
    non-positive amounts. Committed by the caller alongside the user XP write."""
    if not clan_id or amount <= 0:
        return
    share = int(round(amount * settings.club_xp_share))
    if share <= 0:
        return
    db.execute(
        text("UPDATE clans SET xp = xp + :g WHERE id = :cid"),
        {"g": share, "cid": clan_id},
    )


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@router.post("/clans", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def create_clan(request: Request, response: Response, payload: schemas.ClanCreate,
                user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if _membership(db, user.id):
        raise HTTPException(409, "leave your current club first")
    name = payload.name.strip()
    tag = payload.tag.strip().upper()
    if not NAME_RE.match(name):
        raise HTTPException(400, "name must be 3-24 chars")
    if not TAG_RE.match(tag):
        raise HTTPException(400, "tag must be 2-5 letters/digits")
    name = content_moderation.require_allowed_text(name, "club name")
    tag = content_moderation.require_allowed_text(tag, "club tag")
    description = content_moderation.require_allowed_text(
        payload.description or "", "club description"
    )
    if payload.color_key not in CLAN_COLORS:
        raise HTTPException(400, "unknown color")
    if payload.badge_icon not in CLAN_BADGES:
        raise HTTPException(400, "unknown badge")
    if payload.privacy not in ("open", "invite_only"):
        raise HTTPException(400, "bad privacy")
    taken = db.execute(
        text("SELECT 1 FROM clans WHERE lower(name) = lower(:n) OR tag = :t"),
        {"n": name, "t": tag},
    ).fetchone()
    if taken:
        raise HTTPException(409, "club name or tag already taken")

    photo = images.square_jpeg_data_uri(payload.photo) if payload.photo else None
    cid = db.execute(
        text("INSERT INTO clans (id, name, tag, description, color_key, badge_icon, privacy, "
             "photo, photo_etag, created_by, created_at) "
             "VALUES (gen_random_uuid(), :n, :t, :d, :ck, :b, :p, :photo, :etag, :uid, now()) RETURNING id::text"),
        {"n": name, "t": tag, "d": description, "ck": payload.color_key,
         "b": payload.badge_icon, "p": payload.privacy, "uid": user.id,
         "photo": photo, "etag": secrets.token_hex(6) if photo else None},
    ).scalar()
    db.execute(text("INSERT INTO clan_members (clan_id, user_id, role) VALUES (:cid, :uid, 'leader')"),
               {"cid": cid, "uid": user.id})
    db.execute(text("UPDATE users SET clan_id = :cid WHERE id = :uid"), {"cid": cid, "uid": user.id})
    db.commit()
    return _clan_out(db, cid, user.id, full=True)


@router.get("/clans/search", response_model=list[schemas.ClanSummary])
def search_clans(q: str = Query("", max_length=32), user: models.User = Depends(current_user),
                 db: Session = Depends(get_db)):
    like = f"%{q.strip().lower()}%"
    rows = db.execute(
        text("SELECT id::text, name, tag, color_key, badge_icon, privacy, photo_etag FROM clans "
             "WHERE lower(name) LIKE :q OR lower(tag) LIKE :q ORDER BY name LIMIT 30"),
        {"q": like},
    ).fetchall()
    out = [_clan_summary(db, r) for r in rows]
    out.sort(key=lambda c: c.season_area_m2, reverse=True)
    return out


@router.get("/clans/{clan_id}", response_model=schemas.ClanOut)
def get_clan(clan_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return _clan_out(db, clan_id, user.id, full=True)


@router.get("/clans/{clan_id}/photo")
def clan_photo(clan_id: str, db: Session = Depends(get_db)):
    """The club's uploaded photo, as an image.

    Unauthenticated on purpose: this is the <img> target for every club crest
    in the app, the URL carries an unguessable club id plus upload token, and
    a crest is already visible to anyone who can open the club directory.
    Handing images out by URL is what lets the client cache them to disk.
    """
    row = db.execute(text("SELECT photo FROM clans WHERE id = :cid"), {"cid": clan_id}).fetchone()
    if not row or not row[0]:
        raise HTTPException(404, "no club photo")
    data, media_type = images.decode_data_uri(row[0])
    if data is None:
        raise HTTPException(404, "no club photo")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/clans/{clan_id}/join", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def join_clan(request: Request, response: Response, clan_id: str,
              user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if _membership(db, user.id):
        raise HTTPException(409, "leave your current club first")
    c = db.execute(text("SELECT privacy, member_cap FROM clans WHERE id = :cid"), {"cid": clan_id}).fetchone()
    if not c:
        raise HTTPException(404, "club not found")
    if c[0] != "open":
        raise HTTPException(403, "this club is invite-only")
    if _member_count(db, clan_id) >= c[1]:
        raise HTTPException(409, "club is full")
    _add_member(db, clan_id, user.id)
    db.commit()
    return _clan_out(db, clan_id, user.id, full=True)


@router.post("/clans/join-by-code", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def join_by_code(request: Request, response: Response, body: dict,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if _membership(db, user.id):
        raise HTTPException(409, "leave your current club first")
    code = (body.get("code") or "").strip()
    inv = db.execute(
        text("SELECT id::text, clan_id::text, expires_at, max_uses, uses FROM clan_invites WHERE code = :c"),
        {"c": code},
    ).fetchone()
    if not inv:
        raise HTTPException(404, "invalid invite code")
    if inv[2] and inv[2] < datetime.utcnow():
        raise HTTPException(410, "invite expired")
    if inv[4] >= inv[3]:
        raise HTTPException(410, "invite used up")
    clan_id = inv[1]
    c = db.execute(text("SELECT member_cap FROM clans WHERE id = :cid"), {"cid": clan_id}).fetchone()
    if _member_count(db, clan_id) >= c[0]:
        raise HTTPException(409, "club is full")
    _add_member(db, clan_id, user.id)
    db.execute(text("UPDATE clan_invites SET uses = uses + 1 WHERE id = :iid"), {"iid": inv[0]})
    db.commit()
    return _clan_out(db, clan_id, user.id, full=True)


def _add_member(db, clan_id, user_id, role="member"):
    db.execute(text("INSERT INTO clan_members (clan_id, user_id, role) VALUES (:cid, :uid, :r)"),
               {"cid": clan_id, "uid": user_id, "r": role})
    db.execute(text("UPDATE users SET clan_id = :cid WHERE id = :uid"), {"cid": clan_id, "uid": user_id})


@router.post("/clans/{clan_id}/invites", response_model=schemas.ClanInviteOut)
@limiter.limit(settings.rate_limit_auth)
def create_invite(request: Request, response: Response, clan_id: str,
                  user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _require_role(db, clan_id, user.id, ("leader", "officer"))
    code = secrets.token_urlsafe(6)
    expires = datetime.utcnow() + timedelta(days=7)
    db.execute(
        text("INSERT INTO clan_invites (clan_id, code, created_by, expires_at, max_uses) "
             "VALUES (:cid, :c, :uid, :e, 25)"),
        {"cid": clan_id, "c": code, "uid": user.id, "e": expires},
    )
    db.commit()
    return schemas.ClanInviteOut(code=code, expires_at=expires, max_uses=25, uses=0,
                                 url=f"pacer://clan/join/{code}")


@router.post("/clans/leave")
@limiter.limit(settings.rate_limit_auth)
def leave_clan(request: Request, response: Response,
               user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    m = _membership(db, user.id)
    if not m:
        return {"ok": True}
    clan_id, role = m
    others = _member_count(db, clan_id) - 1
    if role == "leader" and others > 0:
        raise HTTPException(409, "transfer leadership before leaving")
    db.execute(text("DELETE FROM clan_members WHERE user_id = :uid"), {"uid": user.id})
    db.execute(text("UPDATE users SET clan_id = NULL WHERE id = :uid"), {"uid": user.id})
    if others == 0:  # sole member left -> disband (territory keeps its clan_id attribution)
        db.execute(text("DELETE FROM clans WHERE id = :cid"), {"cid": clan_id})
    db.commit()
    return {"ok": True}


@router.post("/clans/{clan_id}/members/{target_id}/role")
@limiter.limit(settings.rate_limit_auth)
def set_role(request: Request, response: Response, clan_id: str, target_id: str, body: dict,
             user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    role = _require_role(db, clan_id, user.id, ("leader", "officer"))
    new_role = (body.get("role") or "").strip()
    if new_role not in ("officer", "member", "leader"):
        raise HTTPException(400, "bad role")
    target = _membership(db, target_id)
    if not target or target[0] != clan_id:
        raise HTTPException(404, "not a member")
    if new_role == "leader":
        if role != "leader":
            raise HTTPException(403, "only the leader can transfer leadership")
        # transfer: target -> leader, self -> officer
        db.execute(text("UPDATE clan_members SET role = 'leader' WHERE user_id = :t"), {"t": target_id})
        db.execute(text("UPDATE clan_members SET role = 'officer' WHERE user_id = :u"), {"u": user.id})
    else:
        if role == "officer" and target[1] in ("leader", "officer"):
            raise HTTPException(403, "officers can't manage other officers")
        db.execute(text("UPDATE clan_members SET role = :r WHERE user_id = :t"), {"r": new_role, "t": target_id})
    db.commit()
    return _clan_out(db, clan_id, user.id, full=True)


@router.post("/clans/{clan_id}/members/{target_id}/kick")
@limiter.limit(settings.rate_limit_auth)
def kick_member(request: Request, response: Response, clan_id: str, target_id: str,
                user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    role = _require_role(db, clan_id, user.id, ("leader", "officer"))
    if target_id == user.id:
        raise HTTPException(400, "use leave instead")
    target = _membership(db, target_id)
    if not target or target[0] != clan_id:
        raise HTTPException(404, "not a member")
    if target[1] == "leader" or (role == "officer" and target[1] == "officer"):
        raise HTTPException(403, "can't kick this member")
    db.execute(text("DELETE FROM clan_members WHERE user_id = :t"), {"t": target_id})
    db.execute(text("UPDATE users SET clan_id = NULL WHERE id = :t"), {"t": target_id})
    db.commit()
    return _clan_out(db, clan_id, user.id, full=True)


@router.patch("/clans/{clan_id}", response_model=schemas.ClanOut)
@limiter.limit(settings.rate_limit_auth)
def update_clan(request: Request, response: Response, clan_id: str, payload: schemas.ClanUpdate,
                user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _require_role(db, clan_id, user.id, ("leader", "officer"))
    fields, params = [], {"cid": clan_id}
    if payload.description is not None:
        fields.append("description = :d")
        params["d"] = content_moderation.require_allowed_text(
            payload.description, "club description"
        )
    if payload.color_key is not None:
        if payload.color_key not in CLAN_COLORS:
            raise HTTPException(400, "unknown color")
        fields.append("color_key = :ck"); params["ck"] = payload.color_key
    if payload.badge_icon is not None:
        if payload.badge_icon not in CLAN_BADGES:
            raise HTTPException(400, "unknown badge")
        fields.append("badge_icon = :b"); params["b"] = payload.badge_icon
    if payload.photo is not None:
        # "" clears the photo; a new image gets a new etag so every client
        # that cached the old URL fetches the new one.
        photo = images.square_jpeg_data_uri(payload.photo) if payload.photo else None
        fields.append("photo = :photo"); params["photo"] = photo
        fields.append("photo_etag = :etag"); params["etag"] = secrets.token_hex(6) if photo else None
    if payload.privacy is not None:
        if payload.privacy not in ("open", "invite_only"):
            raise HTTPException(400, "bad privacy")
        fields.append("privacy = :p"); params["p"] = payload.privacy
    if fields:
        db.execute(text(f"UPDATE clans SET {', '.join(fields)} WHERE id = :cid"), params)
        db.commit()
    return _clan_out(db, clan_id, user.id, full=True)


@router.get("/leaderboard/clans", response_model=list[schemas.ClanLeaderboardEntry])
def clan_leaderboard(db: Session = Depends(get_db), limit: int = Query(50, ge=1, le=200)):
    season = _current_season(db)
    if not season:
        return []
    rows = db.execute(
        text(
            """
            SELECT c.id::text, c.name, c.tag, c.color_key, s.area_current, s.league,
                   (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id),
                   c.badge_icon, c.photo_etag
            FROM clan_season_stats s JOIN clans c ON c.id = s.clan_id
            WHERE s.season_id = :sid
            ORDER BY s.area_current DESC
            LIMIT :limit
            """
        ),
        {"sid": season[0], "limit": limit},
    ).fetchall()
    return [
        schemas.ClanLeaderboardEntry(
            clan_id=r[0], name=r[1], tag=r[2], color=_color(r[3]),
            badge_icon=r[7] or "shield", photo_url=_photo_url(r[0], r[8]),
            league=r[5], total_area_m2=float(r[4]), member_count=int(r[6]),
        )
        for r in rows
    ]


@router.get("/clans/{clan_id}/feed", response_model=schemas.FeedOut)
def clan_feed(clan_id: str, limit: int = Query(20, ge=1, le=50),
              user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.user_id::text, u.username, r.distance_m, r.duration_s, r.ended_at,
                   COALESCE(t.area_m2, 0), (t.id IS NOT NULL)
            FROM runs r
            JOIN users u ON u.id = r.user_id
            JOIN clan_members cm ON cm.user_id = r.user_id AND cm.clan_id = :cid
            LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.ended_at IS NOT NULL AND r.verified
            ORDER BY r.ended_at DESC LIMIT :limit
            """
        ),
        {"cid": clan_id, "limit": limit},
    ).fetchall()
    items = [
        schemas.FeedItem(id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id),
                         distance_m=float(r[3] or 0), duration_s=float(r[4] or 0),
                         created_at=r[5], area_m2=float(r[6] or 0), closed_loop=bool(r[7]))
        for r in rows
    ]
    return schemas.FeedOut(items=items, next_cursor=None)


# ---------------------------------------------------------------------------
# join requests (invite-only clans)
# ---------------------------------------------------------------------------

@router.post("/clans/{clan_id}/request")
@limiter.limit(settings.rate_limit_auth)
def request_join(request: Request, response: Response, clan_id: str,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from ..notifications import notify  # local import avoids a cycle

    if _membership(db, user.id):
        raise HTTPException(409, "leave your current club first")
    c = db.execute(text("SELECT privacy, name FROM clans WHERE id = :cid"), {"cid": clan_id}).fetchone()
    if not c:
        raise HTTPException(404, "club not found")
    if c[0] == "open":
        raise HTTPException(400, "this club is open, join directly")
    db.execute(
        text(
            """
            INSERT INTO clan_join_requests (clan_id, user_id, status)
            VALUES (:cid, :uid, 'pending')
            ON CONFLICT (clan_id, user_id) DO UPDATE SET status = 'pending', created_at = now()
            """
        ),
        {"cid": clan_id, "uid": user.id},
    )
    db.commit()
    officers = db.execute(
        text("SELECT user_id::text FROM clan_members WHERE clan_id = :cid AND role IN ('leader','officer')"),
        {"cid": clan_id},
    ).fetchall()
    notify([o[0] for o in officers], "clan_goal", "Join request",
           f"{user.username} wants to join {c[1]}.", actor_id=str(user.id))
    return {"ok": True, "status": "pending"}


@router.get("/clans/{clan_id}/requests")
def list_requests(clan_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _require_role(db, clan_id, user.id, ("leader", "officer"))
    rows = db.execute(
        text(
            """
            SELECT r.id::text, r.user_id::text, u.username, r.created_at
            FROM clan_join_requests r JOIN users u ON u.id = r.user_id
            WHERE r.clan_id = :cid AND r.status = 'pending'
            ORDER BY r.created_at
            """
        ),
        {"cid": clan_id},
    ).fetchall()
    return [{"id": r[0], "user_id": r[1], "username": r[2], "created_at": r[3].isoformat()} for r in rows]


@router.post("/clans/{clan_id}/requests/{req_id}/{action}")
@limiter.limit(settings.rate_limit_auth)
def act_on_request(request: Request, response: Response, clan_id: str, req_id: str, action: str,
                   user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from ..notifications import notify

    if action not in ("approve", "deny"):
        raise HTTPException(400, "action must be approve or deny")
    _require_role(db, clan_id, user.id, ("leader", "officer"))
    req = db.execute(
        text("SELECT user_id::text, status FROM clan_join_requests WHERE id = :rid AND clan_id = :cid"),
        {"rid": req_id, "cid": clan_id},
    ).fetchone()
    if not req:
        raise HTTPException(404, "request not found")
    if req[1] != "pending":
        raise HTTPException(409, "already handled")
    if action == "approve":
        if _membership(db, req[0]):
            raise HTTPException(409, "user already joined a club")
        cap = db.execute(text("SELECT member_cap FROM clans WHERE id = :cid"), {"cid": clan_id}).scalar()
        if _member_count(db, clan_id) >= cap:
            raise HTTPException(409, "club is full")
        _add_member(db, clan_id, req[0])
    db.execute(text("UPDATE clan_join_requests SET status = :s WHERE id = :rid"),
               {"s": "approved" if action == "approve" else "denied", "rid": req_id})
    db.commit()
    tag = db.execute(text("SELECT tag FROM clans WHERE id = :cid"), {"cid": clan_id}).scalar()
    notify([req[0]], "clan_goal",
           "Request approved" if action == "approve" else "Request declined",
           f"Your request to join {tag} was {'approved, welcome in' if action == 'approve' else 'declined'}.",
           actor_id=str(user.id))
    return {"ok": True}


# ---- club chat -------------------------------------------------------------

def _require_member(db: Session, clan_id: str, user_id: str):
    m = _membership(db, user_id)
    if not m or m[0] != clan_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "club members only")


@router.get("/clans/{clan_id}/messages", response_model=list[schemas.ClanMessageOut])
def clan_messages(
    clan_id: str,
    before: datetime | None = None,
    limit: int = 50,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Latest chat messages (ascending). Pass `before` for older pages."""
    _require_member(db, clan_id, user.id)
    rows = db.execute(
        text(
            """
            SELECT m.id::text, m.user_id::text, COALESCE(u.username, 'former member'),
                   m.body, m.created_at
            FROM clan_messages m LEFT JOIN users u ON u.id = m.user_id
            WHERE m.clan_id = :cid AND (CAST(:before AS timestamp) IS NULL OR m.created_at < :before)
              AND (
                    m.user_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM user_blocks b
                        WHERE (b.blocker_id = CAST(:uid AS uuid) AND b.blocked_id = m.user_id)
                           OR (b.blocker_id = m.user_id AND b.blocked_id = CAST(:uid AS uuid))
                    )
              )
            ORDER BY m.created_at DESC
            LIMIT :lim
            """
        ),
        {"cid": clan_id, "before": before, "lim": max(1, min(int(limit), 100)), "uid": user.id},
    ).fetchall()
    return [
        schemas.ClanMessageOut(
            id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id), body=r[3], created_at=r[4]
        )
        for r in reversed(rows)
    ]


@router.post("/clans/{clan_id}/messages", response_model=schemas.ClanMessageOut)
@limiter.limit(settings.rate_limit_default)
def send_clan_message(
    request: Request,
    response: Response,
    clan_id: str,
    payload: schemas.ClanMessageIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, clan_id, user.id)
    body = content_moderation.require_allowed_text(payload.body, "message")
    row = db.execute(
        text(
            "INSERT INTO clan_messages (clan_id, user_id, body) VALUES (:cid, :uid, :b) "
            "RETURNING id::text, created_at"
        ),
        {"cid": clan_id, "uid": user.id, "b": body},
    ).fetchone()
    db.commit()
    return schemas.ClanMessageOut(
        id=row[0], user_id=user.id, username=user.username, is_you=True,
        body=body, created_at=row[1],
    )


@router.get("/me/clan", response_model=schemas.MyClan)
def my_clan(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    m = _membership(db, user.id)
    if not m:
        return schemas.MyClan()
    c = db.execute(text("SELECT tag, color_key FROM clans WHERE id = :cid"), {"cid": m[0]}).fetchone()
    return schemas.MyClan(clan_id=m[0], tag=c[0], role=m[1], color=_color(c[1]))


@router.post("/admin/recompute-season", dependencies=[Depends(require_admin)])
def recompute_season(db: Session = Depends(get_db)):
    """Nightly job (cron): refresh every clan's current area for the live
    season and re-assign leagues by size-normalized held area.

    Gated on `X-Admin-Token` — this reassigns every club's league, so an open
    endpoint let anyone reshuffle the season's standings on demand."""
    season = _current_season(db)
    if not season:
        return {"ok": False, "reason": "no season"}
    db.execute(
        text(
            """
            INSERT INTO clan_season_stats (season_id, clan_id, area_current, area_peak)
            SELECT :sid, c.id, COALESCE(a.area, 0), COALESCE(a.area, 0)
            FROM clans c
            LEFT JOIN (SELECT clan_id, SUM(area_m2) area FROM territories
                       WHERE verified AND clan_id IS NOT NULL
                         AND now() < COALESCE(expires_at, created_at + make_interval(secs => GREATEST(strength,0.1) * :life_per * 86400))
                       GROUP BY clan_id) a
              ON a.clan_id = c.id
            ON CONFLICT (season_id, clan_id)
            DO UPDATE SET area_current = EXCLUDED.area_current,
                          area_peak = GREATEST(clan_season_stats.area_peak, EXCLUDED.area_current)
            """
        ),
        {"sid": season[0], "life_per": settings.territory_life_days_per_strength},
    )
    # League tiers by area-per-member, split into quintiles.
    rows = db.execute(
        text(
            """
            SELECT s.clan_id::text,
                   s.area_current / GREATEST(1, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = s.clan_id)) AS norm
            FROM clan_season_stats s WHERE s.season_id = :sid ORDER BY norm DESC
            """
        ),
        {"sid": season[0]},
    ).fetchall()
    n = len(rows)
    for i, r in enumerate(rows):
        # top 20% diamond ... bottom bronze
        tier = LEAGUES[min(len(LEAGUES) - 1, int((1 - i / max(1, n)) * len(LEAGUES)))]
        db.execute(text("UPDATE clan_season_stats SET league = :l WHERE season_id = :sid AND clan_id = :cid"),
                   {"l": tier, "sid": season[0], "cid": r[0]})
    db.commit()
    return {"ok": True, "clans": n}
