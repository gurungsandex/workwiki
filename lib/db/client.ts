import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '@/lib/env';

let sqlClient: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!sqlClient) {
    sqlClient = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      // Never interpolate values into SQL text; postgres.js parameterises tags.
      transform: { undefined: null },
    });
  }
  return sqlClient;
}

export function db() {
  return drizzle(sql());
}
