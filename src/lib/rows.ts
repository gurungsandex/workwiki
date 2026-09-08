/**
 * Drizzle's typed queries hand back `Date` objects; `db.execute` with raw SQL
 * hands back the driver's strings. Raw SQL is used where a query is clearer as
 * SQL than as a builder chain, so every timestamp that comes out of one goes
 * through here rather than being trusted to already be a Date.
 */
export function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
