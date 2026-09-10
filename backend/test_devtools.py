"""The development-harness allowlist.

The run simulator submits traces the server cannot tell from real runs, so this
allowlist is the only thing between a testing tool and a free-territory button
in every build that ships. The dangerous failure is silent and one-directional:
a match that is too loose grants it to people nobody named, and nothing about
the app looks different when that happens.

Pure functions and no database — run it directly:

    python test_devtools.py
"""

import sys
from datetime import datetime
from types import SimpleNamespace

from app import devtools, energy
from app.config import settings
from app.progression import energy_max
from app.routes.auth import _user_dict
from app.routes.runs import _claim_energy_cost
from app import economy

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' - ' + str(detail)) if detail else ''}")
    return ok


ALICE = SimpleNamespace(
    id="6f1c2f9a-0000-4000-8000-000000000001",
    username="Alice",
    email=None,
    email_verified_at=None,
)
MALLORY = SimpleNamespace(
    id="6f1c2f9a-0000-4000-8000-000000000002",
    username="mallory",
    email=None,
    email_verified_at=None,
)
JON = SimpleNamespace(
    id="6f1c2f9a-0000-4000-8000-000000000078",
    username="jonfong78",
    email=None,
    email_verified_at=None,
)
# The owner's real account, pinned by ID. Given a different username on
# purpose: the pin must survive a rename, because it is not about the name.
OWNER = SimpleNamespace(
    id="32a78fc4-0b3e-49bd-aeac-8e0732c48282",
    username="renamed-owner",
    email=None,
    email_verified_at=None,
)


class _EnergyResult:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _EnergyDb:
    """The one SELECT energy.status_for_user needs for this pure gate test."""
    def __init__(self, value=7, xp=0):
        self.row = (value, datetime.utcnow(), xp)

    def execute(self, statement, params=None):
        return _EnergyResult(self.row)


def with_allowlist(raw, fn):
    previous = settings.dev_run_accounts
    settings.dev_run_accounts = raw
    try:
        return fn()
    finally:
        settings.dev_run_accounts = previous


def main():
    print("dev harness allowlist")

    # The pinned owner account works even if a deploy forgot the environment
    # entry. Everyone else remains dark by default.
    with_allowlist(
        "",
        lambda: (
            check("empty configured list grants no ordinary account", not devtools.is_dev_account(ALICE)),
            check("...not even by id", not devtools.is_dev_account(MALLORY)),
            check("former pinned username grants no privileges", not devtools.is_dev_account(JON)),
            check("the owner's pinned ID is a dev account with nothing configured", devtools.is_dev_account(OWNER)),
        ),
    )
    check(
        "the owner's pin names nobody else",
        with_allowlist("", lambda: not any(devtools.is_dev_account(u) for u in (ALICE, MALLORY, JON))),
    )
    check(
        "the owner's pin sits beside a configured list, not in place of it",
        with_allowlist(
            ALICE.id,
            lambda: devtools.is_dev_account(OWNER) and devtools.is_dev_account(ALICE),
        ),
    )
    check("/me reports dev_tools true for the owner", with_allowlist("", lambda: _user_dict(OWNER)["dev_tools"]) is True)

    check(
        "an unset setting is empty, not missing",
        not with_allowlist(None, lambda: devtools.is_dev_account(ALICE)),
    )
    check("anonymous is never a dev account", not devtools.is_dev_account(None))

    # Named accounts, in the forms a person actually types.
    check(
        "username cannot grant privileges",
        not with_allowlist("alice", lambda: devtools.is_dev_account(ALICE)),
    )
    check(
        "matches an id case-insensitively",
        with_allowlist(ALICE.id.upper(), lambda: devtools.is_dev_account(ALICE)),
    )
    check(
        "reads a list with stray whitespace",
        with_allowlist(f"someone-else, {ALICE.id} ", lambda: devtools.is_dev_account(ALICE)),
    )

    # The one that matters: naming one account must not name another.
    check(
        "naming one account grants only that account",
        with_allowlist(
            ALICE.id,
            lambda: devtools.is_dev_account(ALICE) and not devtools.is_dev_account(MALLORY),
        ),
    )
    check(
        "a partial match is not a match",
        not with_allowlist("alic", lambda: devtools.is_dev_account(ALICE)),
    )
    check(
        "an empty entry in the list matches nobody",
        not with_allowlist(",,  ,", lambda: devtools.is_dev_account(ALICE)),
    )

    # What the app reads its own gate from.
    check(
        "/me reports dev_tools false by default",
        with_allowlist("", lambda: _user_dict(ALICE)["dev_tools"]) is False,
    )
    check(
        "/me reports dev_tools true once named",
        with_allowlist(ALICE.id, lambda: _user_dict(ALICE)["dev_tools"]) is True,
    )

    dev_energy = with_allowlist(
        JON.id, lambda: energy.status_for_user(_EnergyDb(value=7), JON)
    )
    check(
        "dev energy is projected at the full level cap",
        dev_energy["energy"] == dev_energy["energy_max"] == energy_max(0),
        dev_energy,
    )
    check("dev claims advertise zero energy cost", dev_energy["claim_cost"] == 0, dev_energy)
    check(
        "every dev claim action is priced at zero",
        with_allowlist(
            JON.id,
            lambda: all(
                _claim_energy_cost(JON, action, first) == 0
                for action in (
                    economy.ACTION_EMPTY,
                    economy.ACTION_REINFORCE,
                    economy.ACTION_ATTACK,
                    economy.ACTION_FORTIFIED,
                )
                for first in (False, True)
            ),
        ),
    )

    ordinary_energy = with_allowlist(
        "mallory", lambda: energy.status_for_user(_EnergyDb(value=7), ALICE)
    )
    check(
        "ordinary accounts keep their real balance and cost",
        ordinary_energy["energy"] == 7
        and ordinary_energy["claim_cost"] == settings.energy_cost_claim,
        ordinary_energy,
    )

    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        for f in FAILURES:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL DEV HARNESS CHECKS PASSED")


if __name__ == "__main__":
    main()
