# Start here — building this with Claude Code

This bundle is a design + spec package, not a codebase. Below is the sequence for turning it into a working app with Claude Code, plus the exact prompts to paste.

## Order of authority

1. `designs/Platform Spec.dc.html` — engineering spec. Wins on architecture, schema, access engine, extraction pipeline, API surface, security, build sequence.
2. `README.md` (this folder) — visual and interaction truth: tokens, control patterns, copy voice, screen-by-screen behaviour.
3. `designs/*.dc.html` — the prototypes. Read them for markup, measurements and exact copy. **Do not port `support.js`.**

Where the spec and README disagree, the spec wins on behaviour, the README wins on appearance.

## Step 0 — set up the repo before writing features

```
mkdir employee-platform && cd employee-platform
git init
mkdir -p docs/design
# copy this whole handoff folder into docs/design/
cp docs/design/CLAUDE.md ./CLAUDE.md
claude
```

`CLAUDE.md` (also in this folder) holds the invariants that must survive every future session. Copy it to the repo root — Claude Code reads it automatically each session, which is what stops the access engine, soft-delete and draft/publish rules from eroding as the codebase grows.

## Step 1 — the kickoff prompt

Paste this as your first message in Claude Code:

> Read `docs/design/Platform Spec.dc.html` (paginated HTML spec — read the source), `docs/design/README.md`, and `CLAUDE.md`. Then, without writing application code yet, produce `docs/PLAN.md`: the milestone breakdown from spec §12, expanded into concrete tasks with acceptance criteria and the files each will touch. Flag anything in the spec you think is wrong or underspecified. Stop there and wait for me.
>
> Stack is fixed by the spec: Next.js App Router + TypeScript, PostgreSQL 16, Drizzle + drizzle-kit, Argon2id with opaque server sessions, S3 API (MinIO in Compose), pg-boss, `tsvector` + `pg_trgm`, mammoth + pdfjs-dist, Tesseract in the worker image, TipTap with a constrained schema, Nodemailer. Do not substitute libraries.

Review `docs/PLAN.md` yourself before you let it start building. That review is the highest-leverage half hour in this project.

## Step 2 — milestones, one session each

Run these in order. Each is a fresh session; each ends with something you can run.

**M0 — Skeleton.** Compose stack, env validation that fails loudly with variable name and example, forward-only migrations, health checks, auth (register, verify, login, reset, session list, sign-out-everywhere), the setup wizard, and the dimension tables (department, role, employee type, location) as *rows, not enums*.

> Build M0 from `docs/PLAN.md`. Migrations first, then env validation, then auth, then the wizard. Every dimension is a table an admin populates — no enum, no TS union, no CHECK constraint on company vocabulary. End with `docker compose up` working from a clean clone and a seed script that creates one admin. Do not touch content models yet.

**M1 — Content core.** Section / topic / page / block, the block types, draft→publish→archive, versioning, reorder, soft delete with restore.

> Build M1. Soft delete is universal: `archived_at`, never a `DELETE`. A summary block is draft-only until explicitly published, and publishing stamps a byline. Statutory postings are a distinct kind that the platform never summarises — an admin confirms the source instead. Add tests for the state machine before the UI.

**M2 — Access engine. Build this before any reading UI.**

> Build M2: the access evaluator as ONE pure function in ONE module, with no database access inside it — it takes a subject and a resource's resolved rule chain and returns a decision. Rules: resolve the ancestor chain root-first and a child may only narrow the parent; any matching allow suffices; an explicit deny at any level beats every allow; matching everything except tenure returns LOCKED (title + unlock date + one-line teaser, never body); tenure offsets are structured `{ anchor, unit, value, then? }`, never day counts. Write the table-driven test suite first, covering the truth table in the admin console's "Who sees what" tab, then the condition builder that renders dropdown rows as a live sentence — no JSON reaches the admin. Then `POST /admin/access-rules/explain`.

**M3 — Reading experience.** Employee guide screens, contact resolution chain, acknowledgments with content-hash check, search.

> Build M3 against the access engine — every read goes through the evaluator server-side, and the filter compiles into the search SQL rather than filtering results afterwards. Recreate the Employee Guide screens from `docs/design/Employee Guide.dc.html`: read measurements and copy off the elements, use Broadsheet tokens, phone-first at 412px, desktop at 1060px, 44px minimum tap targets, no transitions. A zero-result search resolves the responsible person, pre-fills a mailto with query + role + page, and logs the query. The persona picker and device toggle are prototype scaffolding — leave them out.

That's the MVP line: a company can deploy, author, gate and publish; employees can read, acknowledge, and find who to ask.

**M4+ — Import and extraction.** People import (four steps: file read → column mapping → row review → structure confirmation), then document extraction with OCR confidence.

> Build the people import per spec §4. Sensitive columns (pay, DOB, government ID) are refused and shown as refused; unmapped columns discard silently; rows below the confidence threshold carry a per-row flag and block import until corrected; people absent from a later upload are never auto-deleted. `reports_to` populates reporting lines where it matches a name; everything else is an admin hand-drawn override, and both are written to the audit log.

## Step 3 — what to keep checking

- **Nothing derived is ever stored.** Counts, coverage percentages, checklist marks, progress lines, org-chart chains — all computed at read time. If Claude Code adds a `status` or `progress` column, push back.
- **Access decisions happen server-side, before render.** Server components exist so a gated body never reaches the client. Grep for any page that fetches everything and hides in the browser.
- **Audit log is append-only.** No update path, no delete path.
- **The copy is designed.** Save-state sentences, empty states and removal messages in the prototypes are final text, not lorem. Removal messages state what widened or moved, not what was deleted.
- **No sans-serif, no motion, no cards used for layout.** Broadsheet's do-nots are in `docs/design/README.md`.

## Not designed yet — don't let it invent these

The AI assistant surface, the admin content editor (block-level editing with live employee preview), preview-as with time travel, the unlock timeline as its own screen, and any analytics beyond failed searches. If a milestone needs one, come back and design it.
