-- DOCUMENTATION ONLY. The schema is owned by Alembic (backend/alembic/);
-- fresh databases should run `alembic upgrade head`, not this file.
-- This file is kept in sync with the latest migration for readability.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS territories CASCADE;
DROP TABLE IF EXISTS runs CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- v1.1 clans groundwork (rev 0003): real run-club clans replace hash-based
-- teams later; for now only schema + minimal API exist.
CREATE TABLE clans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT UNIQUE NOT NULL CHECK (char_length(name) BETWEEN 3 AND 32),
    tag          TEXT UNIQUE NOT NULL CHECK (char_length(tag) BETWEEN 2 AND 5),
    color_fill   TEXT NOT NULL,
    color_stroke TEXT NOT NULL,
    color_glow   TEXT NOT NULL,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN clan_id UUID REFERENCES clans(id) ON DELETE SET NULL;
CREATE INDEX users_clan_idx ON users(clan_id);

CREATE TABLE runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at   TIMESTAMP NOT NULL DEFAULT now(),
    ended_at     TIMESTAMP,
    path         geometry(LineString, 4326),
    distance_m   DOUBLE PRECISION,
    duration_s   DOUBLE PRECISION,
    -- Anti-cheat shadow flag: flagged runs look normal to the submitter but
    -- their territories are hidden from everyone else. flag_reasons is
    -- server-side only, never exposed by the API.
    verified     BOOLEAN NOT NULL DEFAULT true,
    flag_reasons TEXT[],
    -- Circle-claim model: when the run's claim circle was placed (null = not
    -- yet). Sticky even after territory rows merge/lose their run_id.
    claimed_at   TIMESTAMP
);

CREATE INDEX runs_user_idx ON runs(user_id);
CREATE INDEX runs_path_gix ON runs USING GIST (path);

CREATE TABLE territories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
    -- MultiPolygon since rev 0002: steals keep every surviving fragment.
    polygon     geometry(MultiPolygon, 4326) NOT NULL,
    area_m2     DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    -- Mirrors the owning run's verified flag at claim time.
    verified    BOOLEAN NOT NULL DEFAULT true,
    -- Denormalized from the runner at claim time (rev 0003).
    clan_id     UUID REFERENCES clans(id) ON DELETE SET NULL
);
CREATE INDEX territories_clan_idx ON territories(clan_id);

CREATE INDEX territories_polygon_gix ON territories USING GIST (polygon);
CREATE INDEX territories_user_idx ON territories(user_id);

ALTER TABLE territories
    ADD CONSTRAINT territories_polygon_valid CHECK (ST_IsValid(polygon));

-- Run comments (home-feed cards) + club chat (0008)
CREATE TABLE run_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX run_comments_run_idx ON run_comments(run_id, created_at);

CREATE TABLE clan_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX clan_messages_clan_idx ON clan_messages(clan_id, created_at DESC);
