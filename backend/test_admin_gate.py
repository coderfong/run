"""The /admin/* endpoints must not be reachable without the token.

All of them rewrite or fan out to everyone's data — the expiry sweep deletes
territory and awards rank, the season recompute reassigns every club's league,
and the weekly recap and scheduled game reminders each fan a push notification
out to every eligible account. All were reachable by anyone who knew the path.

Runs against the app in-process (no server, no database: the gate rejects
before any handler body executes).

    python test_admin_gate.py
"""

import sys

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

ADMIN_PATHS = [
    "/admin/sweep-expired",
    "/admin/recompute-season",
    "/admin/weekly-recap",
    "/admin/run-reminders",
]

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


def main():
    client = TestClient(app, raise_server_exceptions=False)

    print("\n[1] with no token configured, the endpoints do not exist")
    settings.admin_token = ""
    for path in ADMIN_PATHS:
        r = client.post(path)
        # 404, not 403: a 403 confirms there is something there worth attacking.
        check(f"{path} → 404 unconfigured", r.status_code == 404, r.status_code)

    print("\n[2] with a token configured, the wrong one is still nothing")
    settings.admin_token = "s3cret-token"
    for path in ADMIN_PATHS:
        check(
            f"{path} → 404 with no header",
            client.post(path).status_code == 404,
            client.post(path).status_code,
        )
        r = client.post(path, headers={"X-Admin-Token": "wrong"})
        check(f"{path} → 404 with a wrong token", r.status_code == 404, r.status_code)
        r = client.post(path, headers={"X-Admin-Token": "s3cret-token "})
        check(f"{path} → 404 on a near-miss", r.status_code == 404, r.status_code)

    print("\n[3] the right token gets PAST the gate")
    # It will then fail on the database, which is fine and is the point: what
    # matters is that it is no longer rejected as unauthorised.
    for path in ADMIN_PATHS:
        r = client.post(path, headers={"X-Admin-Token": "s3cret-token"})
        check(f"{path} is not refused with the right token", r.status_code != 404, r.status_code)

    settings.admin_token = ""
    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        sys.exit(1)
    print("ADMIN ENDPOINTS ARE GATED")


if __name__ == "__main__":
    main()
