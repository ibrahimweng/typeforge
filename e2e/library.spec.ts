/**
 * The font library, and what it offers before anything is open.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { expect, test } from "@playwright/test";

import {
  CATALOGUE,
  FONT_PATH,
  PILE,
  dropFolder,
  openAssemble,
  openForge,
  openLibrary,
  stubLibrary,
} from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

test("lists the catalogue and measures what you choose", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);

  await expect(page.locator("[data-library-font]")).toHaveCount(CATALOGUE.length);
  await expect(page.locator("[data-library-footer]")).toContainText("from Fontsource");

  await page.locator('[data-library-font="playfair-display"]').click();
  // Fetched, parsed and measured: the panel says what it is made of, and the
  // sample is drawn from the font's own outlines.
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await expect(page.locator("[data-library-measured]")).toContainText("Contrast");
  await expect(page.locator("[data-library-sample] path").first()).toBeVisible();
  await expect(page.locator("[data-library-action]")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("narrows the catalogue by name and by kind", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);

  await page.locator("[data-library-search]").fill("play");
  await expect(page.locator("[data-library-font]")).toHaveCount(1);

  await page.locator("[data-library-search]").fill("");
  await page.locator('[data-library-category="monospace"]').click();
  await expect(page.locator("[data-library-font]")).toHaveCount(1);
  await expect(page.locator('[data-library-font="roboto-mono"]')).toBeVisible();
});

test("still offers a list when the catalogue cannot be reached", async ({ page }) => {
  await stubLibrary(page, { catalogue: false });
  await openForge(page);
  await openLibrary(page);

  // Not empty, and it says why rather than looking broken.
  await expect(page.locator("[data-library-footer]")).toContainText("built in");
  expect(await page.locator("[data-library-font]").count()).toBeGreaterThan(20);
});

test("starts a drawing from a font's proportions", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);

  const before = await page.locator('[data-forge-cell="n"] path').getAttribute("d");
  await openLibrary(page);
  await page.locator('[data-library-font="playfair-display"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await page.locator('[data-library-action="seed"]').click();

  // The dialog closes, the drawing changed, and the toolbar says where it came
  // from. The letters are drawn from a description, so they are not the
  // font's letters -- but they are its proportions.
  await expect(page.getByRole("dialog", { name: "Font library" })).toBeHidden();
  await expect
    .poll(() => page.locator('[data-forge-cell="n"] path').getAttribute("d"))
    .not.toBe(before);
  await expect(page.locator("header").first()).toContainText("My ");
});

test("shows a font behind your own letters, and puts it down again", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);
  await page.locator('[data-library-font="inter"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();

  await page.locator('[data-library-action="reference"]').click();
  await page.getByRole("button", { name: "Close the library" }).click();
  await expect(page.locator("[data-reference]")).toBeVisible();

  await openLibrary(page);
  await page.locator('[data-library-action="reference"]').click();
  await page.getByRole("button", { name: "Close the library" }).click();
  await expect(page.locator("[data-reference]")).toHaveCount(0);
});

test("borrows a font's spacing onto a set of drawings", async ({ page }) => {
  await stubLibrary(page);
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  const advanceOf = async (character: string): Promise<string | null> => {
    await page.locator(`[data-assemble-box="${character}"]`).click();
    return page.locator(`[data-assemble-stage="${character}"] ~ p`).innerText();
  };
  const before = await advanceOf("H");

  await openLibrary(page);
  await page.locator('[data-library-font="inter"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await page.locator('[data-library-action="borrow"]').click();
  await expect(page.locator("[data-library-actions]")).toContainText("Took the spacing");
  await page.getByRole("button", { name: "Close the library" }).click();

  await expect.poll(() => advanceOf("H")).not.toBe(before);
});
