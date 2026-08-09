"""Rivalries — the person-shaped view of the map.

A map diff ("your territory decreased 0.3 km²") is abstract; a name is not.
Every steal and every successful defence is written to `territory_steals`
(migration 0016), and this router folds that ledger into one card per
opponent, always phrased from the requesting runner's side.

Nothing here is a separate game system: a rivalry is just a READ of what the
claim engine already did. That means no new state to keep consistent, and a
rivalry can never disagree with the map.

Rivalries only exist between runners in DIFFERENT clubs — clubmates' land is
never stealable (see `_claim_territory`), so no clubmate can ever appear here.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models, ranks, schemas
from ..clans_meta import color_triple
from ..config import settings
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["rivals"])

DEFAULT_LIMIT = 25

# Territory expires; a rivalry compares LIVE holdings, so the same decay
# window the rest of the app uses has to be applied here too.
_LIVE = (
    "now() < COALESCE(t.expires_at, t.created_at + make_interval("
    "secs => GREATEST(t.strength, 0.1) * :life_per * 86400))"
)

# Every event in the ledger, relabelled from :uid's point of view.
_EVENTS = """
    SELECT
        CASE WHEN s.attacker_id = :uid THEN s.victim_id ELSE s.attacker_id END AS other_id,
        (s.attacker_id = :uid) AS mine,
        s.defended, s.area_m2, s.created_at, s.lat, s.lon
    FROM territory_steals s
    WHERE s.attacker_id = :uid OR s.victim_id = :uid
"""


def _level(xp) -> int:
    return int(((xp or 0) / 100) ** 0.5)


def _clan_color(key):
    return schemas.ClanColor(**color_triple(key)) if key else None


def _kind(mine: bool, defended: bool) -> str:
    """Ledger row → what the viewer should be told happened."""
    if mine:
        return "they_held" if defended else "you_took"
    return "you_held" if defended else "they_took"


def _my_land(db: Session, uid) -> float:
    return float(
        db.execute(
            text(
                f"SELECT COALESCE(SUM(t.area_m2), 0) FROM territories t "
                f"WHERE t.user_id = :uid AND t.verified AND {_LIVE}"
            ),
            {"uid": uid, "life_per": settings.territory_life_days_per_strength},
        ).scalar()
        or 0
    )


def _cards(db: Session, uid, limit: int, other_id: str | None = None):
    """Aggregate the ledger into RivalCards, newest activity first."""
    rows = db.execute(
        text(
            f"""
            WITH ev AS ({_EVENTS}),
            agg AS (
                SELECT other_id,
                       COALESCE(SUM(area_m2) FILTER (WHERE mine AND NOT defended), 0) AS you_took,
                       COALESCE(SUM(area_m2) FILTER (WHERE NOT mine AND NOT defended), 0) AS they_took,
                       COUNT(*) FILTER (WHERE mine AND NOT defended) AS you_took_n,
                       COUNT(*) FILTER (WHERE NOT mine AND NOT defended) AS they_took_n,
                       COUNT(*) FILTER (WHERE NOT mine AND defended) AS you_held_n,
                       MAX(created_at) AS last_at
                FROM ev
                GROUP BY other_id
            ),
            last AS (
                SELECT DISTINCT ON (other_id)
                       other_id, mine, defended, area_m2, lat, lon, created_at
                FROM ev
                ORDER BY other_id, created_at DESC
            )
            SELECT a.other_id::text, u.username, u.avatar, c.tag, c.color_key, u.xp,
                   a.you_took, a.they_took, a.you_took_n, a.they_took_n, a.you_held_n,
                   l.mine, l.defended, l.area_m2, l.lat, l.lon, l.created_at,
                   COALESCE(land.area, 0),
                   COALESCE(u.rank_points, 0), u.rank_points_at
            FROM agg a
            JOIN users u ON u.id = a.other_id
            JOIN last l ON l.other_id = a.other_id
            LEFT JOIN clan_members cm ON cm.user_id = u.id
            LEFT JOIN clans c ON c.id = cm.clan_id
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(t.area_m2), 0) AS area
                FROM territories t
                WHERE t.user_id = a.other_id AND t.verified AND {_LIVE}
            ) land ON true
            WHERE (CAST(:other AS uuid) IS NULL OR a.other_id = CAST(:other AS uuid))
            ORDER BY a.last_at DESC
            LIMIT :lim
            """
        ),
        {
            "uid": uid,
            "other": other_id,
            "lim": limit,
            "life_per": settings.territory_life_days_per_strength,
        },
    ).fetchall()

    mine_land = _my_land(db, uid)
    cards = []
    for r in rows:
        you_took, they_took = float(r[6] or 0), float(r[7] or 0)
        cards.append(
            schemas.RivalCard(
                user_id=r[0],
                username=r[1],
                avatar=r[2],
                clan_tag=r[3],
                clan_color=_clan_color(r[4]),
                rank_key=ranks.key_for(r[18], r[19]),
                level=_level(r[5]),
                you_took_m2=you_took,
                they_took_m2=they_took,
                net_m2=you_took - they_took,
                you_took_times=int(r[8] or 0),
                they_took_times=int(r[9] or 0),
                you_held_times=int(r[10] or 0),
                your_land_m2=mine_land,
                their_land_m2=float(r[17] or 0),
                last_event=schemas.RivalEvent(
                    kind=_kind(bool(r[11]), bool(r[12])),
                    area_m2=float(r[13] or 0),
                    lat=r[14],
                    lon=r[15],
                    at=r[16],
                ),
            )
        )
    return cards


@router.get("/me/rivals", response_model=schemas.RivalsOut)
def my_rivals(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=50),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Everyone who has taken land from you, or lost land to you.

    Ordered by most recent beat — the rivalry that just moved is the one worth
    opening the app for, not the biggest all-time score.
    """
    return schemas.RivalsOut(rivals=_cards(db, user.id, limit))


@router.get("/me/rivals/{user_id}", response_model=schemas.RivalDetail)
def rival_detail(
    user_id: str,
    limit: int = Query(30, ge=1, le=100),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """One rivalry, with its blow-by-blow history."""
    if user_id == str(user.id):
        raise HTTPException(400, "you can't be your own rival")

    cards = _cards(db, user.id, 1, other_id=user_id)
    if not cards:
        raise HTTPException(404, "no rivalry with that runner yet")

    rows = db.execute(
        text(
            f"""
            WITH ev AS ({_EVENTS})
            SELECT mine, defended, area_m2, lat, lon, created_at
            FROM ev
            WHERE other_id = CAST(:other AS uuid)
            ORDER BY created_at DESC
            LIMIT :lim
            """
        ),
        {"uid": user.id, "other": user_id, "lim": limit},
    ).fetchall()

    events = [
        schemas.RivalEvent(
            kind=_kind(bool(r[0]), bool(r[1])),
            area_m2=float(r[2] or 0),
            lat=r[3],
            lon=r[4],
            at=r[5],
        )
        for r in rows
    ]
    return schemas.RivalDetail(rival=cards[0], events=events)
