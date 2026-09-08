import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadDatabaseUrl } from '@/env';
import * as schema from './schema';

/**
 * One pool per process. Next's dev server re-evaluates modules on every edit,
 * so the pool is parked on globalThis to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as { __workwikiPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (!globalForDb.__workwikiPool) {
    globalForDb.__workwikiPool = new pg.Pool({
      connectionString: loadDatabaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'workwiki',
    });
  }
  return globalForDb.__workwikiPool;
}

/**
 * Lazy on purpose.
 *
 * Building the application must not require a database URL or any other
 * secret — every route here is dynamic, so the build only needs to *load* these
 * modules, not connect. Constructing the pool at module scope made importing a
 * page validate the whole environment, which meant the production image could
 * not be built without production credentials. The pool is created on first
 * query instead.
 */
let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function real() {
  instance ??= drizzle(getPool(), { schema });
  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, property, receiver) {
    return Reflect.get(real(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(real(), property);
  },
});

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export { schema };
