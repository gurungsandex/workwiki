#!/usr/bin/env bash
# A timestamped archive of the database and the object bucket.
#
#   ./scripts/backup.sh [destination-directory]
#
# Restore with ./scripts/restore.sh. Rehearse the restore before you need it —
# a backup nobody has restored is a hope, not a backup.
set -euo pipefail

DEST="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="${DEST}/workwiki-${STAMP}"
mkdir -p "${DIR}"

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${S3_BUCKET:=workwiki}"

echo "→ database"
pg_dump --no-owner --no-privileges --format=custom --file "${DIR}/database.dump" "${DATABASE_URL}"

echo "→ object store"
if command -v mc >/dev/null 2>&1; then
  : "${S3_ENDPOINT:?S3_ENDPOINT must be set}"
  : "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID must be set}"
  : "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
  mc alias set workwiki-backup "${S3_ENDPOINT}" "${S3_ACCESS_KEY_ID}" "${S3_SECRET_ACCESS_KEY}" >/dev/null
  mc mirror --quiet "workwiki-backup/${S3_BUCKET}" "${DIR}/objects"
else
  echo "  mc (MinIO client) not found — the database is archived, the files are not." >&2
  echo "  Install mc, or copy the bucket with your provider's own tool." >&2
fi

tar -czf "${DIR}.tar.gz" -C "${DEST}" "workwiki-${STAMP}"
rm -rf "${DIR}"
echo "Wrote ${DIR}.tar.gz"
