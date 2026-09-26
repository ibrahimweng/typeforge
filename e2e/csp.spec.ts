/**
 * The application as it ships, under the policy it ships with.
 *
 * Every other file in this suite runs against the dev server, which sends no
 * Content-Security-Policy at all -- so the suite has never been able to see
 * the one class of fault that exists only in production: something the
 * application does that the deployment's own policy forbids. That class is
 * not hypothetical. The WOFF2 decoder is Emscripten output whose bindings are
 * assembled with `new Function`, the policy did not allow 'unsafe-eval', and
 * every compressed font -- which is every font the library fetches, and most
 * of what anybody downloads -- failed to open on the deployed site while this
 * suite passed in full.
 *
 * So this file talks to a second server: a real `vite build`, served by
 * `vite preview` with the headers read out of vercel.json (see
 * `deploymentHeaders` in vite.config.ts and the second `webServer` in
 * playwright.config.ts). It is a smoke test rather than a second suite: open a
 * WOFF2, reach every host the library reaches, and listen for the browser
 * reporting a violation. A policy tightened past what the application needs
 * fails here; so does the application starting to need something new.
 *
 * test/csp.test.ts checks the same policy statically, source by source, which
 * is quicker to read when it fails. This is what proves those sources are the
 * ones the running application actually uses.
 */

import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { FONT_PATH, openForge, openLibrary, sampleWoff2, stubLibrary } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

// playwright.config.ts starts the preview server on this port.
test.use({ baseURL: "http://127.0.0.1:5184" });

const POLICY = (
  JSON.parse(readFileSync("vercel.json", "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  }
).headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key === "Content-Security-Policy")?.value;

/**
 * Every violation the page reports, and every error.
 *
 * The browser raises `securitypolicyviolation` on the document for anything
 * the policy blocks, which is more reliable than reading the console: each
 * engine words its console message differently, and a blocked `eval` inside a
 * worker or a promise shows up as whatever error the code that wanted it
 * threw next. The event names the directive, which is the useful part.
 */
async function listen(page: Page): Promise<{ violations: string[]; errors: string[] }> {
  const violations: string[] = [];
  const errors: string[] = [];
  await page.exposeFunction("__reportViolation", (said: string) => violations.push(said));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __reportViolation: (said: string) => void }).__reportViolation(
        `${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"}`,
      );
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { violations, errors };
}

test("is served with the deployment's policy", async ({ page }) => {
  expect(POLICY, "vercel.json has no Content-Security-Policy").toBeTruthy();
  const response = await page.goto("/");
  // Without this, everything below would pass against a server that sent no
  // policy at all, and prove nothing.
  expect(response?.headers()["content-security-policy"]).toBe(POLICY);
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
});

test("opens a WOFF2 under the policy", async ({ page }) => {
  const { violations, errors } = await listen(page);
  const woff2 = await sampleWoff2();

  await page.goto("/");
  await expect(page.getByText("Make a typeface")).toBeVisible();
  await page.setInputFiles("[data-open-input]", woff2);

  // Unpacked by the WebAssembly decoder and drawn: the count the TrueType of
  // it gives. A policy that blocks the decoder fails here, with the violation
  // it tripped listed below.
  await expect(page.getByText("6,253 glyphs", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("reaches the font library's hosts under the policy", async ({ page }) => {
  const { violations, errors } = await listen(page);
  // Stubbed, as everywhere else in the suite. The policy is checked by the
  // browser before a request leaves the page, so a host `connect-src` does not
  // name is refused before the stub could answer it -- which is what makes a
  // stubbed request a fair test of the policy.
  const { fetched } = await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);
  await expect(page.locator("[data-library-footer]")).toContainText("from Fontsource");

  await page.locator('[data-library-font="inter"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  expect(fetched).toEqual([expect.stringMatching(/fonts\.gstatic\.com\/.*\/latin\.woff2$/)]);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
