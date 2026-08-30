import { defineConfig, devices } from "@playwright/test";

// End-to-end regression net (see docs/REFACTOR_PLAN.md, Phase 0).
//
// These specs run against the Firebase Auth + Firestore emulators and the Vite
// dev server. They are launched by `npm run test:e2e`, which wraps the run in
// `firebase emulators:exec` and seeds tests/fixtures/mapair-no-space.json first.
// Running `playwright test` directly assumes the emulators are already up.

const PORT = 5173;

export default defineConfig({
  testDir: "tests/e2e",
  // One Firestore emulator database is shared by every spec; keep it serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev:e2e`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
