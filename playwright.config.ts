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
  /*
   * Tests share nothing: every one gets its own browser context, so its own
   * storage, and the three that save a download write into their own output
   * directory. Running them one at a time was costing thirty-four minutes,
   * seventeen of which was editor.spec.ts alone waiting on itself.
   *
   * fullyParallel matters more than the worker count here. Without it a file
   * is the unit of work, and a file of a hundred and forty-one tests pins one
   * worker for as long as it takes however many are idle beside it.
   *
   * Half the cores rather than all of them: the application draws outlines on
   * a canvas, so a worker is busy rather than waiting, and oversubscribing the
   * box turns a slow test into a failed one.
   */
  fullyParallel: true,
  workers: "50%",
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
    // Bind the address Playwright polls, rather than "localhost". Vite resolves
    // "localhost" itself, and on a runner with IPv6 that can land on ::1 while
    // the poll below asks 127.0.0.1, so the server comes up healthy and the
    // wait times out anyway. Naming one address leaves nothing to resolve.
    command: "npm run dev -- --host 127.0.0.1 --port 5183 --strictPort",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Without these a server that fails to boot reports only "timed out",
    // which says nothing about why.
    stdout: "pipe",
    stderr: "pipe",
  },
});
