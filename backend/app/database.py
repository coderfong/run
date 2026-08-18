from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

# PostGIS-enabled connection. The schema.sql script must run `CREATE EXTENSION
# postgis` before tables are created, otherwise the GEOMETRY columns won't load.
#
# Render (and Heroku) inject DATABASE_URL with a "postgres://" scheme that
# SQLAlchemy rejects — normalize it to "postgresql://".
_db_url = settings.database_url.replace("postgres://", "postgresql://", 1)

# POOL SIZING, and why it is not left at the default.
#
# Every route in this app is a sync `def`, so FastAPI runs each one in its
# anyio worker thread — forty of them by default — and each holds a Session for
# the length of the request. Against SQLAlchemy's default pool that is forty
# threads sharing five connections plus ten of overflow, and the twenty-sixth
# concurrent request does not fail: it BLOCKS in `pool_timeout`, which defaults
# to thirty seconds. That is the worst possible failure shape for the thing
# being complained about here — the server has not run out of anything, it is
# making people queue, and from a phone that is indistinguishable from a server
# that is simply slow.
#
# So the pool is sized against the threadpool rather than against nothing, and
# the wait is cut to something a request can survive. Ten seconds still absorbs
# a burst; past that the honest answer is an error the client can retry, not a
# socket held open until it times out on its own.
#
# `pool_recycle` matters more than it looks: managed Postgres closes idle
# connections behind the pool's back, and a checkout that hands out a dead one
# costs a full failed round trip before `pool_pre_ping` notices and replaces
# it. Recycling under the usual idle cutoff retires them first, so pre-ping
# becomes the safety net it is meant to be rather than the mechanism.
engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_timeout=10,
    pool_recycle=280,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
