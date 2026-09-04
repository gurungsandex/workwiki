# Handoff: self-hosted employee information and guidance platform

## Overview

A single-tenant, self-hosted platform where one company's admin builds an employee handbook — people records, departments, documents, statutory postings, access rules — and every employee sees only the version of it that applies to their own record. Two surfaces:

- **Admin console** — eleven tabs. Configure the instance, import people, build structure, upload and publish documents, confirm links and statutory topics, chase acknowledgments, write access rules, read the content-gap signal, triage employee reports, and read the audit log.
- **Employee guide** — six tabs. A personalised handbook: home, my role, rights and eligibility, time and hours, documents and contacts, org chart. Search is the primary navigation.

The defining constraint: **the application ships knowing nothing about any company.** No departments, no roles, no policies, no jurisdictions. Everything is created by an admin, and nothing is ever shown to an employee that an admin did not write, confirm, or publish.

## About the design files

The files in `designs/` are **design references created in HTML** — interactive prototypes showing intended look, copy and behaviour. They are **not production code to copy**. Your task is to recreate these designs in the target codebase's own environment, using its established patterns, router, component library and data layer. If there is no codebase yet, pick the framework the rest of the product needs and implement there.

Concretely: the prototypes are written for a small in-house streaming-template runtime (`support.js`, `<x-dc>`, `<sc-for>`, `<sc-if>`, a `Component extends DCLogic` class with a `renderVals()` method). **Do not port that runtime.** Read `renderVals()` as "the props/derived state this screen needs" and the template as "the markup and inline styles it renders." In React, `renderVals()` is roughly a container component's computed values plus handlers; `<sc-for list>` is `.map()`; `<sc-if value>` is a conditional render.

All state in the prototypes is in-memory and seeded with realistic sample data. There is no backend. Every list, count and status line is *derived* from that state rather than hard-coded — preserve that property; it is the thing that makes the screens honest.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy and interaction states. Recreate the UI closely, using the Broadsheet tokens shipped in `designs/_ds/`. Every measurement in the prototypes is an inline style you can read directly off the element.

The one deliberate exception: there is **no imagery**. Photographs, avatars and org-chart headshots are absent on purpose — supply real assets or leave the slots out.

---

## The design system: Broadsheet

`designs/_ds/broadsheet-.../styles.css` is the source of truth and is linked by both prototypes. `readme.md` beside it is the system's own guide. Summary of what matters when rebuilding:

- **Newsprint.** Near-black serif on paper white. Hierarchy comes from the type scale and whitespace — **not** from cards, borders or dividers. Do not "boxify" these screens; the only rules present are 1px row separators (`border-top: 1px solid var(--color-neutral-300)`) inside lists, and they are the pattern used everywhere.
- **One typeface**, Source Serif 4, for headings and body, including UI chrome. Do not introduce a sans-serif.
- **Cyan is interactive; magenta is the rarer second spot color** used for attention (outstanding, unconfirmed, flagged, open role). Never both accents inside one small component.
- **Left-aligned, asymmetric.** Content hugs the left; reading measures are capped in `ch` (`max-width: 62ch` for body paragraphs, `64–66ch` for long notes).
- **Focus is always visible**: `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`.

### Design tokens (exact values)

Colors:

| Token | Value |
| --- | --- |
| `--color-bg` | `#f3f2f2` |
| `--color-surface` | `#eae9e9` |
| `--color-text` | `#201e1d` |
| `--color-accent` (cyan) | `#0088b0` |
| `--color-accent-2` (magenta) | `#d6006c` |
| `--color-process-yellow` | `#edbb00` (print treatments only, never chrome) |

Ramps, 100 → 900, all generated in OKLCH on one shared lightness scale:

- neutral: `#f8f4f4`, `#eae7e7`, `#d7d3d3`, `#bab6b6`, `#9b9797`, `#7d7979`, `#605d5d`, `#444141`, `#2d2b2b`
- accent (cyan): `#e9f8ff`, `#cbeeff`, `#99e0ff`, `#62c5ee`, `#38a6cf`, `#1186ac`, `#006786`, `#004961`, `#0a303e`
- accent-2 (magenta): `#fff1f4`, `#ffdee6`, `#ffc0d0`, `#ff90b1`, `#ff458e`, `#d82071`, `#aa0b56`, `#790e3d`, `#4b1528`

Usage rules actually followed by these screens:
- Body-size text in an accent uses the **700** step (`--color-accent-700` `#006786`, `--color-accent-2-700` `#aa0b56`) — the base accents only clear 3:1 and are for icons, large text and chrome.
- Tinted fills use 100–300 (e.g. active route card: `background: var(--color-accent-100)`; jurisdiction chips: `--color-accent-2-100` fill, `--color-accent-2-300` border).
- Secondary body copy: `--color-neutral-700`. Metadata and captions: `--color-neutral-600`. Row rules: `--color-neutral-300`. Dashed drop zones: `--color-neutral-400`.

Type — one family, `"Source Serif 4", system-ui, sans-serif`; heading weight 600, body 400, true italic at 400. Sizes as used (px):

| Role | Desktop | Phone |
| --- | --- | --- |
| Page title (h1) | 34 (admin) / 39 (employee) | 29 |
| Section heading (h2) | 24 (admin) / 25 (employee) | 21 |
| Sub-heading (h3) | 19–21 | 19 |
| Lead paragraph | 15 / 1.58 | 15 |
| Body | 13.5–14.5 / 1.5–1.6 | same |
| Row title | 15–17 / 1.3 | same |
| Metadata | 12–13 | same |
| Eyebrow / kicker | 10–11.5, `letter-spacing: 0.13–0.14em`, uppercase, `--color-neutral-600` | same |
| Big derived figure | 27 / 1.1 | same |

Spacing: `--space-1..8` = 5, 10, 15, 20, 30, 40px (density 1.25×). In practice the screens use 6/8/10/14/18/22/26/34/40/44px directly — read them off the elements. Do not tighten.

Radius: `--radius-sm` 1px, `--radius-md` 2px, `--radius-lg` 4px. Controls use 2px; **nothing is pill-shaped or heavily rounded.**

Shadows: `--shadow-sm` `0 1px 2px rgba(45,43,43,.14)`, `--shadow-md` `0 3px 10px rgba(45,43,43,.16)`, `--shadow-lg` (used once, on the console sheet). The page sits on `--color-neutral-200`; the working sheet is `--color-bg` with `--shadow-lg`.

### Recurring control patterns

- **Tab bar** — text buttons, `font-size: 14.5px`, `padding: 9px 2px 12px`, `border-bottom: 2px solid var(--color-accent)` when active and `transparent` otherwise; inactive label `--color-neutral-600`, active `--color-text`. Container has `border-bottom: 1px solid var(--color-neutral-300)`.
- **Pill filter** — `font-size: 12.5px; padding: 6px 12px; border-radius: 2px; border: 1px solid`. Active: accent border + accent fill + white text. Inactive: `--color-neutral-300` border, transparent fill, `--color-neutral-700` text.
- **Primary button** — `font-size: 14px; padding: 9px 16px`, accent border and fill, white text, square (2px).
- **Secondary button** — same geometry, `--color-neutral-400` border, transparent fill, `--color-neutral-700` text.
- **Inline action** — a bare `<button>` styled as an underlined link: `background: none; border: none; padding: 0; font-size: 12.5px`, `--color-accent-700`, or `--color-accent-2-700` for destructive.
- **Field** — `<label>` column with an uppercase 11.5px eyebrow, then `input`/`select` at `font-size: 14px; padding: 8px 10px; border: 1px solid var(--color-neutral-400); background: var(--color-bg); border-radius: 2px`, then an optional 12px helper line.
- **List row** — `display: grid` with a fixed first column (`132px`, `150px`, `210px`) and `1fr`, `gap: 6px 22px`, `padding: 13–14px 0`, `border-top: 1px solid var(--color-neutral-300)`. **Never a card.**
- **Card** — reserved for genuinely discrete pickable items (industry starting points, setup routes): `text-align: left; padding: 14px 16px; border: 1px solid` accent-or-neutral-300, tinted `--color-accent-100` when selected.
- **Drop zone** — `border: 1px dashed var(--color-neutral-400); padding: 22–26px`.

---

## Screens

Everything below exists in the prototypes. Read the named tab in the named file for the exact markup.

### Admin console — `designs/Admin Console.dc.html`

Shell: a sticky dark bar (`--color-text` background, `--color-neutral-100` text, 10px/20px padding) carrying the company display name, an "Admin" eyebrow, a live jurisdiction line, a save-state string, and a link to the employee view. Below it, a centred sheet (`max-width: 1180px`, `--color-bg`, `--shadow-lg`) with the tab bar, a 34/30/40px content pad, and a footer rule with two links.

Every tab renders the same three-part head: uppercase kicker, 34px title, 15px lead paragraph — all three keyed off the active tab.

**1. Setup.** Six numbered steps.
- *1 · How do you want to start?* Two route cards. **Route A** — start from the standard template. **Route B** — start from documents you already have. The choice is not a mode: it only decides what step 4 shows, is switchable at any time, and a toggle at the foot of step 4 opens both routes at once. Copy insists on this explicitly.
- *2 · The company itself.* Twelve text fields (registered legal name, display name, street, suite, city, postal code, main phone, enquiries email, website, first-contact name/email/phone) plus four selects (country, main region, timezone, size band, leave-year start). Each field carries a helper line naming the employee-facing surface it feeds; required-but-empty helpers turn magenta. A live progress line counts filled required fields and states that the rest of setup does not wait for them. Two actions: save (writes an audit entry) and "fill this in later". Blank fields are **hidden** from employees, never rendered as empty cards.
- *3 · Where else do you employ people?* Country + region select, "add this state", chips per added jurisdiction with a scaffolded-topic count and a remove ×. Adding a jurisdiction creates **unconfirmed** topic scaffolds only.
- *4 · What fills the instance.* Route A: nine industry starting-point cards, plus a derived line reporting exactly what the choice created. Route B: a drop zone (PDF/Word/Excel/Google exports/photos/scans), a sample set, then one row per file showing what extraction **proposes** — including an OCR-confidence flag on a scan and a spreadsheet rerouted to the people import — an accept action that moves them into Documents as unpublished drafts, and a "start with nothing at all" escape.
- *5 · Who administers it.* Four admin roles (Owner, HR admin, Department editor, Auditor) × eight capabilities, each toggleable, with a derived note.
- *6 · What is left to do.* A checklist derived from what exists in the instance — never from a stored step number.

**2. People.** Four-step import (file read → column mapping → row review → structure confirmation) accepting .xlsx/.xls/.pdf/.docx/Sheets exports. Sensitive columns (pay, DOB, ID) are **refused and shown as refused**; unmapped columns discard silently. Low-confidence rows carry a per-row flag and must be corrected before import. New departments/roles/sites/types found in the file are reviewed inline — create, rename or skip. People absent from an upload are **never** auto-deleted. Then: the roster with per-person overrides and a "what this person can see" audit; an add-person form; a **Reporting lines and open roles** panel (per-person manager select, every change written to the audit log as a hand-drawn override; open roles as title + department + site, no pay or candidate data); and a *Removed people* archive with restore and purge.

**3. Departments and roles.** Departments → roles, plus employee types and sites. Rename and remove anything; removal messages state what widened or moved rather than what was deleted.

**4. Starter library.** Skeleton documents to copy as drafts. Copying creates the standard blocks with **the summary left blank** — stated in the copy as a deliberate refusal to put words in the admin's mouth.

**5. Sections and highlights.** Sections with the same five standard blocks, a fill-progress indicator, per-section audience rules, and the employee home-screen highlights.

**6. Documents.** Upload; build headings (a five-heading outline offered **once**, then free-form add/rename/reorder/remove); attach files per heading; per-heading summary that can be drafted from the files, must be edited by hand, and is **draft until explicitly published** (with a "not published" state and a byline stamped on publish). Required postings get a different byline: the admin confirms the source, and the platform never summarises them. *Removed files and headings* archive.

**7. Links and laws.** Three views: your own links, links detected inside your documents (offered as candidates), and statutory topics per jurisdiction. Nothing reaches an employee until confirmed; unconfirmed links are hidden rather than shown hopefully.

**8. Reminders and reading.** Acknowledgment coverage counted **against the people each policy actually reaches**, with outstanding people named; and upcoming dated entitlements with a lead time and channel.

**9. Who sees what.** The access-rule builder: rows of dropdowns compose into a rendered sentence, with a live match count and a truth table of evaluation outcomes (no rule inherits; two allows are an OR; an explicit deny always wins; everything-but-tenure is *locked*, not denied; a parent narrower than a child wins).

**10. Gaps and health.** Four derived stats, the failed-search list (the content-gap list), and content-health checks derived from real state.

**11. Reports and audit.** Issue queue — each employee report arrives with its page reference and the reporter's four filter values; filter open/resolved/everything; resolving prompts for what changed (or why it is not a fault) and sends those words back to the reporter. Audit log — append-only, filterable by area (Content, Documents, People, Access, Setup), CSV export; issue resolutions and company-detail saves append to it live.

### Employee guide — `designs/Employee Guide.dc.html`

Shell: a persona picker and a phone/desktop toggle (prototype scaffolding — **not** part of the product), then the employee shell: a search field, suggested queries, six tabs, a head block, and a footer with "report something out of date" and "print this page".

Phone-first. Phone width 412px with 24/22/32px padding; desktop 1060px with 38/44/46px. Minimum tap target 44px.

**Search** is the primary navigation and is always on screen. It is typo-tolerant, intent-matched, reads titles, summaries, page bodies and document text, and groups results by where the answer comes from (company policy / state law / federal law). **A no-result search is never a dead end**: it resolves the named person whose job it is to answer, pre-fills a mailto with the query, the role and the page, and states that the query is logged for whoever maintains the handbook.

**Home** — derived stats, waiting-on-you items, highlights, next unlock.
**My role** — responsibilities with a cadence and who checks each; and an explicit *not yours* list.
**Rights and eligibility** — three sources in one list (company, state, federal), each with a verdict, a verdict note, what it is, how to claim it, a named source and a verified date.
**Time and hours** — accrual, hours, breaks, overtime, with the origin of each rule named and the stronger rule identified.
**Documents and contacts** — documents grouped under the admin's **published** headings with their summaries and bylines, plus outstanding counts and an "everything else" fallback for unfiled documents; then resolved contacts, each with a "find them in the org chart" link.
**Org chart** — the whole company; everyone can see everyone. Opens centred on the employee: the chain above them as tappable breadcrumbs, then their own entry (title, department, site, employee type, on-leave, dotted-line reporting both directions, email and phone), then who reports to them and who sits alongside them. Tapping any name moves the view. Search matches name, title, department or site. Beneath, the whole company as an indented outline, every row tappable, with the focused row in cyan. Open roles appear as openings (magenta, no contact details, "Unfilled position" when focused) rather than being hidden. "Back to me" and "Top of the company" are always available. Reporting lines come from the import's `reports_to` column where it matched a name and from admin hand-drawn overrides otherwise — the footer says so and points at the report link.

---

## Interactions and behavior

- Tabs, filter pills, route cards, persona and device toggles: instant, no animation. This system has **no transitions or motion** — do not add any.
- Hover on inline actions: underline is always present; color steps one accent step (`--color-accent-600`). Keyboard focus: the 2px accent `:focus-visible` ring, everywhere, including bare `<button>` inline actions.
- Every mutation writes a short human sentence into the console's save-state slot in the top bar (e.g. "Company details saved — contacts and dates now resolve from them"). These strings are part of the design; keep their voice.
- Destructive actions are **soft**: people, sections, files and headings move to a per-tab *Removed* archive with restore and purge. Nothing is hard-deleted from the UI.
- Rename and remove prompts use `window.prompt` in the prototype — replace with the codebase's dialog (`.dialog-backdrop` + `.dialog` exists in Broadsheet).
- Resolving a report and dismissing a report both **require a reason**, and the reason is shown against the page and sent to the reporter.
- Empty states are specific, never generic: "No open reports.", "Nothing removed.", "Nobody by that name, title, department or site.", "Nobody else reports to the same person.", "No section asks for an acknowledgment yet."

## State management

The prototypes hold one flat state object per surface. Grouped by concern, the admin console needs:

- **Setup**: `startPath` (`template` | `scratch`), `bothRoutes`, `co` (12 text fields), `coTz`, `coSize`, `coYear`, `coSaved`, `country`, `pendingState`, `states[]`, `industry`, `seeds[]`.
- **Structure**: `depts[]` (each with `roles[]`), `types[]`, `sites[]`, plus draft fields for each add form.
- **People**: `people[]` (name, dept, role, type, site, start, status, `overrides[]`, `hidden[]`), `mgrOf{}`, `openRoles[]`, `intake` + `intakeMap` / `intakeDecisions` / `intakeEdits` / `structDecisions`, `dateOrder`.
- **Content**: `sections[]`, `uploads[]`, `docHeads[]` (name, files, summary, drafted, published), `links[]`, `laws[]`, `detectedTaken{}`, `outlineDismissed`.
- **Governance**: `issues[]` (page, kind, what, who, whoLine, when, status, outcome), `issueFilter`, `auditAdds[]`, `auditFilter`, `adminRole`, `perms{}`, `acked` / `nudged`, `remindLead` / `remindChannel` / `remindOn`.
- **Archives**: `arcPeople[]`, `arcSections[]`, `arcDocs[]`.
- **Chrome**: `tab`, `saved`.

The employee guide needs: `persona` (prototype only), `tab`, `device` (prototype only), `query`, `filter`, `acked{}`, `focus` (org-chart node id), `orgQuery`.

**Everything else is derived, and should stay derived** — counts, coverage percentages, progress lines, checklist marks, the jurisdiction line, "what this person can see", the org chart's chain / peers / reports / outline. In the real app these are server-computed reads; the important property is that no status string is ever stored.

### The one piece of real logic

`Platform Spec.dc.html` §3 specifies the access engine as **one pure function in one place**, called by the UI, the search query, the PDF export and the assistant's retriever alike. Its rules, which the prototypes assume:

1. Resolve the ancestor chain root-first; a child can only narrow the parent. Access narrows down the tree, never widens.
2. Any matching allow rule is enough; an explicit deny beats every allow at any level.
3. Everything matching except tenure means **locked, not denied** — the employee sees the title, the unlock date and a one-line teaser, never the body.
4. Tenure offsets are structured (`{ anchor, unit, value, then? }`), never a day count.

Build this before the reading experience. Retrofitting gating into pages built to render everything is how leaks ship.

## Data model, API, security, build order

`designs/Platform Spec.dc.html` is the engineering specification and takes precedence over this README on anything it covers: architecture, the full schema and indexes, the access engine, the extraction pipeline, deployment, journeys, the API surface, the optional assistant's rules, the security posture, and the recommended build sequence. Open it in a browser — it is a paginated document and prints cleanly.

## Assets

None. No images, icons, avatars or logos are used. Broadsheet specifies **Phosphor icons, duotone weight** if you need iconography (https://phosphoricons.com) — the prototypes deliberately use none. Source Serif 4 loads from Google Fonts via `@import` in `styles.css`; self-host it in production.

## Not yet designed

From the spec's own screen inventory: the org chart is done, but the **optional AI assistant** surface, the **admin content editor** (block-level editing with live employee preview), and **preview-as with time travel** have no designs. The unlock timeline exists as dates inside other tabs rather than its own screen, and analytics stops at failed searches — no page ratings or completion. Do not invent these; ask.

## Building this

`CLAUDE_CODE_START.md` in this folder is the implementation runbook: repo setup, the kickoff prompt, one prompt per milestone (M0 skeleton → M1 content core → M2 access engine → M3 reading experience → M4 import), and what to keep checking. `CLAUDE.md` beside it is meant to be copied to the new repo's root — it carries the invariants that must survive every later session.

## Files

| File | What it is |
| --- | --- |
| `CLAUDE_CODE_START.md` | Implementation runbook and milestone prompts |
| `CLAUDE.md` | Repo-root invariants file — copy to the new codebase |
| `designs/Admin Console.dc.html` | The admin console prototype, all eleven tabs |
| `designs/Employee Guide.dc.html` | The employee guide prototype, all six tabs, phone and desktop |
| `designs/Platform Spec.dc.html` | The engineering specification — schema, access engine, API, build order |
| `designs/support.js` | The prototype runtime. **Reference only — do not port.** |
| `designs/doc-page.js` | Paged-document component used by the spec document |
| `designs/_ds/broadsheet-.../styles.css` | Broadsheet tokens and component classes — the source of truth for the look |
| `designs/_ds/broadsheet-.../readme.md` | Broadsheet's own guide: direction, do's and don'ts |
| `designs/_ds/broadsheet-.../_ds_bundle.js` | Compiled design-system bundle the prototypes load |

Open either prototype directly in a browser; both are self-contained apart from the `_ds/` folder beside them.
