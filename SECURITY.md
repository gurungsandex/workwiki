# Security posture

What is enforced, how it is verified, and what an operator still has to do.

## The property that matters most

An employee must never learn the contents of a page they are not entitled to —
through the UI, search, an export, a file URL, or an API edge. Spec §13 names
this as the highest-severity failure in the system.

Three things defend it:

1. **One evaluator.** `lib/access/evaluate.ts` is a single pure function with no
   database, network or clock inside it. Every read path calls it. There is no
   second implementation at a call site.
2. **A property-tested SQL twin.** Search must filter before ranking and paging,
   so the rules also exist as a SQL predicate (`lib/access/compile.ts`).
   `tests/access/agreement.test.ts` drives 500 generated rule trees through both
   at seven evaluation instants and fails the build on any divergence.
3. **Defence in depth.** `readPage` re-checks with the pure evaluator before a
   body is fetched at all, so even a wrong predicate cannot release content.

**The agreement test was mutation-tested, not assumed.** Seven deliberate
regressions were injected and each failed the build: deny-bypass,
child-widens-parent, lock-treated-as-allowed, locked-node-reported-full,
unlock-date-dropped, month-arithmetic-not-clamping, timezone-ignored. An earlier,
sparser generator missed the deny-bypass; it was strengthened until it caught it.

`tests/security/leak.test.ts` plants a canary string in a gated body and asserts
byte-wise that it appears in no tree, page, search result or acknowledgment
response, across tenure-locked, denied, unpublished and permitted states.

## Authentication

| Surface | Posture |
| --- | --- |
| Passwords | Argon2id, parameters from config, recorded in the encoded hash. Login transparently rehashes when the configured cost is raised. Minimum length 12, no composition rules. |
| Sessions | Opaque 256-bit tokens, stored as sha256, compared in constant time. `__Host-` prefixed cookie, `HttpOnly; Secure; SameSite=Lax`. Sliding 12-hour expiry with a 30-day absolute cap. |
| Revocation | A delete. Sign-out-everywhere is one statement. Deactivating a user takes effect on their **next request**, because the session lookup joins on `status`. |
| Enumeration | Login returns one message for an unknown address and a wrong password, and runs a dummy Argon2id verify when the user does not exist so the timing matches. |
| Brute force | Per-identity and per-IP counters in Postgres. Progressive delay from the soft limit (5 for login), hard refusal at 10 in a 15-minute window. Semantics pinned by `tests/security/rate-limit.test.ts`. |

## Authorisation

- Decided **server-side before render**. Server components and route handlers
  call the evaluator; a gated body is never sent to a browser to be hidden.
- Unpublished and hidden are both `404`, identical to a slug that never existed,
  so an employee cannot probe for draft titles.
- An employee hitting an admin route is **redirected**, not `403`'d: admin
  surfaces are not advertised to people who cannot use them.
- Files are never public. `GET /api/files/:id` checks the rules on every node a
  file is attached to and only then issues a 60-second signed URL. A file
  attached to nothing is admin-only. A tenure-locked page's attachment stays
  withheld, because a full decision is required, not merely a visible one.

## Transport and browser

- CSP with a per-request nonce, set in `middleware.ts`. No `unsafe-inline` and
  no `unsafe-eval` in production; `object-src 'none'`, `base-uri 'none'`,
  `frame-ancestors 'none'`.
- HSTS (2 years, `includeSubDomains; preload`), `X-Content-Type-Options`,
  `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, a restrictive
  `Permissions-Policy`, and COOP/CORP set to same-origin.
- CSRF: the session cookie is `SameSite=Lax`, and every mutating request must
  additionally carry a same-origin `Origin` header. A missing `Origin` on a
  mutation is refused.
- Every access-filtered response is `Cache-Control: no-store, private`, and every
  content route is server-rendered on demand — nothing gated is ever statically
  cached.

## Data handling

- **PII** — personal contact details, hire dates, government identifiers and
  credentials — is redacted by key name in `lib/serialize/redact.ts`, which is
  applied inside the audit writer rather than at call sites, so a new caller
  cannot leak a phone number by forgetting.
- Client IPs are never stored in the clear. They are keyed-hashed with
  `SESSION_SECRET` before being written to the audit log or the rate limiter.
- Contact cards carry per-field visibility (`all` / `managers` / `admins`),
  applied in the resolver — the single place contact responses are built.
- **Uploads** are sniffed from content, never trusted from the extension; capped
  at 50 MB; stored under random keys; served only through the access-checked
  route with `Content-Disposition: attachment` at rest.

## Enforced by the database, not by application code

A trigger or constraint, so neither an ORM bug nor a hand-written query can get
past it. Each was verified by attempting the bad write:

- `audit_event` rejects `UPDATE` and `DELETE`.
- `page_version` and `acknowledgment` reject `UPDATE`.
- Content depth is capped at three; a fourth level is rejected at insert.
- A `summary` block cannot exist without a source; a published one cannot exist
  without a byline.
- An issue cannot be resolved or dismissed without a reason.
- Only one row can be the default HR contact; only one `company_setting` exists.

`scripts/check-invariants.ts` runs in CI and fails the build on: a stored
derived column, a hard delete of content, an audit mutation, a CSS transition or
animation, a sans-serif font, a company-vocabulary literal in code, or a read of
`access_rule` outside `lib/access/`. Its own coverage was verified by injecting
one violation of each class.

## What the operator must still do

1. **Run behind a TLS-terminating reverse proxy and set `TRUST_PROXY=true`.**
   With it off there is no client IP, so only the per-identity rate limit
   applies and an attacker who varies the email address is limited only by
   that. This is the single most important deployment step.
2. **Set `SESSION_SECRET` and `ENCRYPTION_KEY` to 32 random bytes each**
   (`openssl rand -hex 32`). The server refuses to start without them.
3. **Change the MinIO credentials.** The compose file ships
   `minioadmin/minioadmin` for a local evaluation. MinIO's API port is not
   published to the host, but the credentials must change before any real use.
4. **Back up.** `pg_dump` plus the object bucket. Disk encryption is the
   deployment's responsibility; full-database encryption is not claimed.
5. **Review `npm audit` on upgrade.** Production dependencies currently carry no
   known vulnerability and CI fails if that changes. Four moderate advisories
   remain in `drizzle-kit`'s bundled `esbuild` (a dev-server issue, dev-only,
   never in the shipped image); downgrading to `drizzle-kit@0.18` to clear them
   would be a large regression, so they are accepted and tracked instead.

## Not yet built

These are known gaps, not oversights:

- TOTP columns exist; enrolment and enforcement are M7.
- ClamAV scanning of uploads (`file_object.scan_status` exists, always
  `pending`) is M7.
- Delegated sub-admin scopes: `admin_scope` exists, but only the coarse
  `is_admin` check is enforced. M6.
- Email verification and password reset flows have tables and token handling but
  no routes yet.
- The AI assistant is off, ships with no credentials, and has no code path.
  pgvector is deliberately not installed until it is enabled.

## Reporting

Open a private security advisory on the repository rather than a public issue.
