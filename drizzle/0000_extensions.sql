-- Extensions the schema depends on. Kept in its own forward-only step so an
-- operator can see exactly what the database is asked to install.
--   citext    — case-insensitive email, unique without a functional index
--   pg_trgm   — trigram similarity, the typo tolerance in search
-- pgvector is deliberately absent: no index is built until an admin turns the
-- assistant on, and that migration ships with the assistant.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
