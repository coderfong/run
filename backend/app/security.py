"""Password hashing + JWT helpers shared by /auth and the auth dependency."""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import get_db


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, token_version: int = 0) -> str:
    """A 30 day session token.

    `tv` is the account's token_version at issue time. A password reset bumps
    that column, which is what makes a reset actually evict whoever else was
    signed in — without it, a stolen 30 day token outlives the password it was
    obtained with. Tokens minted before this claim existed decode with no `tv`
    and are read as 0, so adding it did not sign the user base out.
    """
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days)
    payload = {"sub": user_id, "exp": expire, "tv": int(token_version or 0)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def token_for(user: models.User) -> str:
    """create_access_token for a loaded user, so no caller has to remember to
    pass the version along."""
    return create_access_token(user.id, getattr(user, "token_version", 0) or 0)


# --- one-time codes ---------------------------------------------------------
# Recovery codes are short enough to guess if they are unbounded, so they are
# stored the same way passwords are and never held in plaintext anywhere.


def hash_code(code: str) -> str:
    return pwd_context.hash(code)


def verify_code(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        # A malformed stored hash must read as a failed guess, not a 500.
        return False


def new_numeric_code(digits: int = 6) -> str:
    """A uniformly random numeric code, leading zeros preserved."""
    return "".join(str(secrets.randbelow(10)) for _ in range(digits))


# --- the password reset ticket ----------------------------------------------

RESET_PURPOSE = "pwreset"


def create_reset_ticket(user: models.User) -> str:
    """Handed out when a mailed code is accepted; spent by /auth/reset-password.

    It carries the account's CURRENT token_version, and the reset it authorises
    bumps that version. So the ticket dies the moment it is spent: a replay
    presents a `tv` the account has moved past. That is single use without a
    consumed-tickets table to keep and sweep.
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.recovery_ticket_ttl_minutes
    )
    payload = {
        "sub": user.id,
        "exp": expire,
        "purpose": RESET_PURPOSE,
        "tv": int(getattr(user, "token_version", 0) or 0),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def read_reset_ticket(ticket: str, db: Session) -> models.User:
    """The user a valid, unspent ticket belongs to, or 400.

    Deliberately NOT 401: this is a body field on an unauthenticated endpoint,
    and a 401 here would tell the client its session is gone.
    """
    invalid = HTTPException(
        status.HTTP_400_BAD_REQUEST, "that reset has expired, request a new code"
    )
    try:
        payload = jwt.decode(
            ticket, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        raise invalid
    if payload.get("purpose") != RESET_PURPOSE:
        # An access token is not a reset ticket. Without this check any signed
        # in caller could change any password they held a token for.
        raise invalid
    user = db.get(models.User, payload.get("sub") or "")
    if user is None:
        raise invalid
    if int(payload.get("tv") or 0) != int(getattr(user, "token_version", 0) or 0):
        raise invalid
    return user


def current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")

    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    if int(payload.get("tv") or 0) != int(getattr(user, "token_version", 0) or 0):
        # The password has been reset since this token was issued.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session ended")
    return user


def require_admin(x_admin_token: Optional[str] = Header(None)) -> None:
    """Gate for the /admin/* maintenance endpoints.

    These rewrite every player's standings — the expiry sweep deletes
    territory and awards rank, the season recompute reassigns leagues — and
    they were reachable by anybody who knew the path.

    Two deliberate choices:

      * No token configured → 404, not 403. A 403 confirms the endpoint is
        there and worth attacking; a 404 says nothing at all. An unconfigured
        deployment therefore has no admin surface rather than an open one.
      * `compare_digest`, not `==`. These are called rarely enough that a
        timing oracle is a stretch, but a constant-time compare costs nothing
        and removes the question.
    """
    expected = settings.admin_token
    if not expected:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, expected):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")


def current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    """Like current_user, but anonymous/invalid tokens yield None instead of
    401. Used by public reads that reveal extra rows to their owner (e.g.
    shadow-flagged territories)."""
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None
    user = db.get(models.User, user_id)
    if user is None:
        return None
    if int(payload.get("tv") or 0) != int(getattr(user, "token_version", 0) or 0):
        return None
    return user
