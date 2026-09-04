import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The access engine's purity, asserted structurally.
 *
 * evaluate.ts, tenure.ts and types.ts must not reach a database, the network or
 * the wall clock. resolve-chain.ts and compile.ts are the deliberate exceptions:
 * they are the SQL boundary and are named here so adding a third is a conscious act.
 */

const PURE = ['types.ts', 'tenure.ts', 'evaluate.ts', 'sentence.ts', 'conditions.ts'];
const FORBIDDEN = [
  /from\s+['"]@?\/?lib\/db/,
  /from\s+['"]postgres['"]/,
  /from\s+['"]drizzle/,
  /\bfetch\s*\(/,
  /Date\.now\s*\(/,
  /new Date\s*\(\s*\)/,
  /process\.env/,
];

/** Comments may legitimately mention Date.now(); code may not call it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('lib/access purity', () => {
  for (const file of PURE) {
    it(`${file} has no database, network or clock dependency`, async () => {
      const src = stripComments(
        await readFile(join(process.cwd(), 'lib/access', file), 'utf8'),
      );
      const hits = FORBIDDEN.filter((re) => re.test(src)).map(String);
      expect(hits).toEqual([]);
    });
  }

  it('evaluate.ts imports only from within lib/access', async () => {
    const src = await readFile(join(process.cwd(), 'lib/access/evaluate.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const i of imports) {
      expect(i.startsWith('./')).toBe(true);
    }
  });
});
