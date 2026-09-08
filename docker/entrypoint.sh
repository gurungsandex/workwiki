#!/bin/sh
# One image, three roles. `app` serves, `worker` runs the queue, `migrate`
# applies migrations and exits.
set -e

if [ "${MIGRATE_ON_BOOT:-true}" = "true" ] && [ "$1" = "app" ]; then
  echo "Running migrations…"
  node dist/migrate.js
fi

case "$1" in
  app)     exec node server.js ;;
  worker)  exec node dist/worker.js ;;
  migrate) exec node dist/migrate.js ;;
  seed)    shift; exec node dist/seed.js "$@" ;;
  *)       exec "$@" ;;
esac
