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
from .. import coins as coins_mod
from .. import energy as energy_mod
from .. import iap
from .. import ranks
from ..progression import (
    MAX_LEVEL,
    level_from_xp,
    premium_rewards_for_level,
    reward_ladder,
    rewards_for_level,
    xp_for_level,
)

router = APIRouter(tags=["progression"])


# ---------------------------------------------------------------------------
# level-up reward grants (called from runs.py after XP is written)
# ---------------------------------------------------------------------------
def sync_level_rewards(db: Session, user_id: str) -> dict:
    """Track level-ups after XP is written. Rewards are no longer auto-granted
    here — the pass ladder is tap-to-claim (POST /me/rewards/claim), so a
    level-up just makes new tiers claimable. reward_level survives as the
    high-water mark (and is what migration 0015 backfilled claims from).
    Self-committing.

    Returns {leveled_up, level, prev_level}."""
    row = db.execute(
        text("SELECT COALESCE(xp,0), COALESCE(reward_level,0) FROM users WHERE id = :u"),
        {"u": user_id},
    ).fetchone()
    if not row:
        return {"leveled_up": False, "level": 0, "prev_level": 0}
    xp, prev_level = int(row[0]), int(row[1])
    level = level_from_xp(xp)
    if level <= prev_level:
        return {"leveled_up": False, "level": level, "prev_level": prev_level}

    db.execute(text("UPDATE users SET reward_level = :l WHERE id = :u"), {"l": level, "u": user_id})
    # Coins for every level crossed — catching up several at once still pays
    # for each one.
    gained = level - prev_level
    if gained > 0:
        coins_mod.grant(db, user_id, gained * coins_mod.COINS_PER_LEVEL,
                        "level_up", f"L{prev_level}->L{level}")
    db.commit()
    return {"leveled_up": True, "level": level, "prev_level": prev_level}


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
    row = db.execute(
        text("SELECT COALESCE(xp,0), COALESCE(premium_pass,false) FROM users WHERE id = :u"),
        {"u": user.id},
    ).fetchone()
    xp = int(row[0]) if row else 0
    premium = bool(row[1]) if row else False
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
    claims = db.execute(
        text("SELECT level, track FROM reward_claims WHERE user_id = :u"),
        {"u": user.id},
    ).fetchall()
    db.commit()

    return {
        "xp": xp,
        "level": level,
        "xp_into_level": xp - base,
        "xp_for_next": max(1, nxt - base),
        # Border follows RANK, not level — level is a one-way ladder, rank can
        # be lost. `current_border(level)` is gone for exactly that reason.
        "rank": ranks.status(db, user.id),
        "energy": st,
        "premium_active": premium,
        "ladder": reward_ladder(),
        "claims": [{"level": int(c[0]), "track": c[1]} for c in claims],
        "pending_lootboxes": [{"id": r[0], "rarity": r[1]} for r in pending],
        "unlocks": [r[0] for r in unlocked],
    }


@router.post("/me/rewards/claim")
@limiter.limit(settings.rate_limit_default)
def claim_reward(request: Request, response: Response, body: dict,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Collect one tier of the pass. Grants whatever the tier holds: lootboxes
    become an unopened box, energy packs credit the meter, and derived rewards
    (borders/shapes/FX/energy-cap — already active from level alone) just get
    marked collected so the tile settles.

    The UNIQUE(user_id, level, track) index is the real double-claim guard;
    the pre-check only exists to return a friendly 409."""
    try:
        tier = int(body.get("level"))
    except (TypeError, ValueError):
        raise HTTPException(400, "bad level")
    track = body.get("track")
    if track not in ("free", "premium"):
        raise HTTPException(400, "track must be free or premium")
    if not 1 <= tier <= MAX_LEVEL:
        raise HTTPException(400, "bad level")

    row = db.execute(
        text("SELECT COALESCE(xp,0), COALESCE(premium_pass,false) FROM users WHERE id = :u"),
        {"u": user.id},
    ).fetchone()
    level = level_from_xp(int(row[0]))
    if tier > level:
        raise HTTPException(403, "level not reached yet")
    if track == "premium" and not bool(row[1]):
        raise HTTPException(402, "premium pass required")

    inserted = db.execute(
        text("INSERT INTO reward_claims (user_id, level, track) VALUES (:u, :l, :t) "
             "ON CONFLICT DO NOTHING"),
        {"u": user.id, "l": tier, "t": track},
    ).rowcount
    if not inserted:
        raise HTTPException(409, "already claimed")

    rewards = rewards_for_level(tier) if track == "free" else premium_rewards_for_level(tier)
    for rw in rewards:
        if rw["kind"] == "lootbox":
            db.execute(
                text("INSERT INTO user_unlocks (user_id, kind, item_id) VALUES (:u, 'lootbox', :r)"),
                {"u": user.id, "r": rw["key"]},
            )
        elif rw["kind"] == "energy":
            energy_mod.grant(db, user.id, int(rw["key"].lstrip("+")))
        elif rw["kind"] == "cosmetic" and ":" in rw["key"]:
            # Pass cosmetics (both tracks) are real grants: the client treats a
            # server unlock as equippable regardless of the item's usual stat
            # gate, so this row IS the reward. Deduped in case a claim retries.
            db.execute(
                text(
                    "INSERT INTO user_unlocks (user_id, kind, item_id) "
                    "SELECT :u, 'cosmetic', :i WHERE NOT EXISTS ("
                    "  SELECT 1 FROM user_unlocks WHERE user_id = :u"
                    "    AND kind = 'cosmetic' AND item_id = :i)"
                ),
                {"u": user.id, "i": rw["key"]},
            )
    st = energy_mod.status(db, user.id)
    db.commit()
    return {"ok": True, "level": tier, "track": track, "rewards": rewards, "energy": st}


# The premium track unlock. One product; permanent (the ladder is career-long,
# not seasonal), so re-buying is a no-op rather than an error — store retries
# and restore-purchases both land here.
PASS_PRODUCTS = {"premium_pass"}


def _claim_txn(db: Session, user_id, txn: str, product_id: str) -> bool:
    """Record a store transaction id, returning False if it was already used.

    The unique index on transaction_id is what actually enforces this — two
    concurrent requests with the same receipt race here, and exactly one wins
    the insert. Checking-then-inserting would let both through.
    """
    res = db.execute(
        text("INSERT INTO iap_transactions (transaction_id, user_id, product_id) "
             "VALUES (:t, :u, :p) ON CONFLICT (transaction_id) DO NOTHING"),
        {"t": txn, "u": user_id, "p": product_id},
    )
    return res.rowcount > 0


@router.post("/me/pass/purchase")
@limiter.limit(settings.rate_limit_default)
def purchase_pass(request: Request, response: Response, body: dict,
                  user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Unlock the premium track after a verified store purchase.

    The pass is permanent, so a repeat call (store retry, restore-purchases)
    is an idempotent no-op rather than an error."""
    product_id = (body.get("product_id") or "").strip()
    if product_id not in PASS_PRODUCTS:
        raise HTTPException(400, "unknown product")
    txn = iap.verify(platform=body.get("platform"), receipt=body.get("receipt"),
                     product_id=product_id)
    if txn and not _claim_txn(db, user.id, txn, product_id):
        # Already redeemed. The pass is permanent so the user still has it —
        # report success rather than failing a legitimate restore.
        return {"ok": True, "premium_active": True, "duplicate": True}
    db.execute(text("UPDATE users SET premium_pass = true WHERE id = :u"), {"u": user.id})
    db.commit()
    return {"ok": True, "premium_active": True}


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
    """Credit an energy pack after a verified store purchase.

    Energy packs are CONSUMABLE, so unlike the pass a replayed receipt must
    not top the player up again — a duplicate transaction id is rejected."""
    product_id = (body.get("product_id") or "").strip()
    amount = ENERGY_PRODUCTS.get(product_id)
    if amount is None:
        raise HTTPException(400, "unknown product")
    txn = iap.verify(platform=body.get("platform"), receipt=body.get("receipt"),
                     product_id=product_id)
    if txn and not _claim_txn(db, user.id, txn, product_id):
        raise HTTPException(409, "receipt already redeemed")
    energy_mod.grant(db, user.id, amount)
    st = energy_mod.status(db, user.id)
    db.commit()
    return {"ok": True, "product_id": product_id, "energy": st}
