"""Energy — the claim limiter. Runs are ALWAYS allowed (this is a fitness
app); energy is spent only to CLAIM territory, and finishing a run grants a
little back so exercise refills the meter.

Energy is time-regenerated and computed LAZILY: we store `energy` and
`energy_updated_at` on the user, and on every read credit
`floor(elapsed / regen_seconds)` points, advancing the timestamp by exactly
the amount consumed so partial progress is never lost. No cron job.

All functions take a `db` session + `user_id` and operate via SQL (the User
ORM model intentionally doesn't map these columns — same pattern as `xp`).
"""

from datetime import datetime, timedelta

from sqlalchemy import text

from .config import settings
from .devtools import is_dev_account
from .progression import energy_max, level_from_xp


def _regen(current: int, updated_at: datetime, level: int):
    """(effective_energy, effective_updated_at) after crediting regen."""
    cap = energy_max(level)
    now = datetime.utcnow()
    if updated_at is None:
        return min(current, cap), now
    if current >= cap:
        return cap, now
    elapsed = (now - updated_at).total_seconds()
    gained = int(elapsed // settings.energy_regen_seconds)
    if gained <= 0:
        return current, updated_at
    new_e = min(cap, current + gained)
    new_updated = updated_at + timedelta(seconds=gained * settings.energy_regen_seconds)
    if new_e >= cap:
        new_updated = now
    return new_e, new_updated


def _read(db, user_id):
    row = db.execute(
        text("SELECT COALESCE(energy, 0), energy_updated_at, COALESCE(xp, 0) FROM users WHERE id = :u"),
        {"u": user_id},
    ).fetchone()
    if not row:
        return 0, datetime.utcnow(), 0
    return int(row[0]), row[1] or datetime.utcnow(), int(row[2])


def _persist(db, user_id, energy, updated_at):
    db.execute(
        text("UPDATE users SET energy = :e, energy_updated_at = :t WHERE id = :u"),
        {"e": energy, "t": updated_at, "u": user_id},
    )


def status(db, user_id, *, unlimited: bool = False) -> dict:
    """Current energy after lazy regen (also persists the regen). Returns the
    shape the API/UI need: energy, cap, cost, and seconds until +1.

    `unlimited` is deliberately supplied by an authenticated route, never by
    request data. It projects a full, free meter without overwriting the
    stored balance, so removing an account from the development allowlist
    immediately restores its ordinary energy state.
    """
    energy, updated_at, xp = _read(db, user_id)
    level = level_from_xp(xp)
    cap = energy_max(level)
    if unlimited:
        return {
            "energy": cap,
            "energy_max": cap,
            "regen_seconds": settings.energy_regen_seconds,
            "seconds_to_next": 0,
            "claim_cost": 0,
        }
    eff, eff_t = _regen(energy, updated_at, level)
    if eff != energy or eff_t != updated_at:
        _persist(db, user_id, eff, eff_t)
    if eff >= cap:
        secs_next = 0
    else:
        elapsed = (datetime.utcnow() - eff_t).total_seconds()
        secs_next = max(0, int(settings.energy_regen_seconds - elapsed))
    return {
        "energy": eff,
        "energy_max": cap,
        "regen_seconds": settings.energy_regen_seconds,
        "seconds_to_next": secs_next,
        "claim_cost": settings.energy_cost_claim,
    }


def status_for_user(db, user) -> dict:
    """Energy status with the server-owned dev allowlist applied."""
    return status(db, user.id, unlimited=is_dev_account(user))


def can_afford(db, user_id, amount: int) -> bool:
    return status(db, user_id)["energy"] >= amount


def spend(db, user_id, amount: int) -> bool:
    """Deduct `amount` if affordable (after regen). Returns False (no change)
    when the player can't afford it. Starts the regen clock if they were full.

    The deduction is a single conditional UPDATE, not a read followed by a
    write: two claims racing for the last of the meter would both pass a
    Python check and drive the balance negative. Here the second one matches
    no rows and reports failure, exactly as `coins.spend` does.
    """
    if amount <= 0:
        return True
    energy, updated_at, xp = _read(db, user_id)
    level = level_from_xp(xp)
    eff, eff_t = _regen(energy, updated_at, level)
    # Credit the regen first so the guard below is measured against the
    # balance the player actually has.
    if eff != energy or eff_t != updated_at:
        _persist(db, user_id, eff, eff_t)
    if eff < amount:
        return False
    was_full = eff >= energy_max(level)
    res = db.execute(
        text(
            "UPDATE users SET energy = COALESCE(energy, 0) - :a, energy_updated_at = :t "
            "WHERE id = :u AND COALESCE(energy, 0) >= :a"
        ),
        {"a": amount, "t": datetime.utcnow() if was_full else eff_t, "u": user_id},
    )
    return res.rowcount > 0


def grant(db, user_id, amount: int) -> None:
    """Add energy (capped). Used to reward finishing a run."""
    if amount <= 0:
        return
    energy, updated_at, xp = _read(db, user_id)
    level = level_from_xp(xp)
    eff, eff_t = _regen(energy, updated_at, level)
    cap = energy_max(level)
    new_e = min(cap, eff + amount)
    _persist(db, user_id, new_e, datetime.utcnow() if new_e >= cap else eff_t)
