"""Daily reminder job used by the Render cron (20:00 Singapore time)."""

import sys

from app.database import SessionLocal
from app.notifications import notify
from app.reminders import deliver_scheduled_reminders


def main() -> int:
    db = SessionLocal()
    try:
        result = deliver_scheduled_reminders(db, notify)
    except Exception as exc:  # noqa: BLE001 - cron failures need a non-zero exit
        db.rollback()
        print(f"reminders FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print(
        f"reminders ok — {result['streak']} streak, "
        f"{result['territory']} territory, {result['total']} total"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
