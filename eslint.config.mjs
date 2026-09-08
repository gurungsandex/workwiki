import next from 'eslint-config-next';

/** Flat config. `next lint` was removed in Next 16; CI runs eslint directly. */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'docs/**', 'dist/**', 'dist-worker/**', 'drizzle/**', 'test-results/**', 'playwright-report/**'] },
  ...next,
];

export default config;
