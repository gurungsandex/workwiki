import next from 'eslint-config-next';

/**
 * eslint-config-next exports a flat-config ARRAY, not a factory.
 *
 * ESLint is pinned to 9.x and TypeScript to 6.x: eslint-plugin-react (bundled
 * inside eslint-config-next) does not yet work under ESLint 10, and
 * typescript-eslint does not yet support TypeScript 7. Both were discovered by
 * `npm run lint` failing outright rather than by reading changelogs.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      // The prototypes are design references written for their own runtime.
      // They are read, never linted, and never ported.
      'designs/**',
    ],
  },
  ...next,
];

export default config;
