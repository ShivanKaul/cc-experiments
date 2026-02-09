import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.mjs',
  timeout: 300_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    browserName: 'chromium',
    headless: true,
  },
  workers: 1,
});
