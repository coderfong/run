"""Auth: signup, login, /me, rename, delete account, password recovery.

Username rules: 3-32 chars, alphanumeric + underscore. Lowercased on read.
Password rules: 8-128 chars, at least one letter and one digit.

Recovery (rules in app/recovery.py, delivery in app/mailer.py): an account may
hold one VERIFIED email address, and that address is the only place a reset
code is ever sent. Three calls, and the middle one is what makes the third
safe:

    POST /auth/forgot             {username}      -> code goes to the address
    POST /auth/verify-reset-code  {username,code} -> short lived reset ticket
    POST /auth/reset-password     {ticket,password} -> new password, new session

An account with no verified address cannot be recovered, and that is said up
front (GET /me/recovery, plus the nudge on the profile screen) instead of being
discovered by somebody who is already locked out. Accounts created through
Google or Apple never need this: their identity lives with the provider.
"""

import json
import re
import secrets
import urllib.parse
import urllib.request

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import jwt as jose_jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import mailer, models, recovery
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import (
    create_reset_ticket,
    current_user,
    hash_password,
    read_reset_ticket,
    token_for,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["users"])

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")


class Credentials(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8, max_length=128)
    # Optional at signup, and optional forever. Given here it is stored
    # UNVERIFIED and a confirmation code is sent, because an address nobody has
    # proved they own is not a recovery route.
    email: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
    created: bool = False  # true when this call created a brand-new account


class OAuthIn(BaseModel):
    id_token: str
    name: str | None = None
    nonce: str | None = None


class RenameIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)


class ForgotIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=32)


class VerifyResetIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=32)
    code: str = Field(..., min_length=4, max_length=12)


class ResetIn(BaseModel):
    ticket: str = Field(..., min_length=16, max_length=2048)
    password: str = Field(..., min_length=8, max_length=128)


class SetEmailIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    # Required only when the account already has a verified address to lose
    # (see set_email). Absent on a first time set, which is the case for
    # somebody who is signed in on their phone and has forgotten their password.
    current_password: str | None = None


class CodeIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=12)


def _validate_username(username: str) -> str:
    u = username.strip().lower()
    if not USERNAME_RE.match(u):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "username must be 3-32 chars: a-z, 0-9, underscore",
        )
    return u


def _validate_password(password: str):
    if len(password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "password too short")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "password must include a letter and a digit",
        )


def _user_dict(user: models.User) -> dict:
    """The identity blob, returned only ever to its owner (login, signup,
    refresh, /me). The recovery fields ride along so the app can nudge an
    account that has no way back in without a second round trip on launch."""
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "email_verified": user.email_verified_at is not None,
    }


@router.post("/signup", response_model=TokenOut)
@limiter.limit(settings.rate_limit_auth)
def signup(request: Request, response: Response, payload: Credentials, db: Session = Depends(get_db)):
    username = _validate_username(payload.username)
    _validate_password(payload.password)

    existing = (
        db.query(models.User).filter(models.User.username == username).one_or_none()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "username already taken")

    user = models.User(
        username=username, password_hash=hash_password(payload.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # An address given at signup is stored unverified and confirmed by code, so
    # a typo is caught now rather than on the day it is needed. Failure here is
    # never fatal to the signup: the account exists, and the address can be set
    # again from the profile.
    if payload.email:
        email = None
        try:
            email = recovery.normalize_email(payload.email)
        except HTTPException:
            # A malformed address does not cost somebody their new account.
            # They will be asked for one again from the profile.
            db.rollback()
        if email and recovery.email_available(db, email) and mailer.configured():
            user.email = email
            code = recovery.issue_code(db, user, recovery.PURPOSE_VERIFY, email)
            db.commit()
            try:
                recovery.send_verify_code(user, email, code)
            except mailer.MailError:
                # The address and its code are already stored, so the confirm
                # screen's resend button is all that is needed to recover.
                pass

    return TokenOut(access_token=token_for(user), user=_user_dict(user))


@router.post("/login", response_model=TokenOut)
@limiter.limit(settings.rate_limit_auth)
def login(request: Request, response: Response, payload: Credentials, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    user = (
        db.query(models.User).filter(models.User.username == username).one_or_none()
    )
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "invalid username or password"
        )
    return TokenOut(access_token=token_for(user), user=_user_dict(user))


# ---------------------------------------------------------------------------
# Social sign-in (Google / Apple)
# ---------------------------------------------------------------------------

APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def _audiences(csv: str) -> set[str]:
    return {a.strip() for a in (csv or "").split(",") if a.strip()}


def _http_json(url: str):
    with urllib.request.urlopen(url, timeout=6) as r:
        return json.loads(r.read())


def _verify_google(id_token: str) -> dict:
    """Verify a Google id_token via the tokeninfo endpoint and audience check."""
    auds = _audiences(settings.google_client_ids)
    if not auds:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Google sign-in not configured")
    try:
        claims = _http_json(
            "https://oauth2.googleapis.com/tokeninfo?id_token="
            + urllib.parse.quote(id_token, safe="")
        )
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "could not verify Google token")
    if claims.get("iss") not in GOOGLE_ISSUERS or claims.get("aud") not in auds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid Google token")
    if not claims.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid Google token")
    return claims


def _verify_apple(id_token: str) -> dict:
    """Verify an Apple identity token against Apple's public keys."""
    auds = _audiences(settings.apple_client_ids)
    if not auds:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Apple sign-in not configured")
    try:
        kid = jose_jwt.get_unverified_header(id_token).get("kid")
        key = next((k for k in _http_json(APPLE_KEYS_URL)["keys"] if k["kid"] == kid), None)
        if key is None:
            raise ValueError("no matching Apple key")
        claims = jose_jwt.decode(
            id_token, key, algorithms=["RS256"], issuer=APPLE_ISSUER,
            options={"verify_aud": False},
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "could not verify Apple token")
    if claims.get("aud") not in auds or not claims.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid Apple token")
    return claims


def _unique_username(db: Session, seed: str | None) -> str:
    """A valid, unique username seeded from an email/name, else random."""
    base = re.sub(r"[^a-z0-9_]", "", (seed or "").split("@")[0].lower())[:24]
    if len(base) < 3:
        base = "runner"
    for _ in range(20):
        cand = base if not db.query(models.User).filter(models.User.username == base).first() else \
            f"{base[:24]}_{secrets.token_hex(3)}"
        if not db.query(models.User).filter(models.User.username == cand).first():
            return cand[:32]
    return f"runner_{secrets.token_hex(5)}"


def _oauth_login(db: Session, provider: str, claims: dict, name_hint: str | None) -> TokenOut:
    sub = claims["sub"]
    existing = (
        db.query(models.User)
        .filter(models.User.oauth_provider == provider, models.User.oauth_sub == sub)
        .one_or_none()
    )
    if existing is not None:
        return TokenOut(access_token=token_for(existing), user=_user_dict(existing))

    username = _unique_username(db, name_hint or claims.get("email"))
    user = models.User(username=username, password_hash=None)
    user.oauth_provider = provider
    user.oauth_sub = sub
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenOut(access_token=token_for(user), user=_user_dict(user), created=True)


@router.post("/google", response_model=TokenOut)
@limiter.limit(settings.rate_limit_auth)
def google_auth(request: Request, response: Response, payload: OAuthIn, db: Session = Depends(get_db)):
    claims = _verify_google(payload.id_token)
    return _oauth_login(db, "google", claims, payload.name)


@router.post("/apple", response_model=TokenOut)
@limiter.limit(settings.rate_limit_auth)
def apple_auth(request: Request, response: Response, payload: OAuthIn, db: Session = Depends(get_db)):
    claims = _verify_apple(payload.id_token)
    return _oauth_login(db, "apple", claims, payload.name)


@router.post("/refresh", response_model=TokenOut)
@limiter.limit(settings.rate_limit_auth)
def refresh(
    request: Request,
    response: Response,
    user: models.User = Depends(current_user),
):
    """Issue a fresh 30-day token from a still-valid one. Clients call this
    silently when their token is within jwt_refresh_window_days of expiry."""
    return TokenOut(access_token=token_for(user), user=_user_dict(user))


# ---------------------------------------------------------------------------
# Forgot password
# ---------------------------------------------------------------------------
#
# What these deliberately do NOT do is pretend. A reset request that always
# answers "check your email" is the textbook anti-enumeration answer, and it is
# the wrong one here: the account being asked about usually has no address on
# it at all (nothing collected one before this shipped), so the honest answer is
# the only useful one. `sent` and `reason` let the app say "there is no recovery
# email on this account" instead of leaving somebody watching an inbox forever.
#
# The address itself is never returned to an unauthenticated caller, not even
# masked. Whether an account exists is already public from signup's 409, so the
# only thing left to protect is the address, and this protects it.


@router.post("/forgot")
@limiter.limit(settings.rate_limit_recovery)
def forgot_password(
    request: Request,
    response: Response,
    payload: ForgotIn,
    db: Session = Depends(get_db),
):
    recovery.require_mailer()
    username = payload.username.strip().lower()
    user = db.query(models.User).filter(models.User.username == username).one_or_none()

    if user is None:
        # Same shape as a real account with no address. There is nothing to send
        # and nothing to say about who does or does not exist.
        return {"sent": False, "reason": "no_email"}
    if user.password_hash is None and user.oauth_provider:
        # No password to reset. Saying which provider is what turns a dead end
        # into one tap on the button they already have.
        return {"sent": False, "reason": "oauth", "provider": user.oauth_provider}
    if not user.email or user.email_verified_at is None:
        return {"sent": False, "reason": "no_email"}

    code = recovery.issue_code(db, user, recovery.PURPOSE_RESET, user.email)
    db.commit()
    try:
        recovery.send_reset_code(user, user.email, code)
    except mailer.MailError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "could not send the email, try again shortly"
        )
    return {"sent": True, "reason": None}


@router.post("/verify-reset-code")
@limiter.limit(settings.rate_limit_recovery)
def verify_reset_code(
    request: Request,
    response: Response,
    payload: VerifyResetIn,
    db: Session = Depends(get_db),
):
    """Trade a mailed code for a short lived ticket.

    The code is spent here, so it cannot also be replayed at the password step,
    and the ticket carries no secret the client has to keep beyond the next
    screen.
    """
    username = payload.username.strip().lower()
    user = db.query(models.User).filter(models.User.username == username).one_or_none()
    if user is None:
        # Identical to a wrong code, because at this point the caller has
        # already been told whether an address exists; what they must not be
        # able to do is probe usernames one code at a time.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that code is not valid")

    recovery.consume_code(db, user, recovery.PURPOSE_RESET, payload.code)
    return {"ticket": create_reset_ticket(user)}


@router.post("/reset-password", response_model=TokenOut)
@limiter.limit(settings.rate_limit_recovery)
def reset_password(
    request: Request,
    response: Response,
    payload: ResetIn,
    db: Session = Depends(get_db),
):
    """Set the new password and hand back a session.

    Bumping token_version is the half of this that matters if the reason for the
    reset was somebody else being in the account: every token issued before now
    stops working on its next request, including theirs. The response contains a
    fresh one so the runner is simply signed in rather than bounced to a login
    form to type the password they just chose.
    """
    user = read_reset_ticket(payload.ticket, db)
    _validate_password(payload.password)

    user.password_hash = hash_password(payload.password)
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    return TokenOut(access_token=token_for(user), user=_user_dict(user))


# ---------------------------------------------------------------------------
# The recovery address (owner only)
# ---------------------------------------------------------------------------


@me_router.get("/me/recovery")
def get_recovery(user: models.User = Depends(current_user)):
    """What this account's way back in currently is.

    `can_recover` is the one field the UI acts on. An account signed in through
    Google or Apple recovers through the provider and needs nothing here, which
    is why it reads true with no address set.
    """
    social = bool(user.oauth_provider) and user.password_hash is None
    return {
        "email": user.email,
        "verified": user.email_verified_at is not None,
        "provider": user.oauth_provider,
        "can_recover": social or (bool(user.email) and user.email_verified_at is not None),
        "mail_available": mailer.configured(),
    }


@me_router.put("/me/recovery/email")
@limiter.limit(settings.rate_limit_recovery)
def set_email(
    request: Request,
    response: Response,
    payload: SetEmailIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Point recovery at an address, pending confirmation by code.

    The password is required only to REPLACE an already verified address, and
    that asymmetry is on purpose. Requiring it to set the first one would lock
    out the exact person this feature is for: somebody still signed in on their
    phone who has forgotten their password. Once an address is verified they can
    use the forgot flow instead, so the password requirement costs them nothing
    and it stops a stolen session from quietly redirecting recovery.
    """
    recovery.require_mailer()
    email = recovery.normalize_email(payload.email)
    had_verified = user.email_verified_at is not None
    previous = user.email

    if had_verified and user.password_hash is not None:
        if not payload.current_password or not verify_password(
            payload.current_password, user.password_hash
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "that password is not right")

    if had_verified and previous and previous.lower() == email:
        return {"pending": email, "sent": False, "reason": "unchanged"}

    # Taken by somebody else: answered exactly like success, with no mail sent.
    # Anything else here would report which addresses have PASER accounts.
    if not recovery.email_available(db, email, exclude_user_id=user.id):
        return {"pending": email, "sent": True, "reason": None}

    user.email = email
    user.email_verified_at = None
    code = recovery.issue_code(db, user, recovery.PURPOSE_VERIFY, email)
    db.commit()

    try:
        recovery.send_verify_code(user, email, code)
    except mailer.MailError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "could not send the email, try again shortly"
        )

    # The old address is told it lost the account, since that mail is the only
    # warning the real owner gets if this was not them.
    if had_verified and previous and previous.lower() != email:
        try:
            mailer.send(
                previous,
                "Your PASER recovery email changed",
                f"Hi {user.username},\n\n"
                "The recovery email on your PASER account was changed to a "
                "different address, so password reset codes will no longer come "
                "here.\n\n"
                "If that was not you, someone else may be using your account. "
                "Reply to this email and we will help you get it back.\n",
            )
        except mailer.MailError:
            pass

    return {"pending": email, "sent": True, "reason": None}


@me_router.post("/me/recovery/email/verify")
@limiter.limit(settings.rate_limit_recovery)
def verify_email(
    request: Request,
    response: Response,
    payload: CodeIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Confirm the pending address, which is what makes it a recovery route."""
    row = recovery.consume_code(db, user, recovery.PURPOSE_VERIFY, payload.code)
    # Bound to the address the code was sent to, so a code mailed to the old
    # address cannot verify a newer one that was set in the meantime.
    if not user.email or user.email.lower() != (row.dest or "").lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that code is not valid")
    user.email_verified_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return {"email": user.email, "verified": True}


@me_router.post("/me/recovery/email/resend")
@limiter.limit(settings.rate_limit_recovery)
def resend_email_code(
    request: Request,
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    recovery.require_mailer()
    if not user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no email to confirm")
    if user.email_verified_at is not None:
        return {"sent": False, "reason": "already_verified"}
    code = recovery.issue_code(db, user, recovery.PURPOSE_VERIFY, user.email)
    db.commit()
    try:
        recovery.send_verify_code(user, user.email, code)
    except mailer.MailError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "could not send the email, try again shortly"
        )
    return {"sent": True, "reason": None}


@me_router.delete("/me/recovery/email")
def clear_email(
    payload: dict | None = None,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Drop the address. Same password rule as replacing it, for the same
    reason, and the account is left unrecoverable on purpose if that is what
    the runner wants."""
    if user.email_verified_at is not None and user.password_hash is not None:
        given = (payload or {}).get("current_password")
        if not given or not verify_password(given, user.password_hash):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "that password is not right")
    user.email = None
    user.email_verified_at = None
    db.query(models.AuthCode).filter(
        models.AuthCode.user_id == user.id,
        models.AuthCode.used_at.is_(None),
    ).update({"used_at": datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"ok": True}


@me_router.get("/me")
def get_me(user: models.User = Depends(current_user)):
    return _user_dict(user)


@me_router.patch("/me")
def rename_me(
    payload: RenameIn,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    new_name = _validate_username(payload.username)
    if new_name == user.username:
        return _user_dict(user)
    taken = (
        db.query(models.User).filter(models.User.username == new_name).one_or_none()
    )
    if taken is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "username already taken")
    user.username = new_name
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@me_router.put("/me/birthday")
def set_birthday(
    payload: dict,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Record the birthday onboarding already collects.

    It was written to the phone and never sent, which meant the one place that
    decides what a route publishes could not tell whether it was publishing a
    child's. It is used for exactly one thing — raising the floor on route
    trimming and the publish delay for under-18 accounts (see privacy.load) —
    and is never returned to anybody else.

    Write-once-ish by design: it can be corrected, but there is nothing here
    that reads it back out, so it cannot become a profile field by accident.
    """
    raw = (payload or {}).get("birthday")
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "birthday required (YYYY-MM-DD)")
    try:
        day = date.fromisoformat(str(raw)[:10])
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "birthday must be YYYY-MM-DD")
    today = date.today()
    if day > today or day.year < today.year - 120:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that birthday isn't plausible")
    db.execute(
        text("UPDATE users SET birthday = :b WHERE id = :u"), {"b": day, "u": user.id}
    )
    db.commit()
    return {"ok": True}


@me_router.delete("/me")
def delete_me(
    user: models.User = Depends(current_user), db: Session = Depends(get_db)
):
    """Hard delete. Cascade in the schema removes runs + territories."""
    db.delete(user)
    db.commit()
    return {"ok": True}
