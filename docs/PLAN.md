# Build plan

Derived from `designs/Platform Spec.dc.html` §12, with the schema, access engine, API
surface and security posture from §§2, 3, 9 and 11, and appearance/copy from
`README.md` and the two prototypes.

Nothing here is application code. Sections 1–3 are the work; section 4 lists what I
believe is wrong or underspecified in the spec; section 5 lists what the spec and
handoff say is not designed, and which milestone first needs it.

**Read section 4 before approving M1.** Three of the items there (the page body model,
the second content tree, and `visibility: 'preview'`) change the M1 and M2 schema and
cannot be deferred without a rewrite.

---

## 0. Conventions this plan assumes

### Repository layout

```
app/
  (setup)/setup/…                first-run wizard
  (employee)/…                   employee guide, six tabs + search
  (admin)/admin/…                admin console, eleven tabs
  api/…                          route handlers (§9 surface)
lib/
  env.ts                         schema-validated environment
  db/schema/*.ts                 Drizzle table definitions
  db/migrations/*.sql            drizzle-kit, forward-only, numbered
  access/                        THE access engine — see M2
    types.ts  evaluate.ts  tenure.ts  compile.ts  explain.ts
  auth/                          Argon2id, sessions, tokens, rate limit
  content/                       tree, blocks, versions, state machine
  contacts/                      resolution chain
  files/                         S3 client, access-checked proxy, sniffing
  mail/                          Nodemailer transport + templates
  audit/                         append-only writer
  serialize/                     the single place responses are built (§11 PII)
components/                      Broadsheet-shaped React components
styles/broadsheet.css            tokens copied from designs/_ds/…/styles.css
worker/                          pg-boss workers (+ Tesseract from M7)
scripts/                         backup.sh, restore.sh, seed.ts, check-slug-literals.ts
tests/                           vitest; tests/access/ is table-driven
docker-compose.yml  Dockerfile  Dockerfile.worker
```

### Rules the plan holds itself to

- **No derived column anywhere.** No `status` rollup, no `progress`, no
  `percent_complete`, no `coverage`, no cached counts, no stored org-chart chain, no
  stored checklist position. Every such number in the prototypes is a read-time query.
  Three columns below look like exceptions and are not; each is justified where it
  appears:
  - `content_node.state` (`draft|published|archived`) — an **authored** state, set by an
    admin action, not computed from anything.
  - `external_resource.status` (`suggested|confirmed|broken`) — likewise authored, plus
    a link-check event result.
  - `page_version.content_hash` — an immutable artefact of a past publish that
    acknowledgments attest against. Recomputing it later would be recomputing history.
  `block.summary_stale` from spec §2 **is** a derived value and is not stored; see §4.6.
- **`CHECK` constraints are allowed on platform vocabulary and forbidden on company
  vocabulary.** `user.status`, `content_node.state`, `access_rule.effect` are the
  platform's own words and are constrained. Department, role, employee type, location,
  content kind and jurisdiction are rows with no constraint and no TypeScript union.
  `employee_type.kind` is the single soft hint the spec permits.
- **Soft delete everywhere**: `archived_at timestamptz`. Purge is a separate audited
  action. No `DELETE` from application code except session revocation and token
  consumption.
- **`user` is reserved in Postgres**; the table is `app_user` and the Drizzle export is
  `users`. Every other name follows the spec verbatim.
- Every task's acceptance criterion is something that can be **run** — a test, a command,
  a screen reached from a clean database.

---

## 1. Milestones and tasks

Task IDs are stable; dependencies reference them.

### M0 — Skeleton

*Ships:* Compose stack, env validation, migrations, health checks, auth, setup wizard,
dimension tables. *Waits:* everything content.

| ID | Task | Acceptance criterion | Files created / touched | Depends on |
|---|---|---|---|---|
| **M0.1** | Repo scaffold: Next.js App Router + TypeScript strict, vitest, eslint, prettier, `tsconfig` paths | `npm run typecheck`, `npm run lint`, `npm test` all pass on an empty suite | `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.eslintrc` | — |
| **M0.2** | Broadsheet token stylesheet + base layout primitives (no components yet) | Every token in `README.md`'s table resolves in the browser; `:focus-visible` rule is global; a CI check greps the codebase for `transition:`/`animation:` and fails on a hit | `styles/broadsheet.css`, `app/layout.tsx`, `scripts/check-no-motion.ts` | M0.1 |
| **M0.3** | Env schema + boot-time validation | Starting with `SESSION_SECRET` unset exits non-zero printing the variable name, expected shape and an example — no stack trace. Test asserts the exact message | `lib/env.ts`, `tests/env.test.ts`, `.env.example` | M0.1 |
| **M0.4** | Compose stack: app, Postgres 16, MinIO, worker | `git clone && cp .env.example .env && docker compose up` reaches a healthy `/readyz` with no other steps | `docker-compose.yml`, `Dockerfile`, `Dockerfile.worker`, `README` run section | M0.3 |
| **M0.5** | Drizzle + drizzle-kit wiring, forward-only migration runner, `npm run migrate` | `drizzle-kit generate` produces a numbered SQL file; runner is idempotent; boot-time auto-migrate is behind `MIGRATE_ON_BOOT` (default on) | `drizzle.config.ts`, `lib/db/client.ts`, `lib/db/migrate.ts` | M0.3 |
| **M0.6** | Migrations 0001–0006 (see §2) | `docker compose up` from empty volume produces the full M0 schema; a second run is a no-op; `pg_dump` diff against the schema fixture is empty | `lib/db/migrations/0001…0006_*.sql`, `lib/db/schema/*.ts` | M0.5 |
| **M0.7** | Audit writer with append-only enforcement | App DB role has no `UPDATE`/`DELETE` grant on `audit_event`; a test that attempts an update fails at the database, not in application code | `lib/audit/write.ts`, migration `0004`, `tests/audit-append-only.test.ts` | M0.6 |
| **M0.8** | Password hashing + session store | Argon2id parameters read from config and recorded on the hash; login rehashes when parameters change (tested); session tokens are 256-bit opaque, stored hashed, cookie is `HttpOnly; Secure; SameSite=Lax` | `lib/auth/password.ts`, `lib/auth/session.ts`, `tests/auth/*.test.ts` | M0.6 |
| **M0.9** | Auth routes: register, verify, login, logout, logout-all, reset request/confirm, session list | Failure messages are identical for unknown-address and wrong-password (test asserts byte equality); per-account and per-IP progressive delay; verify and reset tokens are single-use and expiring | `app/api/auth/*/route.ts`, `app/api/me/sessions/route.ts`, `lib/auth/rate-limit.ts` | M0.8 |
| **M0.10** | Mail transport + templates over SMTP | A test send from the wizard reports the SMTP error verbatim on failure and blocks the step on failure | `lib/mail/transport.ts`, `lib/mail/templates/*.tsx` | M0.3, M0.6 |
| **M0.11** | File object store: S3 client, upload with type sniffing, access-checked proxy route | Bucket is private; `GET /api/files/:id` 404s for an unauthenticated request and redirects to a short-lived signed URL otherwise; extension is never trusted for MIME | `lib/files/*.ts`, `app/api/files/[id]/route.ts` | M0.6 |
| **M0.12** | Setup wizard, six steps, matching Admin Console tab 1 | From a clean database the wizard creates the first admin, saves company details, adds jurisdictions, applies (or skips) a scaffold, sets admin roles, and lands on the checklist. **The checklist is a live query** — deleting a department makes its line revert. No `setup_step` column exists | `app/(setup)/setup/**`, `lib/setup/checklist.ts`, `tests/setup-checklist-derived.test.ts` | M0.6, M0.9, M0.10, M0.11 |
| **M0.13** | Dimension admin: departments, roles, employee types, sites (Admin Console tab 3) | Adding a department named `Enum` works; a CI check greps `lib/` and `app/` for section/department/role slug literals and fails the build on a hit (spec §13 risk row) | `app/(admin)/admin/structure/**`, `app/api/admin/dimensions/*/route.ts`, `scripts/check-slug-literals.ts` | M0.12 |
| **M0.14** | Health endpoints + diagnostics page | `/healthz` returns liveness with a build id only; `/readyz` checks database, storage, migrations-current and reports which one failed; the diagnostics page additionally tests email and auth config on demand | `app/healthz/route.ts`, `app/readyz/route.ts`, `app/(admin)/admin/diagnostics/page.tsx` | M0.4, M0.10, M0.11 |
| **M0.15** | Seed script: one admin, no content | `npm run seed` creates exactly one admin and zero departments, zero sections, zero policies. A test asserts the seeded database contains no company vocabulary | `scripts/seed.ts`, `tests/seed-is-empty.test.ts` | M0.6 |
| **M0.16** | Backup / restore scripts | `./scripts/backup.sh` writes a timestamped archive of `pg_dump` + bucket; `./scripts/restore.sh` restores it into a clean stack and the app boots against it (rehearsed in CI) | `scripts/backup.sh`, `scripts/restore.sh` | M0.4 |

**M0 exit:** clean clone → `docker compose up` → wizard → one admin, populated dimension
tables, empty content. No `section` table exists yet.

---

### M1 — Content core

*Ships:* section/topic/page/block model, the block kinds, draft→publish→archive,
versioning, reorder, soft delete. *Waits:* guides, summaries, benefits.

> **Blocked on a decision:** M1.1 and M1.3 cannot be written until §4.1 (which page body
> model) and §4.2 (whether document headings are a second tree) are answered. Everything
> else in M1 is independent of that answer.

| ID | Task | Acceptance criterion | Files | Depends on |
|---|---|---|---|---|
| **M1.1** | Migrations 0101–0102: `content_node`, `content_kind`, `block`, `snippet` | Depth is capped at three levels by a database constraint, not by application code; a fourth level is rejected at insert | `lib/db/migrations/0101,0102_*.sql`, `lib/db/schema/content.ts` | M0.6, §4.1, §4.2 |
| **M1.2** | Fractional-index ordering (`sort_key text`) | Reordering any item is a **single-row** `UPDATE`; a property test doing 500 random moves never rewrites more than one row and never produces a duplicate key | `lib/content/sort-key.ts`, `tests/sort-key.test.ts` | M1.1 |
| **M1.3** | Block kind registry: validator + renderer per kind, `data` validated on write | Adding a kind touches `lib/content/blocks/` and nothing in `lib/db/migrations/`. A test asserts a new kind needs no migration. Invalid `data` is rejected at the API boundary with the failing path named | `lib/content/blocks/{index,richtext,document,image,callout,contact,external-link,table}.ts` | M1.1 |
| **M1.4** | TipTap with a constrained schema (rich-text kind only) | The editor accepts only the allowed marks/nodes; pasted HTML outside the schema is stripped, not stored; stored value is structured JSON, not an HTML blob | `components/editor/RichText.tsx`, `lib/content/blocks/richtext.ts` | M1.3 |
| **M1.5** | Content state machine: draft → published → archived, with `publish_at` / `unpublish_at` | **Tests before implementation.** Every legal and illegal transition is a table row; publishing writes a `page_version` and an audit event in one transaction; unpublishing never destroys the version | `lib/content/state.ts`, `tests/content-state.test.ts` | M1.1, M0.7 |
| **M1.6** | Migration 0103 + versioning: `page_version` snapshot and `content_hash` | Version numbers are gapless per page; the snapshot is the resolved block list at publish time; `content_hash` is a documented canonicalisation (see §4.7 — needs a ruling) | `lib/db/migrations/0103_*.sql`, `lib/content/version.ts` | M1.5 |
| **M1.7** | Summary-block rules | A `summary` block without one of `source_block_id` / `source_file_id` / `source_url` is rejected by a partial `CHECK` at the database. A drafted summary is `published_at IS NULL` and its text is absent from every employee response (test hits the API, not the function). Publishing stamps `published_by` + `byline_kind = 'authored'` | migration `0102`, `lib/content/summary.ts`, `tests/summary-not-leaked.test.ts` | M1.3, M1.5 |
| **M1.8** | Required postings are never summarised | For a node whose `content_kind.never_summarised` is true, the "draft a summary" path returns 400 and the UI offers *confirm the source* instead, stamping `byline_kind = 'confirmed_source'` | `lib/content/summary.ts`, `app/(admin)/admin/docs/**` | M1.7, M0.13 |
| **M1.9** | Migration 0104 + contact cards and bindings | A card is stored once and embedded by reference; changing the number changes it everywhere (test asserts a single row updated and two surfaces changed). `field_visibility` is honoured in the serialiser, not the component | `lib/db/migrations/0104_*.sql`, `lib/contacts/*.ts`, `lib/serialize/contact.ts` | M1.1, M0.6 |
| **M1.10** | Migration 0105 + file attachment to nodes and blocks | The original upload is immutable and always downloadable through the access-checked route; alt text is required at upload time for images and the upload fails without it | `lib/db/migrations/0105_*.sql`, `app/api/admin/files/route.ts` | M0.11, M1.1 |
| **M1.11** | Soft delete + Trash: archive, restore, purge | Nothing in `app/api/admin/**` issues a `DELETE` on content (grep test). Restore returns the item to its previous parent and sort position. Purge is a separate route, requires confirmation, and writes an audit event | `lib/content/archive.ts`, `app/(admin)/admin/trash/**`, `tests/no-hard-delete.test.ts` | M1.5, M0.7 |
| **M1.12** | Admin structure tree UI (tree, move, duplicate, rename, reorder) with Broadsheet list rows | List rows, never cards (`README.md` control patterns). Removal messages state what widened or moved, in the prototype's exact words | `app/(admin)/admin/sections/**`, `components/list/Row.tsx` | M1.2, M1.11, M0.2 |
| **M1.13** | Save-state line in the admin top bar | Every mutation writes a human sentence into the save slot; the strings come from the prototype verbatim, held in one copy module so they are reviewable | `components/admin/SaveState.tsx`, `lib/copy/admin.ts` | M1.12 |

**M1 exit:** an admin can build the tree, author blocks, publish, version, reorder,
archive and restore. **No employee route exists yet** — that is deliberate: M2 lands
before any reading UI.

---

### M2 — Access engine (the keystone)

*Ships:* the evaluator, condition builder, inheritance, lock visibility, tenure and
eligibility date math, preview-as with time travel, full test suite. *Waits:* bulk rule
application.

The order below is not negotiable: **types, then fixtures, then tests, then the
function.** M2.4 must be red before M2.5 is written.

| ID | Task | Acceptance criterion | Files | Depends on |
|---|---|---|---|---|
| **M2.1** | Migration 0201: `access_rule` | `(target_type, target_id)` index plus a partial index on `effect = 'deny'`. `conditions` is JSONB validated by a schema in code. No dimension is an enum | `lib/db/migrations/0201_*.sql`, `lib/db/schema/access.ts` | M1.1 |
| **M2.2** | `lib/access/types.ts` — `Subject`, `Node`, `RuleChain`, `Decision`, `TenureOffset` | The module imports **nothing** from `lib/db`. A test asserts the import graph of `lib/access/**` contains no database, network or clock dependency (the clock is the `at` parameter) | `lib/access/types.ts`, `tests/access/no-io.test.ts` | M2.1 |
| **M2.3** | `lib/access/tenure.ts` — structured offsets, no day counts | Table-driven fixtures covering: month clamping (31 Jan + 1 month = 28 Feb); `then: 'first_of_next_month'` composed **after** the offset; a target landing exactly on the first of a month; leap day; DST transitions in both directions; two locations in different zones on the same rule (no early unlock for the western one); a hire date in the future. `value` in days/weeks/months/years each covered | `lib/access/tenure.ts`, `tests/access/tenure.fixtures.ts`, `tests/access/tenure.test.ts` | M2.2 |
| **M2.4** | **The truth table as a test suite, written before the evaluator** | One table-driven suite reproducing the five rows of the admin console's "Who sees what" tab: no rule inherits the section and never more; two allows are an OR; an explicit deny at any level beats every allow; everything-but-tenure is LOCKED with title + unlock date + teaser and **never the body**; a parent narrower than the child wins. Plus spec §3's worked example asserted to the exact `Decision` object. Suite is red | `tests/access/truth-table.fixtures.ts`, `tests/access/evaluate.test.ts` | M2.2, M2.3 |
| **M2.5** | `lib/access/evaluate.ts` — `evaluate(subject, node, at): Decision` | M2.4 goes green with no change to the fixtures. Pure: same inputs → same output, no `Date.now()`, no `await`. Returns `reason: { ruleId, clause }` on every allow, deny and lock | `lib/access/evaluate.ts` | M2.4 |
| **M2.6** | Rule-chain resolution (the only database-touching part) | Resolves the ancestor chain root-first in **one** recursive CTE and hands the evaluator a plain array. A test asserts one query regardless of depth | `lib/access/resolve-chain.ts` | M2.5, M1.1 |
| **M2.7** | `lib/access/compile.ts` — the same rules as a SQL predicate | **Property test**: for 1,000 generated (subject, rule-chain) pairs the SQL predicate and `evaluate()` agree on `allowed`. Disagreement fails the build. This is the leak test | `lib/access/compile.ts`, `tests/access/agreement.property.test.ts` | M2.5 |
| **M2.8** | Benefits eligibility return shape | `{ eligible, eligibleOn, enrollmentOpens, enrollmentCloses, windowState }` computed from the same offsets; new-hire and fixed-annual windows use one mechanism; fixtures cover a window that opens on the eligibility date and one anchored to a calendar date | `lib/access/eligibility.ts`, `tests/access/eligibility.test.ts` | M2.3, M2.5 |
| **M2.9** | Condition builder UI — dropdown rows rendering a live sentence | **No JSON reaches the admin** (test: the rules screen renders no `<textarea>` and no `{`). Six controls per the prototype: employee type, department, role, work location, *after* (tenure), *while locked show*. Tenure presets are exactly the prototype's five, with the `60` preset carrying `then: 'first_of_next_month'` — a preset, not new semantics. Live match count comes from a server query, is never stored | `app/(admin)/admin/rules/**`, `components/rules/SentenceBuilder.tsx`, `lib/access/sentence.ts` | M2.5, M0.13 |
| **M2.10** | `POST /api/admin/access-rules/explain` | Given a rule set and a real employee or persona, returns the evaluator's `reason` rendered as the prototype's sentence, including the unlock date | `app/api/admin/access-rules/explain/route.ts`, `lib/access/explain.ts` | M2.5, M2.6 |
| **M2.11** | Preview-as with time travel — **design blocker, see §5** | A preview context is scoped, expiring, read-only; a mutation or acknowledgment attempted inside it is rejected server-side (test); the simulated date is a parameter to `evaluate`, never a global clock change | `app/api/admin/preview-as/route.ts`, `lib/access/preview-context.ts` | M2.5, M2.10 |
| **M2.12** | "What this person can see" audit (People tab) | For a selected employee, lists every node with `Visible now` / `Locked until their date` / `Hidden` and the deciding rule — produced by calling `evaluate`, never by a parallel implementation | `app/(admin)/admin/people/[id]/visibility/page.tsx` | M2.5, M2.6 |

**M2 exit:** one pure function, one property-tested SQL twin, and a rules screen an HR
lead can use. Still no employee route.

---

### M3 — The reading experience

*Ships:* summary and step-by-step guide blocks with handoff enforcement, contact
resolution chain, acknowledgment with re-acknowledgment, employee home, search,
print/PDF, mobile pass, AA audit. *Waits:* branching guides.

| ID | Task | Acceptance criterion | Files | Depends on |
|---|---|---|---|---|
| **M3.1** | Employee shell: search field, suggested queries, six tabs, head block, footer | Phone-first at 412px (24/22/32 padding), desktop 1060px (38/44/46), 44px minimum targets, zero transitions. Persona picker and device toggle are **not** built | `app/(employee)/layout.tsx`, `components/employee/*` | M0.2, M2.5 |
| **M3.2** | Access-filtered tree read: `GET /api/content/tree` | Returns lock states and unlock dates. A section with no published, permitted page is **absent**, not empty. Test: response for a locked node contains the title and teaser and does not contain any body text (byte search of the response) | `app/api/content/tree/route.ts`, `lib/content/read-tree.ts` | M2.6, M2.7 |
| **M3.3** | Content page read: `GET /api/content/pages/:slug` | Locked → teaser payload only; unpublished → 404 and not routable; never a partial body. Rendered server-side; a test asserts the RSC payload for a locked page contains no block text | `app/api/content/pages/[slug]/route.ts`, `app/(employee)/…/page.tsx` | M3.2 |
| **M3.4** | Step-by-step guide block with handoff enforcement | A guide whose last step has no named person, system or external destination cannot be published; the editor says so at the failing step, and content health counts them | `lib/content/blocks/guide.ts`, `lib/content/health/guide-handoff.ts` | M1.3, M1.5 |
| **M3.5** | Internal vs external visual language | External handoffs use `--color-accent-2`, show the destination domain, an external mark and a last-verified date; internal steps sit on paper. A component test asserts the two never share a card | `components/content/Handoff.tsx` | M3.4, M0.2 |
| **M3.6** | Personal checklist labelling | Checking a guide step renders "for your own tracking — this notifies no one and submits nothing" **next to the control**, not in a tooltip. Check state is per-user and is a row keyed `(user_id, block_id, step_index)` — a fact about a user action, not a progress rollup; no percentage is stored | migration `0301`, `components/content/StepCheck.tsx` | M3.4 |
| **M3.7** | Contact resolution chain: `GET /api/contacts/resolve` | Resolves page → topic → section → department → default HR fallback (note: the spec's list omits topic — see §4.9). Any unfilled surface is **hidden**, never an empty card (test asserts no empty card renders) | `lib/contacts/resolve.ts`, `app/api/contacts/resolve/route.ts` | M1.9, M2.5 |
| **M3.8** | Migration 0302 + acknowledgment with content-hash check | `(user_id, page_version_id)` unique; re-acknowledgment after a new publish is a **new row**, never an update. A POST whose `content_hash` does not match the stored version is rejected with a message telling the employee the page changed. Publishing a new version re-triggers acknowledgment for everyone in scope, where scope is evaluated, not stored | `lib/db/migrations/0302_*.sql`, `app/api/acknowledgments/route.ts`, `tests/ack-rehash.test.ts` | M1.6, M2.5, §4.7 |
| **M3.9** | Employee home | Derived stats, waiting-on-you items, highlights, next unlock — every one a read-time query. Empty state is the prototype's exact sentence plus the resolved HR card | `app/(employee)/page.tsx` | M3.2, M3.7, M3.8 |
| **M3.10** | Migration 0303 + search: `tsvector` + `pg_trgm`, access filter compiled into the query | The access predicate is a **join in the same query** (test asserts one round trip and asserts a locked page's body never appears in any result snippet). Typo tolerance from trigram similarity; ranking from `ts_rank_cd`; results grouped by origin (company / state / federal / documents / people) | `lib/db/migrations/0303_*.sql`, `lib/search/query.ts`, `app/api/search/route.ts` | M2.7 |
| **M3.11** | Zero-result search is never a dead end | Resolves the responsible person from department and site, pre-fills a `mailto` with the query, the reader's role and the page, states that the query is logged, and writes a `search_event` row with `result_count = 0` | `components/employee/NoResults.tsx`, `lib/search/log.ts` | M3.10, M3.7 |
| **M3.12** | Six employee tabs against real content | Home, My role, Rights and eligibility, Time and hours, Documents and contacts, Org chart placeholder. **See §4.3** — how admin-authored content is routed to these tabs is currently undefined and must be answered before this task starts | `app/(employee)/{role,rights,time,docs}/page.tsx` | M3.2, §4.3 |
| **M3.13** | Print / PDF export | Export runs through `evaluate` — a locked page exports as its teaser, never its body (test). Print stylesheet is part of Broadsheet, not a second design | `app/(employee)/…/print.css`, `lib/export/pdf.ts` | M3.3 |
| **M3.14** | Issue reporting: `POST /api/issues`, `POST /api/feedback` | A report carries the page reference and the reporter's four dimension values automatically. Resolving or dismissing **requires a reason**, and the reason is stored against the page and sent back to the reporter | migration `0304`, `app/api/issues/route.ts` | M3.3, M0.10 |
| **M3.15** | Accessibility and mobile pass | axe runs in CI over every employee route and fails the build on a violation; keyboard traversal of every flow is a test; heading order and landmarks verified; alt text enforced at upload (already M1.10) | `tests/a11y/*.spec.ts`, CI workflow | M3.1–M3.13 |
| **M3.16** | PII serialiser gate | Personal contact details, hire dates and eligibility status are filtered in `lib/serialize/` only. A test enumerates every route handler and fails if one returns a profile object not passed through the serialiser | `lib/serialize/*.ts`, `tests/pii-gate.test.ts` | M3.9 |

**MVP line.** A company can deploy, author, gate and publish; employees can read,
acknowledge and find who to ask.

---

### M4 — Import

*Ships:* DOCX and text-PDF extraction, classification, side-by-side review, unsorted
bucket, CSV people and org import. *Waits:* OCR, re-import diff.

| ID | Task | Acceptance criterion | Files | Depends on |
|---|---|---|---|---|
| **M4.1** | Migration 0401: `import_batch`, `import_item`, `import_column_map` | `import_item` carries `raw_text, confidence, proposed_kind, proposed_target, decision, became_block_id`. Add `source_anchor text` and `supersedes_item_id` now, unused until M7 — see §4.8 | `lib/db/migrations/0401_*.sql` | M1.1 |
| **M4.2** | pg-boss worker: extraction jobs, resumable per stage | Killing the worker mid-batch and restarting resumes at the last completed stage; every stage leaves an inspectable artefact | `worker/index.ts`, `worker/jobs/extract.ts` | M0.4, M4.1 |
| **M4.3** | DOCX extraction (mammoth) | Heading levels, lists, tables and images survive into the proposal. An empty extraction is **reported as a failure**, never as an empty success | `worker/extract/docx.ts` | M4.2 |
| **M4.4** | Text-PDF extraction (pdfjs-dist) | Positioned runs reconstruct tables; page count and per-page text are stored | `worker/extract/pdf.ts` | M4.2 |
| **M4.5** | Classification proposals (spec §4 table) | Each of the seven signals produces its proposal with a confidence score. Long legal prose produces a source block plus an **empty** summary block — the platform never machine-writes a published summary (test) | `worker/classify/*.ts` | M4.3, M4.4, M1.7 |
| **M4.6** | Review queue, side-by-side, unsorted bucket | Sorted low-confidence first; unclassifiable items get `proposed_target = null` and are counted as Unsorted; accept / edit / reassign / reject each recorded; **nothing publishes and nothing is discarded** | `app/(admin)/admin/imports/**` | M4.5 |
| **M4.7** | People CSV/XLSX import, four steps | File read → column mapping → row review → structure confirmation. Sensitive columns (pay, DOB, government ID) are **refused and shown as refused** with the prototype's exact refusal copy; unmapped columns discard silently; low-confidence rows carry a per-row flag and **block** import until corrected; people absent from a later upload are never auto-deleted | `app/(admin)/admin/people/import/**`, `lib/import/people.ts` | M0.13, M4.2 |
| **M4.8** | New dimensions found in a file are reviewed inline | Create / rename / skip per discovered department, role, site, type — no silent creation | `lib/import/structure.ts` | M4.7 |
| **M4.9** | Migration 0402 + `org_node` / `org_edge`, populated from `reports_to` | Reporting lines from a matched `reports_to` name are one provenance; admin hand-drawn overrides are another; **both** write to the audit log, and the employee-facing footer says which is which | `lib/db/migrations/0402_*.sql`, `lib/org/*.ts` | M4.7, M0.7 |

### M5 — Benefits and jurisdictions

| ID | Task | Acceptance criterion | Depends on |
|---|---|---|---|
| **M5.1** | Migration 0501: `benefit`, `enrollment_window` | Windows expressed relative to `eligibleOn` or a fixed annual date — one mechanism | M2.8 |
| **M5.2** | My benefits screen | The employee sees **their own dates**, from the evaluator. No generic eligibility table exists in the employee UI (grep test) | M5.1, M3.1 |
| **M5.3** | Unlock timeline as its own screen — **design blocker, see §5** | Personal chronology including not-yet-unlocked items; empty state "Everything available to you is unlocked." | M5.2 |
| **M5.4** | Eligibility-checker block | A new `block.kind` with a validator and a component — **no migration** (test asserts the diff touches no `lib/db/migrations/`) | M1.3, M2.8 |
| **M5.5** | Migration 0502: `external_resource`, `resource_category`, `external_resource_employee_type` | `employee_type_ids[]` from the spec is a join table, not an array column, so it can be joined and constrained | M0.6 |
| **M5.6** | Links and laws admin: own links, detected links, statutory topics | Nothing reaches an employee until confirmed; `status = 'suggested'` is invisible to employees (test hits the employee API); unconfirmed links are hidden rather than shown hopefully | M5.5 |
| **M5.7** | Scheduled link checks (pg-boss) | A link that errors, redirects to a new host, or passes its review interval returns to the admin queue with `status = 'broken'` and a last-checked timestamp | M5.6, M4.2 |
| **M5.8** | Org chart employee screen | Opens centred on the employee: chain above as breadcrumbs, own entry, reports, peers; whole company as an indented outline; open roles shown as openings in magenta with no contact details; "Back to me" and "Top of the company" always available. Chain, peers and reports are **computed per request** | M4.9, M3.1 |

### M6 — Admin at scale

| ID | Task | Acceptance criterion | Depends on |
|---|---|---|---|
| **M6.1** | Failed-search analytics (Gaps and health) | The failed-search list is the first thing on the screen, from `search_event` rows; the four stats above it are live queries | M3.11 |
| **M6.2** | Content health checks | Broken links, stale drafts, guides with no handoff, unverified resources, pages with no rule, contacts with no owner — each a query, each with a last-run timestamp; "Everything checks out" when all pass | M3.4, M5.7 |
| **M6.3** | Issue queue | Filter open / resolved / everything; resolving prompts for what changed or why it is not a fault and sends those words to the reporter; the resolution appends to the audit log live | M3.14 |
| **M6.4** | Audit log UI | Append-only, filterable by area (Content, Documents, People, Access, Setup), CSV export | M0.7 |
| **M6.5** | Bulk operations, find-and-replace, snippets | Bulk rule application (deliberately deferred from M2) previews the match count before applying and writes one audit event per target | M2.9 |
| **M6.6** | Delegated sub-admin scopes | A department editor can edit their own playbook and nothing else; scope is checked **per target**, not per route group (test attacks a route with a mismatched target id) | M0.6, §4.10 |
| **M6.7** | Full JSON + files export | Export contains all content with original files attached; a restore into a clean instance reproduces the tree | M1.6, M0.11 |

### M7 — Optional extras

| ID | Task | Acceptance criterion | Depends on |
|---|---|---|---|
| **M7.1** | Tesseract OCR in the worker image | Per-word confidence stored; pages under the mean-confidence floor are marked *needs a human read* and are **not** imported as text | M4.2 |
| **M7.2** | Re-import diff | Per-item diff against what was accepted last time: accept the change, keep the current version, or fork — never a silent duplicate. Uses `source_anchor` from M4.1 | M4.6, M7.1 |
| **M7.3** | Branching guides | Branch conditions reuse the access engine's condition shape rather than a second expression language | M3.4, M2.5 |
| **M7.4** | Knowledge checks | — | M3.3 |
| **M7.5** | PWA offline for published content | Only content the evaluator already allowed is cached; the cache is cleared on sign-out (test) | M3.3 |
| **M7.6** | Notifications (unlock reminders) | Reminders say what unlocks and where to go; never what somebody should choose; never sent to managers | M5.3, M0.10 |
| **M7.7** | TOTP enforcement | Secrets encrypted with a key from the environment | M0.9 |

### M8 — Assistant

| ID | Task | Acceptance criterion | Depends on |
|---|---|---|---|
| **M8.1** | Migration 0801: `content_embedding` + pgvector, created **only** when the assistant is first enabled | With the assistant off, `SELECT * FROM pg_extension WHERE extname='vector'` returns zero rows on a fresh install (test) | M1.6 |
| **M8.2** | Provider layer, admin-supplied credentials, monthly call cap | Ships with no credentials; makes no call until configured; usage estimate and cap visible in admin | M8.1 |
| **M8.3** | Filtered retrieval | The access predicate from `lib/access/compile.ts` is applied **in SQL before retrieval**. Regression test: a locked page's text is never in the retrieved set for a subject who cannot see it | M2.7, M8.1 |
| **M8.4** | Citation validation gate | A response whose citation ids are not all in the retrieved set is discarded and replaced by the handoff — enforced after generation, not by prompt wording (test with a stubbed model returning a fabricated id) | M8.3 |
| **M8.5** | Injection regression suite | A standing test document containing injected instructions; the assistant restates and locates and does not follow them. Any date it states comes from the evaluator injected as a fact | M8.4 |
| **M8.6** | Assistant surface — **design blocker, see §5** | Hidden entirely when disabled: no teaser, no upsell, route 404s | M8.4 |

---

## 2. Migration sequence, M0 and M1

Ordered. Forward-only. Every table gets `created_at timestamptz not null default now()`;
every non-append-only table gets `updated_at` and `archived_at timestamptz`. IDs are
`uuid default gen_random_uuid()` unless noted.

### M0

**`0001_extensions.sql`**
`citext`, `pg_trgm`, `pgcrypto`. **Not** `vector` — that is M8.1, created lazily.

**`0002_identity.sql`**

| Table | Key columns |
|---|---|
| `app_user` | `id`, `email citext unique not null`, `password_hash text`, `email_verified_at`, `totp_secret_enc bytea`, `status text not null check (status in ('invited','active','deactivated'))`, `is_admin boolean not null default false`, `failed_attempts int not null default 0`, `locked_until timestamptz`, `archived_at` |
| `session` | `id`, `user_id → app_user`, `token_hash bytea unique not null`, `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, `ip_hash bytea`, `user_agent text` |
| `auth_token` | `id`, `user_id`, `kind text check (kind in ('email_verify','password_reset'))`, `token_hash bytea unique`, `expires_at`, `consumed_at` |
| `invite` | `id`, `token_hash bytea unique`, `email citext null`, `scope jsonb` (dimension prefills), `created_by`, `expires_at`, `max_uses int`, `use_count int`, `revoked_at` |

`session` and `auth_token` are the only tables application code may `DELETE` from.

**`0003_dimensions.sql`** — the invariant tables. No enum, no `CHECK` on any name.

| Table | Key columns |
|---|---|
| `jurisdiction` | `id`, `level text check (level in ('federal','state','other'))`, `country_code text`, `region_code text`, `name text`, `archived_at` |
| `department` | `id`, `name text`, `slug text`, `sort_key text`, `origin text check (origin in ('scaffold','custom','import'))`, `archived_at`. Unique `(slug) where archived_at is null` |
| `role` | `id`, `department_id → department null`, `name`, `slug`, `sort_key`, `origin`, `archived_at` |
| `employee_type` | `id`, `name`, `slug`, `kind text check (kind in ('salaried','hourly','contingent','other'))` — the one soft hint the spec permits, `sort_key`, `origin`, `archived_at` |
| `location` | `id`, `name`, `slug`, `jurisdiction_id → jurisdiction null`, `timezone text not null` (IANA — see §4.5), address columns, `sort_key`, `origin`, `archived_at` |
| `employee_profile` | `user_id pk → app_user`, `display_name`, `department_id`, `role_id`, `employee_type_id`, `location_id`, `work_state_jurisdiction_id null` (spec §13 q3), `hours_per_week numeric null`, `external_employee_id text`, `employment_status text` (New hire / Onboarding / Active / On leave / Notice period — **a `status_id → employment_status` row table, not a `CHECK`**, since these are company words), `archived_at` |
| `employment_status` | `id`, `name`, `slug`, `sort_key`, `origin`, `archived_at` |
| `tenure_anchor` | `id`, `user_id → app_user`, `key text` (slug: `hire_date`, `benefits_eligibility_date`, `transfer_date`, admin-invented), `date date`, `source text check (source in ('profile','admin','import'))`, unique `(user_id, key)` |

> **Deviation to confirm.** The spec puts `hire_date` on `employee_profile` *and* mirrors
> it into `tenure_anchor`. I propose `hire_date` live **only** as `tenure_anchor` where
> `key = 'hire_date'`, with `employee_profile.hire_date` not existing. This gives the
> evaluator the one lookup path the spec asks for without a duplicated value that can
> drift. Everything that reads a hire date reads an anchor. Flagged in §4.4.

**`0004_governance.sql`**

| Table | Key columns |
|---|---|
| `admin_scope` | `id`, `user_id`, `capability text`, `scope_type text check (scope_type in ('global','department'))`, `scope_id uuid null`, `granted_by`, `granted_at`, `revoked_at`. Shape is provisional — see §4.10 |
| `audit_event` | `id bigserial`, `actor_user_id`, `actor_label text`, `action text`, `area text check (area in ('Content','Documents','People','Access','Setup'))`, `target_type text`, `target_id uuid`, `before jsonb`, `after jsonb` (both PII-redacted by the serialiser before write), `ip_hash bytea`, `at timestamptz default now()`. **`REVOKE UPDATE, DELETE ON audit_event FROM app_role` in this migration** |

**`0005_company.sql`**

| Table | Key columns |
|---|---|
| `company_setting` | `id`, `singleton boolean not null default true unique check (singleton)`, `legal_name`, `display_name`, `street`, `suite`, `city`, `postal_code`, `region`, `country_code`, `main_phone`, `enquiries_email`, `website`, `contact_name`, `contact_email`, `contact_phone`, `timezone text`, `size_band text`, `leave_year_start date`, `logo_file_id`, `accent_hex text`, `email_domain_allowlist text[]`. **Every content field nullable** — blank fields are hidden from employees, never rendered empty. **No `setup_step` column**: the checklist is a query |
| `mail_setting` | `id`, `singleton`, `host`, `port`, `secure`, `username`, `password_enc bytea`, `from_address`, `last_test_at`, `last_test_error text` |

**`0006_files.sql`**

| Table | Key columns |
|---|---|
| `file_object` | `id`, `storage_key text unique`, `original_filename`, `mime_type text` (sniffed, not from extension), `byte_size bigint`, `checksum_sha256 bytea`, `alt_text text` (required for image kinds at upload), `scan_status text`, `uploaded_by`, `archived_at` |

pg-boss creates and owns its own `pgboss` schema on first worker start; it is not in
these migrations.

### M1

**`0101_content_tree.sql`**

| Table | Key columns |
|---|---|
| `content_kind` | `id`, `name`, `slug`, `never_summarised boolean not null default false`, `sort_key`, `origin`, `archived_at`. Seeded with the prototype's six: Policy, Department playbook, Benefit, Step-by-step guide, Required posting (`never_summarised = true`), Knowledge base |
| `content_node` | `id`, `level text check (level in ('section','topic','page'))`, `parent_id → content_node null`, `depth int` (maintained by trigger, `check (depth <= 3)`), `title`, `slug`, `sort_key text`, `state text check (state in ('draft','published','archived'))`, `publish_at`, `unpublish_at`, `origin text`, `content_kind_id → content_kind null`, `help_contact_card_id null`, `review_due_at date`, `review_owner_user_id null`, `created_by`, `archived_at`. Unique `(parent_id, slug) where archived_at is null`. Trigger enforces the level ladder: a `topic`'s parent is a `section`, a `page`'s parent is a `topic` |

> **Deviation to confirm.** The spec's ER diagram draws `SECTION`, `TOPIC` and `PAGE` as
> three entities, but its "Key tables" row gives them one identical column list
> *including `parent_id`* — which only means anything if they are one table. One table
> makes the evaluator's ancestor chain a single recursive CTE and makes
> `access_rule.(target_type, target_id)` uniform across levels. If three tables are
> intended, say so before M1.1: it changes M2.6.

**`0102_blocks.sql`**

| Table | Key columns |
|---|---|
| `block` | `id`, `node_id → content_node`, `kind text` (**no `CHECK`** — a new kind must not need a migration, per spec §2), `slot text null` (only if §4.1 resolves to the fixed-slot model), `sort_key text`, `data jsonb not null`, `source_block_id null`, `source_file_id → file_object null`, `source_url text null`, `snippet_id null`, `published_at`, `published_by`, `byline_kind text null check (byline_kind in ('authored','confirmed_source'))`, `created_by`, `archived_at`. Partial constraint: `check (kind <> 'summary' or coalesce(source_block_id::text, source_file_id::text, source_url) is not null)` |
| `snippet` | `id`, `name`, `kind text`, `data jsonb`, `archived_at` |

`summary_stale` from spec §2 is **not** a column; staleness is
`source.updated_at > summary.updated_at`, computed at read time (§4.6).

**`0103_versions.sql`**

| Table | Key columns |
|---|---|
| `page_version` | `id`, `node_id → content_node`, `version_no int`, `snapshot jsonb not null` (resolved block list at publish), `content_hash bytea not null`, `published_at`, `published_by`, `effective_date date`, `note text`. Unique `(node_id, version_no)`. **No update path** |

**`0104_contacts.sql`**

| Table | Key columns |
|---|---|
| `contact_card` | `id`, `name`, `title`, `email citext`, `phone`, `extension`, `about text`, `response_time_note text`, `field_visibility jsonb` (per field: `all` / `managers` / `admins`), `department_id null`, `location_id null`, `origin`, `archived_at` |
| `contact_binding` | `id`, `card_id → contact_card`, `target_type text`, `target_id uuid`, `purpose text`, `sort_key`, unique `(card_id, target_type, target_id, purpose)` |

**`0105_node_files.sql`**

| Table | Key columns |
|---|---|
| `node_file` | `id`, `node_id → content_node`, `file_object_id → file_object`, `sort_key`, `caption text`, `archived_at` |

M1 ends here. `access_rule` is `0201` (M2); `acknowledgment`, `step_check`,
`search_event`, `issue_report`, `page_feedback` are M3; `import_*` M4; `benefit`,
`external_resource`, `org_node`, `org_edge` M5; `content_embedding` M8.

---

## 3. What I would have to guess

Specific, and short on purpose. Items 1–3 change the M1/M2 schema and need answers
before M1.1.

**3.1 — The page body model is specified three incompatible ways.**
Spec §2 says the page body is a free list of `block` rows whose `kind` picks a validator,
and §12 names the M1 kinds as *rich text, document, image, callout, contact card,
external link, table*. Spec §8 says every long document has a **fixed five-beat order**:
summary → key points → guidance → who to ask → source. The admin prototype
(`Admin Console.dc.html:1732`) defines a **fixed seven-slot template** — summary in your
own words, what it means for you, steps in order, attached documents and images, links
out, who to ask, review date and owner — three of them mandatory, and stores fill state
as a fixed seven-element array (`sections[].filled`). These are three different data
models. Which is it: a free block list, a fixed seven-slot template, or a free list whose
first five blocks are constrained by a template? I have written M1.1/M1.3 with an optional
`block.slot` column so either resolution fits, but the editor, the fill-progress
indicator and the employee page renderer all depend on the answer.

**3.2 — There is a second content tree with no schema.**
Spec §2/§8 give one hierarchy: section → topic → page, depth-capped at three. The
prototype's Documents tab has a **separate** structure — `docHeads`: admin-named headings,
each holding uploaded files and one publishable summary with a byline — and the employee's
"Documents and contacts" tab browses *those headings*, not the section tree. Meanwhile the
prototype's *"Sections and highlights"* tab treats a **section** as the leaf thing an
employee reads ("a policy, a department playbook, a benefit, a step-by-step guide, a
required posting, a knowledge-base entry"), which is the spec's **page**. So either
(a) a document heading is a `topic` whose pages are document blocks, (b) it is a `section`
and the spec's three levels collapse to two in practice, or (c) it is a fourth entity the
schema does not have. This is the largest single unknown in M1 and it also decides whether
`content_kind` sits on sections or pages.

**3.3 — Nothing routes admin-authored content to the employee guide's six tabs.**
The spec's IA (§8) is four destinations: Home, Browse, My things, Help. The prototype ships
six: Home, My role, Rights and eligibility, Time and hours, Documents and contacts, Org
chart. Four of those are *topic-shaped* — but the admin's vocabulary for content is
`content_kind` (Policy / Playbook / Benefit / Guide / Required posting / Knowledge base)
plus a per-item audience rule, and **no admin surface assigns anything to "Time and hours"
or "Rights and eligibility."** In the prototype these tabs are hand-authored persona
fixtures. Given the founding constraint that nothing is shown that an admin did not write,
either the tabs are fixed product surfaces fed by something the admin sets (a new
`surface` field on `content_node`? a mapping from `content_kind`?), or the employee shell
should be the spec's four destinations and the prototype's tabs are illustrative. M3.12
cannot start without this.

**3.4 — `hire_date` is stored twice.**
`employee_profile.hire_date` and `tenure_anchor` with `key = 'hire_date'`, described as a
mirror. Two writable copies of the value every tenure calculation depends on is the exact
shape of a silent wrong-eligibility-date bug, which §13 names as a top risk. §2 above
proposes the anchor as the only home. Confirm or reject.

**3.5 — Tenure arithmetic needs a timezone that no table has.**
§3: "All arithmetic runs in the location's timezone at local midnight; a rule must not
unlock a day early for a west-coast employee." But §2's `location` row has no timezone
column — the only timezone in the spec is the single company timezone from the setup
wizard. I have added `location.timezone` (IANA, `not null`) in `0003`. If the intent was
the company timezone, the west-coast sentence in §3 is wrong and M2.3's fixtures change.
Related: §13 q3 asks whether `work_state` is needed distinctly from location; I have added
the column nullable, but if it exists it, not `location`, may be what drives jurisdiction —
and possibly the timezone too.

**3.6 — `hours_per_week` and `groupIds[]` are rule inputs with no builder and no table.**
The `Subject` in §3 carries `groupIds[]`; no table in §2 defines a group or a membership.
The worked example's rule R2 tests `hours_per_week >= 20` — a **numeric comparison**, while
every other condition is set membership, and the prototype's condition builder has exactly
five inputs (employee type, department, role, work location, tenure) with no hours row.
So: are groups real (and if so, what creates them), and is `hours_per_week` a rule
dimension? If it is, the builder needs a numeric comparator, which is a different control
from a dropdown and changes `conditions` validation.

**3.7 — `visibility: 'preview'` contradicts the locked invariant.**
`Decision.visibility` includes `'preview'`, and the prototype's option list glosses it as
*"the whole page, marked not yet active"* (`Admin Console.dc.html:1743`). But §3 rule 6
and `CLAUDE.md` both say of a tenure-locked node that the body never reaches the client.
`preview` sends the whole body to someone who is not yet entitled to it. Either it is a
legitimate admin choice and the invariant needs the exception written down explicitly
(including what search, export and the assistant do with a `preview` node), or it should
be removed from the type. The evaluator's return type and M2.4's fixtures both depend on
this, so it has to be settled before M2 starts, not during.

**3.8 — `content_hash` has no defined canonicalisation.**
§9 says `POST /acknowledgments` carries "the `page_version_id` and content hash the client
rendered", and a mismatch is rejected. Nothing says what is hashed: the canonical JSON of
`page_version.snapshot`, the rendered text, or the visible text after access filtering.
The third would make the hash subject-dependent, which breaks the unique
`(user_id, page_version_id)` design. It must be a stable server-side canonicalisation of
the snapshot that the client can reproduce, and the canonicalisation (key order, whitespace,
which fields are included) needs to be written down once, because changing it later
invalidates every stored acknowledgment.

**3.9 — The contact resolution chain skips a level.**
§9: "page → section → department → default HR fallback". `topic` sits between page and
section in the same spec. I have assumed this is an oversight and planned
page → topic → section → department → HR (M3.7). Confirm.

**3.10 — The admin authorisation model is described three ways.**
`app_user.is_admin` (a boolean) in §2; `admin_scope` rows "granted" in §2's ER diagram;
"admin scope checked per target" in §11; and the prototype's Setup step 5, which is four
fixed admin roles (Owner, HR admin, Department editor, Auditor) × eight fixed capabilities.
A role-with-capability-matrix and a per-target grant are different tables. `0004` above
guesses per-capability rows with an optional department scope, which can express the four
roles as presets — but M6.6 is where this gets tested and M0.6 is where the table is
created, so guessing wrong costs a migration across a live instance.

**3.11 — Re-import diff has nothing to diff against.**
§4 promises a per-item diff "against what was accepted last time", but `import_item`
carries no stable identity for the same passage across two uploads of an evolving
document. M4.1 adds `source_anchor` and `supersedes_item_id` speculatively; what the anchor
is derived from (heading path? normalised first line? content hash of the raw text?) is
undefined, and picking it late means re-importing old batches produces no matches.

---

## 4. Not designed, and when it first blocks

From the spec's own screen inventory (§7), `README.md`'s "Not yet designed", and
`CLAUDE.md`'s "ask before building". Two of these block a milestone the plan already
schedules; the rest are later.

| Undesigned surface | First needed | Blocking? |
|---|---|---|
| **Admin content editor** — block-level editing with live employee preview (§7 row "Content editor") | **M1** | **Yes.** M1 ships the block model, the state machine and versioning; the editor is the only way to author any of it. Mitigation: M1 can ship the model, the API and the state-machine tests, and use the prototype's *Sections and highlights* and *Documents* tabs (which **are** designed) as the authoring surface for the kinds they cover. A general block editor with live preview is then a designed-and-built follow-on. M1.4 and M1.12 are scoped to that mitigation. |
| **Preview-as with time travel** (§7 row "Preview as") | **M2** | **Yes.** It is named in M2's *Ships* column and it is how an admin verifies a rule before publishing. M2.10 (`/explain`, which returns the reason sentence) and M2.12 (the "what this person can see" audit, which **is** designed, in the People tab) cover most of the value without a new screen. M2.11 builds only the server-side preview context — scoped, expiring, read-only, simulated date as a parameter — and the screen waits for a design. |
| **Unlock timeline as its own screen** (§7 row "Unlock timeline") | **M5** | No. Unlock dates exist inside other tabs today (Home's "next unlock", Rights' eligibility dates). M5.3 is the first task that needs the standalone chronology. |
| **Analytics beyond failed searches** — page ratings, completion (§7 row "Analytics") | **M6** | No. M6.1 ships the failed-search list, which **is** designed (Gaps and health). Page ratings and completion have no screen; M3.14 still collects the underlying feedback rows so the data exists when the screen does. |
| **AI assistant surface** (§7 row "Assistant") | **M8** | No, and it is off by default. M8.1–M8.5 are all backend and testable without a surface; M8.6 is the screen. |

Two more gaps I found that the handoff's list does not name:

| Undesigned surface | First needed | Note |
|---|---|---|
| **The employee content page itself** — the five-beat progressive-disclosure page (summary → key points → guidance → who to ask → source) with acknowledge, helpful?, report an issue and print | **M3** | The Employee Guide prototype has six tabs and a search overlay and **no page-detail route**: documents appear as rows with summaries, never as a full body with the five beats. §7 and §8 both describe this page in detail, and M3 is where an employee first reads a policy. M3.3, M3.5 and M3.13 all render into it. This needs either a design or an explicit ruling that the Documents-tab row expands in place. |
| **Employee acknowledgments history** and **external resources** as their own screens (§7 rows "Acknowledgments", "External resources") | **M3** / **M5** | Both are in the spec's screen inventory with empty-state copy; neither has a prototype screen. The Rights and eligibility tab covers some of the external-resource content, and Home shows outstanding acknowledgments, but the "own attestation history with versions attested" screen does not exist anywhere. |

---

*Stopping here. No application code written, no M0 started.*
