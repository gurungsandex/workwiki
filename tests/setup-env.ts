/**
 * Test environment.
 *
 * Some modules (anything that pseudonymises with SESSION_SECRET) validate the
 * whole environment on first use and exit if it is incomplete. Tests get a
 * complete, obviously-fake one.
 */
process.env.BASE_URL ||= 'http://localhost:3000';
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
process.env.SESSION_SECRET ||= '0'.repeat(64);
process.env.ENCRYPTION_KEY ||= '1'.repeat(64);
process.env.S3_ENDPOINT ||= 'http://localhost:9000';
process.env.S3_REGION ||= 'us-east-1';
process.env.S3_BUCKET ||= 'test';
process.env.S3_ACCESS_KEY_ID ||= 'test';
process.env.S3_SECRET_ACCESS_KEY ||= 'test';
