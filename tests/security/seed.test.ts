import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

/**
 * The application ships knowing nothing about any company.
 *
 * The seed script is the likeliest place for that to quietly stop being true,
 * so it is asserted rather than trusted.
 */
describe('the seed creates one admin and no company vocabulary', () => {
  it('inserts into no table but app_user, employee_profile, tenure_anchor and audit_event', async () => {
    const src = await readFile('scripts/seed.ts', 'utf8');
    const inserts = [...src.matchAll(/INSERT\s+INTO\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(inserts)].sort()).toEqual([
      'app_user',
      'audit_event',
      'employee_profile',
      'tenure_anchor',
    ]);
  });

  it('has no default password', async () => {
    const src = await readFile('scripts/seed.ts', 'utf8');
    expect(src).toMatch(/SEED_ADMIN_PASSWORD/);
    // No literal fallback password anywhere.
    expect(src).not.toMatch(/SEED_ADMIN_PASSWORD\s*(?:\?\?|\|\|)\s*['"]/);
  });

  it('names no department, role, section or policy', async () => {
    const src = await readFile('scripts/seed.ts', 'utf8');
    for (const table of ['department', 'role', 'employee_type', 'location', 'content_node', 'block', 'access_rule']) {
      expect(src.toLowerCase()).not.toContain(`insert into ${table}`);
    }
  });
});
