"""Server-side simulator access, granted only to immutable account IDs.

Set DEV_RUN_ACCOUNTS to comma-separated user IDs. Usernames and emails are
user-editable and must never grant development privileges. Empty disables
simulator access, including for previously hard-coded tester usernames.
"""
from __future__ import annotations

from .config import settings


def is_dev_account(user) -> bool:
    if user is None:
        return False
    allowed = {
        part.strip().lower()
        for part in (settings.dev_run_accounts or "").split(",")
        if part.strip()
    }
    account_id = str(getattr(user, "id", "") or "").lower()
    return bool(account_id) and account_id in allowed
