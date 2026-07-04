-- Anti-cheat shadow flagging (Phase 5).
-- Apply with: psql postgresql://run:run@localhost:5432/run -f migrations/002_anticheat.sql

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS flag_reasons TEXT[];

ALTER TABLE territories
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true;

-- Public reads filter on verified constantly; partial index keeps them fast.
CREATE INDEX IF NOT EXISTS territories_verified_idx ON territories (verified);
