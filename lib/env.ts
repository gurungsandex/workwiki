import { z } from 'zod';

/**
 * Environment is validated before the server listens. A missing or malformed
 * variable exits with the variable name, the expected shape and an example —
 * never a stack trace (spec §5, "Boot").
 */

const example = {
  BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://workwiki:workwiki@localhost:5432/workwiki',
  SESSION_SECRET: '<64 hex chars: openssl rand -hex 32>',
  ENCRYPTION_KEY: '<64 hex chars: openssl rand -hex 32>',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'workwiki',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  MIGRATE_ON_BOOT: 'true',
  ARGON2_MEMORY_KIB: '19456',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  ASSISTANT_ENABLED: 'false',
} as const;

const shape = {
  BASE_URL: 'an absolute http(s) URL with no trailing slash',
  DATABASE_URL: 'a postgres:// connection string',
  SESSION_SECRET: '64 hexadecimal characters (32 bytes)',
  ENCRYPTION_KEY: '64 hexadecimal characters (32 bytes)',
  S3_ENDPOINT: 'an absolute http(s) URL',
  S3_REGION: 'an S3 region name',
  S3_BUCKET: 'a bucket name',
  S3_ACCESS_KEY_ID: 'a non-empty string',
  S3_SECRET_ACCESS_KEY: 'a non-empty string',
  MIGRATE_ON_BOOT: '"true" or "false"',
  ARGON2_MEMORY_KIB: 'an integer >= 19456 (OWASP floor)',
  ARGON2_TIME_COST: 'an integer >= 2',
  ARGON2_PARALLELISM: 'an integer >= 1',
  ASSISTANT_ENABLED: '"true" or "false"',
} as const;

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hexadecimal characters');

const url = z
  .string()
  .url()
  .refine((v) => !v.endsWith('/'), 'must not end with a trailing slash');

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const intAtLeast = (min: number) =>
  z.coerce.number().int().min(min);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BASE_URL: url,
  DATABASE_URL: z.string().min(1).startsWith('postgres'),
  SESSION_SECRET: hex32,
  ENCRYPTION_KEY: hex32,

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default('true'),

  MIGRATE_ON_BOOT: bool.default('true'),

  ARGON2_MEMORY_KIB: intAtLeast(19456).default(19456),
  ARGON2_TIME_COST: intAtLeast(2).default(2),
  ARGON2_PARALLELISM: intAtLeast(1).default(1),

  // The assistant is off by default and ships with no credentials (spec §10).
  ASSISTANT_ENABLED: bool.default('false'),

  // Optional: SMTP may also be configured in the setup wizard.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  TRUST_PROXY: bool.default('false'),
});

export type Env = z.infer<typeof envSchema>;

/** Formats a validation failure as operator-readable text. No stack trace. */
export function formatEnvError(error: z.ZodError): string {
  const lines: string[] = [
    '',
    'Cannot start: the environment is not valid.',
    '',
  ];
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? '(unknown)');
    const expected = shape[name as keyof typeof shape] ?? 'see .env.example';
    const sample = example[name as keyof typeof example] ?? '';
    lines.push(`  ${name}`);
    lines.push(`      problem:  ${issue.message}`);
    lines.push(`      expected: ${expected}`);
    if (sample) lines.push(`      example:  ${name}=${sample}`);
    lines.push('');
  }
  lines.push('Copy .env.example to .env and fill these in, then start again.');
  lines.push('');
  return lines.join('\n');
}

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    process.stderr.write(formatEnvError(result.error));
    process.exit(1);
  }
  return result.data;
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    cached = parseEnv();
    warnAboutInsecureTransport(cached);
  }
  return cached;
}

let warned = false;

/**
 * An http BASE_URL means the session cookie cannot carry `Secure`, so the
 * session token crosses the wire in the clear. That is a legitimate way to
 * evaluate the product on a laptop or an internal LAN, and a bad way to run it
 * for real — so it works, loudly, rather than failing in a way that looks like
 * a bug.
 */
function warnAboutInsecureTransport(e: Env) {
  if (warned || e.BASE_URL.startsWith('https://')) return;
  warned = true;
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(e.BASE_URL);
  process.stderr.write(
    '\n' +
      `  BASE_URL is ${e.BASE_URL}, so sessions run over plain HTTP.\n` +
      '  The session cookie cannot be marked Secure, and anyone on the network\n' +
      '  path can read it. ' +
      (local
        ? 'Fine for evaluating on this machine.\n'
        : 'NOT fine for real employee data.\n') +
      '  Put a TLS-terminating proxy in front, set BASE_URL to its https URL,\n' +
      '  and set TRUST_PROXY=true.\n\n',
  );
}
