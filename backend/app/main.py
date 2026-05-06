from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import auth, leaderboard, runs, territories, users

app = FastAPI(title="Territory Run API", version="1.0.0")

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
