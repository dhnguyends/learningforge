import { defineConfig, devices } from "@playwright/test";

// One source of truth for the target server. Tests, the readiness probe and
// the spawned command MUST agree on the port: probing a different port than
// the tests use makes Playwright start a second dev server alongside the
// existing one, and two dev servers racing on the same .next corrupt the
// incremental build (every route then serves the "missing required error
// components" HTML page).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const port = new URL(baseURL).port || "3000";

/**
 * E2E suite runs against a seeded dev database with all external providers
 * mocked (QUEUE_DRIVER=inline, AI_PROVIDER=mock, STORAGE_DRIVER=local).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  // One worker: parallel browsers against a dev server thrash route
  // compilation on first visit and turn cold compiles into flakes.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  // A dev server compiles each route on first visit (seconds on Windows).
  expect: { timeout: 10_000 },
  // Unlocks the LECTURE_ACCESS_KEY gate once; tests start with that cookie.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    storageState: "test-results/.auth/access.json",
    // Local HTTPS uses an mkcert certificate; Node-side requests don't read the Windows trust store.
    ignoreHTTPSErrors: true,
    baseURL,
    trace: "on-first-retry",
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // https:// base URL => the mkcert-backed dev server (npm run dev:https).
    command: `npm run ${baseURL.startsWith("https://") ? "dev:https" : "dev"} -- -p ${port}`,
    url: baseURL,
    ignoreHTTPSErrors: true,
    timeout: 120_000,
    reuseExistingServer: true,
    env: {
      QUEUE_DRIVER: "inline",
      AI_PROVIDER: "mock",
      STORAGE_DRIVER: "local",
      TRANSCRIPTION_PROVIDER: "mock",
    },
  },
});
