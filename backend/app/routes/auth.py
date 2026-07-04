"""Auth: signup, login, /me, rename, delete account.

Username rules: 3-32 chars, alphanumeric + underscore. Lowercased on read.
Password rules: 8-128 chars, at least one letter and one digit.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
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
