import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * One deployment, one company, one database.
 *
 * Two rules govern this file and are enforced by tests and CI:
 *
 *  - **Dimensions are rows, not enums.** Department, role, employee type and
 *    location are admin-populated tables. There is no enum, no TypeScript
 *    union and no CHECK constraint anywhere that names a company's vocabulary.
 *    The `text` columns below that *are* constrained hold platform vocabulary
 *    (a lifecycle state, a rule effect) — never a company's.
 *  - **Nothing derived is stored.** There is no `status`, `progress`,
 *    `percent_complete` or `coverage` column. Every count, percentage and
 *    status string in the product is computed at read time.
 */

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
/** Deletes are soft, everywhere. Purge is a separate, explicit, audited action. */
const archivedAt = () => timestamp('archived_at', { withTimezone: true });

/* ------------------------------------------------------------------ instance */

/** Singleton: the company this deployment is for. Enforced by a one-row CHECK. */
export const instance = pgTable('instance', {
  id: smallint('id').primaryKey().default(1),
  legalName: text('legal_name'),
  displayName: text('display_name'),
  street: text('street'),
  suite: text('suite'),
  city: text('city'),
  region: text('region'),
  postalCode: text('postal_code'),
  country: text('country'),
  mainPhone: text('main_phone'),
  enquiriesEmail: text('enquiries_email'),
  website: text('website'),
  firstContactName: text('first_contact_name'),
  firstContactEmail: text('first_contact_email'),
  firstContactPhone: text('first_contact_phone'),
  timeZone: text('time_zone').notNull().default('UTC'),
  sizeBand: text('size_band'),
  leaveYearStart: text('leave_year_start'),
  accentColor: text('accent_color'),
  logoFileId: uuid('logo_file_id'),
  /** Optional allowlist of email domains permitted to register. */
  emailDomainAllowlist: jsonb('email_domain_allowlist').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* --------------------------------------------------------------- people */

export const users = pgTable(
  'user',
  {
    id: id(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    totpSecretEnc: text('totp_secret_enc'),
    /** Platform lifecycle, not a company's vocabulary. */
    status: text('status').notNull().default('invited'),
    isAdmin: boolean('is_admin').notNull().default(false),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('user_email_key').on(t.email)],
);

export const departments = pgTable(
  'department',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    origin: text('origin').notNull().default('admin'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('department_slug_key').on(t.slug)],
);

export const roles = pgTable(
  'role',
  {
    id: id(),
    departmentId: uuid('department_id').references(() => departments.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('role_slug_key').on(t.slug)],
);

export const employeeTypes = pgTable(
  'employee_type',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** A soft hint only, used to pick defaults in the rule builder. */
    kind: text('kind').notNull().default('other'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('employee_type_slug_key').on(t.slug)],
);

export const locations = pgTable(
  'location',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    region: text('region'),
    country: text('country'),
    /** Access dates resolve at local midnight here. */
    timeZone: text('time_zone'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('location_slug_key').on(t.slug)],
);

/** Ad-hoc audiences an admin can put people into, orthogonal to the dimensions. */
export const groups = pgTable(
  'group',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('group_slug_key').on(t.slug)],
);

export const groupMembers = pgTable(
  'group_member',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const employeeProfiles = pgTable(
  'employee_profile',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    departmentId: uuid('department_id').references(() => departments.id),
    roleId: uuid('role_id').references(() => roles.id),
    employeeTypeId: uuid('employee_type_id').references(() => employeeTypes.id),
    locationId: uuid('location_id').references(() => locations.id),
    hireDate: date('hire_date'),
    hoursPerWeek: numeric('hours_per_week', { precision: 5, scale: 2 }),
    workEmail: text('work_email'),
    workPhone: text('work_phone'),
    onLeave: boolean('on_leave').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('employee_profile_department_idx').on(t.departmentId),
    index('employee_profile_location_idx').on(t.locationId),
  ],
);

/**
 * Every date a rule may count from, built-in or admin-invented, sits here — so
 * the evaluator has exactly one lookup path. `hire_date` is mirrored in.
 */
export const tenureAnchors = pgTable(
  'tenure_anchor',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    date: date('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** The org chart. A node with no user is an open role, shown as an opening. */
export const orgNodes = pgTable(
  'org_node',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id'),
    title: text('title'),
    departmentId: uuid('department_id').references(() => departments.id),
    locationId: uuid('location_id').references(() => locations.id),
    /** How the line got here: 'import' from a matched reports_to, or 'override'. */
    lineOrigin: text('line_origin').notNull().default('override'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [index('org_node_parent_idx').on(t.parentId), uniqueIndex('org_node_user_key').on(t.userId)],
);

/** Dotted lines, in both directions. */
export const orgEdges = pgTable(
  'org_edge',
  {
    id: id(),
    fromNodeId: uuid('from_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    toNodeId: uuid('to_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('dotted'),
  },
  (t) => [unique('org_edge_unique').on(t.fromNodeId, t.toNodeId, t.kind)],
);

/* --------------------------------------------------------------- sessions */

export const sessions = pgTable(
  'session',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sliding expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Absolute cap, never extended. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('session_token_hash_key').on(t.tokenHash), index('session_user_idx').on(t.userId)],
);

/** Single-use, expiring tokens: verification, password reset, invite redemption. */
export const authTokens = pgTable(
  'auth_token',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** Invite scoping: which dimensions the redeemed profile starts with. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    email: citext('email'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('auth_token_hash_key').on(t.tokenHash), index('auth_token_user_idx').on(t.userId, t.purpose)],
);

/** Per-account and per-IP counters behind the login, reset and redeem limits. */
export const rateLimits = pgTable(
  'rate_limit',
  {
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    count: integer('count').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key] })],
);

/* --------------------------------------------------------------- content */

export const sections = pgTable(
  'section',
  {
    id: id(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    lead: text('lead'),
    sortKey: text('sort_key').notNull(),
    state: text('state').notNull().default('draft'),
    /** 'scaffold' is inert data. No query branches on it, and no code tests a slug. */
    origin: text('origin').notNull().default('admin'),
    helpContactCardId: uuid('help_contact_card_id'),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    unpublishAt: timestamp('unpublish_at', { withTimezone: true }),
    reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('section_slug_key').on(t.slug)],
);

export const topics = pgTable(
  'topic',
  {
    id: id(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    lead: text('lead'),
    sortKey: text('sort_key').notNull(),
    state: text('state').notNull().default('draft'),
    origin: text('origin').notNull().default('admin'),
    helpContactCardId: uuid('help_contact_card_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('topic_slug_key').on(t.slug), index('topic_section_idx').on(t.sectionId)],
);

export const pages = pgTable(
  'page',
  {
    id: id(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    /** The one line an employee sees while the page is locked. */
    teaser: text('teaser'),
    sortKey: text('sort_key').notNull(),
    state: text('state').notNull().default('draft'),
    origin: text('origin').notNull().default('admin'),
    /** A required statutory posting is never summarised by the platform. */
    kind: text('kind').notNull().default('page'),
    requiresAcknowledgment: boolean('requires_acknowledgment').notNull().default(false),
    effectiveDate: date('effective_date'),
    helpContactCardId: uuid('help_contact_card_id'),
    reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('page_slug_key').on(t.slug), index('page_topic_idx').on(t.topicId)],
);

export const blocks = pgTable(
  'block',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** Selects a validator and a renderer. Adding a kind adds neither table nor migration. */
    kind: text('kind').notNull(),
    sortKey: text('sort_key').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    sourceBlockId: uuid('source_block_id'),
    sourceFileId: uuid('source_file_id'),
    sourceUrl: text('source_url'),
    /** A summary is draft until an admin publishes it; publishing stamps a byline. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    /** 'summarised' or 'confirmed' — a confirmed statutory source reads differently. */
    bylineKind: text('byline_kind'),
    summaryStale: boolean('summary_stale').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [index('block_page_idx').on(t.pageId)],
);

/** Acknowledgments point here, never at the live page. */
export const pageVersions = pgTable(
  'page_version',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    contentHash: text('content_hash').notNull(),
    effectiveDate: date('effective_date'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [unique('page_version_no_unique').on(t.pageId, t.versionNo), index('page_version_page_idx').on(t.pageId)],
);

export const acknowledgments = pgTable(
  'acknowledgment',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageVersionId: uuid('page_version_id')
      .notNull()
      .references(() => pageVersions.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
  },
  (t) => [uniqueIndex('acknowledgment_user_version_key').on(t.userId, t.pageVersionId)],
);

/* --------------------------------------------------------------- access */

export const accessRules = pgTable(
  'access_rule',
  {
    id: id(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    effect: text('effect').notNull(),
    conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    visibilityWhenLocked: text('visibility_when_locked').notNull().default('teaser'),
    priority: integer('priority').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [index('access_rule_target_idx').on(t.targetType, t.targetId)],
);

/* --------------------------------------------------------------- contacts */

export const contactCards = pgTable(
  'contact_card',
  {
    id: id(),
    label: text('label').notNull(),
    personName: text('person_name'),
    roleTitle: text('role_title'),
    email: text('email'),
    phone: text('phone'),
    responseTime: text('response_time'),
    note: text('note'),
    /** Per-field: 'all' | 'managers' | 'admins'. Enforced in the serialiser. */
    fieldVisibility: jsonb('field_visibility')
      .$type<Record<string, 'all' | 'managers' | 'admins'>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    departmentId: uuid('department_id').references(() => departments.id),
    locationId: uuid('location_id').references(() => locations.id),
    orgNodeId: uuid('org_node_id').references(() => orgNodes.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
);

/** Cards are embedded by reference, so a changed number changes everywhere. */
export const contactBindings = pgTable(
  'contact_binding',
  {
    id: id(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => contactCards.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    purpose: text('purpose').notNull().default('help'),
  },
  (t) => [
    unique('contact_binding_unique').on(t.cardId, t.targetType, t.targetId, t.purpose),
    index('contact_binding_target_idx').on(t.targetType, t.targetId),
  ],
);

/* --------------------------------------------------------------- files */

export const files = pgTable(
  'file',
  {
    id: id(),
    /** Random object key. Never derived from the filename. */
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    /** Sniffed from the bytes, never trusted from the extension. */
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    altText: text('alt_text'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    scanState: text('scan_state').notNull().default('pending'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [uniqueIndex('file_storage_key_key').on(t.storageKey)],
);

/* --------------------------------------------------------------- telemetry */

/** Every search, including — especially — the ones that found nothing. */
export const searchEvents = pgTable(
  'search_event',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    query: text('query').notNull(),
    resultCount: integer('result_count').notNull(),
    departmentId: uuid('department_id').references(() => departments.id),
    roleId: uuid('role_id').references(() => roles.id),
    locationId: uuid('location_id').references(() => locations.id),
    employeeTypeId: uuid('employee_type_id').references(() => employeeTypes.id),
    createdAt: createdAt(),
  },
  (t) => [index('search_event_created_idx').on(t.createdAt)],
);

export const issueReports = pgTable(
  'issue_report',
  {
    id: id(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    /** 'open' | 'resolved' | 'dismissed'. Both closures require a reason. */
    state: text('state').notNull().default('open'),
    outcome: text('outcome'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('issue_report_state_idx').on(t.state)],
);

export const pageFeedback = pgTable(
  'page_feedback',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    helpful: boolean('helpful').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('page_feedback_user_page_key').on(t.userId, t.pageId)],
);

export const bookmarks = pgTable(
  'bookmark',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

/** Append-only. The app role holds INSERT and SELECT here and nothing else. */
export const auditEvents = pgTable(
  'audit_event',
  {
    id: id(),
    /*
     * Deliberately not a foreign key: `ON DELETE SET NULL` is an UPDATE, and
     * this table refuses updates. An audit row keeps the actor's id even after
     * that account is purged — see migration 0003.
     */
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    area: text('area').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    summary: text('summary').notNull(),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    ipHash: text('ip_hash'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_event_at_idx').on(t.at), index('audit_event_area_idx').on(t.area)],
);
