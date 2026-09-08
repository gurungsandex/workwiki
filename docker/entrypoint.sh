#!/bin/sh
# One image, two roles. `app` serves; `worker` runs the queue.
set -e

if [ "${MIGRATE_ON_BOOT:-true}" = "true" ] && [ "$1" = "app" ]; then
  echo "Running migrations…"
  ./node_modules/tsx/dist/cli.mjs scripts/migrate.ts
fi

case "$1" in
  app)    exec node server.js ;;
  worker) exec ./node_modules/tsx/dist/cli.mjs src/worker/index.ts ;;
  migrate) exec ./node_modules/tsx/dist/cli.mjs scripts/migrate.ts ;;
  *)      exec "$@" ;;
esac
