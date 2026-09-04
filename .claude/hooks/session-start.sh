#!/bin/bash
#
# SessionStart hook for Claude Code on the web.
#
# WHY THIS EXISTS
#
# 30 of this repo's 117 tests are database-backed and SKIP SILENTLY when
# TEST_DATABASE_URL is unset — and they are the ones that matter most:
#
#   tests/security/leak.test.ts        15  a canary in a gated body must not
#                                          reach any tree, page or search result
#   tests/access/sql-truth-table.test  9   the SQL predicate against the spec
#   tests/security/rate-limit.test     5   login throttling semantics
#   tests/access/agreement.test        1   500 rule trees through both the pure
#                                          evaluator and its SQL twin
#
# Without this hook a session runs `npm test`, sees "87 passed", and reasonably
# concludes the access engine is verified when the leak tests never executed.
# That is the exact failure this codebase is built to prevent, reintroduced
# through the test harness. So: start Postgres, migrate it, export the URL.
#
# The container ships Postgres 16 binaries but no running server, no Docker
# daemon and no MinIO. MinIO is not started here; without it /readyz correctly
# reports storage down and file-upload paths cannot be exercised. Nothing else
# is affected.

set -euo pipefail

# Local machines have their own Postgres and their own habits. Only shape the
# ephemeral web container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
PGDATA=/var/lib/workwiki-pg
PGPORT=5432
TEST_DB=workwiki_test
TEST_URL="postgres://postgres@127.0.0.1:${PGPORT}/${TEST_DB}"

say() { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------- dependencies
# `install`, not `ci`: the container image is cached after this hook completes,
# so an incremental install is both correct and much faster on resume.
say "Installing npm dependencies..."
npm install --no-audit --no-fund --loglevel=error

# ------------------------------------------------------------------- postgres
if [ -z "$PG_BIN" ]; then
  say "WARNING: no Postgres binaries found. Database-backed tests will SKIP."
  say "         Run them elsewhere, or treat a 87/117 pass as unverified."
  exit 0
fi
export PATH="$PG_BIN:$PATH"

if pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then
  say "Postgres already listening on ${PGPORT}."
else
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    say "Initialising a Postgres cluster at ${PGDATA}..."
    rm -rf "$PGDATA"
    mkdir -p "$PGDATA"
    # initdb refuses to run as root, so the cluster is owned by `postgres`.
    chown postgres "$PGDATA"
    chmod 700 "$PGDATA"
    su postgres -c "PATH='$PG_BIN:\$PATH' initdb -D '$PGDATA' -A trust -U postgres" \
      >/dev/null
  fi

  say "Starting Postgres on ${PGPORT}..."
  chown -R postgres "$PGDATA"
  su postgres -c \
    "PATH='$PG_BIN:\$PATH' pg_ctl -D '$PGDATA' -o '-p ${PGPORT} -k /tmp' -l /tmp/workwiki-pg.log -w start" \
    >/dev/null

  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null && break
    sleep 1
  done
fi

if ! pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then
  say "WARNING: Postgres did not come up. See /tmp/workwiki-pg.log"
  say "         Database-backed tests will SKIP, so 87/117 means unverified."
  exit 0
fi

# ------------------------------------------------------- test database + schema
if ! psql "$TEST_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  say "Creating ${TEST_DB}..."
  psql "postgres://postgres@127.0.0.1:${PGPORT}/postgres" \
    -c "CREATE DATABASE ${TEST_DB}" >/dev/null
fi

# The migrations create these, but citext must exist before 0002 runs and the
# app role is not a superuser in every deployment, so they are made here.
psql "$TEST_URL" -q \
  -c 'CREATE EXTENSION IF NOT EXISTS citext' \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null

# Tests query real tables; an unmigrated database makes them ERROR, not skip.
say "Applying migrations to ${TEST_DB}..."
DATABASE_URL="$TEST_URL" npx tsx lib/db/migrate.ts 2>&1 | sed 's/^/  /' || {
  say "WARNING: migrations failed. Database-backed tests will not pass."
  exit 0
}

# ------------------------------------------------------------------ session env
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export TEST_DATABASE_URL='${TEST_URL}'"
    echo "export DATABASE_URL='${TEST_URL}'"
    # Double quotes in the WRITTEN line, so $PATH expands when the file is
    # sourced. Single quotes there would set PATH to the literal string
    # "/usr/lib/postgresql/16/bin:$PATH" and wipe out the session's PATH.
    echo "export PATH=\"${PG_BIN}:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
fi

say "Ready. TEST_DATABASE_URL is set — 'npm test' should report 117 passed."
say "A run reporting 87 means the database-backed suites skipped; do not"
say "treat that as a green access engine."
