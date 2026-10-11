import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const preview = `pnpm preview --port ${port} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/ModoTorneo/`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI builds before running e2e; locally, build first so preview serves fresh output.
    command: process.env.CI ? preview : `pnpm build && ${preview}`,
    url: `http://localhost:${port}/ModoTorneo/`,
    reuseExistingServer: !process.env.CI,
  },
});
