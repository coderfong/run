"""Progression + energy API.

- GET  /me/progression   full state for the level screen (level, xp, energy,
                         the 1..50 ladder, pending lootboxes, unlocked cosmetics)
- GET  /me/energy        just the energy meter (cheap poll for the HUD)
- POST /me/rewards/claim      collect one tier
- POST /me/rewards/claim-all  collect every unlocked, unclaimed tier at once
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
from .. import entitlements
from .. import iap
from .. import elo
from .. import lootbox
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
    st = energy_mod.status_for_user(db, user)
    db.commit()  # persist any lazy regen
    return st


@router.get("/me/progression")
def my_progression(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT COALESCE(xp,0) FROM users WHERE id = :u"),
        {"u": user.id},
    ).fetchone()
    xp = int(row[0]) if row else 0
    # The gold track is part of PRO, so it follows the one entitlement — a
    # subscriber and a lifetime holder both have it. Reading `premium_pass`
    # directly here would have shown the ladder locked to every subscriber.
    premium = entitlements.is_pro(user)
    level = level_from_xp(xp)
    base = xp_for_level(level)
    nxt = xp_for_level(level + 1)
    st = energy_mod.status_for_user(db, user)

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
        "rank": elo.solo_status(db, user.id),
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
        text("SELECT COALESCE(xp,0) FROM users WHERE id = :u"),
        {"u": user.id},
    ).fetchone()
    level = level_from_xp(int(row[0]))
    if tier > level:
        raise HTTPException(403, "level not reached yet")
    if track == "premium" and not entitlements.is_pro(user):
        raise HTTPException(402, "PASER PRO required")

    inserted = db.execute(
        text("INSERT INTO reward_claims (user_id, level, track) VALUES (:u, :l, :t) "
             "ON CONFLICT DO NOTHING"),
        {"u": user.id, "l": tier, "t": track},
    ).rowcount
    if not inserted:
        raise HTTPException(409, "already claimed")

    rewards = rewards_for_level(tier) if track == "free" else premium_rewards_for_level(tier)
    _grant_rewards(db, user.id, rewards)
    st = energy_mod.status_for_user(db, user)
    db.commit()
    return {"ok": True, "level": tier, "track": track, "rewards": rewards, "energy": st}


def _grant_rewards(db: Session, user_id, rewards: list[dict]) -> None:
    """Hand over one tier's contents. Caller owns the commit."""
    for rw in rewards:
        if rw["kind"] == "lootbox":
            db.execute(
                text("INSERT INTO user_unlocks (user_id, kind, item_id) VALUES (:u, 'lootbox', :r)"),
                {"u": user_id, "r": rw["key"]},
            )
        elif rw["kind"] == "energy":
            energy_mod.grant(db, user_id, int(rw["key"].lstrip("+")))
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
                {"u": user_id, "i": rw["key"]},
            )


@router.post("/me/rewards/claim-all")
@limiter.limit(settings.rate_limit_default)
def claim_all_rewards(request: Request, response: Response,
                      user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Collect every tier that is unlocked and unclaimed, in one transaction.

    A player who comes back at level 40 has ~80 tiers waiting. Eighty taps —
    or eighty requests from a client-side loop — is not a reward, it's a chore,
    so the sweep happens here.

    The INSERT ... RETURNING is the guard AND the worklist: whatever rows it
    actually wrote are exactly the tiers this call is allowed to pay out, so
    two concurrent sweeps can never grant the same tier twice."""
    row = db.execute(
        text("SELECT COALESCE(xp,0) FROM users WHERE id = :u"),
        {"u": user.id},
    ).fetchone()
    level = level_from_xp(int(row[0]))
    premium = entitlements.is_pro(user)
    if level < 1:
        return {"ok": True, "claimed": 0, "rewards": [], "energy": energy_mod.status_for_user(db, user)}

    tracks = ["free"] + (["premium"] if premium else [])
    pairs = [(lvl, tr) for lvl in range(1, min(level, MAX_LEVEL) + 1) for tr in tracks]
    won = db.execute(
        text(
            # Every parameter is cast: in a SELECT (unlike a VALUES list)
            # Postgres has no column to infer a bare placeholder's type from.
            "INSERT INTO reward_claims (user_id, level, track) "
            "SELECT CAST(:u AS uuid), l, t "
            "FROM UNNEST(CAST(:levels AS int[]), CAST(:tracks AS text[])) AS x(l, t) "
            "ON CONFLICT DO NOTHING RETURNING level, track"
        ),
        {"u": str(user.id), "levels": [p[0] for p in pairs], "tracks": [p[1] for p in pairs]},
    ).fetchall()

    rewards: list[dict] = []
    for lvl, track in won:
        tier = rewards_for_level(int(lvl)) if track == "free" else premium_rewards_for_level(int(lvl))
        _grant_rewards(db, user.id, tier)
        rewards.extend(tier)
    st = energy_mod.status_for_user(db, user)
    db.commit()
    return {"ok": True, "claimed": len(won), "rewards": rewards, "energy": st}


# RETIRED, restore-only. `premium_pass` was the one-time lifetime unlock of the
# gold track, from before PRO became a subscription (see app/entitlements.py and
# alembic 0037). It is no longer sold and the app no longer offers it, but this
# endpoint stays reachable so an old receipt replayed by the store — a
# reinstall, a restore-purchases tap — still lands the entitlement its owner
# paid for. Anyone holding it keeps it forever.
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
    """Open the oldest unopened box, and decide its whole gamble here.

    The response carries the rarity the box was granted at, one pre rolled
    outcome per tap, and the rarity it therefore opens as. The client spends
    the taps to REVEAL those outcomes; it never asks for one.

    That is the security property, not a convenience: a per tap endpoint is a
    re-roll the moment a response is dropped or a request is replayed, and
    there is no way for the server to tell a retry from a second attempt. Here
    the sequence and the `opened` flag are written in the same transaction, so
    a box has exactly one sequence for its whole life and calling this again
    finds nothing left to open.

    `rarity` stays the box's GRANTED rarity so older clients, which read only
    that field and know nothing about the gamble, keep working unchanged and
    simply roll at the floor. New clients read `final_rarity`.
    """
    box = db.execute(
        text("SELECT id::text, item_id FROM user_unlocks "
             "WHERE user_id = :u AND kind = 'lootbox' AND NOT opened ORDER BY created_at LIMIT 1"),
        {"u": user.id},
    ).fetchone()
    if not box:
        raise HTTPException(404, "no lootboxes to open")
    db.execute(text("UPDATE user_unlocks SET opened = true WHERE id = :id"), {"id": box[0]})
    rolled = lootbox.roll_sequence(box[1])
    db.commit()
    return {"lootbox_id": box[0], **rolled}


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
    st = energy_mod.status_for_user(db, user)
    db.commit()
    return {"ok": True, "product_id": product_id, "energy": st}
