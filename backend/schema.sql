-- Bootstrap script for the territory-run database.
-- Run:
--   psql -U postgres -d territory_run -f schema.sql

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
    flag_reasons TEXT[]
);

CREATE INDEX runs_user_idx ON runs(user_id);
CREATE INDEX runs_path_gix ON runs USING GIST (path);

CREATE TABLE territories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
    polygon     geometry(Polygon, 4326) NOT NULL,
    area_m2     DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    -- Mirrors the owning run's verified flag at claim time.
    verified    BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX territories_polygon_gix ON territories USING GIST (polygon);
CREATE INDEX territories_user_idx ON territories(user_id);

ALTER TABLE territories
    ADD CONSTRAINT territories_polygon_valid CHECK (ST_IsValid(polygon));
