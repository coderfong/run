from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import settings
from .ratelimit import limiter
from .routes import auth, leaderboard, runs, territories, users

app = FastAPI(title="Territory Run API", version="1.0.0")

# Rate limiting: per-route limits on auth/run endpoints, a sane default
# everywhere else. 429s carry Retry-After.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

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


@app.get("/health")
def health():
    return {"ok": True}
