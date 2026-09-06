/**
 * Several fonts open at once, from the outside.
 *
 * The store tests beside `documents.ts` prove the swap carries the right
 * things. What they cannot prove is that the fonts arrive at all: a font comes
 * in by four doors, and when this was first wired two of them were still
 * replacing whatever was in front of you. The one anybody actually uses -- the
 * file picker -- was one of the two.
 *
 * So these go in through the picker.
 */

import { expect, test } from "@playwright/test";

import { FONT_PATH, openFont, startBlank } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

const tabs = "[data-document-tabs]";

test("no strip of tabs until there is a second font", async ({ page }) => {
  /*
   * A lone tab answers a question nobody asked, above the first screen
   * somebody sees, and it would carry a cross that does nothing -- the last
   * font never closes.
   */
  await page.goto("/");
  await openFont(page);
  await expect(page.locator(tabs)).toHaveCount(0);

  await startBlank(page);
  await expect(page.locator(tabs)).toBeVisible();
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
});

test("a second font opens beside the first rather than over it", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);

  // The blank is in front, and it is the one being worked on.
  await expect(page.locator('[data-document-tab="Untitled"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-document-tab="DejaVu Sans"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // And the first is still there, whole, a click away.
  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("the screen you were on is part of where you were in that font", async ({ page }) => {
  /*
   * Which view belongs to the font rather than to the desk, so coming back to
   * a font you were kerning puts you back in the kerning table. The tool in
   * hand is the other way round and is tested in the store, where a tool can
   * be taken up without a letter under it.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Kerning", exact: true }).click();

  await startBlank(page);
  // The new font starts where a new font starts, not where the last one was.
  await expect(page.getByRole("button", { name: "Font", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.getByRole("button", { name: "Kerning", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("closing a tab brings its neighbour forward", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);

  await page.locator('[data-close-document="Untitled"]').click();
  await expect(page.locator("[data-document-tab]")).toHaveCount(0);
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});
