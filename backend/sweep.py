"""Scheduled maintenance: collect expired territory, credit holds.

Run by the `territory-run-sweep` cron in render.yaml. It talks to the database
directly rather than calling the API over HTTP, so it needs no shared secret,
no network hop, and does not care whether the web service happens to be up.

    python sweep.py

Claims sweep only their own neighbourhood (see `runs.claim_territory`), so this
is what tidies the rest of the map — and it is the ONLY thing that credits the
hold milestone. Without it, `POINTS_HOLD` is never awarded and rank goes back
to measuring taking and losing but never keeping.
"""

import sys

from app.database import SessionLocal
from app.routes.runs import run_expiry_sweep


def main() -> int:
    db = SessionLocal()
    try:
        result = run_expiry_sweep(db)
    except Exception as exc:  # noqa: BLE001 — a cron needs a non-zero exit, not a trace
        db.rollback()
        print(f"sweep FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print(
        f"sweep ok — removed {result['expired_removed']} expired territories, "
        f"credited {result['territories_credited']} holds "
        f"across {result['runners_credited']} runners"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
