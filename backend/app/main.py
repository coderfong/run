import json
import logging
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt as jose_jwt
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from .config import settings
from .database import SessionLocal
from .ratelimit import limiter
from .routes import (
    auth, clans, feed, leaderboard, pasers, profile, progression, runs, social, territories, users,
)

# ---------------------------------------------------------------------------
# Config hygiene — fail LOUDLY at boot, not quietly at 3am.
# ---------------------------------------------------------------------------

if settings.env == "production":
    if settings.jwt_secret == "dev-only-change-me-in-prod":
        raise RuntimeError(
            "FATAL: JWT_SECRET is still the dev default. Set a real secret "
            "(e.g. `openssl rand -hex 32`) before running with ENV=production."
        )
    if settings.cors_origins.strip() == "*":
        raise RuntimeError(
            "FATAL: CORS_ORIGINS is '*'. In production set an explicit "
            "comma-separated list of allowed origins."
        )

# ---------------------------------------------------------------------------
# Sentry — no-op when SENTRY_DSN is unset.
# ---------------------------------------------------------------------------

if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        traces_sample_rate=0.1,
    )

# ---------------------------------------------------------------------------
# Structured JSON access logging: request id, user id (JWT sub, best-effort),
# route, status, latency.
# ---------------------------------------------------------------------------

_access_logger = logging.getLogger("territory.access")
if not _access_logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(message)s"))
    _access_logger.addHandler(_h)
    _access_logger.setLevel(logging.INFO)
    _access_logger.propagate = False


def _user_id_from_auth_header(request: Request):
    """Best-effort JWT sub for log correlation — never trusted for authz."""
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = jose_jwt.decode(
            header[7:], settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        return payload.get("sub")
    except Exception:
        return None


app = FastAPI(title="PASER API", version=settings.app_version)

# Rate limiting: per-route limits on auth/run endpoints, a sane default
# everywhere else. 429s carry Retry-After.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def access_log(request: Request, call_next):
    request_id = str(uuid.uuid4())
    start = time.perf_counter()
    response = await call_next(request)
    latency_ms = (time.perf_counter() - start) * 1000
    _access_logger.info(
        json.dumps(
            {
                "request_id": request_id,
                "user_id": _user_id_from_auth_header(request),
                "method": request.method,
                "route": request.url.path,
                "status": response.status_code,
                "latency_ms": round(latency_ms, 1),
            }
        )
    )
    response.headers["X-Request-Id"] = request_id
    return response


origins = (
    ["*"]
    if settings.cors_origins.strip() == "*"
    else [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(auth.me_router)
app.include_router(users.router, tags=["users"])
app.include_router(runs.router, tags=["runs"])
app.include_router(territories.router, tags=["territories"])
app.include_router(leaderboard.router, tags=["leaderboard"])
app.include_router(clans.router)
app.include_router(feed.router, tags=["feed"])
app.include_router(profile.router)
app.include_router(social.router)
app.include_router(progression.router)
app.include_router(pasers.router)


@app.get("/health")
def health():
    """Liveness + DB connectivity."""
    db_ok = False
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()
    except Exception:
        db_ok = False
    return {"ok": db_ok, "db": db_ok}


@app.get("/version")
def version():
    return {"version": settings.app_version, "env": settings.env}
