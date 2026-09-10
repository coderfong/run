"""Server-side simulator access, granted only to immutable account IDs.

Set DEV_RUN_ACCOUNTS to comma-separated user IDs. Usernames and emails are
user-editable and must never grant development privileges. Empty disables
simulator access for everyone except the pinned owner account below.
"""
from __future__ import annotations

from .config import settings

# The product owner's own account (jonfong78), pinned so a deploy that forgets
# DEV_RUN_ACCOUNTS cannot lock the owner out of the harness. Pinned by ID and
# never by username: a username can be changed, and whoever took the name next
# would inherit free claims and a full energy meter.
PINNED_DEV_ACCOUNT_IDS = frozenset({"32a78fc4-0b3e-49bd-aeac-8e0732c48282"})


def is_dev_account(user) -> bool:
    if user is None:
        return False
    account_id = str(getattr(user, "id", "") or "").lower()
    if not account_id:
        return False
    if account_id in PINNED_DEV_ACCOUNT_IDS:
        return True
    allowed = {
        part.strip().lower()
        for part in (settings.dev_run_accounts or "").split(",")
        if part.strip()
    }
    return account_id in allowed
