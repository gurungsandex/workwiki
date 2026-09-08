# Employee information and guidance platform

Self-hosted, single-tenant. One deployment, one company, one database.

The application ships knowing nothing about any company: no departments, no
roles, no policies, no jurisdictions. Everything is created by an admin, and
nothing is ever shown to an employee that an admin did not write, confirm, or
publish.

Two surfaces:

- **Employee guide** — a personalised handbook. Home, browse, search, who to
  ask, acknowledgments, org chart. Every read is access-filtered on the server
  before render, so a body an employee is not entitled to never reaches their
  browser.
- **Admin console** — set the company up, populate its vocabulary, write and
  publish content, decide who sees what, invite people, read the content-gap
  list, triage employee reports, and read an append-only audit log.

Design and specification live in [`docs/design/`](docs/design). The
specification is authoritative on behaviour and architecture, its README on
appearance and copy, and [`CLAUDE.md`](CLAUDE.md) carries the invariants that
must survive every future change.

## Run it

```sh
git clone <this repo> && cd workwiki
cp .env.example .env
# Set the three required values: APP_BASE_URL, DATABASE_URL, SESSION_SECRET.
# Plus POSTGRES_PASSWORD, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for Compose.
docker compose up --build
```

Four containers come up: the app, PostgreSQL 16, MinIO for the object store,
and the worker. Nothing external is required to evaluate the product. The app
migrates itself on boot, then the first browser visit is the setup wizard: it
claims the deployment, names the company, and sets the timezone.

The environment is validated before the server listens. A missing or malformed
variable exits naming the variable, the shape expected and an example — never a
stack trace.

### Without Docker

```sh
npm ci
createdb workwiki
export DATABASE_URL=postgres://…/workwiki APP_BASE_URL=http://localhost:3000 \
       SESSION_SECRET="$(openssl rand -base64 48)" \
       S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=…
npm run migrate
npm run seed -- --email you@example.com --password '…'   # one admin, nothing else
npm run dev
```

Add `--demo` to the seed for a clearly labelled sample set — every row is
prefixed “Demo — ”, no external URL in it resolves, and
`npm run seed -- --remove-demo` takes it all out again.

## What is here

| Milestone | State |
| --- | --- |
| M0 — skeleton: Compose, env validation, forward-only migrations, health checks, Argon2id auth with opaque sessions, setup wizard, dimension tables | Built |
| M1 — content core: section/topic/page/block, block kinds, draft→publish→archive, versioning, reorder, soft delete with restore | Built |
| M2 — access engine: one pure evaluator, structured tenure offsets, locked-not-denied, inheritance, condition builder, explain | Built |
| M3 — reading experience: employee screens, contact resolution, acknowledgment with content-hash check, access-filtered search, org chart | Built |
| M4 — import and extraction (DOCX/PDF, classification, side-by-side review, people CSV) | **Not built** |
| M5 — benefits, jurisdictions, external resources | **Not built** |
| M6 — admin at scale: bulk operations, snippets, delegated sub-admin scopes | **Not built** |
| M7 — OCR, branching guides, PWA offline, notifications, TOTP enforcement | **Not built** |
| M8 — the optional assistant | **Not built** |

M0–M3 is the MVP line the specification draws: a company can deploy, author,
gate and publish; employees can read, acknowledge, and find who to ask.

## The parts that matter

**The access engine** is one pure function in one module —
[`src/lib/access/engine.ts`](src/lib/access/engine.ts). It has no database
access inside it: it takes a subject and a resolved rule chain and returns a
decision. The UI, search and the file route all call it, and nothing
reimplements it. [`src/lib/access/sql.ts`](src/lib/access/sql.ts) compiles the
same rules into a SQL predicate so search filters inside the query, and
[`tests/access-sql.test.ts`](tests/access-sql.test.ts) property-tests the two
against each other on randomly generated rule shapes.

**Date arithmetic** lives in one tested module,
[`src/lib/access/dates.ts`](src/lib/access/dates.ts). Offsets are structured
`{ anchor, unit, value, then? }`, month arithmetic clamps, and every unlock
resolves at local midnight in the employee's own site timezone — a rule must
not unlock a day early for somebody on a western clock.

**Nothing derived is stored.** There is no `status`, `progress` or `coverage`
column anywhere. Counts, checklists, coverage and org-chart chains are computed
at read time.

**Deletes are soft.** `archived_at` and a restore path everywhere. Purge is a
separate, explicit, audited action, and it is the only `DELETE` in the content
layer.

**The audit log is append-only**, enforced by database triggers rather than by
convention: `UPDATE`, `DELETE` and `TRUNCATE` all raise.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run migrate` | Apply forward-only migrations |
| `npm run seed` | Create the first admin (`--demo` for the sample set) |
| `npm run worker:dev` | The pg-boss worker |
| `npm test` | Unit, integration and leak tests |
| `npm run e2e` | Browser tests (needs a running server; `scripts/e2e.sh` does the lot) |
| `npm run typecheck` / `npm run lint` | Types and lint |
| `npm run check:no-slug-literals` | Fails if the code starts knowing a company's vocabulary |
| `./scripts/backup.sh` / `./scripts/restore.sh` | Database plus object store |

## Operations and security

- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deployment, TLS, backups,
  upgrades, scaling, and what to change at a few thousand employees.
- [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md) — the security posture,
  what was found and fixed during review, and what is deliberately out of scope.
