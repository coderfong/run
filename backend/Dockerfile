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
COPY schema.sql migrations ./

# Render/Fly inject $PORT; default to 8000 for local docker run.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
