import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks of exported snippets. The suite exports real snippets from
 * the studio (dev server), then loads them into blank pages on a fake origin.
 * Uses the installed Chrome, headless.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
