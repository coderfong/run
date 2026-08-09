"""Run detail, kudos, push-token registration, notification prefs, and the
weekly-recap cron."""

from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from shapely import wkt as shapely_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, privacy, ranks, schemas
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..geospatial import geometry_to_rings
from ..notifications import notify
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
                   r.verified, COALESCE(t.area_m2, 0), (t.id IS NOT NULL),
                   ST_AsText(r.path), ST_AsText(t.polygon), c.tag, c.color_key,
                   COALESCE(r.visibility, 'public')
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
    rings = geometry_to_rings(shapely_wkt.loads(r[10])) if r[10] else []

    splits = db.execute(
        text("SELECT km, seconds FROM run_splits WHERE run_id = :rid ORDER BY km"), {"rid": run_id}
    ).fetchall()
    kcount = db.execute(text("SELECT COUNT(*) FROM run_kudos WHERE run_id = :rid"), {"rid": run_id}).scalar()
    kmine = db.execute(
        text("SELECT 1 FROM run_kudos WHERE run_id = :rid AND user_id = :uid"), {"rid": run_id, "uid": user.id}
    ).fetchone()
    ccount = db.execute(text("SELECT COUNT(*) FROM run_comments WHERE run_id = :rid"), {"rid": run_id}).scalar()

    return schemas.RunDetail(
        run_id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id),
        distance_m=float(r[3] or 0), duration_s=float(r[4] or 0), created_at=r[5],
        area_m2=float(r[7] or 0), closed_loop=bool(r[8]),
        clan_tag=r[11], clan_color=_clan_color(r[12]),
        path=path, territory_rings=rings,
        splits=[schemas.RunSplit(km=s[0], seconds=float(s[1])) for s in splits],
        kudos_count=int(kcount or 0), kudoed=bool(kmine),
        comment_count=int(ccount or 0),
    )


def _run_visible_to(db, run_id, user):
    """Same visibility rule as run_detail: shadow-flagged runs are owner-only."""
    r = db.execute(
        text("SELECT user_id::text, verified FROM runs WHERE id = :rid"), {"rid": run_id}
    ).fetchone()
    if not r or (not r[1] and r[0] != user.id):
        raise HTTPException(404, "run not found")
    return r[0]


@router.get("/runs/{run_id}/comments", response_model=list[schemas.RunCommentOut])
def run_comments(run_id: str, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    _run_visible_to(db, run_id, user)
    rows = db.execute(
        text(
            """
            SELECT c.id::text, c.user_id::text, u.username, c.body, c.created_at
            FROM run_comments c JOIN users u ON u.id = c.user_id
            WHERE c.run_id = :rid
            ORDER BY c.created_at
            LIMIT 200
            """
        ),
        {"rid": run_id},
    ).fetchall()
    return [
        schemas.RunCommentOut(
            id=r[0], user_id=r[1], username=r[2], is_you=(r[1] == user.id), body=r[3], created_at=r[4]
        )
        for r in rows
    ]


@router.post("/runs/{run_id}/comments", response_model=schemas.RunCommentOut)
@limiter.limit(settings.rate_limit_default)
def add_run_comment(request: Request, response: Response, run_id: str, payload: schemas.RunCommentIn,
                    background: BackgroundTasks,
                    user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    owner_id = _run_visible_to(db, run_id, user)
    row = db.execute(
        text(
            "INSERT INTO run_comments (run_id, user_id, body) VALUES (:rid, :uid, :b) "
            "RETURNING id::text, created_at"
        ),
        {"rid": run_id, "uid": user.id, "b": payload.body.strip()},
    ).fetchone()
    db.commit()
    if owner_id != user.id:
        snippet = payload.body.strip()[:80]
        background.add_task(
            notify, [owner_id], "kudos", "New comment on your run",
            f"{user.username}: {snippet}", None, str(user.id),
        )
    return schemas.RunCommentOut(
        id=row[0], user_id=user.id, username=user.username, is_you=True,
        body=payload.body.strip(), created_at=row[1],
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
                f"{user.username} gave kudos to your run.", None, str(user.id),
            )
    db.commit()
    count = db.execute(text("SELECT COUNT(*) FROM run_kudos WHERE run_id = :rid"), {"rid": run_id}).scalar()
    return {"kudoed": kudoed, "kudos_count": int(count or 0)}


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
            "SELECT stolen, captured, clan_goal, kudos, season, recap, pasers, paserby "
            "FROM notif_prefs WHERE user_id = :u"
        ),
        {"u": user.id},
    ).fetchone()
    if not row:
        return schemas.NotifPrefs()
    return schemas.NotifPrefs(
        stolen=row[0], captured=row[1], clan_goal=row[2], kudos=row[3], season=row[4],
        recap=row[5], pasers=row[6], paserby=row[7],
    )


@router.put("/me/notif-prefs", response_model=schemas.NotifPrefs)
def set_prefs(payload: schemas.NotifPrefs, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(
        text(
            """
            INSERT INTO notif_prefs
                (user_id, stolen, captured, clan_goal, kudos, season, recap, pasers, paserby)
            VALUES (:u, :s, :cap, :g, :k, :se, :r, :p, :pb)
            ON CONFLICT (user_id) DO UPDATE SET stolen=:s, captured=:cap, clan_goal=:g, kudos=:k,
                season=:se, recap=:r, pasers=:p, paserby=:pb
            """
        ),
        # `pasers` was in the model and on the wire but was never written —
        # muting paser requests silently did nothing. Both social categories
        # are persisted here now.
        {"u": user.id, "s": payload.stolen, "cap": payload.captured, "g": payload.clan_goal,
         "k": payload.kudos, "se": payload.season, "r": payload.recap,
         "p": payload.pasers, "pb": payload.paserby},
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
                   COALESCE(a.rank_points, 0), a.rank_points_at, c.color_key
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
                actor_rank_key=ranks.key_for(r[9], r[10]),
                actor_clan_color=schemas.ClanColor(**color_triple(r[11])) if r[11] else None,
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
            f"{(dist or 0) / 1000:.1f} km · {int(claims or 0)} claims. Keep the streak alive.",
        )
    return {"ok": True, "users": len(rows)}
