"""Run detail, kudos, push-token registration, notification prefs, and the
weekly-recap cron."""

import json
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import (
    content_moderation,
    economy,
    elo,
    images,
    models,
    paserby,
    post_media,
    privacy,
    reactions as reaction_rules,
    schemas,
)
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..notifications import notify
from ..reminders import deliver_scheduled_reminders
from ..ratelimit import limiter
from ..security import current_user, require_admin

router = APIRouter(tags=["social"])


def _clan_color(key):
    return schemas.ClanColor(**color_triple(key)) if key else None


@router.get("/runs/{run_id}", response_model=schemas.RunDetail)
def run_detail(run_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.execute(
        text(
            """
            SELECT r.id::text, r.user_id::text, u.username, r.distance_m, r.duration_s, r.ended_at,
                   r.verified,
                   -- The ground this run WON, not the merged holding it joined
                   -- (see ClaimOut.gained_m2); the join is the fallback for
                   -- runs claimed before that was measured.
                   COALESCE((r.claim_result ->> 'gained_m2')::float, t.area_m2, 0),
                   (t.id IS NOT NULL),
                   ST_AsText(r.path), ST_AsText(t.polygon), c.tag, c.color_key,
                   COALESCE(r.visibility, 'public'), r.caption,
                   COALESCE(r.post_media, '[]'::jsonb), r.post_media_etag,
                   -- This run's own claim shape, for the same reason as the
                   -- area above: `t.polygon` is the merged holding, so a
                   -- reinforcing run would be illustrated with a map of
                   -- everything its owner holds nearby.
                   r.claim_result -> 'claim_rings',
                   -- Whether the owner can still place this run's land.
                   r.claimed_at, r.claim_area_m2, r.tier
            FROM runs r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN territories t ON t.run_id = r.id
            LEFT JOIN clan_members cm ON cm.user_id = r.user_id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE r.id = :rid
            """
        ),
        {"rid": run_id},
    ).fetchone()
    if not r:
        raise HTTPException(404, "run not found")
    # Shadow-flagged runs are private to their owner.
    if not r[6] and r[1] != user.id:
        raise HTTPException(404, "run not found")
    if r[1] != user.id and paserby.is_blocked(db, user.id, r[1]):
        raise HTTPException(404, "run not found")

    path = []
    if r[9]:
        try:
            line = shapely_wkt.loads(r[9])
            path = [(x, y) for x, y in line.coords]
        except Exception:
            path = []
    # This endpoint used to hand the FULL raw trace of anyone's run to any
    # authenticated caller — one request, no privileges, and you have their
    # front door. The owner still sees their own route untouched; everyone else
    # gets it trimmed at both ends, cleared of privacy zones, and withheld
    # entirely while the publish delay is running.
    path = privacy.path_for_viewer(
        path,
        owner_id=r[1],
        viewer_id=user.id,
        prefs=privacy.load(db, r[1]),
        visibility=r[13],
        ended_at=r[5],
    )
    # The claim itself where it was recorded, the merged territory otherwise.
    rings = [
        [(float(x), float(y)) for x, y in ring]
        for ring in (r[17] or [])
        if len(ring) >= 3
    ]
    if not rings and r[10]:
        rings = geometry_to_rings(shapely_wkt.loads(r[10]))

    splits = db.execute(
        text("SELECT km, seconds FROM run_splits WHERE run_id = :rid ORDER BY km"), {"rid": run_id}
    ).fetchall()
    kcount = db.execute(text("SELECT COUNT(*) FROM run_kudos WHERE run_id = :rid"), {"rid": run_id}).scalar()
    kmine = db.execute(
        text("SELECT 1 FROM run_kudos WHERE run_id = :rid AND user_id = :uid"), {"rid": run_id, "uid": user.id}
    ).fetchone()
    ccount = db.execute(
        text(
            "SELECT COUNT(*) FROM run_comments "
            "WHERE run_id = :rid AND NULLIF(BTRIM(body), '') IS NOT NULL"
        ),
        {"rid": run_id},
    ).scalar()
    summary, mine = reaction_rules.summarise(db, [run_id], user.id)

    # The owner's own run can still have land waiting to be placed, and its
    # page is one of the ways back into the claim screen. Same rule as the
    # Home list (/me/pending-claims): finished, unclaimed, earned ground,
    # claimable, has a route, and still inside the window.
    claim_pending = bool(
        r[1] == user.id
        and r[5] is not None
        and r[18] is None
        and r[9]
        and float(r[19] or 0) > 0
        and economy.claim_allowed(r[20] or economy.CLAIMABLE)
        and economy.claim_window_open(r[5])
    )

    return schemas.RunDetail(
        run_id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id),
        distance_m=float(r[3] or 0), duration_s=float(r[4] or 0), created_at=r[5],
        area_m2=float(r[7] or 0), closed_loop=bool(r[8]),
        clan_tag=r[11], clan_color=_clan_color(r[12]),
        path=path, territory_rings=rings,
        splits=[schemas.RunSplit(km=s[0], seconds=float(s[1])) for s in splits],
        kudos_count=int(kcount or 0), kudoed=bool(kmine),
        comment_count=int(ccount or 0),
        reactions=[schemas.RunReaction(**x) for x in summary.get(run_id, [])],
        my_reaction=mine.get(run_id),
        caption=r[14], media=post_media.photo_urls(r[0], r[16], list(r[15] or [])),
        claim_pending=claim_pending,
        claim_expires_at=economy.claim_deadline(r[5]) if claim_pending else None,
    )


def _run_visible_to(db, run_id, user):
    """Same visibility rule as run_detail: shadow-flagged runs are owner-only."""
    r = db.execute(
        text("SELECT user_id::text, verified FROM runs WHERE id = :rid"), {"rid": run_id}
    ).fetchone()
    if not r or (not r[1] and r[0] != user.id):
        raise HTTPException(404, "run not found")
    if r[0] != user.id and paserby.is_blocked(db, user.id, r[0]):
        raise HTTPException(404, "run not found")
    return r[0]


@router.put("/runs/{run_id}/post", response_model=schemas.RunPostOut)
@limiter.limit(settings.rate_limit_default)
def update_run_post(
    request: Request,
    response: Response,
    run_id: str,
    payload: schemas.RunPostIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Edit the caption and photos attached to the owner's Home feed card."""
    run = db.execute(
        text(
            "SELECT user_id::text, ended_at, COALESCE(post_media, '[]'::jsonb) "
            "FROM runs WHERE id = :rid"
        ),
        {"rid": run_id},
    ).fetchone()
    if not run or run[0] != user.id:
        raise HTTPException(404, "run not found")
    if run[1] is None:
        raise HTTPException(409, "finish the run before editing its post")

    caption = payload.caption
    if caption:
        caption = content_moderation.require_allowed_text(caption, "caption")
    # New photos arrive as data URIs; the ones already on the post come back as
    # their own URLs, which resolve to the stored image rather than a re-upload.
    try:
        media = post_media.resolve_incoming(run_id, list(run[2] or []), payload.media)
    except ValueError as e:
        raise HTTPException(400, str(e))
    etag = secrets.token_hex(6) if media else None
    db.execute(
        text(
            "UPDATE runs SET caption = :caption, post_media = CAST(:media AS jsonb), "
            "post_media_etag = :etag WHERE id = :rid AND user_id = :uid"
        ),
        {
            "caption": caption,
            "media": json.dumps(media),
            "etag": etag,
            "rid": run_id,
            "uid": user.id,
        },
    )
    db.commit()
    return schemas.RunPostOut(
        run_id=run_id, caption=caption, media=post_media.photo_urls(run_id, etag, media)
    )


@router.get("/runs/{run_id}/post-photo/{index}")
def run_post_photo(
    run_id: str,
    index: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """One photo from a run post, as an image.

    Authenticated and behind the same visibility rule as the run itself: these
    are somebody's own photos, and a private or shadow-flagged run must not
    leak them just because the URL is guessable from the run id.
    """
    _run_visible_to(db, run_id, user)
    row = db.execute(
        text("SELECT COALESCE(post_media, '[]'::jsonb) FROM runs WHERE id = :rid"),
        {"rid": run_id},
    ).fetchone()
    media = list(row[0] or []) if row else []
    if index < 0 or index >= len(media):
        raise HTTPException(404, "no such photo")
    data, media_type = images.decode_data_uri(media[index])
    if data is None:
        raise HTTPException(404, "no such photo")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/runs/{run_id}/comments", response_model=list[schemas.RunCommentOut])
def run_comments(run_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _run_visible_to(db, run_id, user)
    rows = db.execute(
        text(
            """
            SELECT c.id::text, c.user_id::text, u.username, c.body, c.created_at
            FROM run_comments c JOIN users u ON u.id = c.user_id
            WHERE c.run_id = :rid AND NULLIF(BTRIM(c.body), '') IS NOT NULL
              AND NOT EXISTS (
                    SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = CAST(:uid AS uuid) AND b.blocked_id = c.user_id)
                       OR (b.blocker_id = c.user_id AND b.blocked_id = CAST(:uid AS uuid))
              )
            ORDER BY c.created_at
            LIMIT 200
            """
        ),
        {"rid": run_id, "uid": user.id},
    ).fetchall()
    return [
        schemas.RunCommentOut(
            id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id),
            body=r[3], created_at=r[4],
        )
        for r in rows
    ]


@router.post("/runs/{run_id}/comments", response_model=schemas.RunCommentOut)
@limiter.limit(settings.rate_limit_default)
def add_run_comment(request: Request, response: Response, run_id: str, payload: schemas.RunCommentIn,
                    background: BackgroundTasks,
                    user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    owner_id = _run_visible_to(db, run_id, user)
    body = content_moderation.require_allowed_text(payload.body, "comment")
    row = db.execute(
        text(
            "INSERT INTO run_comments (run_id, user_id, body, emote) VALUES (:rid, :uid, :b, NULL) "
            "RETURNING id::text, created_at"
        ),
        {"rid": run_id, "uid": user.id, "b": body},
    ).fetchone()
    db.commit()
    if owner_id != user.id:
        background.add_task(
            notify, [owner_id], "kudos", "New comment on your run",
            f"{user.username}: {body[:80]}",
            {"kind": "run_comment", "screen": "run", "run_id": run_id}, str(user.id),
        )
    return schemas.RunCommentOut(
        id=row[0], user_id=user.id, username=user.username, is_you=True,
        body=body, created_at=row[1],
    )


@router.post("/runs/{run_id}/kudos")
@limiter.limit(settings.rate_limit_default)
def toggle_kudos(request: Request, response: Response, run_id: str, background: BackgroundTasks,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    run = db.execute(text("SELECT user_id::text FROM runs WHERE id = :rid"), {"rid": run_id}).fetchone()
    if not run:
        raise HTTPException(404, "run not found")
    existing = db.execute(
        text("SELECT 1 FROM run_kudos WHERE run_id = :rid AND user_id = :uid"), {"rid": run_id, "uid": user.id}
    ).fetchone()
    if existing:
        db.execute(text("DELETE FROM run_kudos WHERE run_id = :rid AND user_id = :uid"), {"rid": run_id, "uid": user.id})
        kudoed = False
    else:
        db.execute(text("INSERT INTO run_kudos (run_id, user_id) VALUES (:rid, :uid)"), {"rid": run_id, "uid": user.id})
        kudoed = True
        if run[0] != user.id:
            background.add_task(
                notify, [run[0]], "kudos", "You got kudos",
                f"{user.username} gave kudos to your run.",
                {"kind": "run_kudos", "screen": "run", "run_id": run_id}, str(user.id),
            )
    db.commit()
    count = db.execute(text("SELECT COUNT(*) FROM run_kudos WHERE run_id = :rid"), {"rid": run_id}).scalar()
    return {"kudoed": kudoed, "kudos_count": int(count or 0)}


@router.get("/runs/{run_id}/reactions", response_model=schemas.RunReactionsOut)
def run_reactions(run_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _run_visible_to(db, run_id, user)
    summary, mine = reaction_rules.summarise(db, [run_id], user.id)
    return schemas.RunReactionsOut(
        reactions=[schemas.RunReaction(**x) for x in summary.get(run_id, [])],
        my_reaction=mine.get(run_id),
    )


@router.post("/runs/{run_id}/reactions", response_model=schemas.RunReactionsOut)
@limiter.limit(settings.rate_limit_default)
def set_run_reaction(request: Request, response: Response, run_id: str, payload: schemas.RunReactionIn,
                     background: BackgroundTasks,
                     user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Leave, swap, or take back one emote on a run.

    ONE per person, so this is a SET rather than an append: sending a different
    emote replaces yours, sending null (or the one you already left) clears it.
    The upsert does the swap in a single statement, which matters because two
    quick taps on two different emotes would otherwise race into a duplicate
    key on the (run_id, user_id) unique index.
    """
    owner_id = _run_visible_to(db, run_id, user)
    try:
        emote = reaction_rules.normalise(payload.emote)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    previous = db.execute(
        text("SELECT emote FROM run_reactions WHERE run_id = :rid AND user_id = :uid"),
        {"rid": run_id, "uid": user.id},
    ).fetchone()
    # Tapping the emote you already left is how you take it back off — the
    # picker has no separate clear button, and a tile you have selected should
    # behave like a toggle.
    if emote is None or (previous and previous[0] == emote):
        db.execute(
            text("DELETE FROM run_reactions WHERE run_id = :rid AND user_id = :uid"),
            {"rid": run_id, "uid": user.id},
        )
        emote = None
    else:
        db.execute(
            text(
                """
                INSERT INTO run_reactions (run_id, user_id, emote) VALUES (:rid, :uid, :e)
                ON CONFLICT (run_id, user_id) DO UPDATE SET emote = :e, created_at = now()
                """
            ),
            {"rid": run_id, "uid": user.id, "e": emote},
        )
    db.commit()

    # Only a NEW reaction pushes. Swapping between emotes, or clearing, would
    # otherwise let one person ring somebody's phone as often as they liked.
    if emote and not previous and owner_id != user.id:
        background.add_task(
            notify, [owner_id], "kudos", "Someone reacted to your run",
            f"{user.username} reacted to your run.",
            {"kind": "run_reaction", "screen": "run", "run_id": run_id}, str(user.id),
        )

    summary, mine = reaction_rules.summarise(db, [run_id], user.id)
    return schemas.RunReactionsOut(
        reactions=[schemas.RunReaction(**x) for x in summary.get(run_id, [])],
        my_reaction=mine.get(run_id),
    )


@router.post("/me/push-token")
@limiter.limit(settings.rate_limit_default)
def register_push_token(request: Request, response: Response, payload: schemas.PushTokenIn,
                        user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(
        text(
            """
            INSERT INTO device_tokens (user_id, token, platform) VALUES (:u, :t, :p)
            ON CONFLICT (token) DO UPDATE SET user_id = :u, platform = :p
            """
        ),
        {"u": user.id, "t": payload.token, "p": payload.platform},
    )
    db.commit()
    return {"ok": True}


@router.get("/me/notif-prefs", response_model=schemas.NotifPrefs)
def get_prefs(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.execute(
        text(
            "SELECT stolen, defended, captured, reminder, clan_goal, kudos, "
            "season, recap, pasers, paserby, club_run, club_battles "
            "FROM notif_prefs WHERE user_id = :u"
        ),
        {"u": user.id},
    ).fetchone()
    if not row:
        return schemas.NotifPrefs()
    return schemas.NotifPrefs(
        stolen=row[0], defended=row[1], captured=row[2], reminder=row[3],
        clan_goal=row[4], kudos=row[5], season=row[6], recap=row[7],
        pasers=row[8], paserby=row[9], club_run=row[10],
        club_battles=row[11],
    )


@router.put("/me/notif-prefs", response_model=schemas.NotifPrefs)
def set_prefs(payload: schemas.NotifPrefs, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(
        text(
            """
            INSERT INTO notif_prefs
                (user_id, stolen, defended, captured, reminder, clan_goal, kudos,
                 season, recap, pasers, paserby, club_run, club_battles)
            VALUES (:u, :s, :d, :cap, :rem, :g, :k, :se, :r, :p, :pb, :cr, :cb)
            ON CONFLICT (user_id) DO UPDATE SET stolen=:s, defended=:d,
                captured=:cap, reminder=:rem, clan_goal=:g, kudos=:k,
                season=:se, recap=:r, pasers=:p, paserby=:pb, club_run=:cr,
                club_battles=:cb
            """
        ),
        # `pasers` was in the model and on the wire but was never written —
        # muting paser requests silently did nothing. Both social categories
        # are persisted here now.
        {"u": user.id, "s": payload.stolen, "d": payload.defended,
         "cap": payload.captured, "rem": payload.reminder, "g": payload.clan_goal,
         "k": payload.kudos, "se": payload.season, "r": payload.recap,
         "p": payload.pasers, "pb": payload.paserby, "cr": payload.club_run,
         "cb": payload.club_battles},
    )
    db.commit()
    return payload


@router.get("/me/notifications", response_model=schemas.NotificationsOut)
def my_notifications(limit: int = 30, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    # The actor joins in so a row can lead with the face of whoever did it —
    # the inbox of a game about people taking your land should show the people.
    rows = db.execute(
        text(
            """
            SELECT n.id::text, n.category, n.title, n.body, n.read, n.created_at,
                   n.actor_id::text, a.username, a.avatar,
                   COALESCE(a.solo_elo, 1000), NULL::timestamp, c.color_key,
                   COALESCE(n.data, '{}'::jsonb)
            FROM notifications n
            LEFT JOIN users a ON a.id = n.actor_id
            LEFT JOIN clan_members cm ON cm.user_id = n.actor_id
            LEFT JOIN clans c ON c.id = cm.clan_id
            WHERE n.user_id = :u
            ORDER BY n.created_at DESC LIMIT :l
            """
        ),
        {"u": user.id, "l": max(1, min(int(limit), 100))},
    ).fetchall()
    unread = db.execute(
        text("SELECT COUNT(*) FROM notifications WHERE user_id = :u AND NOT read"), {"u": user.id}
    ).scalar()
    return schemas.NotificationsOut(
        items=[
            schemas.NotificationItem(
                id=r[0], category=r[1], title=r[2], body=r[3], read=bool(r[4]), created_at=r[5],
                actor_id=r[6],
                actor_username=r[7],
                actor_avatar=r[8],
                actor_rank_key=elo.key_for(r[9], r[10]),
                actor_clan_color=schemas.ClanColor(**color_triple(r[11])) if r[11] else None,
                data=r[12] or {},
            )
            for r in rows
        ],
        unread=int(unread or 0),
    )


@router.post("/me/notifications/read")
def mark_notifications_read(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(text("UPDATE notifications SET read = true WHERE user_id = :u AND NOT read"), {"u": user.id})
    db.commit()
    return {"ok": True}


@router.post("/admin/weekly-recap", dependencies=[Depends(require_admin)])
def weekly_recap(background: BackgroundTasks, db: Session = Depends(get_db)):
    """Cron (Monday): push each user last week's distance + claims.

    Gated on `X-Admin-Token` — an open endpoint that fans out a push
    notification to every account is a spam button with a URL."""
    since = datetime.utcnow() - timedelta(days=7)
    rows = db.execute(
        text(
            """
            SELECT r.user_id::text, COALESCE(SUM(r.distance_m),0),
                   COUNT(t.id)
            FROM runs r LEFT JOIN territories t ON t.run_id = r.id
            WHERE r.ended_at >= :since
            GROUP BY r.user_id
            """
        ),
        {"since": since},
    ).fetchall()
    for uid, dist, claims in rows:
        background.add_task(
            notify, [uid], "recap", "Last week on PASER",
            f"{(dist or 0) / 1000:.1f} km and {int(claims or 0)} claims. Keep the streak alive.",
            {"kind": "weekly_recap", "screen": "home"},
        )
    return {"ok": True, "users": len(rows)}


@router.post("/admin/run-reminders", dependencies=[Depends(require_admin)])
def run_reminders(background: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue today's deduplicated streak and territory-expiry reminders."""

    def enqueue(*args):
        background.add_task(notify, *args)

    result = deliver_scheduled_reminders(db, enqueue)
    return {"ok": True, **result}
