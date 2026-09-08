#!/usr/bin/env node
/**
 * Bundle the two things that run outside Next — the migration runner and the
 * worker — into plain JavaScript.
 *
 * The production image then needs no TypeScript loader at runtime: it runs
 * `node dist/migrate.js` and `node dist/worker.js`. A build-time tool that has
 * to be present in the runtime image is a dependency surface nobody audits.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: {
    migrate: join(root, 'scripts/migrate.ts'),
    seed: join(root, 'scripts/seed.ts'),
    worker: join(root, 'src/worker/index.ts'),
  },
  outdir: join(root, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  /*
   * Only what cannot be bundled stays external: the Argon2 native addon, and
   * pg's optional native driver, which is never installed. Everything else —
   * pg, pg-boss, drizzle, zod — is inlined, so the runtime image needs one
   * package rather than a hand-picked slice of the dependency tree.
   */
  external: ['@node-rs/argon2', 'pg-native', 'cardinal'],
  banner: {
    // Bundled CJS dependencies expect these to exist in an ESM file.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirname_ } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirname_(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});
