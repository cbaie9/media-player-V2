'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'node tests/e2e/server-fixture.js',
    url: 'http://127.0.0.1:3100/login',
    // ⚠️ V1.1 : on désactive la réutilisation pour garantir un serveur
    // frais à chaque run (les fixtures E2E contiennent hasVideo, /api/me, etc.)
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});