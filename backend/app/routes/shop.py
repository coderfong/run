"""Coin shop.

- GET  /me/coins             balance + the priced catalogue
- POST /me/coins/purchase    credit a coin pack after a VERIFIED store purchase
- POST /me/coins/buy         spend coins on a cosmetic

Every paid path goes through iap.verify + the transaction dedupe used by the
pass and energy endpoints, so a replayed receipt can't mint coins twice.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import coins as coins_mod
from .. import iap
from .. import models
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import current_user

router = APIRouter(tags=["shop"])


def _claim_txn(db: Session, user_id, txn: str, product_id: str) -> bool:
    """Same replay guard as the pass/energy endpoints — the unique index on
    transaction_id decides the winner, not an application-level check."""
    res = db.execute(
        text("INSERT INTO iap_transactions (transaction_id, user_id, product_id) "
             "VALUES (:t, :u, :p) ON CONFLICT (transaction_id) DO NOTHING"),
        {"t": txn, "u": user_id, "p": product_id},
    )
    return res.rowcount > 0


@router.get("/me/coins")
@limiter.limit(settings.rate_limit_default)
def get_coins(request: Request, response: Response,
              user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "coins": coins_mod.balance(db, user.id),
        "packs": [{"product_id": p, "coins": c}
                  for p, c in coins_mod.COIN_PRODUCTS.items()],
        "items": coins_mod.catalog_for(db, user.id),
        # Client counts down to this; the selection changes when it passes.
        "expires_at": coins_mod.window_expires_at(),
        "rotation_hours": coins_mod.ROTATION_HOURS,
    }


@router.post("/me/coins/purchase")
@limiter.limit(settings.rate_limit_default)
def purchase_coins(request: Request, response: Response, body: dict,
                   user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Credit a coin pack after a verified store purchase.

    Coin packs are CONSUMABLE, so a duplicate transaction id is rejected —
    crediting twice would be minting currency."""
    product_id = (body.get("product_id") or "").strip()
    amount = coins_mod.COIN_PRODUCTS.get(product_id)
    if amount is None:
        raise HTTPException(400, "unknown product")
    txn = iap.verify(platform=body.get("platform"), receipt=body.get("receipt"),
                     product_id=product_id)
    if txn and not _claim_txn(db, user.id, txn, product_id):
        raise HTTPException(409, "receipt already redeemed")
    new_balance = coins_mod.grant(db, user.id, amount, "iap", txn or product_id)
    db.commit()
    return {"ok": True, "product_id": product_id, "coins": new_balance}


@router.post("/me/coins/buy")
@limiter.limit(settings.rate_limit_default)
def buy_cosmetic(request: Request, response: Response, body: dict,
                 user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Spend coins on a cosmetic. The price comes from the SERVER catalogue —
    never from the request — so the client can't discount itself."""
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        raise HTTPException(400, "item_id required")
    ok, err, price = coins_mod.buy_cosmetic(db, user.id, item_id)
    if not ok:
        db.rollback()
        if err == "insufficient coins":
            raise HTTPException(402, err)
        if err == "already owned":
            raise HTTPException(409, err)
        if err == "not in the shop right now":
            raise HTTPException(410, err)   # the window rotated under them
        raise HTTPException(400, err or "could not buy")
    db.commit()
    return {
        "ok": True,
        "item_id": item_id,
        "price": price,
        "coins": coins_mod.balance(db, user.id),
    }
