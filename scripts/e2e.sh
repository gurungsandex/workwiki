#!/usr/bin/env bash
# Build, serve and drive the real application in a browser.
#
# The origin the browser uses must match APP_BASE_URL exactly — every mutation
# checks it, which is the point of the check.
set -euo pipefail

PORT="${E2E_PORT:-3210}"
export APP_BASE_URL="http://127.0.0.1:${PORT}"
export PORT
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-local}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-local-secret}"

# NODE_ENV is set only for the server, never for the build: `next build` sets
# its own, and building with NODE_ENV=development produces a bundle that will
# not render.

npm run build
npm run seed -- --email "${E2E_ADMIN_EMAIL:-admin@example.com}" --password "${E2E_ADMIN_PASSWORD:-a fine long passphrase}" --demo || true

# The standalone server serves static assets from beside itself.
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true

NODE_ENV=production node .next/standalone/server.js &
SERVER=$!
trap 'kill ${SERVER} 2>/dev/null || true' EXIT

until curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null; do sleep 1; done

# The suite deliberately spends failed attempts; clear the counters it left
# behind last time so the lockout is tested, not merely inherited.
psql "${DATABASE_URL}" -q -c "DELETE FROM rate_limit" \
  -c "UPDATE \"user\" SET failed_attempts = 0, locked_until = NULL" >/dev/null || true

npx playwright test "$@"
