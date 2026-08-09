"""Account recovery machinery: the codes, the mail, and the rules around them.

The endpoints in routes/auth.py are thin wrappers over this. Everything that
decides whether a code is acceptable lives here, in one place, because the
whole safety of a six digit secret is in those rules:

  * one live code per account per purpose (issuing retires the previous ones,
    so an old mail cannot be used after a new one is requested)
  * hashed at rest, compared with bcrypt, never logged
  * `recovery_max_attempts` wrong guesses burns the code, so an attacker gets
    five tries at a million, not a million tries at one
  * expiry on the row, checked on read, so a mail sitting in an inbox stops
    being a key after `recovery_code_ttl_minutes`
  * single use, stamped the moment it is accepted

A deliberate omission: nothing here tells the caller whether an address is
attached to some other account. The one place that could leak it is setting an
address that is already taken, and that returns the same success shape as a
fresh one, with the mail simply not sent.
"""

import logging
import re
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import mailer, models
from .config import settings
from .security import hash_code, new_numeric_code, verify_code

log = logging.getLogger("app.recovery")

PURPOSE_RESET = "password_reset"
PURPOSE_VERIFY = "verify_email"

# Not RFC 5322. It rejects the shapes that are certainly typos (no @, no dot in
# the domain, whitespace) and lets the mail provider be the judge of the rest,
# which is the only judge that matters.
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[a-z]{2,}$", re.IGNORECASE)


def normalize_email(raw: str | None) -> str:
    """Lowercased, trimmed, and plausible, or 400."""
    email = (raw or "").strip().lower()
    if not email or len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that email does not look right")
    return email


def email_available(db: Session, email: str, *, exclude_user_id: str | None = None) -> bool:
    """False when another account already holds this address.

    Callers must NOT surface this to the client as a distinct outcome (it would
    turn the endpoint into an "is this person on PASER" oracle). It exists so a
    duplicate is handled quietly instead of hitting the unique index.
    """
    row = db.execute(
        text(
            "SELECT id FROM users WHERE lower(email) = :e "
            "AND (:exclude IS NULL OR id <> :exclude) LIMIT 1"
        ),
        {"e": email, "exclude": exclude_user_id},
    ).first()
    return row is None


def issue_code(db: Session, user: models.User, purpose: str, dest: str) -> str:
    """Mint a code for this account, retiring any earlier live one.

    Returns the plaintext code for immediate sending; it is never stored and
    never returned to a client. The caller commits.
    """
    now = datetime.utcnow()
    # Retire rather than delete: a burnt row is the audit trail of an attempt.
    # Marking them used is what stops a mail from ten minutes ago working after
    # a new one has been requested.
    db.query(models.AuthCode).filter(
        models.AuthCode.user_id == user.id,
        models.AuthCode.purpose == purpose,
        models.AuthCode.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)

    # Housekeeping, so this table cannot grow without bound on an account that
    # keeps asking. Nothing reads a code this old.
    db.query(models.AuthCode).filter(
        models.AuthCode.user_id == user.id,
        models.AuthCode.created_at < now - timedelta(days=1),
    ).delete(synchronize_session=False)

    code = new_numeric_code()
    db.add(
        models.AuthCode(
            user_id=user.id,
            purpose=purpose,
            dest=dest,
            code_hash=hash_code(code),
            expires_at=now + timedelta(minutes=settings.recovery_code_ttl_minutes),
        )
    )
    return code


def consume_code(db: Session, user: models.User, purpose: str, code: str) -> models.AuthCode:
    """Accept a code once, or raise.

    Every rejection returns the same 400 text whatever went wrong: expired,
    already used, never existed, wrong digits. Distinguishing them tells an
    attacker which half of the problem to work on. The one exception is running
    out of attempts, which the runner needs to know because their next move is
    to request a new code rather than keep typing.
    """
    bad = HTTPException(status.HTTP_400_BAD_REQUEST, "that code is not valid")
    digits = (code or "").strip()
    if not digits.isdigit():
        raise bad

    now = datetime.utcnow()
    row = (
        db.query(models.AuthCode)
        .filter(
            models.AuthCode.user_id == user.id,
            models.AuthCode.purpose == purpose,
            models.AuthCode.used_at.is_(None),
        )
        .order_by(models.AuthCode.created_at.desc())
        .first()
    )
    if row is None or row.expires_at <= now:
        raise bad

    if row.attempts >= settings.recovery_max_attempts:
        row.used_at = now
        db.commit()
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "too many tries, request a new code"
        )

    if not verify_code(digits, row.code_hash):
        row.attempts += 1
        # Committed even though the request fails: an attacker who abandons the
        # connection must not roll back their own attempt counter.
        db.commit()
        raise bad

    row.used_at = now
    db.commit()
    return row


# --- the messages -----------------------------------------------------------
# Plain text, no links. A reset link in a mail is a credential in a URL that
# gets logged by every hop it passes through, and the app cannot receive one
# without universal links set up. A code typed into the app it came from is
# both simpler and harder to misuse.


def send_reset_code(user: models.User, email: str, code: str) -> None:
    mins = settings.recovery_code_ttl_minutes
    mailer.send(
        email,
        "Your PASER reset code",
        f"Hi {user.username},\n\n"
        f"Your password reset code is {code}\n\n"
        f"Type it into PASER to choose a new password. It expires in {mins} "
        "minutes and works once.\n\n"
        "If you did not ask for this, you can ignore this email. Your password "
        "has not changed.\n",
    )


def send_verify_code(user: models.User, email: str, code: str) -> None:
    mins = settings.recovery_code_ttl_minutes
    mailer.send(
        email,
        "Confirm your PASER email",
        f"Hi {user.username},\n\n"
        f"Your confirmation code is {code}\n\n"
        f"Type it into PASER to confirm this address. It expires in {mins} "
        "minutes.\n\n"
        "Once confirmed, this is where we send a code if you ever forget your "
        "password. It stays private and nobody else on PASER can see it.\n",
    )


def require_mailer() -> None:
    """501 when this deployment cannot send mail at all.

    Same shape as the social sign-in endpoints: a capability that was never
    configured says so, rather than accepting the request and dropping it.
    """
    if not mailer.configured():
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED, "account recovery is not available yet"
        )
