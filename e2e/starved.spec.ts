/**
 * The application with no animation library.
 *
 * Animejs is fetched alongside the application rather than inside it, which
 * creates a window -- short on a fast connection, indefinite on a bad one --
 * where every animation helper is asked to run before the library exists.
 * `motion.ts` argues that this is safe because not-yet-loaded takes the same
 * paths as `prefers-reduced-motion`, which the file already supported.
 *
 * An argument is not a test. This blocks the library outright, which is the
 * worst case the deferral can produce and worse than any real network, and
 * then does the things that animate: opening a font, drawing letters, pressing
 * controls. Without the guards it fails on "Cannot read properties of null
 * (reading 'animate')" -- the shape of every bug this change could introduce.
 */

import { expect, test } from "@playwright/test";

import { measureInk, openFont } from "./support";

test("the application works when the animation library never arrives", async ({ page }) => {
  const blocked: string[] = [];
  await page.route(/anime/i, async (route) => {
    blocked.push(route.request().url());
    await route.abort();
  });

  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");
  await openFont(page);

  expect(await measureInk(page), "letters are drawn with no animation library").toBeGreaterThan(0);

  /*
   * Press feedback is the one piece wired at startup, delegated from a single
   * pointerdown listener on the root, so any enabled button reaches it.
   */
  const pressable = page.locator("button:visible:not([disabled])");
  const count = Math.min(await pressable.count(), 6);
  expect(count, "there are enabled buttons to press").toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await pressable.nth(index).dispatchEvent("pointerdown");
  }

  await expect(page.locator("canvas").first()).toBeVisible();

  /*
   * If the served name ever stops matching, this is what says so rather than
   * the test quietly passing without having blocked anything.
   */
  expect(blocked.length, "the animejs request was actually blocked").toBeGreaterThan(0);

  // The one message expected is the browser reporting the request aborted
  // above. Anything else means the deferral broke something.
  const unexpected = errors.filter((message) => !/Failed to load resource/.test(message));
  expect(unexpected, `blocked: ${blocked.join(", ")} | console: ${errors.join(" | ")}`).toEqual([]);
});
