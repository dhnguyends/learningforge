import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshots for docs/USER-GUIDE.md and docs/ADMIN-GUIDE.md, taken from the
 * running dev server: `npm run guides:screenshots` (E2E_BASE_URL, default
 * https://localhost:3001). Not part of the test suite.
 */
const baseURL = process.env.E2E_BASE_URL ?? "https://localhost:3001";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.shots\.ts$/,
  timeout: 10 * 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  expect: { timeout: 30_000 },
  globalSetup: "../../tests/e2e/global-setup.ts",
  use: {
    storageState: "test-results/.auth/access.json",
    ignoreHTTPSErrors: true,
    baseURL,
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        // A fake microphone, so the speaking screens show a working level meter.
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
  ],
});
