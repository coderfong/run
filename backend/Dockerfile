# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# GeoAlchemy2 needs psycopg + libgeos + libproj at runtime; build stage
# only needs build-essential for any compiled wheels.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        libgeos-c1v5 \
        libgeos-dev \
        libproj-dev \
        proj-bin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Trim the build-only deps to keep the final image small.
RUN apt-get purge -y build-essential libgeos-dev libproj-dev \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY schema.sql migrations ./

# The scheduled jobs. render.yaml runs these by name and each entrypoint must
# be present in the image; otherwise the cron only ever dies on "can't open
# file". They
# talk to the database directly rather than going through the API, which is
# what lets them keep working when the web service is down — but it also means
# nothing about the web service's own startup would ever have surfaced the
# omission.
#
# sg_regions.json comes too: bot_activity reads it to keep synthesised running
# routes on land. Its absence is survivable (the loader falls back to
# unconstrained routes) which is exactly why it needs saying out loud, or the
# bots quietly start running out to sea.
COPY sweep.py reminders.py bot_activity.py bot_world.py seed_world.py sg_regions.json ./

# Render/Fly inject $PORT; default to 8000 for local docker run. PYTHONPATH so
# alembic's env.py can import the app package from WORKDIR.
ENV PORT=8000 \
    PYTHONPATH=/app
EXPOSE 8000

# Migrate to head (0001 creates the PostGIS/pgcrypto extensions, so a fresh
# database is fully provisioned), then serve. Additive-only — never drops data.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
