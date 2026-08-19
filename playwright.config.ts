import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

/**
 * Some sandboxes ship a Chromium build that does not match the one this
 * Playwright version would fetch, and cannot download another. Use the
 * installed binary when it is there and let Playwright resolve its own
 * everywhere else, so the same config works locally and in CI.
 */
const PRESET_CHROMIUM = process.env.TYPEFORGE_CHROMIUM;
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath =
  PRESET_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: "npm run dev -- --port 5183 --strictPort",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
