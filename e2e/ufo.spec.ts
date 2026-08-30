/**
 * Opening the file a designer actually works in, and leaving with it.
 *
 * The format itself is tested next to the code that reads it, and against
 * fontTools, without a browser anywhere near it. What these prove is the part
 * that only exists in a browser: that a folder can be got into the page at all,
 * that what comes out of it is a font somebody can edit, and that saving hands
 * back something that opens again.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

// These specs are ES modules, so the directory has to come from the URL.
const here = dirname(fileURLToPath(import.meta.url));
const UFO = join(here, "..", "test", "fixtures", "FixtureSans-Regular.ufo");

test.skip(!existsSync(UFO), "needs the fixture UFO");

/**
 * Open the fixture through the folder input.
 *
 * Playwright drives a `webkitdirectory` input by being handed the directory
 * rather than the files in it, which is the same thing the browser does when
 * somebody picks a folder: every file arrives knowing the path it had inside.
 */
async function openUfo(page: Page): Promise<void> {
  await page.setInputFiles("[data-open-folder-input]", UFO);
  await expect(page.getByText("Fixture Sans", { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
}

test("opens a UFO folder and draws what is in it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await openUfo(page);

  // Six glyphs, in the groups the grid sorts a font into.
  await expect(page.getByText("Opened — 6 glyphs")).toBeVisible();
  await expect(page.locator('[data-glyph-group="Capitals"]')).toContainText("1");
  await expect(page.locator('[data-glyph-group="Lowercase"]')).toContainText("1");
  // `.notdef`, `square` and `openpath` map to no character at all, which is a
  // pile of its own rather than a fault.
  await expect(page.locator('[data-glyph-group="Unencoded"]')).toContainText("3");

  await expect(page.locator('[data-glyph-cell="o"]')).toBeVisible();
  await expect(page.locator('[data-glyph-cell="Aacute"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("the letters come through with their curves and their components", async ({ page }) => {
  await page.goto("/");
  await openUfo(page);

  /*
   * `o` is four cubic segments, and the last two controls in the file belong to
   * the segment that arrives back at the first point. A reader that stops at
   * the end of the list gives the `o` a flat bottom, which is a fault you can
   * see and the paths list can count.
   */
  await page.locator('[data-glyph-cell="o"]').dblclick();
  await expect(page.locator("[data-path-row]")).toHaveCount(1);
  await expect(page.locator('[data-path-row="0"]')).toContainText("4 points");

  // `Aacute` is drawn out of `A` and an accent rather than redrawn, which is
  // what a component is and what has to survive being read.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.locator('[data-glyph-cell="Aacute"]').dblclick();
  const numbers = page.locator("[data-glyph-numbers]");
  await expect(numbers).toBeVisible();
});

test("the kerning read out of a UFO is there to be worked on", async ({ page }) => {
  await page.goto("/");
  await openUfo(page);
  await page.getByRole("button", { name: "Kerning", exact: true }).click();

  /*
   * One pair between two glyphs, and one class between two groups.
   *
   * Matched on the accessible name, which is where writing this test found a
   * fault: the count was set off with a left padding rather than a space, so
   * the tab announced itself as `pairs1`. That is the same defect the
   * inspector's scope tab had, and it turned out to be in six other places.
   */
  await expect(page.getByRole("button", { name: "pairs 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "classes 1", exact: true })).toBeVisible();
});

test("writes a UFO back out, and opens what it wrote", async ({ page }) => {
  /*
   * The round trip that matters, through the application rather than through
   * the format: open somebody's folder, change a letter, save, and open the
   * result. A UFO leaves as a zip because a page cannot hand back a folder.
   */
  await page.goto("/");
  await openUfo(page);

  // Change something, so what comes back is provably what went out rather than
  // the file that arrived.
  await page.locator('[data-glyph-cell="A"]').click();
  const panel = page.getByRole("complementary", { name: "Parameters" });
  await panel.getByRole("button", { name: "Letter A", exact: true }).click();
  const weight = panel.getByRole("slider", { name: "Weight" });
  await weight.focus();
  for (let press = 0; press < 6; press++) await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-glyph-cell="A"]')).toHaveAttribute("data-glyph-changed", "yes");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Download font" });
  await dialog.getByText("UFO (a folder, zipped)").click();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    dialog.getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ufo\.zip$/);

  const path = await download.path();
  const bytes = readFileSync(path!);
  // A zip, by the signature every one of them opens with.
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  // And it opens again, in a browser that has never seen the folder.
  await page.reload();
  await page.setInputFiles("[data-open-input]", path!);
  await expect(page.getByText("Fixture Sans", { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Opened — 6 glyphs")).toBeVisible();
  await expect(page.locator('[data-glyph-cell="Aacute"]')).toBeVisible();
});

test("says so when the folder is not a UFO", async ({ page }) => {
  // A folder of anything else is a thing somebody will drop by accident, and
  // "nothing happened" is the worst possible answer to it.
  await page.goto("/");
  await page.setInputFiles("[data-open-folder-input]", join(here, "..", "src", "ufo"));
  await expect(page.getByText("not a UFO", { exact: false })).toBeVisible();
});

test("the empty state offers the folder, because a UFO is one", async ({ page }) => {
  /*
   * An input carrying `webkitdirectory` picks folders and cannot pick files, so
   * Open cannot also be this. The empty state is the one screen with room to
   * say why there are two.
   */
  await page.goto("/");
  await expect(page.locator("[data-open-folder]")).toBeVisible();
  await expect(page.getByText("A UFO is a folder rather than a file")).toBeVisible();
});
