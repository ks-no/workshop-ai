import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3210', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'], channel: 'chrome',
  },
  webServer: {
    command: 'npm run start', url: 'http://127.0.0.1:3210', reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
