from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

# PostGIS-enabled connection. The schema.sql script must run `CREATE EXTENSION
# postgis` before tables are created, otherwise the GEOMETRY columns won't load.
#
# Render (and Heroku) inject DATABASE_URL with a "postgres://" scheme that
# SQLAlchemy rejects — normalize it to "postgresql://".
_db_url = settings.database_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(_db_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
