import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.APP_BASE_URL ??= 'http://localhost:3000';
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/x';
  process.env.SESSION_SECRET ??= 'test-secret-that-is-long-enough-for-the-schema';
  process.env.S3_ACCESS_KEY_ID ??= 'x';
  process.env.S3_SECRET_ACCESS_KEY ??= 'x';
});

describe('password policy', () => {
  it('asks for length, not composition', async () => {
    const { checkPassword } = await import('@/lib/auth/password');
    expect(checkPassword('short')?.message).toMatch(/at least 12 characters/);
    expect(checkPassword('correct horse battery staple')).toBeNull();
    expect(checkPassword('aaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('refuses a password from the breach list', async () => {
    const { checkPassword } = await import('@/lib/auth/password');
    expect(checkPassword('passwordpassword')?.message).toMatch(/breach lists/);
    expect(checkPassword('ThisIsMyPassword')?.message).toMatch(/breach lists/);
  });

  it('refuses a password containing the account name', async () => {
    const { checkPassword } = await import('@/lib/auth/password');
    expect(checkPassword('a fine long passphrase', { email: 'terrellboyd@example.com' })).toBeNull();
    expect(checkPassword('my terrellboyd password', { email: 'terrellboyd@example.com' })?.message).toMatch(
      /contains your email/,
    );
  });
});

describe('argon2id', () => {
  it('round-trips and rejects the wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false);
  }, 20_000);

  it('flags a hash made with weaker parameters for rehash on next login', async () => {
    const { hashPassword, passwordNeedsRehash } = await import('@/lib/auth/password');
    const stored = await hashPassword('correct horse battery staple');
    expect(passwordNeedsRehash(stored)).toBe(false);
    expect(passwordNeedsRehash(stored.replace('m=65536', 'm=19456'))).toBe(true);
    expect(passwordNeedsRehash('$2b$12$notargon2atall')).toBe(true);
  }, 20_000);
});

describe('content hash', () => {
  it('is stable across key order — an acknowledgment must not break on a re-serialise', async () => {
    const { contentHash } = await import('@/lib/crypto');
    expect(contentHash({ a: 1, b: [1, { x: 'y', w: 2 }] })).toBe(contentHash({ b: [1, { w: 2, x: 'y' }], a: 1 }));
  });

  it('changes when the content changes', async () => {
    const { contentHash } = await import('@/lib/crypto');
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe('configuration', () => {
  it('throws rather than exiting, so a caller that copes with it can', async () => {
    // process.exit inside a library function is uncatchable. The root layout
    // renders without a company name when there is no database yet, and it can
    // only do that if the failure is an exception.
    const { ConfigError, loadDatabaseUrl } = await import('@/env');
    expect(() => loadDatabaseUrl({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadDatabaseUrl({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('names the variable, the problem and an example', async () => {
    const { loadDatabaseUrl } = await import('@/env');
    try {
      loadDatabaseUrl({ DATABASE_URL: 'mysql://nope' } as unknown as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('problem:');
      expect(message).toContain('example:');
      expect(message).not.toContain('at Object.'); // never a stack trace
    }
  });

  it('asks for only the database URL, not the whole configuration', async () => {
    const { loadDatabaseUrl } = await import('@/env');
    expect(loadDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h:5432/d' } as unknown as NodeJS.ProcessEnv)).toBe(
      'postgres://u:p@h:5432/d',
    );
  });

  it('rejects a whole environment that is missing its required three', async () => {
    const { ConfigError, loadEnv } = await import('@/env');
    expect(() => loadEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d' } as unknown as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});
