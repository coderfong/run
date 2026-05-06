-- Idempotent migration: add password_hash to users for existing DBs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
