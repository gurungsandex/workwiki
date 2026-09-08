# Security review

A review of this codebase against the posture in `docs/design/Platform Spec.dc.html`
§11, plus the findings that came out of it and what was done about each.

The threat this product exists to prevent is narrower and sharper than "an
attacker gets in": **an employee learning the contents of a page their own
record does not entitle them to.** That is the failure the architecture is
shaped around, and it is where the review spent most of its time.

## Posture

| Surface | What is done |
| --- | --- |
| Passwords | Argon2id, parameters in configuration (`ARGON2_*`), rehashed on sign-in when they are raised. Minimum length over composition rules, plus a bundled breach list checked on set. |
| Sessions | Opaque 256-bit tokens; only a SHA-256 of the token is stored. `HttpOnly`, `SameSite=Lax`, `Secure` and the `__Host-` prefix when `APP_BASE_URL` is HTTPS. Sliding expiry (14 days) inside an absolute cap (90 days) that is never extended. Revocation is a row update; "sign out everywhere" is one query. |
| Brute force | Per-account and per-IP counters in Postgres, with a progressive delay applied before the answer is given. Account lockout after repeated failures. Failure messages never say whether an address exists. |
| CSRF | Two independent checks on every mutation: the request `Origin` (or `Referer`) must match `APP_BASE_URL`, and a double-submit token must match, compared in constant time. |
| Authorisation | One evaluator, called server-side before render. Admin routes are guarded at the layout and again in every action. Nothing reads `access_rule` except the evaluator and the SQL predicate compiled from it. |
| Uploads | Type sniffed from the leading bytes, never trusted from the extension; ZIP-based Office formats resolve only to the ZIP-based types we accept. 25 MB cap. Random object keys. Served only through an access-checked route that issues a short-lived signed URL, with `Content-Disposition: attachment`. The bucket has no public policy. |
| PII | Contact fields carry per-field visibility, enforced in one serialiser rather than at each route. Audit diffs are redacted by key name. IP addresses are never stored — a keyed hash is. |
| Transport | HSTS when served over HTTPS; strict nonce-based CSP with `strict-dynamic`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'none'`; `nosniff`; `Referrer-Policy: same-origin`; a restrictive `Permissions-Policy`. |
| Audit | Append-only in the database: triggers raise on `UPDATE`, `DELETE` and `TRUNCATE`. |
| Data at rest | Disk encryption is the deployment's responsibility and is documented as such. Full-database encryption is not claimed. |

## Findings, and what was done

Each of these was found during the review of code written in this same pass,
and each is fixed in the tree.

### 1. An invitation could take over an existing account — **critical**

`register` looked up the submitted address, and if an account already existed
it *updated that account's password hash* and signed the caller in. An
invitation issued without an address attached could therefore be redeemed
against any colleague's email and would reset their password.

**Fixed.** An invitation may now only land on an account that has never been
claimed — no password hash and status `invited`, which is exactly the
roster-added case the flow is for. Anything else is refused with "There is
already an account for that address. Sign in, or reset the password instead."

### 2. Sign-in leaked account existence through timing — **moderate**

When no account matched, the code verified the password against a hard-coded
string that is not a valid Argon2id hash. Verification failed immediately,
while a real account cost a full Argon2id verification — a timing oracle for
"does this address have an account here", which every other message in the flow
is careful not to answer.

**Fixed.** A real Argon2id hash of an unknown value is computed once per
process and verified against when no account matches, so both paths cost the
same.

### 3. A locked page disclosed its version identity — **low**

`loadPage` fetched and returned the current `page_version` id and content hash
even when the decision was *locked*. Neither reveals the body, but a content
hash is a fingerprint: it would let a locked-out employee tell whether a page
had changed, and confirm two pages were identical. A locked page is entitled to
a title, an unlock date and one line, and nothing else.

**Fixed.** The version is not read at all unless the decision allows the body.

### 4. Every inline style was about to be blocked in production — **would break the product**

The CSP set `style-src` to `'self'` plus a nonce, with no `style-src-attr`.
Element style attributes fall back to `style-src`, so in production every
inline measurement in the Broadsheet screens would have been dropped and the
layout would have collapsed — a class of bug that never appears in development,
where `'unsafe-inline'` was permitted.

**Fixed.** `style-src-elem` stays nonce-gated for stylesheets and `<style>`
elements; `style-src-attr 'unsafe-inline'` permits element style attributes,
which cannot execute script. `script-src` is untouched and remains
nonce-gated.

### 5. The freshly minted CSRF token never reached the first render — **would break the product**

The middleware minted the CSRF cookie and set it on the response, but the
forwarded request headers were built before the mutation, so a first-time
visitor's page rendered with an empty token and every form on it failed its own
check. Found by driving the real sign-in form in a browser.

**Fixed.** The mutated cookie jar is forwarded explicitly on the request that
minted it.

### 6. Purging a user was impossible — **low, but a data-protection obligation**

`audit_event.actor_user_id` was a foreign key with `ON DELETE SET NULL`. That
is an `UPDATE`, which the append-only trigger correctly refused — so a purge
could never complete. Rewriting history to satisfy a purge is the wrong trade
anyway.

**Fixed** (migration `0003`). The column keeps the id and is no longer a
foreign key: history survives the purge, and the admin UI resolves the actor's
name where it still can.

### 7. The rule builder's live match count was O(people) queries — **availability**

`matchCount` loaded each employee's subject with its own set of queries, on
every render of the "Who sees what" tab. At a few hundred employees that is a
page that times out.

**Fixed.** `loadAllSubjects()` builds every subject in three queries.

### 8. Search had no rate limit — **availability**

A limit was defined and never applied. Full-text search with a compiled access
predicate is not free.

**Fixed.** The limit is consumed on the search page, and a client over it gets
a plain sentence.

### 9. The company accent colour was interpolated into a stylesheet

It is validated as a hex colour when saved, but the render path trusted
whatever was in the database.

**Fixed.** Validated again where it is interpolated, so the value never leaves
that file unchecked.

## Tests that exist to keep this true

- `tests/access-engine.test.ts` — the truth table the admin console publishes,
  the specification's worked example, and the locked-not-denied distinction.
- `tests/access-sql.test.ts` — the SQL predicate and the pure evaluator must
  agree on 400 randomly generated rule sets. This is the leak test for search.
- `tests/leaks.test.ts` — a locked page yields no blocks and no version; a
  denied page and a nonexistent page are the same 404; locked, denied and draft
  pages stay out of search and out of the outstanding-acknowledgment list; an
  acknowledgment with the wrong content hash is refused; the audit log refuses
  update, delete and truncate; archive and restore leave nothing deleted.
- `tests/dates.test.ts` — month clamping, DST, timezone boundaries, and that a
  rule does not unlock a day early for somebody on a western clock.
- `e2e/auth.spec.ts` — signed-out routes redirect, generic failures stay
  generic, invented tokens are refused.
- `e2e/guide.spec.ts` — the security headers, the session cookie flags, and a
  cross-origin mutation being refused.
- `npm run check:no-slug-literals` — fails the build if application code starts
  branching on a company's vocabulary.

## Deliberately out of scope

- **TOTP** is modelled in the schema (`totp_secret_enc`, encrypted with
  `ENCRYPTION_KEY`) and not implemented. M7.
- **ClamAV** scanning of uploads: the schema carries `scan_state` and the file
  route refuses anything marked `infected`, but no scanner is wired in. Document
  extraction lands in M4 and the scanner belongs with it.
- **The assistant** is not built. The highest-severity failure in the system
  would be an employee learning the contents of a locked page through it, which
  is why its retrieval filter is specified in SQL and why it is not being
  approximated here.
- **Full-database encryption** is not claimed. Disk encryption is the
  deployment's responsibility.
- **Dependency advisories.** CI runs `npm audit --omit=dev --audit-level=high`.
  At the time of writing, production dependencies are clean; `drizzle-kit`
  carries moderate advisories through `@esbuild-kit`, and it is a build-time
  tool that is not present in the runtime image.
