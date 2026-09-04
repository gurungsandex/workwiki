import postgres from 'postgres';
import { hash } from '@node-rs/argon2';

/**
 * Creates ONE admin and nothing else.
 *
 * No departments, no roles, no sections, no policies, no jurisdictions. The
 * platform ships knowing nothing about any company, and this script must not be
 * the place that quietly changes that. tests/security/seed.test.ts asserts it.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('\nCannot seed: DATABASE_URL is not set.\n\n');
    process.exit(1);
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    process.stderr.write(
      '\nCannot seed: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set.\n' +
        '      There is no default password: a known one on a self-hosted\n' +
        '      instance is an open door.\n' +
        '      example:  SEED_ADMIN_EMAIL=you@example.com \\\n' +
        '                SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)" npm run seed\n\n',
    );
    process.exit(1);
  }
  if (password.length < 12) {
    process.stderr.write('\nCannot seed: SEED_ADMIN_PASSWORD must be at least 12 characters.\n\n');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    const existing = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM app_user WHERE is_admin`;
    if (Number(existing[0]!.n) > 0) {
      process.stdout.write('An admin already exists. Nothing to do.\n');
      return;
    }

    const passwordHash = await hash(password, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await sql.begin(async (tx) => {
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO app_user (email, password_hash, status, is_admin, email_verified_at)
        VALUES (${email}, ${passwordHash}, 'active', true, now())
        RETURNING id`;
      const displayName = email.split('@')[0] ?? email;
      await tx`
        INSERT INTO employee_profile (user_id, display_name)
        VALUES (${user!.id}::uuid, ${displayName})`;
      await tx`
        INSERT INTO tenure_anchor (user_id, key, date, source)
        VALUES (${user!.id}::uuid, 'hire_date', current_date, 'admin')`;
      await tx`
        INSERT INTO audit_event (actor_user_id, action, area, target_type, target_id)
        VALUES (${user!.id}::uuid, 'setup.seed_admin', 'Setup', 'app_user', ${user!.id}::uuid)`;
    });

    process.stdout.write(`Created one admin: ${email}\nNothing else was created.\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\nSeed failed: ${e instanceof Error ? e.message : String(e)}\n\n`);
  process.exit(1);
});
