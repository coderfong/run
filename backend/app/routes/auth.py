"""Auth: signup, login, /me, rename, delete account.

Username rules: 3-32 chars, alphanumeric + underscore. Lowercased on read.
Password rules: 8-128 chars, at least one letter and one digit.
"""

import json
import re
import secrets
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import jwt as jose_jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..ratelimit import limiter
from ..security import (
    create_access_token,
    current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["users"])

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")


class Credentials(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8, max_length=128)


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
    return {"id": user.id, "username": user.username}


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
    return TokenOut(access_token=create_access_token(user.id), user=_user_dict(user))


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
    return TokenOut(access_token=create_access_token(user.id), user=_user_dict(user))


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
        return TokenOut(access_token=create_access_token(existing.id), user=_user_dict(existing))

    username = _unique_username(db, name_hint or claims.get("email"))
    user = models.User(username=username, password_hash=None)
    user.oauth_provider = provider
    user.oauth_sub = sub
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenOut(access_token=create_access_token(user.id), user=_user_dict(user), created=True)


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
    return TokenOut(access_token=create_access_token(user.id), user=_user_dict(user))


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


@me_router.delete("/me")
def delete_me(
    user: models.User = Depends(current_user), db: Session = Depends(get_db)
):
    """Hard delete. Cascade in the schema removes runs + territories."""
    db.delete(user)
    db.commit()
    return {"ok": True}
