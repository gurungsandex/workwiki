# Operations

Everything an operator needs after `docker compose up` has worked once.

## The shape of it

Four containers, one database, one bucket.

- **app** — Next.js, server-rendered. Serves employees and admins. Migrates on
  boot unless `MIGRATE_ON_BOOT=false`.
- **worker** — pg-boss on the same Postgres. Sweeps expired sessions, tokens
  and rate-limit windows nightly; re-checks external links weekly.
- **db** — PostgreSQL 16 with `citext` and `pg_trgm`. Not published to the host.
- **minio** — the object store, private. Only the console is exposed, on
  loopback.

The app listens on loopback. **Put a TLS-terminating reverse proxy in front of
it.** HTTPS is assumed by the security posture and by the session cookie: when
`APP_BASE_URL` is `https://`, the session cookie is issued with the `__Host-`
prefix and the `Secure` flag, and HSTS is sent.

Minimal nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name handbook.example.com;

  ssl_certificate     /etc/letsencrypt/live/handbook.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/handbook.example.com/privkey.pem;

  client_max_body_size 30m;   # uploads are capped at 25 MB in the application

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

`APP_BASE_URL` must be exactly the origin employees reach. Every mutation
checks the request's `Origin` against it; a mismatch fails every form on the
site, which is the check working rather than a bug.

`TRUST_PROXY` defaults to true, which makes per-IP rate limits read
`X-Forwarded-For`. **Set it to false if the app is exposed directly**, or a
client can spoof that header and evade the limits.

## Configuration

Three values are required — `APP_BASE_URL`, `DATABASE_URL`, `SESSION_SECRET` —
and the object store needs its own two. The environment is validated against a
schema before the server listens; a missing or malformed variable exits naming
the variable, the shape and an example. See [`.env.example`](../.env.example)
for the whole surface.

Argon2id parameters are configuration, not constants:
`ARGON2_MEMORY_KIB` (default 65536), `ARGON2_TIME_COST` (3),
`ARGON2_PARALLELISM` (1). Raising them is safe at any time — the next
successful sign-in rehashes that password at the new parameters.

## Health

- `GET /healthz` — liveness. Returns a build id and nothing else.
- `GET /readyz` — readiness: database reachable, object store reachable,
  migrations current. Returns 503 with a per-check breakdown when it is not.

Neither discloses a version beyond the build id.

## Migrations

Forward-only. Every file in `drizzle/` is applied once, in filename order,
inside a transaction, and recorded with its checksum in `schema_migration`.

- There is no down path. A mistake is corrected by a new migration.
- An applied migration whose contents change is a hard failure on next boot:
  editing a deployed migration is how two deployments quietly diverge.
- Destructive changes are not automatic and are called out in release notes.
- CI runs the migrations twice against a real Postgres 16, and again against a
  seeded fixture database.

Run them by hand with `npm run migrate` when `MIGRATE_ON_BOOT=false`, or
`docker compose run --rm app migrate`.

## Backups

```sh
DATABASE_URL=… S3_ENDPOINT=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
  ./scripts/backup.sh /var/backups
```

Writes one timestamped `.tar.gz` holding a `pg_dump` custom-format dump and a
mirror of the bucket. The bucket half needs the MinIO client (`mc`) on the
path; without it the script says so rather than writing half a backup quietly.

### Rehearse the restore

A backup nobody has restored is a hope, not a backup.

```sh
createdb workwiki_restore_test
DATABASE_URL=postgres://…/workwiki_restore_test ./scripts/restore.sh backups/workwiki-….tar.gz
DATABASE_URL=postgres://…/workwiki_restore_test npm run migrate
# point a throwaway app at it, sign in, read a page
dropdb workwiki_restore_test
```

In-app, an admin can also export the audit log as CSV. A full content export
with original files attached is planned and not built.

## Upgrades

```sh
git pull
docker compose up --build
```

Migrations are forward-only and additive by default. Read the release notes
before an upgrade that names a destructive migration. Roll back by deploying
the previous image — but not across a destructive migration, which is why they
are announced.

## Scale

The defaults target a few hundred employees on one small host. At a few
thousand:

- **Connection pooling.** The app opens up to 10 connections per process. Put
  PgBouncer in transaction mode in front of Postgres before you run more than a
  couple of app processes.
- **Worker concurrency.** One worker is plenty for the housekeeping jobs here.
  Extraction and OCR (M4/M7, not built) belong in their own worker container,
  off the web host — an OCR pass will starve a web container of CPU.
- **File reads.** Every file is proxied through an access-checked route that
  issues a short-lived signed URL. That route is cheap, but put a CDN in front
  of the redirect target, never in front of the check.
- **Search.** `ts_rank_cd` over a GIN index plus a trigram index on titles. The
  access filter is a predicate inside the same query. If it slows down, the
  first thing to look at is the number of live `access_rule` rows, not the
  index.

## Logs

Structured JSON from the worker; no PII. IP addresses are never stored — a
keyed hash is, which is enough to rate-limit and to say "a different device"
in the admin's session list, and useless as a locator.

## Fonts

Source Serif 4 is not fetched from a font host: the Content-Security-Policy
does not permit a third-party origin, deliberately. To ship the intended
typeface rather than the fallback stack, drop the WOFF2 files into `public/fonts/`
and add an `@font-face` block to `src/app/globals.css` pointing at them. Until
then the stack falls back to Georgia, which is a serif, and the design holds.

## What is not built

M4 onward: document extraction and OCR, the people CSV import, benefits and
jurisdictions, delegated sub-admin scopes, and the optional assistant. The
schema and the access engine were built to receive them; nothing about them is
stubbed in a way that pretends otherwise.
