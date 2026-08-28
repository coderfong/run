"""Scheduled maintenance: collect expired territory, credit holds.

Run by the `territory-run-sweep` cron in render.yaml. It talks to the database
directly rather than calling the API over HTTP, so it needs no shared secret,
no network hop, and does not care whether the web service happens to be up.

    python sweep.py

Claims sweep only their own neighbourhood (see `runs.claim_territory`), so this
is what tidies the rest of the map — and it is the ONLY thing that credits the
hold milestone. Without it, `POINTS_HOLD` is never awarded and rank goes back
to measuring taking and losing but never keeping.

It also refreshes the club season stats, because expiring land is the one way
a club can LOSE area without anybody running. `clan_season_stats.area_current`
is a stored snapshot that only `record_clan_activity` rewrites, and that fires
on a run — so without this the club board reads high from the moment a club's
territory expires until one of its members next goes out. Profiles never had
the problem: they sum live territory per request.
"""

import sys

from app.database import SessionLocal
from app.routes.clans import rebuild_clan_season_stats
from app.routes.runs import run_expiry_sweep


def main() -> int:
    db = SessionLocal()
    clubs = 0
    try:
        result = run_expiry_sweep(db)
        # After the expiry pass, so it measures what is left rather than what
        # was there. Committed here because run_expiry_sweep commits its own
        # work and this must not be left dangling behind it.
        clubs = rebuild_clan_season_stats(db)
        db.commit()
    except Exception as exc:  # noqa: BLE001 — a cron needs a non-zero exit, not a trace
        db.rollback()
        print(f"sweep FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print(
        f"sweep ok — removed {result['expired_removed']} expired territories, "
        f"credited {result['territories_credited']} holds "
        f"across {result['runners_credited']} runners, "
        f"refreshed {clubs} club season totals"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
