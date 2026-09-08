#!/usr/bin/env bash
# Restore an archive written by backup.sh.
#
#   ./scripts/restore.sh backups/workwiki-20260101T000000Z.tar.gz
#
# REHEARSAL STEP — do this before you ever need it for real:
#   1. Bring up a scratch database:  createdb workwiki_restore_test
#   2. DATABASE_URL=postgres://…/workwiki_restore_test ./scripts/restore.sh <archive>
#   3. Point a throwaway app container at it and sign in.
#   4. Drop the scratch database.
# A restore you have not rehearsed is a plan you have not tested.
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <archive.tar.gz>}"
: "${DATABASE_URL:?DATABASE_URL must be set — point it at the target, not production, unless you mean it}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
tar -xzf "${ARCHIVE}" -C "${WORK}"
ROOT="$(find "${WORK}" -maxdepth 1 -type d -name 'workwiki-*' | head -n1)"

echo "→ database"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "${DATABASE_URL}" "${ROOT}/database.dump"

if [ -d "${ROOT}/objects" ]; then
  echo "→ object store"
  : "${S3_ENDPOINT:?S3_ENDPOINT must be set}"
  : "${S3_BUCKET:=workwiki}"
  mc alias set workwiki-restore "${S3_ENDPOINT}" "${S3_ACCESS_KEY_ID}" "${S3_SECRET_ACCESS_KEY}" >/dev/null
  mc mb --ignore-existing "workwiki-restore/${S3_BUCKET}"
  mc mirror --quiet --overwrite "${ROOT}/objects" "workwiki-restore/${S3_BUCKET}"
  mc anonymous set none "workwiki-restore/${S3_BUCKET}"
fi

echo "Restored. Run the migrations before serving: npm run migrate"
