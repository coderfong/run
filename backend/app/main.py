import json
import logging
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from jose import jwt as jose_jwt
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from .config import settings
from .database import SessionLocal
from .ratelimit import limiter
from .routes import (
    auth, clans, dev, feed, insights, leaderboard, missions, my_territory, paserby, pasers, pro,
    profile, progression, rivals, runs, shop, social, territories, users,
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

# Compress anything big enough to be worth it.
#
# This API's payloads are the shape gzip is best at: the map, the leaderboards,
# the feed and the claim options are long lists of repetitive JSON, and the
# geometry ones are page after page of coordinate digits. Ten to one is normal
# on that shape of body.
#
# It is a LATENCY fix, not a bandwidth one, which is why it belongs in a pass
# about the server feeling slow. The clients are phones on mobile data, where
# the round trip is fine and the throughput is not — a few hundred KB of
# territory is most of a second of transfer on its own, and every bit of that
# is time the runner spends looking at a spinner.
#
# 1000 bytes because below roughly that the compressed body plus its header
# costs more than it saves, and small responses are the ones already fast.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(auth.router)
app.include_router(auth.me_router)
app.include_router(users.router, tags=["users"])
app.include_router(runs.router, tags=["runs"])
app.include_router(dev.router)
app.include_router(territories.router, tags=["territories"])
app.include_router(leaderboard.router, tags=["leaderboard"])
app.include_router(clans.router)
app.include_router(feed.router, tags=["feed"])
app.include_router(profile.router)
app.include_router(social.router)
app.include_router(progression.router)
app.include_router(missions.router)
app.include_router(pasers.router)
app.include_router(paserby.router)
app.include_router(rivals.router)
app.include_router(shop.router)
app.include_router(pro.router, tags=["pro"])
app.include_router(insights.router)
app.include_router(my_territory.router)


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
    """What is actually running here.

    `commit` is the thing worth having: `version` is a hand-maintained string
    that does not move when code does, so it cannot answer "did my push go
    out". The commit can, in one request, without credentials — which matters
    most for changes that live inside authenticated handlers and have no other
    externally visible signature.

    Short-form, because it is for eyeballing against `git log --oneline`.
    Empty off Render, which is the honest answer rather than a guess.
    """
    return {
        "version": settings.app_version,
        "env": settings.env,
        "commit": (settings.render_git_commit or "")[:7],
    }
