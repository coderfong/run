"""Who may use the in-app development harness. Decided here, by the server.

The run simulator (`frontend/src/run/simulatedRun.js`) submits a synthesised
GPS trace through the ordinary run endpoints. The server cannot tell one apart
from a run on legs — that is exactly what makes it useful for looking at the
post-run flow, and exactly what makes it dangerous. A one-tap button that mints
territory is the strongest cheat in the game.

So the gate is NOT a build flag. A build flag is decided when the binary is
made, which means every tester on a TestFlight build gets the button, the
decision cannot be revisited without shipping again, and a build promoted to
the App Store carries it into release.

It is an exact-match allowlist. The primary internal tester is pinned in code
so a missing deployment variable cannot strand that account without energy;
additional testers are supplied through the environment.

`DEV_RUN_ACCOUNTS` is a comma-separated list of user ids or usernames.

It controls three things, and all are decided again on every request:

  * whether the app offers the harness at all (`dev_tools` on the identity blob
    the client already fetches)
  * whether /start-run will honour a backdated `started_at`. That is the half
    with teeth. A simulated run submitted without it is a two-second activity
    whatever its trace says, and is gated as too short before it can claim, so
    an allowlist on the button alone would be decoration on an open door.
  * whether claim energy is projected full and priced at zero. This keeps the
    same named account able to repeat the entire claim flow during testing;
    ordinary accounts still use the production meter and atomic spend guard.

Usernames are accepted because they are the thing a person actually knows about
their own account. They are also mutable, so an id is the stabler entry when
one is to hand.
"""

from __future__ import annotations

from .config import settings

# The product owner's permanent internal testing account. This exact username
# is intentionally independent of deployment configuration: every request for
# it gets the dev gate, a full projected meter and zero-cost claims.
PINNED_DEV_ACCOUNTS = {"jonfong78"}


def _allowlist() -> set[str]:
    raw = getattr(settings, "dev_run_accounts", "") or ""
    configured = {part.strip().lower() for part in raw.split(",") if part.strip()}
    return PINNED_DEV_ACCOUNTS | configured


def is_dev_account(user) -> bool:
    """True only for accounts explicitly named in the exact-match allowlist.

    Id, username or email — whichever the person setting the variable happens
    to know. All three are exact matches after lowercasing: a prefix match
    would mean naming one account could quietly name another, which is the one
    mistake this function must not make.
    """
    allowed = _allowlist()
    if not allowed or user is None:
        return False
    return any(
        str(getattr(user, field, "") or "").lower() in allowed
        for field in ("id", "username", "email")
    )
