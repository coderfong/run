"""Password hashing + JWT helpers shared by /auth and the auth dependency."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
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


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


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
    return user


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
    return db.get(models.User, user_id)
