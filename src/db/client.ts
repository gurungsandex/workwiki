import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '@/env';
import * as schema from './schema';

/**
 * One pool per process. Next's dev server re-evaluates modules on every edit,
 * so the pool is parked on globalThis to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as { __workwikiPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (!globalForDb.__workwikiPool) {
    globalForDb.__workwikiPool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'workwiki',
    });
  }
  return globalForDb.__workwikiPool;
}

export const db = drizzle(getPool(), { schema });
export type Db = typeof db;
export { schema };
