# Employee information and guidance platform

Self-hosted, single-tenant. One deployment, one company, one database. The application ships knowing nothing about any company: no departments, no roles, no policies, no jurisdictions. Everything is created by an admin, and **nothing is ever shown to an employee that an admin did not write, confirm, or publish.**

Design and spec live in `docs/design/`. `Platform Spec.dc.html` is authoritative on behaviour and architecture; `README.md` is authoritative on appearance and copy; the `.dc.html` prototypes are references — their runtime (`support.js`) is never ported.

## Stack (fixed — do not substitute)

Next.js App Router + TypeScript · PostgreSQL 16 · Drizzle + drizzle-kit (forward-only migrations) · Argon2id with opaque server-side sessions · S3 API, MinIO in Compose · pg-boss · `tsvector` + `pg_trgm` · pgvector only if the assistant is enabled · mammoth + pdfjs-dist · Tesseract in the worker image · TipTap with a constrained schema · Nodemailer over SMTP.

## Invariants

**Dimensions are rows, not enums.** Department, role, employee type and location are admin-populated tables. Never an enum, a TypeScript union, a `CHECK` constraint, or a migration to add a company's vocabulary.

**The access engine is one pure function in one module.** No database access inside it. It takes a subject and a resolved rule chain, returns a decision. Called by the UI, search, PDF export and the assistant's retriever alike — never reimplemented at a call site.

- Ancestor chain resolves root-first; a child may only narrow the parent. Access narrows down the tree, never widens.
- Any matching allow is enough. An explicit deny at any level beats every allow.
- Matching everything except tenure is **LOCKED, not denied**: title, unlock date and a one-line teaser reach the client. The body never does.
- Tenure offsets are structured `{ anchor, unit, value, then? }` — never a day count.

**Access is decided server-side before render.** Never fetch everything and hide it in the browser. Files are never public: every fetch proxies an access-checked route.

**Nothing derived is stored.** Counts, coverage, progress, checklist state, org-chart chains and status strings are computed at read time. No `status`/`progress`/`percent_complete` columns.

**Deletes are soft.** `archived_at` and a restore path everywhere — people, sections, files, headings. Purge is a separate, explicit, audited action.

**Drafts are draft until published.** A per-heading summary may be drafted from source files but must be hand-edited, and stays unpublished until an admin publishes it, which stamps a byline. Required statutory postings are never summarised by the platform — the admin confirms the source, and that produces a different byline.

**The audit log is append-only.** No update path, no delete path. Reporting-line overrides, company-detail saves and issue resolutions all append.

**Import safety.** Sensitive columns (pay, date of birth, government ID) are refused and *shown as refused*. Unmapped columns discard silently. Low-confidence rows are flagged per row and block import until corrected — never silently dropped. People absent from a later upload are never auto-deleted.

**Employee-facing gaps are hidden, not empty.** A blank company field, an unconfirmed link, an unpublished summary: absent from the employee view. Never an empty card.

## Look and feel — Broadsheet

Newsprint: near-black Source Serif 4 on paper white. Hierarchy from the type scale and whitespace.

- One typeface, including UI chrome. **No sans-serif.**
- Cyan `#0088b0` is interactive; magenta `#d6006c` is the rarer attention color. Never both in one small component. Body-size accent text uses the 700 step.
- **No transitions, no motion, no animation.**
- Do not structure the page with rules, borders or boxes. The only rule is a 1px `--color-neutral-300` row separator inside lists. `.card` is reserved for genuinely discrete pickable items, never layout.
- Radius is 2px. Nothing is pill-shaped.
- `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` everywhere, including bare `<button>` inline actions.
- Full token table and every control pattern: `docs/design/README.md`.

## Copy

The prototypes' text is final, not placeholder. Keep the voice: save-state confirmations say what now works ("Company details saved — contacts and dates now resolve from them"); removal messages say what widened or moved, not what was deleted; empty states are specific, never generic. Resolving or dismissing an employee report requires a reason, and that reason goes back to the reporter.

## Not designed — ask before building

AI assistant surface · admin content editor with live employee preview · preview-as with time travel · unlock timeline as its own screen · analytics beyond failed searches.
