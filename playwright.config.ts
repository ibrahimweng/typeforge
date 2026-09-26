import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

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

/** Where the shipped build is served from. e2e/csp.spec.ts names the same port. */
const PREVIEW_PORT = 5184;
const PREVIEW_DIR = "node_modules/.typeforge-preview";

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
  /*
   * The tree is fingerprinted before the first test and after the last, and a
   * run that was overtaken by an edit fails rather than reporting a result
   * about code that is no longer there. See e2e/fresh.ts -- it is written down
   * because it has already cost a wrong answer.
   */
  globalSetup: "./e2e/fresh-setup.ts",
  globalTeardown: "./e2e/fresh-check.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  /*
   * Three engines, because each of the other two is where this application is
   * likelier to be wrong than in Chromium.
   *
   * Everything here runs on a canvas, in IndexedDB and against fonts the
   * browser has to load, and those three are where WebKit differs from
   * Chromium rather than where it agrees. Testing Chromium alone was testing
   * the half that was never going to be the problem: a Safari user would have
   * found the fault first, on their own work, with no test able to reproduce
   * what they saw. Firefox is here for the same reason and was added after a
   * report nobody could rule the browser out of -- see the browser job in
   * .github/workflows/ci.yml.
   *
   * Chromium first so the ordinary run is unchanged, and `--project` picks one
   * when only one is wanted:
   *
   *     npx playwright test --project=webkit
   */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: [
    {
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
    /*
     * The application as it ships: built, and served with the headers the
     * deployment sends -- the Content-Security-Policy above all. Only
     * e2e/csp.spec.ts talks to it, and that file says why it has to exist.
     *
     * Built into node_modules rather than dist/, so a run of the suite never
     * overwrites a build somebody made on purpose, and nothing new needs
     * ignoring. `vite build` rather than `npm run build`: the type check is
     * not what this is testing, and it is the slow half. The build is about
     * five seconds and runs beside the dev server's start rather than after it.
     */
    {
      command: `npx vite build --outDir ${PREVIEW_DIR} --emptyOutDir --logLevel warn && npx vite preview --outDir ${PREVIEW_DIR} --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
