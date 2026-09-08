import { z } from 'zod';

/**
 * Environment is validated before the server listens. A missing or malformed
 * variable exits with the variable name, the expected shape and an example —
 * never a stack trace. (Spec §5, "Boot".)
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Required three (spec §5, "Clone").
  APP_BASE_URL: z.url({ error: 'must be an absolute URL, e.g. https://handbook.example.com' }),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, { error: 'must be a postgres connection string, e.g. postgres://user:pass@db:5432/workwiki' }),
  SESSION_SECRET: z
    .string()
    .min(32, { error: 'must be at least 32 characters of entropy, e.g. the output of `openssl rand -base64 48`' }),

  // Storage (S3 API; MinIO in Compose).
  S3_ENDPOINT: z.url().default('http://minio:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('workwiki'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),

  // Encryption key for TOTP secrets at rest (spec §11, "Data at rest").
  ENCRYPTION_KEY: z
    .string()
    .min(32, { error: 'must be at least 32 characters, e.g. the output of `openssl rand -base64 32`' })
    .optional(),

  // Mail.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  MAIL_FROM: z.string().optional(),

  // Operations.
  MIGRATE_ON_BOOT: bool.default(true),
  TRUST_PROXY: bool.default(true),
  BUILD_ID: z.string().default('dev'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Argon2id parameters, recorded in config so a login can rehash when they change.
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  // The assistant ships off. No pgvector index exists until it is turned on.
  ASSISTANT_ENABLED: bool.default(false),
});

export type Env = z.infer<typeof schema>;

const EXAMPLES: Record<string, string> = {
  APP_BASE_URL: 'https://handbook.example.com',
  DATABASE_URL: 'postgres://workwiki:secret@db:5432/workwiki',
  SESSION_SECRET: 'openssl rand -base64 48',
  S3_ACCESS_KEY_ID: 'workwiki',
  S3_SECRET_ACCESS_KEY: 'openssl rand -base64 24',
};

function formatFailure(error: z.ZodError): string {
  const lines = ['Configuration is not valid. The server did not start.', ''];
  for (const issue of error.issues) {
    const name = issue.path.join('.') || '(root)';
    lines.push(`  ${name}`);
    lines.push(`    problem:  ${issue.message}`);
    const example = EXAMPLES[name];
    if (example) lines.push(`    example:  ${example}`);
  }
  lines.push('', 'See .env.example for every variable and its shape.');
  return lines.join('\n');
}

let cached: Env | null = null;

/** Parse and cache the environment. Throws a human-readable error, never a stack trace. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const message = formatFailure(parsed.error);
    if (source.NODE_ENV === 'test') throw new Error(message);
    process.stderr.write(`\n${message}\n\n`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: validate an arbitrary object without touching the cache or exiting. */
export function parseEnv(source: Record<string, unknown>) {
  return schema.safeParse(source);
}

export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return loadEnv()[prop as keyof Env];
  },
});
