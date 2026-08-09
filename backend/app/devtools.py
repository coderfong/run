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

It is an allowlist in the environment instead, EMPTY by default. The harness
therefore ships dark in every build: the code is present and reaches nobody.
Naming an account is a deployment change, takes effect on the next launch, and
is undone by clearing one variable rather than by shipping a new binary.

`DEV_RUN_ACCOUNTS` is a comma-separated list of user ids or usernames.

It controls two things, and it needs both to mean anything:

  * whether the app offers the harness at all (`dev_tools` on the identity blob
    the client already fetches)
  * whether /start-run will honour a backdated `started_at`. That is the half
    with teeth. A simulated run submitted without it is a two-second activity
    whatever its trace says, and is gated as too short before it can claim, so
    an allowlist on the button alone would be decoration on an open door.

Usernames are accepted because they are the thing a person actually knows about
their own account. They are also mutable, so an id is the stabler entry when
one is to hand.
"""

from __future__ import annotations

from .config import settings


def _allowlist() -> set[str]:
    raw = getattr(settings, "dev_run_accounts", "") or ""
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def is_dev_account(user) -> bool:
    """True only for accounts explicitly named in the environment."""
    allowed = _allowlist()
    if not allowed or user is None:
        return False
    return (
        str(getattr(user, "id", "")).lower() in allowed
        or str(getattr(user, "username", "") or "").lower() in allowed
    )
