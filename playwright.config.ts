import { defineConfig, devices } from "@playwright/test";

/**
 * Multi-client realtime e2e (KTD8 hydrate-on-reconnect, pause/resume, results).
 * Requires a running app and a Supabase project; intended for local/CI runs
 * with env configured. See the Verification Contract in the plan.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Generation + first-route compiles are slow, so give the suite room.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // `dev` so the suite runs without a separate build; set E2E_BASE_URL to
        // point at an already-running server (e.g. `npm run start`) instead.
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
