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
from types import SimpleNamespace

from app import devtools
from app.config import settings
from app.routes.auth import _user_dict

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


def with_allowlist(raw, fn):
    previous = settings.dev_run_accounts
    settings.dev_run_accounts = raw
    try:
        return fn()
    finally:
        settings.dev_run_accounts = previous


def main():
    print("dev harness allowlist")

    # The shipped default. Everything else is a deployment choosing otherwise.
    with_allowlist(
        "",
        lambda: (
            check("empty allowlist grants nobody", not devtools.is_dev_account(ALICE)),
            check("...not even by id", not devtools.is_dev_account(MALLORY)),
        ),
    )

    check(
        "an unset setting is empty, not missing",
        not with_allowlist(None, lambda: devtools.is_dev_account(ALICE)),
    )
    check("anonymous is never a dev account", not devtools.is_dev_account(None))

    # Named accounts, in the forms a person actually types.
    check(
        "matches a username case-insensitively",
        with_allowlist("alice", lambda: devtools.is_dev_account(ALICE)),
    )
    check(
        "matches an id case-insensitively",
        with_allowlist(ALICE.id.upper(), lambda: devtools.is_dev_account(ALICE)),
    )
    check(
        "reads a list with stray whitespace",
        with_allowlist("someone-else, alice ", lambda: devtools.is_dev_account(ALICE)),
    )

    # The one that matters: naming one account must not name another.
    check(
        "naming one account grants only that account",
        with_allowlist(
            "alice",
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
        with_allowlist("alice", lambda: _user_dict(ALICE)["dev_tools"]) is True,
    )

    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        for f in FAILURES:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL DEV HARNESS CHECKS PASSED")


if __name__ == "__main__":
    main()
