# Running this

Self-hosted, single-tenant. One deployment, one company, one database.

## From a clean clone

```sh
cp .env.example .env

# The two required secrets. The server refuses to start without them and tells
# you which one is missing, what shape it expects, and an example.
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

docker compose up --build
```

Then open <http://localhost:3000>. A fresh instance goes straight to the setup
wizard, which creates the first admin. There is no default account and no
default password.

`/healthz` is liveness. `/readyz` checks the database, the object store and
whether migrations are current, and says which one failed.

## Without Docker

```sh
npm ci
createdb workwiki
DATABASE_URL=postgres://localhost/workwiki npm run migrate
npm run dev
```

You still need an S3-compatible object store for file uploads; everything else
works without one, and `/readyz` will report storage as the failing check.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run migrate` | Apply pending migrations. Forward-only, idempotent, advisory-locked so two booting containers cannot race |
| `npm run seed` | Create one admin and nothing else. Requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` |
| `npm test` | Full suite. Set `TEST_DATABASE_URL` to include the database-backed tests |
| `npm run check:invariants` | The CLAUDE.md invariants, enforced mechanically |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run worker` | Background worker (pg-boss) |

Tests that need Postgres skip silently without `TEST_DATABASE_URL`, so
`npm test` is useful either way — but CI sets it, and the access-engine
agreement test and the leak tests only run when it is set.

```sh
TEST_DATABASE_URL=postgres://localhost/workwiki_test npm test
```

## Upgrading

```sh
git pull
docker compose up --build
```

Migrations are forward-only and additive. CI applies them twice to prove the
second run is a no-op.

## Where things are

| Path | What |
| --- | --- |
| `lib/access/` | **The access engine.** `evaluate.ts` is the pure function; nothing else decides access |
| `lib/db/migrations/` | Numbered, forward-only SQL |
| `lib/content/` | Block registry, state machine, versioning, the read path |
| `lib/serialize/` | The single place responses are built, so PII filtering cannot be forgotten |
| `app/(employee)/` | The handbook |
| `app/(admin)/` | The console |
| `tests/access/` | Truth table, tenure fixtures, SQL-vs-function agreement |
| `tests/security/` | Leak tests, rate limiting, seed emptiness |
| `docs/PLAN.md` | Milestones, and what the spec leaves ambiguous |
| `docs/DECISIONS.md` | What was decided on each ambiguity, and why |
| `SECURITY.md` | Posture, verification, and what an operator must still do |

`designs/` holds the original spec and prototypes. `designs/support.js` is the
prototypes' own runtime and is reference only — it is not ported.
