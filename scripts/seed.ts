/**
 * Seed.
 *
 * By default this creates exactly one thing: the first administrator, so a
 * fresh deployment can be signed into. `--demo` additionally writes a clearly
 * labelled demo set — no live external URLs, and removable in one action with
 * `--remove-demo`.
 *
 *   npm run seed -- --email you@example.com --password '…'
 *   npm run seed -- --demo
 *   npm run seed -- --remove-demo
 */
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/db/client';
import {
  accessRules,
  blocks,
  contactBindings,
  contactCards,
  departments,
  employeeProfiles,
  employeeTypes,
  instance,
  locations,
  orgNodes,
  pages,
  roles,
  sections,
  tenureAnchors,
  topics,
  users,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/auth/password';
import { publishPage } from '../src/lib/content/mutations';
import { keyBetween } from '../src/lib/sort-key';
import { exitOnConfigError, loadDatabaseUrl } from '../src/env';

// Seeding writes to the database and sends no mail and stores no file.
try {
  loadDatabaseUrl();
} catch (error) {
  exitOnConfigError(error);
}

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const has = (name: string) => args.includes(`--${name}`);

const DEMO_PREFIX = 'demo-';

async function seedAdmin(): Promise<string> {
  const email = (arg('email') ?? 'admin@example.com').toLowerCase();
  const password = arg('password') ?? 'change this password today';

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    process.stdout.write(`Admin ${email} already exists.\n`);
    return existing.id;
  }

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(password),
      status: 'active',
      isAdmin: true,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });

  await db
    .insert(instance)
    .values({ id: 1, displayName: 'Your company', timeZone: 'UTC' })
    .onConflictDoNothing();

  process.stdout.write(`Created admin ${email}.\n`);
  if (!arg('password')) {
    process.stdout.write('  Password: "change this password today" — change it before anybody else signs in.\n');
  }
  return user!.id;
}

/**
 * Removable in one action. The order matters: people reference the dimensions,
 * rules reference the pages, and the platform never hard-deletes anything an
 * admin wrote — only rows this script created, all of which carry the prefix.
 */
async function removeDemo(): Promise<void> {
  const demoPages = await db.select({ id: pages.id }).from(pages).where(like(pages.slug, `${DEMO_PREFIX}%`));
  const demoTopics = await db.select({ id: topics.id }).from(topics).where(like(topics.slug, `${DEMO_PREFIX}%`));
  const demoSections = await db.select({ id: sections.id }).from(sections).where(like(sections.slug, `${DEMO_PREFIX}%`));

  const targets = [
    ...demoPages.map((row) => row.id),
    ...demoTopics.map((row) => row.id),
    ...demoSections.map((row) => row.id),
  ];
  if (targets.length > 0) {
    await db.delete(accessRules).where(inArray(accessRules.targetId, targets));
  }

  // People first: their profiles reference the dimensions below.
  await db.delete(users).where(like(users.email, '%@demo.invalid'));

  await db.delete(pages).where(like(pages.slug, `${DEMO_PREFIX}%`));
  await db.delete(topics).where(like(topics.slug, `${DEMO_PREFIX}%`));
  await db.delete(sections).where(like(sections.slug, `${DEMO_PREFIX}%`));

  const demoCards = await db.select({ id: contactCards.id }).from(contactCards).where(like(contactCards.label, 'Demo — %'));
  if (demoCards.length > 0) {
    await db.delete(contactBindings).where(inArray(contactBindings.cardId, demoCards.map((row) => row.id)));
    await db.delete(contactCards).where(inArray(contactCards.id, demoCards.map((row) => row.id)));
  }

  await db.delete(roles).where(like(roles.slug, `${DEMO_PREFIX}%`));
  await db.delete(departments).where(like(departments.slug, `${DEMO_PREFIX}%`));
  await db.delete(employeeTypes).where(like(employeeTypes.slug, `${DEMO_PREFIX}%`));
  await db.delete(locations).where(like(locations.slug, `${DEMO_PREFIX}%`));

  process.stdout.write('Demo set removed. Anything you wrote yourself is untouched.\n');
}

async function seedDemo(adminId: string): Promise<void> {
  const [engineering] = await db
    .insert(departments)
    .values({ name: 'Demo — Field Operations', slug: `${DEMO_PREFIX}field-operations` })
    .onConflictDoNothing()
    .returning({ id: departments.id });

  const [fullTime] = await db
    .insert(employeeTypes)
    .values({ name: 'Demo — Full-time', slug: `${DEMO_PREFIX}full-time`, kind: 'salaried' })
    .onConflictDoNothing()
    .returning({ id: employeeTypes.id });

  const [partTime] = await db
    .insert(employeeTypes)
    .values({ name: 'Demo — Part-time', slug: `${DEMO_PREFIX}part-time`, kind: 'hourly' })
    .onConflictDoNothing()
    .returning({ id: employeeTypes.id });

  const [site] = await db
    .insert(locations)
    .values({
      name: 'Demo — Newark yard',
      slug: `${DEMO_PREFIX}newark-yard`,
      region: 'New Jersey',
      country: 'United States',
      timeZone: 'America/New_York',
    })
    .onConflictDoNothing()
    .returning({ id: locations.id });

  if (!engineering || !fullTime || !partTime || !site) {
    process.stdout.write('Demo set is already here.\n');
    return;
  }

  const [card] = await db
    .insert(contactCards)
    .values({
      label: 'Demo — People and Payroll',
      personName: 'Demo contact',
      roleTitle: 'People lead',
      email: 'people@demo.invalid',
      responseTime: 'within two working days',
      fieldVisibility: {},
    })
    .returning({ id: contactCards.id });
  await db.insert(contactBindings).values({ cardId: card!.id, targetType: 'instance', targetId: null, purpose: 'help' });

  const [section] = await db
    .insert(sections)
    .values({
      title: 'Demo — Pay and benefits',
      slug: `${DEMO_PREFIX}pay-and-benefits`,
      lead: 'A clearly labelled demo set. Remove it with `npm run seed -- --remove-demo`.',
      sortKey: keyBetween(null, null),
      state: 'published',
      origin: 'scaffold',
      helpContactCardId: card!.id,
    })
    .returning({ id: sections.id });

  const [topic] = await db
    .insert(topics)
    .values({
      sectionId: section!.id,
      title: 'Demo — Health cover',
      slug: `${DEMO_PREFIX}health-cover`,
      sortKey: keyBetween(null, null),
      state: 'published',
      origin: 'scaffold',
    })
    .returning({ id: topics.id });

  const openNow = await db
    .insert(pages)
    .values({
      topicId: topic!.id,
      title: 'Demo — What the plan covers',
      slug: `${DEMO_PREFIX}what-the-plan-covers`,
      teaser: 'What is covered, what it costs you, and when it starts.',
      sortKey: keyBetween(null, null),
      state: 'draft',
      origin: 'scaffold',
      requiresAcknowledgment: true,
    })
    .returning({ id: pages.id });

  const locked = await db
    .insert(pages)
    .values({
      topicId: topic!.id,
      title: 'Demo — Enrolling in the plan',
      slug: `${DEMO_PREFIX}enrolling-in-the-plan`,
      teaser: 'The steps, and who to hand each one to.',
      sortKey: keyBetween(null, null),
      state: 'draft',
      origin: 'scaffold',
    })
    .returning({ id: pages.id });

  await db.insert(blocks).values([
    {
      pageId: openNow[0]!.id,
      kind: 'summary',
      sortKey: 'a',
      data: {
        text: 'The company pays most of the premium for you, and about half for anyone you add. Cover starts on your first day.',
        label: 'This is a plain-language summary. The plan document governs.',
      },
      sourceUrl: 'https://example.invalid/demo-plan-document',
      publishedAt: new Date(),
      publishedBy: adminId,
      bylineKind: 'summarised',
    },
    {
      pageId: openNow[0]!.id,
      kind: 'key_points',
      sortKey: 'b',
      data: {
        points: [
          'Cover starts on your first day — there is no waiting period on this one.',
          'Adding a partner or child changes what comes out of each pay packet.',
          'Changing plan outside open enrolment needs a qualifying life event.',
        ],
      },
    },
    {
      pageId: locked[0]!.id,
      kind: 'steps',
      sortKey: 'a',
      data: {
        steps: [
          { text: 'Check which plan you are on today.', external: false },
          { text: 'Decide whether anyone is being added.', external: false },
          { text: 'Send the completed form to People and Payroll.', external: false },
        ],
        handoff: { kind: 'internal', label: 'People and Payroll' },
      },
    },
  ]);

  await publishPage({ pageId: openNow[0]!.id, actorUserId: adminId });
  await publishPage({ pageId: locked[0]!.id, actorUserId: adminId });

  // One rule of each shape the truth table names, so the demo shows the point:
  // this one is locked, not denied, until the person has been here 90 days.
  await db.insert(accessRules).values({
    targetType: 'page',
    targetId: locked[0]!.id,
    effect: 'allow',
    conditions: { employeeType: [fullTime.id, partTime.id], tenure: { anchor: 'hire_date', unit: 'day', value: 90 } },
    visibilityWhenLocked: 'teaser',
  });

  const hireDate = new Date();
  hireDate.setUTCDate(hireDate.getUTCDate() - 10);
  const hireDateIso = hireDate.toISOString().slice(0, 10);

  const [employee] = await db
    .insert(users)
    .values({ email: 'newstarter@demo.invalid', status: 'invited' })
    .returning({ id: users.id });
  await db.insert(employeeProfiles).values({
    userId: employee!.id,
    displayName: 'Demo — a new starter',
    departmentId: engineering.id,
    employeeTypeId: fullTime.id,
    locationId: site.id,
    hireDate: hireDateIso,
    hoursPerWeek: '40',
  });
  await db.insert(tenureAnchors).values({ userId: employee!.id, key: 'hire_date', date: hireDateIso });
  await db.insert(orgNodes).values({ userId: employee!.id, lineOrigin: 'override' }).onConflictDoNothing();

  process.stdout.write('Demo set written. Everything in it is prefixed “Demo — ” and removable in one action.\n');
}

if (has('remove-demo')) {
  // Removing the demo set is not a reason to create an administrator.
  await removeDemo();
} else {
  const adminId = await seedAdmin();
  if (has('demo')) await seedDemo(adminId);
}
process.exit(0);
