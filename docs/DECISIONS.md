# Decisions

`docs/PLAN.md` §3 listed what the spec leaves ambiguous. This file records the
call made on each one and why, so a later session changes them deliberately
rather than by drift.

Where a decision departs from the spec's literal text, that is stated.

---

## 1. The page body is a free block list with an optional slot

**The ambiguity.** Spec §2 describes a free list of `block` rows whose `kind`
picks a validator. Spec §8 describes a fixed five-beat page order (summary →
key points → guidance → who to ask → source). The admin prototype defines a
fixed seven-slot template and stores fill state as a seven-element array.

**Decision.** `block` is a free list, per §2, which is authoritative on
architecture. `block.slot` is an optional column carrying one of the five beats;
a partial unique index enforces at most one block per slot per node. The employee
renderer orders slotted blocks into the five beats and appends unslotted ones.

**Why.** This satisfies all three readings at once. The block registry stays in
code — adding a kind adds a validator and a component, never a migration, which
is the property §2 exists to protect. The fixed order is a render concern, not a
storage concern, so changing the page shape later does not migrate anyone's data.

---

## 2. One content tree, not two

**The ambiguity.** The spec has section → topic → page. The prototype's Documents
tab has a *separate* structure of admin-named headings holding files and a
publishable summary, and the employee's "Documents and contacts" tab browses
those headings rather than the section tree.

**Decision.** One `content_node` table. A document heading is a **topic** whose
pages carry `document` blocks and a `summary` block. Files attach to nodes via
`node_file`.

**Why.** Two parallel trees would need two access-rule target types, two
ancestor-chain resolvers and two versions of every leak test — and the leak
surface is exactly where a second implementation is most expensive. The spec's
own key-table listing gives section, topic and page an identical column list
*including `parent_id`*, which only means anything if they are one table.

**Departs from the spec's diagram**, which draws three entities.

---

## 3. `visibility: 'preview'` is not implemented

**The ambiguity.** `Decision.visibility` in spec §3 includes `'preview'`, and the
admin prototype glosses it as *"the whole page, marked not yet active"*. But §3
rule 6 and `CLAUDE.md` both say the body of a tenure-locked node never reaches
the client.

**Decision.** `LockedVisibility` is `'hidden' | 'teaser'`. The database CHECK on
`access_rule.visibility_when_locked` permits only those two.

**Why.** The invariant is unambiguous and is the product's core safety property.
`preview` would send a body to somebody not yet entitled to it, and would need
its own answers for what search, export and the assistant do with such a node —
none of which the spec gives. Adding it later is a migration and a type change;
shipping it wrongly is a leak.

**Departs from the spec's type.** If `preview` is genuinely wanted, it needs a
written rule for every read surface first.

---

## 4. `hire_date` lives only in `tenure_anchor`

**The ambiguity.** The spec puts `hire_date` on `employee_profile` *and* mirrors
it into `tenure_anchor`, describing the mirror as giving the evaluator one lookup
path.

**Decision.** There is no `employee_profile.hire_date`. The hire date is
`tenure_anchor` with `key = 'hire_date'`.

**Why.** One lookup path is the stated goal; two writable copies of the value
every eligibility date depends on is the opposite of that. Spec §13 names a
silent wrong eligibility date as a top risk, and a drifting mirror is how one
happens.

**Departs from the spec's key-table listing.**

---

## 5. `location` carries an IANA timezone

**The ambiguity.** Spec §3 requires tenure arithmetic to run "in the location's
timezone at local midnight", but §2's `location` has no timezone column; the only
timezone in the spec is the single company one from the setup wizard.

**Decision.** `location.timezone` is `NOT NULL`, defaulting to `'UTC'`. The
evaluator's `Subject.timezone` resolves location first, then the company setting.

**Why.** Without it the sentence "a rule must not unlock a day early for a
west-coast employee" is unimplementable. Verified: the same rule for a Los
Angeles and a New York employee produces unlock instants three hours apart, and
the western one is always later.

---

## 6. `hours_per_week` is a rule dimension; groups are a table

**The ambiguity.** The spec's `Subject` carries `groupIds[]` with no table
defining groups, and its worked example tests `hours_per_week >= 20` — a numeric
comparison — while the prototype's builder has only five set-membership
dropdowns.

**Decision.** Both are real. `RuleConditions.hoursPerWeek` is a
`{ op, value }` numeric comparison; `employee_group` and
`employee_group_member` back `groupIds`, matched by slug.

**Why.** The spec's own worked example does not evaluate correctly without
`hours_per_week`, and `Subject` does not type-check without groups. The condition
builder needs a numeric control for hours, which is noted as outstanding UI work.

---

## 7. `content_hash` covers the canonical JSON of the version snapshot

**The ambiguity.** Spec §9 says an acknowledgment carries "the content hash the
client rendered" and that a mismatch is rejected, but never says what is hashed.

**Decision.** sha256 over `JSON.stringify` of the `page_version.snapshot` with
object keys sorted at every depth, `undefined` dropped, `null` preserved and no
insignificant whitespace. Pinned in `lib/content/canonical.ts`.

**Why.** It cannot be the access-filtered view: that would make the hash
subject-dependent, and the schema requires uniqueness per `(user, version)`.
It cannot be the rendered HTML: markup changes on a redeploy would invalidate
every stored attestation. Changing this later invalidates every acknowledgment,
so it is one documented function with tests.

---

## 8. The contact chain includes `topic`

Spec §9 lists "page → section → department → default HR fallback", skipping the
`topic` level that its own hierarchy defines. Read as an oversight; the
implemented chain is page → topic → section → department → location → default HR.

---

## 9. The employee shell is the spec's four destinations

**The ambiguity.** Spec §8 gives four destinations (Home, Browse, My things,
Help). The prototype ships six, four of which are *topic*-shaped: My role,
Rights and eligibility, Time and hours, Org chart.

**Decision.** Four destinations, built. The four topic-shaped tabs are **not**
built.

**Why.** Nothing in the admin console routes authored content to "Time and
hours" or "Rights and eligibility". In the prototype those tabs are hand-written
persona fixtures. Building them would mean either inventing a routing concept the
spec does not have, or showing employees words no admin wrote — which is the one
thing the product exists not to do. This needs a design decision before it can be
built honestly; see `docs/PLAN.md` §3.3.

The org chart is a real screen with a real design, but it depends on the M4/M5
people-import and `org_node` work and is out of the MVP scope shipped here.

---

## 10. Admin authorisation is per-capability with an optional department scope

The spec describes `user.is_admin`, `admin_scope` rows, and per-target scope
checks; the prototype shows four fixed roles × eight capabilities. `admin_scope`
is modelled as capability rows with an optional department scope, which can
express the four roles as presets. Only the coarse `is_admin` check is enforced
in this milestone; delegated sub-admin scopes are M6.
