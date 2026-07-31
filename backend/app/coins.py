"""Coins — the soft currency cosmetics are bought with.

Deliberately separate from energy: energy gates HOW OFTEN you claim, coins
gate WHAT YOU WEAR. Mixing them would mean buying a hat costs you territory.

Coins are earned by playing (finishing runs, levelling up) and can also be
bought outright. Everything a coin can buy is also earnable through normal
stat progression, so paying is a shortcut, never the only route — PASER PRO
exclusives are NOT coin-buyable (see shop_catalog.py).

Balance lives on `users.coins`. Every change writes a `coin_ledger` row, which
is what makes "where did my coins go" answerable and gives support a paper
trail for refunds.
"""

from sqlalchemy import text

from .shop_catalog import SHOP_ITEMS, price_of

# Earn rates. A common item (150) is ~6 runs; a legendary (2000) is a goal.
COINS_PER_RUN = 25
COINS_PER_LEVEL = 100

# IAP coin packs: product_id -> coins granted.
COIN_PRODUCTS = {
    "coins_pouch": 500,
    "coins_sack": 1200,
    "coins_chest": 3000,
    "coins_vault": 6500,
}


def balance(db, user_id) -> int:
    row = db.execute(
        text("SELECT COALESCE(coins, 0) FROM users WHERE id = :u"), {"u": user_id}
    ).fetchone()
    return int(row[0]) if row else 0


def grant(db, user_id, amount: int, reason: str, ref: str | None = None) -> int:
    """Add coins and record why. Returns the new balance."""
    if amount <= 0:
        return balance(db, user_id)
    db.execute(
        text("UPDATE users SET coins = COALESCE(coins, 0) + :a WHERE id = :u"),
        {"a": amount, "u": user_id},
    )
    db.execute(
        text("INSERT INTO coin_ledger (user_id, delta, reason, ref) "
             "VALUES (:u, :d, :r, :f)"),
        {"u": user_id, "d": amount, "r": reason, "f": ref},
    )
    return balance(db, user_id)


def spend(db, user_id, amount: int, reason: str, ref: str | None = None) -> bool:
    """Deduct coins if affordable. Returns False when the balance is too low.

    The guard is in the UPDATE's WHERE clause, not a read-then-write: two
    concurrent purchases against the same balance would both pass a Python
    check and overdraw. Here the second one matches no rows.
    """
    if amount <= 0:
        return True
    res = db.execute(
        text("UPDATE users SET coins = COALESCE(coins, 0) - :a "
             "WHERE id = :u AND COALESCE(coins, 0) >= :a"),
        {"a": amount, "u": user_id},
    )
    if res.rowcount == 0:
        return False
    db.execute(
        text("INSERT INTO coin_ledger (user_id, delta, reason, ref) "
             "VALUES (:u, :d, :r, :f)"),
        {"u": user_id, "d": -amount, "r": reason, "f": ref},
    )
    return True


def owns(db, user_id, item_id: str) -> bool:
    row = db.execute(
        text("SELECT 1 FROM user_unlocks WHERE user_id = :u AND item_id = :i LIMIT 1"),
        {"u": user_id, "i": item_id},
    ).fetchone()
    return row is not None


def buy_cosmetic(db, user_id, item_id: str):
    """Buy a cosmetic with coins.

    Returns (ok, error, price). Errors are strings the route turns into HTTP
    codes; nothing is mutated unless the whole purchase succeeds.
    """
    price = price_of(item_id)
    if price is None:
        # Either not a real id, or a PRO exclusive that coins must not reach.
        return False, "not purchasable", None
    if owns(db, user_id, item_id):
        return False, "already owned", price
    if not spend(db, user_id, price, "buy_cosmetic", item_id):
        return False, "insufficient coins", price
    db.execute(
        text("INSERT INTO user_unlocks (user_id, kind, item_id) "
             "VALUES (:u, 'cosmetic', :i) ON CONFLICT DO NOTHING"),
        {"u": user_id, "i": item_id},
    )
    return True, None, price


def catalog_for(db, user_id) -> list[dict]:
    """Every shop item with its price and whether the player already has it."""
    have = {
        r[0] for r in db.execute(
            text("SELECT item_id FROM user_unlocks WHERE user_id = :u"),
            {"u": user_id},
        ).fetchall()
    }
    out = []
    for item_id, (slot, rarity) in SHOP_ITEMS.items():
        out.append({
            "item_id": item_id,
            "slot": slot,
            "rarity": rarity,
            "price": price_of(item_id),
            "owned": item_id in have,
        })
    return out
