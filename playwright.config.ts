import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks run against the built server, the real database and the
 * real access engine. They exist to catch the class of bug unit tests cannot:
 * a body that reaches the browser when the evaluator said it should not.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3210',
    // Honour a browser supplied by the environment (CI images pin one).
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
    trace: 'off',
    // Phone-first: the design is tested at 412px before it is tested at 1060.
    ...devices['Desktop Chrome'],
  },
  projects: [
    // Signed-out checks first: they spend one of the account's login attempts.
    { name: 'signed-out', testMatch: /auth\.spec\.ts/, use: { viewport: { width: 1060, height: 900 } } },
    { name: 'setup', testMatch: /auth\.setup\.ts/, dependencies: ['signed-out'] },
    // Phone-first: the design is tested at 412px before it is tested at 1060.
    {
      name: 'phone',
      testMatch: /guide\.spec\.ts/,
      dependencies: ['setup'],
      use: { viewport: { width: 412, height: 900 }, storageState: 'e2e/.auth/admin.json' },
    },
    {
      name: 'desktop',
      testMatch: /guide\.spec\.ts/,
      dependencies: ['setup'],
      use: { viewport: { width: 1060, height: 900 }, storageState: 'e2e/.auth/admin.json' },
    },
  ],
});
