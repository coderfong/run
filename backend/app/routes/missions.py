"""Daily missions API.

- GET  /me/missions              today's four, the week strip, and the bonus
- POST /me/missions/claim        collect one finished mission (pays coins)
- POST /me/missions/day-bonus    collect the all four bonus (grants a box)

Progress is never posted by the client: it is derived server side from what
the player actually did (see app/missions.py). These endpoints only move
rewards, which is why every one of them is a write guarded by the unique
index rather than a trusted count.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import coins as coins_mod
from .. import missions as missions_mod
from .. import models
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter(tags=["missions"])


def _parse_day(raw) -> date | None:
    """A caller supplied ``YYYY-MM-DD``, or None for today.

    Only ever used to look at a day already past — see `_guard_day`.
    """
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise HTTPException(400, "bad day")


def _guard_day(day: date | None, today: date) -> date:
    """Resolve and bound the day a request may act on.

    A future day has no progress to derive and nothing to pay, and letting a
    client name one is how a clock skewed device claims tomorrow twice.
    """
    resolved = day or today
    if resolved > today:
        raise HTTPException(400, "that day has not started")
    return resolved


@router.get("/me/missions")
def my_missions(day: str | None = None,
                user: models.User = Depends(current_user),
                db: Session = Depends(get_db)):
    """Everything the missions screen draws in one request.

    `day` is for opening a past day off the week strip; it defaults to today.
    """
    today = missions_mod.local_day()
    target = _guard_day(_parse_day(day), today)

    # Resolve the week and the day being viewed TOGETHER. The day is almost
    # always inside the week, and resolving them separately meant deriving it
    # twice — the batch already has the answer.
    week_dates = [d for d in missions_mod.week_days(today) if d <= today]
    states = missions_mod.day_states(db, user.id, sorted({*week_dates, target}))
    state = states[target]
    return {
        "today": today.isoformat(),
        "day": state["day"],
        "missions": state["missions"],
        "complete_count": state["complete_count"],
        "total": state["total"],
        "all_complete": state["all_complete"],
        "bonus_claimed": state["bonus_claimed"],
        "bonus_rarity": state["bonus_rarity"],
        "week": [
            {"day": d.isoformat(), "locked": True, "complete_count": 0,
             "total": missions_mod.MISSIONS_PER_DAY, "all_complete": False,
             "bonus_claimed": False}
            if d > today else
            {k: states[d][k] for k in
             ("day", "complete_count", "total", "all_complete", "bonus_claimed")}
            | {"locked": False}
            for d in missions_mod.week_days(today)
        ],
    }


@router.post("/me/missions/claim")
@limiter.limit(settings.rate_limit_default)
def claim_mission(request: Request, response: Response, body: dict,
                  user: models.User = Depends(current_user),
                  db: Session = Depends(get_db)):
    """Collect one finished mission.

    The mission must be one this account actually holds on that day — the set
    is seeded from (user, date), so a client naming any other id is asking to
    be paid for something it was never given.
    """
    mission_id = (body.get("mission_id") or "").strip()
    today = missions_mod.local_day()
    target = _guard_day(_parse_day(body.get("day")), today)

    held = {m["id"]: m for m in missions_mod.missions_for(user.id, target)}
    mission = held.get(mission_id)
    if mission is None:
        raise HTTPException(404, "not one of that day's missions")

    values = missions_mod.progress_for(db, user.id, target, [mission["metric"]])
    if values.get(mission["metric"], 0) < mission["goal"]:
        raise HTTPException(403, "mission not finished")

    inserted = db.execute(
        text("INSERT INTO mission_claims (user_id, day, mission_id, reward) "
             "VALUES (:u, :d, :m, :r) ON CONFLICT DO NOTHING"),
        {"u": user.id, "d": target, "m": mission_id, "r": mission["reward"]},
    ).rowcount
    if not inserted:
        raise HTTPException(409, "already collected")

    coins_mod.grant(db, user.id, mission["reward"], "mission",
                    f"{target.isoformat()}:{mission_id}")
    db.commit()

    state = missions_mod.day_state(db, user.id, target)
    return {"ok": True, "mission_id": mission_id, "reward": mission["reward"],
            "day": state["day"], "missions": state["missions"],
            "complete_count": state["complete_count"], "total": state["total"],
            "all_complete": state["all_complete"],
            "bonus_claimed": state["bonus_claimed"]}


@router.post("/me/missions/day-bonus")
@limiter.limit(settings.rate_limit_default)
def claim_day_bonus(request: Request, response: Response, body: dict | None = None,
                    user: models.User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Collect the all four bonus: an unopened box, ready for the gamble.

    Deliberately NOT gated on the four rewards having been collected — the
    bonus is earned by doing the four things. Someone who finished the day and
    never tapped Claim still gets their box.
    """
    today = missions_mod.local_day()
    target = _guard_day(_parse_day((body or {}).get("day")), today)

    state = missions_mod.day_state(db, user.id, target)
    if not state["all_complete"]:
        raise HTTPException(403, "not every mission is finished")

    inserted = db.execute(
        text("INSERT INTO mission_claims (user_id, day, mission_id, reward) "
             "VALUES (:u, :d, :m, 0) ON CONFLICT DO NOTHING"),
        {"u": user.id, "d": target, "m": missions_mod.DAY_BONUS_ID},
    ).rowcount
    if not inserted:
        raise HTTPException(409, "already collected")

    # The box lands in the same place every other box does, so it opens
    # through the same gamble and shows up in the same pending list.
    db.execute(
        text("INSERT INTO user_unlocks (user_id, kind, item_id) VALUES (:u, 'lootbox', :r)"),
        {"u": user.id, "r": missions_mod.DAY_BONUS_RARITY},
    )
    db.commit()
    return {"ok": True, "day": target.isoformat(),
            "rarity": missions_mod.DAY_BONUS_RARITY, "bonus_claimed": True}
