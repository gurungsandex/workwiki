-- Forward-only. Extensions the platform needs from first boot.
-- pgvector is deliberately absent: it is created lazily, only when an admin
-- first enables the assistant (spec §2, "Indexes worth naming").
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
