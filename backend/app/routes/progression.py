"""Progression + energy API.

- GET  /me/progression   full state for the level screen (level, xp, energy,
                         the 1..50 ladder, pending lootboxes, unlocked cosmetics)
- GET  /me/energy        just the energy meter (cheap poll for the HUD)
- POST /me/lootbox/open  open the oldest unopened box → returns its rarity so
                         the client rolls a still-locked cosmetic of that tier
- POST /me/unlocks       persist a cosmetic the client granted (lootbox roll)
- POST /me/energy/purchase  credit an IAP energy pack (receipt verification is
                            a marked TODO — dev accepts unverified)

`sync_level_rewards` is imported by runs.py to hand out level-up lootboxes
exactly once, right after XP is awarded.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user
from .. import energy as energy_mod
from ..progression import (
    LOOTBOX_LEVELS,
    current_border,
    level_from_xp,
    lootbox_rarity,
    reward_ladder,
    xp_for_level,
)

router = APIRouter(tags=["progression"])


# ---------------------------------------------------------------------------
# level-up reward grants (called from runs.py after XP is written)
# ---------------------------------------------------------------------------
def sync_level_rewards(db: Session, user_id: str) -> dict:
    """Grant any not-yet-granted level rewards. Only LOOTBOXES need persisting
    (they roll a random cosmetic); borders/shapes/FX are derived from level.
    Idempotent via users.reward_level. Self-committing.

    Returns {leveled_up, level, prev_level, new_lootboxes}."""
    row = db.execute(
        text("SELECT COALESCE(xp,0), COALESCE(reward_level,0) FROM users WHERE id = :u"),
        {"u": user_id},
    ).fetchone()
    if not row:
        return {"leveled_up": False, "level": 0, "prev_level": 0, "new_lootboxes": 0}
    xp, prev_level = int(row[0]), int(row[1])
    level = level_from_xp(xp)
    if level <= prev_level:
        return {"leveled_up": False, "level": level, "prev_level": prev_level, "new_lootboxes": 0}

    boxes = 0
    for lvl in range(prev_level + 1, level + 1):
        if lvl in LOOTBOX_LEVELS:
            db.execute(
                text("INSERT INTO user_unlocks (user_id, kind, item_id) VALUES (:u, 'lootbox', :r)"),
                {"u": user_id, "r": lootbox_rarity(lvl)},
            )
            boxes += 1
    db.execute(text("UPDATE users SET reward_level = :l WHERE id = :u"), {"l": level, "u": user_id})
    db.commit()
    return {"leveled_up": True, "level": level, "prev_level": prev_level, "new_lootboxes": boxes}


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------
@router.get("/me/energy")
def my_energy(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    st = energy_mod.status(db, user.id)
    db.commit()  # persist any lazy regen
    return st


@router.get("/me/progression")
def my_progression(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT COALESCE(xp,0) FROM users WHERE id = :u"), {"u": user.id}).fetchone()
    xp = int(row[0]) if row else 0
    level = level_from_xp(xp)
    base = xp_for_level(level)
    nxt = xp_for_level(level + 1)
    st = energy_mod.status(db, user.id)

    pending = db.execute(
        text("SELECT id::text, item_id FROM user_unlocks "
             "WHERE user_id = :u AND kind = 'lootbox' AND NOT opened ORDER BY created_at"),
        {"u": user.id},
    ).fetchall()
    unlocked = db.execute(
        text("SELECT item_id FROM user_unlocks WHERE user_id = :u AND kind = 'cosmetic'"),
        {"u": user.id},
    ).fetchall()
    db.commit()

    return {
        "xp": xp,
        "level": level,
        "xp_into_level": xp - base,
        "xp_for_next": max(1, nxt - base),
        "border": current_border(level),
        "energy": st,
        "ladder": reward_ladder(),
        "pending_lootboxes": [{"id": r[0], "rarity": r[1]} for r in pending],
        "unlocks": [r[0] for r in unlocked],
    }


@router.post("/me/lootbox/open")
@limiter.limit(settings.rate_limit_default)
def open_lootbox(request: Request, response: Response,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Open the oldest unopened box. Returns its rarity; the client rolls a
    still-locked cosmetic of that rarity and POSTs it to /me/unlocks."""
    box = db.execute(
        text("SELECT id::text, item_id FROM user_unlocks "
             "WHERE user_id = :u AND kind = 'lootbox' AND NOT opened ORDER BY created_at LIMIT 1"),
        {"u": user.id},
    ).fetchone()
    if not box:
        raise HTTPException(404, "no lootboxes to open")
    db.execute(text("UPDATE user_unlocks SET opened = true WHERE id = :id"), {"id": box[0]})
    db.commit()
    return {"lootbox_id": box[0], "rarity": box[1]}


@router.post("/me/unlocks")
@limiter.limit(settings.rate_limit_default)
def add_unlock(request: Request, response: Response, body: dict,
               user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Persist a cosmetic the client unlocked (e.g. a lootbox roll). Cosmetic
    ids live in the frontend catalog, so we store whatever id is claimed —
    cosmetic-only, low-stakes. Deduped per (user, item)."""
    item_id = (body.get("item_id") or "").strip()
    if not item_id or len(item_id) > 64:
        raise HTTPException(400, "bad item_id")
    exists = db.execute(
        text("SELECT 1 FROM user_unlocks WHERE user_id = :u AND kind = 'cosmetic' AND item_id = :i"),
        {"u": user.id, "i": item_id},
    ).fetchone()
    if not exists:
        db.execute(
            text("INSERT INTO user_unlocks (user_id, kind, item_id) VALUES (:u, 'cosmetic', :i)"),
            {"u": user.id, "i": item_id},
        )
        db.commit()
    return {"ok": True, "item_id": item_id}


# Energy IAP packs. product_id → energy granted (a big number = fill to cap).
ENERGY_PRODUCTS = {
    "energy_refill_small": 50,
    "energy_pack_large": 150,
    "energy_refill_full": 10_000,  # clamped to the cap by energy.grant
}


@router.post("/me/energy/purchase")
@limiter.limit(settings.rate_limit_default)
def purchase_energy(request: Request, response: Response, body: dict,
                    user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Credit an energy pack after a successful store purchase.

    TODO(prod): when settings.iap_verify_receipts is on, verify `receipt`
    against Apple (verifyReceipt / App Store Server API) or Google Play
    (purchases.products.get) for `platform` BEFORE crediting, and dedupe on
    the store transaction id. Dev path accepts unverified so the flow is
    testable end-to-end."""
    product_id = (body.get("product_id") or "").strip()
    amount = ENERGY_PRODUCTS.get(product_id)
    if amount is None:
        raise HTTPException(400, "unknown product")
    if settings.iap_verify_receipts:
        receipt = body.get("receipt")
        if not receipt:
            raise HTTPException(402, "missing receipt")
        # raise HTTPException(402, "receipt verification not configured")
        raise HTTPException(501, "receipt verification not implemented — see TODO")
    energy_mod.grant(db, user.id, amount)
    st = energy_mod.status(db, user.id)
    db.commit()
    return {"ok": True, "product_id": product_id, "energy": st}
