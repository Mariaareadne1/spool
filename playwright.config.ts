import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs in real Chromium against the Vite dev server by default.
 * E2E_PROD=1 builds and serves the production bundle (hooks enabled via ?e2e).
 * Chromium's fake camera lets the real MediaPipe pipeline load and run.
 */
const prod = process.env.E2E_PROD === '1';
const port = prod ? 4320 : 5341;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-angle=metal',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: prod ? 'npm run build && npm run preview' : 'npm run dev',
    port,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
